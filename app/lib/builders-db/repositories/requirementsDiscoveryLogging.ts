/**
 * Shared logging helpers for the Sprint 50 Requirements Discovery repositories
 * (`requirementsSessionRepository.ts`, `requirementsSessionMessageRepository.ts`,
 * `businessUnderstandingRepository.ts`). Each of those files needs the exact same two
 * defensive-logging behaviors `buildersDbRepository.ts` already established (warn once when
 * BuildersDB isn't configured, log the real error on a failed call) — this factory avoids
 * three near-identical copies of the same two functions differing only by log-tag prefix.
 */
export function createRepositoryLogger(tag: string) {
  return {
    unavailable(method: string): void {
      console.warn(
        `[${tag}] ${method}() skipped — BuildersDB is not configured (no BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY).`,
      );
    },
    logError(method: string, error: unknown): void {
      console.error(`[${tag}] ${method}() failed:`, error);
    },
  };
}
