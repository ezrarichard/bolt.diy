/**
 * Sprint 46 — pure decision for "does an auth transition invalidate every project's BuildersDB
 * hydration state" (see app/lib/projects/hydration.ts's invalidateAllProjectHydration). Extracted
 * out of AuthProvider.tsx's effect so the two cases that must invalidate — a genuine sign-out,
 * and a same-tab account switch where a different user becomes authenticated without an
 * intervening 'unauthenticated' state — are covered by a plain test, not just component wiring.
 */
export function shouldInvalidateProjectHydration(
  previousUserId: string | null,
  nextStatus: 'authenticated' | 'unauthenticated',
  nextUserId: string | null,
): boolean {
  if (nextStatus === 'unauthenticated') {
    return previousUserId !== null;
  }

  return previousUserId !== null && previousUserId !== nextUserId;
}
