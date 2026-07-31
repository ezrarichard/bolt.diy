/**
 * Builders Observability / AI Usage — read path.
 *
 * Reads `builders_ai_usage_events` through the browser's own authenticated Supabase client, so
 * the existing `builders_ai_usage_events_select_own` RLS policy (`user_id = auth.uid()`) is what
 * scopes the results. There is no new RPC and no new table: a user can only ever see their own
 * rows, and that is enforced by Postgres rather than by this file.
 *
 * Never throws. A missing/unconfigured BuildersDB, a network failure, or an RLS rejection all
 * resolve to an empty result plus `available: false`, which the dashboard renders as an explicit
 * "usage data unavailable" state rather than as "zero usage".
 */

import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { createScopedLogger } from '~/utils/logger';
import type { AiUsageStatus } from '~/lib/ai-usage/aiUsageTypes';
import { resolveRangeStart } from './aiUsageAggregations';
import type { AiUsageEvent, AiUsageQueryOptions } from './aiUsageQueryTypes';

const logger = createScopedLogger('observability/ai-usage');

/** Caps a single fetch. The dashboard shows the most recent 100; the extra headroom keeps the range totals honest without paging. */
const DEFAULT_LIMIT = 1000;

export interface AiUsageQueryResult {
  events: AiUsageEvent[];

  /** False when the ledger could not be read at all — distinct from "read fine, found nothing". */
  available: boolean;
}

const EMPTY_UNAVAILABLE: AiUsageQueryResult = { events: [], available: false };

/** A row as Postgres returns it — snake_case, `numeric` columns arriving as string or number. */
interface AiUsageRow {
  id: string;
  created_at: string;
  project_id: string | null;
  request_type: string;
  role_key: string | null;
  provider: string;
  model_key: string | null;
  api_model: string;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cached_input_tokens: number | string | null;
  cached_output_tokens: number | string | null;
  total_tokens: number | string | null;
  estimated_cost_usd: number | string | null;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
}

/** `bigint`/`numeric` come back as strings from PostgREST; a missing value must stay null, not become 0. */
function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Token counts are `not null default 0` in the schema, so absence really is zero here. */
function toNumber(value: number | string | null | undefined): number {
  return toNullableNumber(value) ?? 0;
}

function toEvent(row: AiUsageRow): AiUsageEvent {
  return {
    id: row.id,
    createdAt: row.created_at,
    projectId: row.project_id,
    requestType: row.request_type,
    roleKey: row.role_key,
    provider: row.provider,
    modelKey: row.model_key,
    apiModel: row.api_model,
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cachedInputTokens: toNumber(row.cached_input_tokens),
    cachedOutputTokens: toNumber(row.cached_output_tokens),
    totalTokens: toNumber(row.total_tokens),
    estimatedCostUsd: toNullableNumber(row.estimated_cost_usd),
    durationMs: row.duration_ms ?? null,
    status: (row.status as AiUsageStatus) ?? 'success',
    errorMessage: row.error_message,
  };
}

/**
 * Fetches the events matching `options`. Filtering happens in Postgres (not after the fetch) so
 * the row cap applies to the filtered set — otherwise a narrow filter over a busy account could
 * return nothing simply because the newest 1000 unfiltered rows contained no match.
 */
export async function fetchAiUsageEvents(options: AiUsageQueryOptions): Promise<AiUsageQueryResult> {
  if (!isBuildersDbConfigured()) {
    return EMPTY_UNAVAILABLE;
  }

  const client = getBuildersDbClient();

  if (!client) {
    return EMPTY_UNAVAILABLE;
  }

  try {
    let query = client
      .from('builders_ai_usage_events')
      .select(
        'id, created_at, project_id, request_type, role_key, provider, model_key, api_model, ' +
          'input_tokens, output_tokens, cached_input_tokens, cached_output_tokens, total_tokens, ' +
          'estimated_cost_usd, duration_ms, status, error_message',
      )
      .gte('created_at', options.sinceIso ?? resolveRangeStart(options.range, options.sessionStartedAt))
      .order('created_at', { ascending: false })
      .limit(options.limit ?? DEFAULT_LIMIT);

    if (options.projectId) {
      query = query.eq('project_id', options.projectId);
    }

    if (options.provider) {
      query = query.eq('provider', options.provider);
    }

    /*
     * Role is stored in `role_key`, but calls that carried no role (Chat, code generation) are
     * identified by `request_type` — the breakdown groups on the same coalesced value, so the
     * filter has to match both or clicking a row's role would return nothing.
     */
    if (options.roleKey) {
      query = query.or(`role_key.eq.${options.roleKey},and(role_key.is.null,request_type.eq.${options.roleKey})`);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return { events: (data ?? []).map((row) => toEvent(row as unknown as AiUsageRow)), available: true };
  } catch (error) {
    logger.warn('Failed to read AI usage events — the dashboard will show an unavailable state.', error);
    return EMPTY_UNAVAILABLE;
  }
}
