import { formatError, toStructuredError } from './structuredError';

/**
 * Shared logging helpers for the Sprint 50 Requirements Discovery repositories
 * (`requirementsSessionRepository.ts`, `requirementsSessionMessageRepository.ts`,
 * `businessUnderstandingRepository.ts`). Each of those files needs the exact same two
 * defensive-logging behaviors `buildersDbRepository.ts` already established (warn once when
 * BuildersDB isn't configured, log the real error on a failed call) — this factory avoids
 * three near-identical copies of the same two functions differing only by log-tag prefix.
 *
 * Sprint 98A, BUG-010 — `logError` now flattens the error into a single readable line BEFORE
 * logging it. Previously it passed the raw object as `console.error`'s second argument, which a
 * PostgrestError (a plain object, not an `Error`) renders as `[object Object]`. That is how
 * Acceptance Test Round 1 lost the `42703 column ... feature_ids does not exist` that would have
 * identified a total persistence outage immediately. The structured object is still logged
 * alongside the summary, so nothing is lost for a human reading a live console.
 */
export function createRepositoryLogger(tag: string) {
  return {
    unavailable(method: string): void {
      console.warn(
        `[${tag}] ${method}() skipped — BuildersDB is not configured (no BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY).`,
      );
    },
    logError(method: string, error: unknown): void {
      console.error(`[${tag}] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
    },
  };
}
