import type { ParsedDraftResult } from './draftParsing';

/**
 * Role Generation Recovery — Sprint 44 (Truncated-JSON reliability fix).
 *
 * A single AI role generation can end truncated: the model hits its output-token ceiling,
 * the provider reports `finishReason: 'length'`, and the JSON is cut off mid-object. Before
 * this module the autonomous pipeline (app/lib/hooks/useAutoEngineeringPipeline.ts) had no
 * awareness of that — it parsed the truncated text, failed, and stopped the whole pipeline
 * at that role with no retry.
 *
 * This is the pure, provider-agnostic recovery core: given an injected `generate` function
 * it runs ONE role to a clean, fully-parsed draft, with a bounded number of automatic
 * retries. It never touches React, the store, the network, or any specific provider — the
 * hook wires the real `generate`/context/persistence around it, and the tests wire a fake
 * `generate` (see roleGenerationRecovery.spec.ts). Because it only ever returns `ok: true`
 * for a fully-parsed, non-truncated draft, the caller can never create an artifact from a
 * partial/incomplete response (requirement: "never auto-approve malformed or incomplete
 * content", "never create duplicate role-output versions for failed partial responses").
 */

/** The minimal `generate` contract this module needs — a subset of useGenerateText.ts's `generate` (which now surfaces `finishReason`, Sprint 44). */
export type RecoveryGenerateFn = (
  system: string | undefined,
  prompt: string,
  options?: { maxTokens?: number; model?: string; provider?: string; temperature?: number; [key: string]: unknown },
) => Promise<{ ok: true; text: string; finishReason?: string } | { ok: false; error: string }>;

/** Why a role generation failed, kept distinct so the UI/telemetry can tell truncation apart from a genuine bad response. */
export type RoleGenerationFailureKind = 'truncated' | 'empty' | 'invalid' | 'error';

export type RoleGenerationResult<T> =
  | { ok: true; draft: T; attempts: number }
  | { ok: false; kind: RoleGenerationFailureKind; message: string; attempts: number };

/** One safe telemetry record per attempt — deliberately excludes prompt text, system text, API keys, and JWTs (only non-sensitive routing/outcome fields). */
export interface RoleGenerationAttemptLog {
  projectId: string;
  roleKey: string;
  provider: string | undefined;
  model: string | undefined;
  maxOutputTokens: number;
  attempt: number;
  isRetry: boolean;
  ok: boolean;
  finishReason: string | undefined;
  outcome: 'success' | RoleGenerationFailureKind;
}

export interface RoleGenerationDeps<T> {
  projectId: string;
  roleKey: string;
  system: string;

  /** The engine-built user prompt (never modified in place — retries append a JSON-only reinforcement to a copy). */
  prompt: string;

  /**
   * The additive "## Persistent Project Context from BuildersDB" block. Included on the
   * first attempt only; retries drop it because it re-lists upstream role outputs the
   * engine's own prompt already summarizes, so it's the cheapest input to shed when the
   * previous attempt ran out of room. Empty string when BuildersDB is unavailable.
   */
  contextBlock: string;

  /** Base output-token ceiling for the first attempt (unchanged from the normal pipeline — 8192). Retries raise it, capped at RETRY_MAX_OUTPUT_TOKENS_CEILING. */
  maxOutputTokens: number;

  parseDraft: (rawText: string) => ParsedDraftResult<T>;
  generate: RecoveryGenerateFn;

  /** Profile/model routing for the normal attempts (from getRoleGenerateOptions). */
  baseOptions: Record<string, unknown>;

  /**
   * Optional stronger fallback model, applied only on the final retry — used only if such a
   * fallback already exists (none is configured in the codebase today, so this stays
   * undefined and the final retry reuses the same model with the tightest prompt/budget).
   */
  fallbackOptions?: Record<string, unknown>;

  /** Max AUTOMATIC retries after the first attempt (default 2 → up to 3 total attempts). */
  maxRetries?: number;

  /** Safe, non-sensitive per-attempt telemetry sink. */
  onAttempt?: (log: RoleGenerationAttemptLog) => void;
}

const DEFAULT_MAX_RETRIES = 2;

/** Absolute ceiling for a raised retry budget, so a bug can never request an unbounded output length. */
const RETRY_MAX_OUTPUT_TOKENS_CEILING = 16000;

/** Appended to the prompt on every retry: the previous attempt was cut off, so ask for a smaller, fences-free, single JSON object that actually fits. Never invents content — only tightens format/length. */
const RETRY_JSON_ONLY_INSTRUCTION = `

IMPORTANT: Your previous response was cut off before the JSON finished. Return ONLY the single JSON object described above — no markdown code fences, no prose before or after it. Be more concise so the entire object fits in one response: keep every text field to 1-2 short sentences and every list to at most 5 items. Do not omit any key.`;

