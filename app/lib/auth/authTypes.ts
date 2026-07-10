import type { UserProfile } from './profileClient';

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

/**
 * Sprint 41.6 — `profile` is the `public.profiles` row for `user`, loaded/created once
 * `status` becomes `'authenticated'` (see AuthProvider.tsx). It's `null` while that load is
 * still in flight or BuildersDB is unconfigured — every consumer (sidebar greeting, the
 * Control Panel profile dropdown) must fall back to `user.firstName`/`user.email` in that
 * case, never assume `profile` is populated just because `status === 'authenticated'`.
 */
export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  profile: UserProfile | null;
}
