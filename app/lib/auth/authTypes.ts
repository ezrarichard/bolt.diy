/**
 * Sprint 40 — Authentication Foundation.
 *
 * Shared types for the Supabase Auth layer. `AuthUser` is deliberately minimal (id + email
 * only) — this sprint has no profile/role data wired up yet (see supabase/migrations for the
 * `profiles` table), and every consumer today only ever needs "who is this" for gating, not
 * for display beyond the email fallback in the header.
 */

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}
