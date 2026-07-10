/**
 * Sprint 40 — Authentication Foundation.
 *
 * Shared types for the Supabase Auth layer. `AuthUser` is deliberately minimal (id + email
 * only) — this sprint has no profile/role data wired up yet (see supabase/migrations for the
 * `profiles` table), and every consumer today only ever needs "who is this" for gating, not
 * for display beyond the email fallback in the header.
 *
 * Sprint 41.2 adds `firstName` — derived once in authClient.ts's `toAuthUser()` (see
 * app/lib/auth/deriveName.ts) so every consumer (sidebar greeting today, others later) reads
 * a single resolved value instead of re-deriving it from the raw Supabase user.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}
