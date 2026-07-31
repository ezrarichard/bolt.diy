import { AUTH_TOKEN_HEADER } from '~/lib/auth/authClient';
import { createScopedLogger } from '~/utils/logger';
import { calculateEstimatedCost } from './calculateEstimatedCost';
import { insertUsageEvent } from './aiUsageRepository';
import { sanitizeErrorMessage } from './sanitizeErrorMessage';
import type { AiUsageEventInput } from './aiUsageTypes';

const logger = createScopedLogger('ai-usage');

type RecordAiUsageInput = Omit<
  AiUsageEventInput,
  'inputCostUsd' | 'outputCostUsd' | 'estimatedCostUsd' | 'pricingVersion'
>;

/**
 * Why a usage event did or did not land. Returned rather than swallowed so a caller can react —
 * no caller is required to, and none of them block on it.
 */
export interface RecordAiUsageOutcome {
  recorded: boolean;
  reason?: 'no-access-token' | 'insert-rejected' | 'threw';
}

/**
 * AI Usage Ledger — Sprint 42.1.
 *
 * The one function every AI call path (app/routes/api.chat.ts, app/routes/api.generate-text.ts,
 * and any future Code Reviewer/Repair Engineer/Runtime Debugger route) calls to persist a
 * usage event — see the migration's "AI Usage Ledger Foundation" section for the schema this
 * writes to, and the Sprint 42.1 audit for why this is the narrowest practical integration
 * point (there is no single function every provider call funnels through; `/api/chat` and
 * `/api/generate-text` are the two route-level choke points instead).
 *
 * Non-blocking by construction: NEVER throws or rejects. A failure here — misconfigured
 * BuildersDB, an RLS/RPC rejection, a network error — is logged and swallowed. The caller's
 * AI response (success or failure) is always what reaches the browser; this function's own
 * outcome never changes it.
 *
 * User attribution comes entirely from `accessToken` — the same `X-Builders-Auth` token the
 * route's own `requireAuthenticatedUser()` call already validated one layer up (see
 * app/lib/auth/requireUser.ts). This function does NOT re-validate it via another Supabase
 * Auth round-trip: the real, non-forgeable check happens inside
 * `builders_record_ai_usage()` itself, which derives `user_id` from `auth.uid()` — Postgres's
 * own JWT verification of the token forwarded by aiUsageRepository.ts's per-request client.
 * If the token were somehow invalid by the time this runs, that RPC call simply fails (caught
 * below, logged, no row written) — there's no path where a bad token produces a
 * misattributed row.
 *
 * `errorMessage` is always run through sanitizeErrorMessage() here — the single, centralized
 * point every call site's error text passes through, rather than each route implementing its
 * own length/redaction logic — before it ever reaches insertUsageEvent()/the RPC.
 */
export async function recordAiUsage(
  accessToken: string | null,
  input: RecordAiUsageInput,
): Promise<RecordAiUsageOutcome> {
  if (!accessToken) {
    /*
     * Not a failure: an unauthenticated call has no user to attribute a row to, and the RPC
     * derives user_id from auth.uid(). Reported distinctly so it is never mistaken for a fault.
     */
    return { recorded: false, reason: 'no-access-token' };
  }

  try {
    const usage = input.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = calculateEstimatedCost(input.modelKey, usage);

    const ok = await insertUsageEvent(accessToken, {
      ...input,
      errorMessage: sanitizeErrorMessage(input.errorMessage),
      inputCostUsd: cost.inputCostUsd,
      outputCostUsd: cost.outputCostUsd,
      estimatedCostUsd: cost.estimatedCostUsd,
      pricingVersion: cost.pricingVersion,
    });

    if (ok) {
      return { recorded: true };
    }

    /*
     * Structured, and unconditional. The ledger was absent for weeks precisely because this path
     * produced a message nobody could search for or aggregate. Every field here is operational —
     * no prompt, no response, no credential.
     */
    logger.warn('[telemetry] AI usage event was NOT recorded. AI generation is unaffected.', {
      outcome: 'insert-rejected',
      requestType: input.requestType,
      roleKey: input.roleKey ?? null,
      provider: input.provider,
      apiModel: input.apiModel,
      projectId: input.projectId ?? null,
      hint: 'Check that builders_ai_usage_events and builders_record_ai_usage() exist — see docs/10-Operations/Observability.md.',
    });

    return { recorded: false, reason: 'insert-rejected' };
  } catch (error) {
    logger.warn('[telemetry] recordAiUsage() threw. AI generation is unaffected.', {
      outcome: 'threw',
      requestType: input.requestType,
      provider: input.provider,
      apiModel: input.apiModel,
      error: error instanceof Error ? error.message : String(error),
    });

    return { recorded: false, reason: 'threw' };
  }
}

/** Reads the same header requireAuthenticatedUser() (app/lib/auth/requireUser.ts) already validated for this request — the one place every call site should pull the token from, so nobody re-derives the header name themselves. */
export function getRequestAccessToken(request: Request): string | null {
  return request.headers.get(AUTH_TOKEN_HEADER)?.trim() || null;
}
