/**
 * Retry-with-backoff — Sprint 76 (Real Database Provisioning, Phase 2).
 *
 * Provider-agnostic: does not know about Supabase, SQL, or any specific provider — any
 * `DatabaseProvisioner` implementation (present or future — Postgres, MySQL, a self-hosted
 * CubicleDB) can reuse this unchanged. Only retries failures the caller marks retryable
 * (network/5xx-shaped transients); a caller-supplied `isRetryable` predicate decides that, since
 * "was this a transient failure" is inherently provider-specific (e.g. a Postgres syntax error
 * should never be retried, a fetch timeout should).
 */

export interface RetryOptions {
  /** Maximum number of attempts, including the first — default 3. */
  maxAttempts?: number;

  /** Base delay in ms before the first retry; doubles each subsequent attempt — default 250. */
  baseDelayMs?: number;

  /** Decides whether a given failure is worth retrying. Defaults to "always retry" if omitted. */
  isRetryable?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;

  /** How many attempts were actually made (1 = succeeded or failed on the first try, no retry occurred). */
  attempts: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` up to `maxAttempts` times, retrying only while `isRetryable(error)` is true and
 * attempts remain. Never throws — the last failure (if all attempts are exhausted) is returned as
 * `{ ok: false, error, attempts }` rather than propagated, so callers get a uniform result shape
 * whether the underlying operation throws or the retry budget just runs out.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const isRetryable = options.isRetryable ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;

      const attemptsRemain = attempt < maxAttempts;

      if (!attemptsRemain || !isRetryable(error)) {
        return { ok: false, error, attempts: attempt };
      }

      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  return { ok: false, error: lastError, attempts: maxAttempts };
}