/** True when a parsed-draft error message is the shared parser's truncation signal (see draftParsing.ts's looksTruncated branch), as opposed to a genuinely malformed/non-JSON response. */
function isTruncationError(message: string): boolean {
  return /cut off before completing/i.test(message);
}

/**
 * Runs one role generation to a fully-parsed draft, with bounded automatic retries.
 *
 * Retry strategy (requirement "RETRY POLICY"):
 *  - attempt 0: exactly the normal pipeline call (base prompt + BuildersDB context block +
 *    base budget + profile model) — so a project that already generates fine is unchanged.
 *  - retry 1: same model, redundant BuildersDB context block dropped, an explicit
 *    JSON-only + be-concise instruction appended, and the output budget raised.
 *  - retry 2: same as retry 1 but using the stronger fallback model if one is configured
 *    (none is today, so it reuses the same model).
 *
 * A response is treated as unusable — and retried, never approved — when the call fails, the
 * text is empty, the provider reports `finishReason: 'length'` (truncated: not parsed at
 * all, per requirement), the parser reports truncation/invalid JSON, or the parsed draft has
 * zero populated fields. Only a clean, non-truncated, non-empty parsed draft returns ok.
 */
export async function generateRoleWithRecovery<T extends object>(
  deps: RoleGenerationDeps<T>,
): Promise<RoleGenerationResult<T>> {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;

  let lastKind: RoleGenerationFailureKind = 'error';
  let lastMessage = 'The AI response could not be generated.';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isRetry = attempt > 0;
    const isFinalRetry = attempt === maxRetries;

    const prompt = isRetry
      ? `${deps.prompt}${RETRY_JSON_ONLY_INSTRUCTION}`
      : deps.contextBlock
        ? `${deps.prompt}\n\n${deps.contextBlock}`
        : deps.prompt;

    const maxTokens = isRetry
      ? Math.min(deps.maxOutputTokens * 2, RETRY_MAX_OUTPUT_TOKENS_CEILING)
      : deps.maxOutputTokens;

    const options: Record<string, unknown> = {
      maxTokens,
      ...deps.baseOptions,
      ...(isFinalRetry && deps.fallbackOptions ? deps.fallbackOptions : {}),
    };

    const result = await deps.generate(deps.system, prompt, options);

    const finishReason = result.ok ? result.finishReason : undefined;

    let outcome: 'success' | RoleGenerationFailureKind;

    if (!result.ok) {
      lastKind = 'error';
      lastMessage = result.error;
      outcome = 'error';
    } else if (!result.text || result.text.trim().length === 0) {
      lastKind = 'empty';
      lastMessage = 'The AI returned an empty response.';
      outcome = 'empty';
    } else if (result.finishReason === 'length') {
      // Requirement: do NOT parse a length-truncated response as a normal answer — retry instead.
      lastKind = 'truncated';
      lastMessage = 'The AI response was cut off before completing valid JSON.';
      outcome = 'truncated';
    } else {
      const parsed = deps.parseDraft(result.text);

      if (!parsed.ok) {
        lastKind = isTruncationError(parsed.error) ? 'truncated' : 'invalid';
        lastMessage = parsed.error;
        outcome = lastKind;
      } else if (Object.keys(parsed.draft).length === 0) {
        // Parsed as JSON but nothing usable survived validation — treat as incomplete, never approve. Never "repairs" by inventing content.
        lastKind = 'invalid';
        lastMessage = 'The AI response did not contain any of the expected fields.';
        outcome = 'invalid';
      } else {
        deps.onAttempt?.({
          projectId: deps.projectId,
          roleKey: deps.roleKey,
          provider: deps.baseOptions.provider as string | undefined,
          model: (isFinalRetry && deps.fallbackOptions?.model ? deps.fallbackOptions.model : deps.baseOptions.model) as
            | string
            | undefined,
          maxOutputTokens: maxTokens,
          attempt,
          isRetry,
          ok: true,
          finishReason,
          outcome: 'success',
        });

        return { ok: true, draft: parsed.draft, attempts: attempt + 1 };
      }
    }

    deps.onAttempt?.({
      projectId: deps.projectId,
      roleKey: deps.roleKey,
      provider: deps.baseOptions.provider as string | undefined,
      model: (isFinalRetry && deps.fallbackOptions?.model ? deps.fallbackOptions.model : deps.baseOptions.model) as
        | string
        | undefined,
      maxOutputTokens: maxTokens,
      attempt,
      isRetry,
      ok: result.ok,
      finishReason,
      outcome,
    });
  }

  return { ok: false, kind: lastKind, message: lastMessage, attempts: maxRetries + 1 };
}
