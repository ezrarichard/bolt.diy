import { createClient } from '@supabase/supabase-js';
import { getBuildersDbConfig, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { AiUsageEventInput } from './aiUsageTypes';
import { formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';

/**
 * AI Usage Ledger — Sprint 42.1.
 *
 * A fresh, per-request Supabase client carrying the CALLER'S OWN verified access token as its
 * Authorization header — deliberately never the memoized singleton `getBuildersDbClient()`
 * returns (app/lib/builders-db/client.ts), which is anon-key only with no session attached
 * when called from server code (see the Sprint 42 security audit's Part 1 finding: every
 * server-side `.from()`/`.rpc()` call through that singleton executes as Postgres role `anon`,
 * so `auth.uid()` would resolve to null inside any RLS policy or SECURITY DEFINER function it
 * calls). This is what makes `builders_record_ai_usage()`'s `auth.uid()` resolve correctly.
 *
 * Constructed fresh on every call (cheap — no network round-trip, just an object) rather than
 * cached: caching a specific user's token in a module-level singleton would leak it across
 * requests in a shared Worker isolate, the same reason `getBuildersDbClient()`'s caching
 * pattern is safe (it holds no per-user state) but this can't reuse that pattern.
 */
function createAuthedClient(accessToken: string) {
  const config = getBuildersDbConfig();

  if (!config) {
    return null;
  }

  return createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function logError(method: string, error: unknown): void {
  console.error(`[AiUsage] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

/**
 * Writes one builders_ai_usage_events row via the `builders_record_ai_usage()` SECURITY
 * DEFINER RPC (see the migration) — never a direct `.from('builders_ai_usage_events').insert()`.
 * There is no INSERT policy on that table for `authenticated` at all, so a direct insert
 * would always be rejected regardless of which client attempts it; the RPC is the only write
 * path. It derives `user_id` from `auth.uid()` (resolved from `accessToken` above) and
 * independently re-validates `projectId` — this function never asks Postgres to trust a
 * client-supplied user id.
 *
 * Never throws — every caller (recordAiUsage.ts) treats a `false` return as "logged and
 * moved on," matching the same defensive contract as every buildersDbRepository.ts function.
 */
export async function insertUsageEvent(accessToken: string, input: AiUsageEventInput): Promise<boolean> {
  if (!isBuildersDbConfigured()) {
    console.warn('[AiUsage] insertUsageEvent() skipped — BuildersDB is not configured.');
    return false;
  }

  const client = createAuthedClient(accessToken);

  if (!client) {
    console.warn('[AiUsage] insertUsageEvent() skipped — BuildersDB is not configured.');
    return false;
  }

  try {
    const usage = input.usage ?? { inputTokens: 0, outputTokens: 0 };
    const totalTokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens;

    const { error } = await client.rpc('builders_record_ai_usage', {
      p_project_id: input.projectId ?? null,
      p_actor_display_name: null,
      p_request_type: input.requestType,
      p_role_key: input.roleKey ?? null,
      p_generation_profile_id: input.generationProfileId ?? null,
      p_operation_id: input.operationId ?? null,
      p_parent_operation_id: input.parentOperationId ?? null,
      p_provider: input.provider,
      p_model_key: input.modelKey ?? null,
      p_api_model: input.apiModel,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cached_input_tokens: usage.cachedInputTokens ?? 0,
      p_cached_output_tokens: usage.cachedOutputTokens ?? 0,
      p_total_tokens: totalTokens,
      p_input_cost_usd: input.inputCostUsd ?? null,
      p_output_cost_usd: input.outputCostUsd ?? null,
      p_estimated_cost_usd: input.estimatedCostUsd ?? null,
      p_pricing_version: input.pricingVersion ?? null,
      p_duration_ms: input.durationMs ?? null,
      p_status: input.status,
      p_error_code: input.errorCode ?? null,
      p_error_message: input.errorMessage ?? null,
      p_provider_request_id: input.providerRequestId ?? null,
      p_repair_attempt_number: input.repairAttemptNumber ?? null,
      p_metadata: input.metadata ?? {},
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('insertUsageEvent', error);
    return false;
  }
}
