/**
 * Builders Observability / AI Usage — read-side types.
 *
 * The write side already exists (app/lib/ai-usage/): every AI call funnels through
 * `recordAiUsage()` into `builders_ai_usage_events`. This module is the READ side only — it
 * never writes, and it deliberately owns no schema of its own, so the ledger stays the single
 * source of truth for AI requests.
 *
 * Every numeric field here is nullable on purpose. A provider that reports no token counts, no
 * cached-token breakdown, or a model with no configured price all produce `null` rather than a
 * fabricated number — the UI renders those as "-" (see formatters in the dashboard).
 */

import type { AiUsageStatus } from '~/lib/ai-usage/aiUsageTypes';

/** One row of `builders_ai_usage_events`, in the shape the dashboard consumes. */
export interface AiUsageEvent {
  id: string;
  createdAt: string;
  projectId: string | null;
  requestType: string;
  roleKey: string | null;

  /**
   * The generation this request belongs to, minted by aiOperationScope.ts. Null on every row
   * written before that instrumentation existed — Generation Analytics falls back to inferred
   * grouping for those (see groupIntoGenerations).
   */
  operationId: string | null;
  provider: string;
  modelKey: string | null;
  apiModel: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cachedOutputTokens: number;
  totalTokens: number;

  /** Null whenever the model has no configured price — never a guess. */
  estimatedCostUsd: number | null;

  /**
   * Set to `'override'` only when the cost was filled in at read time from configured pricing
   * (see enrichEventCosts.ts). Absent means the value is exactly what the ledger recorded.
   */
  costSource?: 'override';
  durationMs: number | null;
  status: AiUsageStatus;
  errorMessage: string | null;
}

export type AiUsageRange = 'session' | 'today' | '7d' | '30d';

export interface AiUsageFilters {
  range: AiUsageRange;

  /** Undefined means "all projects". */
  projectId?: string;
  roleKey?: string;
  provider?: string;
}

/**
 * `session` is resolved against a timestamp captured when the app loaded, not a stored session
 * id — the ledger has no session column and inventing one would mean a schema change for a
 * purely presentational grouping.
 */
export interface AiUsageQueryOptions extends AiUsageFilters {
  sessionStartedAt: string;
  limit?: number;

  /**
   * Explicit lower bound, overriding `range`. The summary/budget query needs whichever is
   * earlier of "30 days ago" and "start of this month" — on the 31st those differ, and using
   * the range alone would silently clip the 1st out of a month-to-date budget.
   */
  sinceIso?: string;
}

export interface AiUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;

  /** Null when NO event in the set had a cost — distinguishes "nothing priced" from "genuinely zero". */
  estimatedCostUsd: number | null;
  failures: number;

  /** Null when no event reported a duration. */
  averageLatencyMs: number | null;
}

export interface AiUsageBreakdownRow {
  key: string;
  label: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}
