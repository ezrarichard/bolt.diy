/**
 * Provider error classification — Sprint 99, Checkpoint A.
 *
 * Acceptance Round 2 spent roughly 800 paid AI calls retrying a hard billing refusal
 * ("Your credit balance is too low to access the Anthropic API"). Every one of those calls was
 * guaranteed to fail: no amount of retrying restores a credit balance. The generation pipeline
 * had no way to tell "this might work next time" from "this cannot work until a human acts", so
 * it applied its normal 9-attempt-per-file budget to all 96 backend files.
 *
 * This module draws that line. It is a pure string classifier with no provider SDK dependency —
 * the pipeline stays provider-agnostic (see codeGenerationTypes.ts's `GenerateFn` comment), and
 * the classifier is trivially testable against real error text captured from the wire.
 */

/**
 * `non-retryable` — a human must change something (billing, credentials, quota). Abort the run
 * immediately with a structured error; never retry, never spend another call.
 *
 * `retryable` — transient or output-shaped (overload, timeout, truncation, malformed JSON).
 * The existing bounded-retry budget applies.
 */
export type ProviderErrorClass = 'non-retryable' | 'retryable';

/**
 * Matched case-insensitively against the provider's error text. Kept deliberately specific:
 * a false "non-retryable" aborts a healthy run, which is worse than one wasted retry, so
 * anything ambiguous is left to fall through to `retryable`.
 */
const NON_RETRYABLE_PATTERNS: readonly RegExp[] = [
  // Billing / credit — the exact Acceptance Round 2 failure.
  /credit balance is too low/i,
  /billing/i,
  /insufficient (?:credit|funds|balance|quota)/i,
  /payment required/i,
  /\b402\b/,

  // Authentication / authorisation — a bad or missing key never fixes itself mid-run.
  /invalid[ _-]?api[ _-]?key/i,
  /authentication[ _-]?error/i,
  /unauthorized/i,
  /permission denied/i,
  /\b401\b/,
  /\b403\b/,

  // Hard quota exhaustion (distinct from a rate limit, which IS retryable — see below).
  /quota exceeded/i,
  /exceeded your current quota/i,
  /spend limit/i,
];

/**
 * Checked BEFORE the non-retryable list, because a plain rate limit is genuinely transient and
 * its text ("rate limit exceeded") would otherwise trip the `/quota exceeded/` pattern above.
 */
const RETRYABLE_OVERRIDES: readonly RegExp[] = [/rate[ _-]?limit/i, /overloaded/i, /\b429\b/, /\b529\b/];

/** Classifies provider error text. Unknown/empty text is `retryable` — the existing bounded budget then applies. */
export function classifyProviderError(message: string | undefined | null): ProviderErrorClass {
  if (!message) {
    return 'retryable';
  }

  if (RETRYABLE_OVERRIDES.some((pattern) => pattern.test(message))) {
    return 'retryable';
  }

  return NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message)) ? 'non-retryable' : 'retryable';
}

/** True when the run must stop immediately rather than consume another paid call. */
export function isNonRetryableProviderError(message: string | undefined | null): boolean {
  return classifyProviderError(message) === 'non-retryable';
}

/**
 * True when the model stopped because it hit the output-token ceiling rather than finishing.
 * The AR2-BUG-008 investigation reproduced exactly this on a six-file backend module:
 * `finishReason: "length"` with the JSON cut off mid-string. Retrying the same batch unchanged
 * just truncates again — the batch has to get SMALLER (see `splitBatch`).
 */
export function isTruncatedOutput(finishReason: string | undefined | null, errorText?: string | null): boolean {
  if (finishReason && /^length$/i.test(finishReason)) {
    return true;
  }

  return Boolean(errorText && /cut off before completing valid JSON|truncat/i.test(errorText));
}
