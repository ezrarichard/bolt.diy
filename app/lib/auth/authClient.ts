import type { Session } from '@supabase/supabase-js';
import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { deriveFirstName } from './deriveName';
import type { AuthUser } from './authTypes';

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Browser-side Supabase Auth calls, centralized here so no component talks to
 * `supabase.auth` directly (per the sprint's "avoid scattering direct Supabase Auth calls"
 * requirement). Deliberately reuses `getBuildersDbClient()` (app/lib/builders-db/client.ts)
 * rather than constructing a second `SupabaseClient` — auth.users and BuildersDB's tables
 * live in the same Supabase project, and supabase-js supports using one client for both.
 */

export function toAuthUser(session: Session | null): AuthUser | null {
  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? null,
    firstName: deriveFirstName(session.user),
  };
}

export function isAuthConfigured(): boolean {
  return isBuildersDbConfigured();
}

export async function getCurrentSession(): Promise<Session | null> {
  const client = getBuildersDbClient();

  if (!client) {
    return null;
  }

  const { data } = await client.auth.getSession();

  return data.session;
}

/** Returns an unsubscribe function. */
export function onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
  const client = getBuildersDbClient();

  if (!client) {
    return () => undefined;
  }

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(toAuthUser(session));
  });

  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string): Promise<{ error: string | null }> {
  const client = getBuildersDbClient();

  if (!client) {
    return { error: 'Authentication is not configured on this deployment.' };
  }

  const { error } = await client.auth.signInWithPassword({ email, password });

  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  const client = getBuildersDbClient();

  if (!client) {
    return;
  }

  await client.auth.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.access_token ?? null;
}

let fetchPatched = false;

/**
 * Header used for Builders' own session token — deliberately NOT the standard `Authorization`
 * header. Several existing routes already read/forward a caller-supplied `Authorization`
 * header for their own purposes (api.git-proxy.$.ts forwards it verbatim to third-party git
 * hosts; api.vercel-user.ts falls back to reading a Vercel token from it) — overwriting that
 * header on every `/api/*` request would silently break both. A dedicated header sidesteps
 * the collision entirely; both ends (this file and app/lib/auth/requireUser.ts) agree on it.
 */
export const AUTH_TOKEN_HEADER = 'X-Builders-Auth';

/**
 * Patches `window.fetch` once so every same-origin `/api/*` request automatically carries the
 * current Supabase access token — the transport `requireAuthenticatedUser()`
 * (app/lib/auth/requireUser.ts) expects. Centralizing this here means the ~20 existing
 * components/hooks that already call `fetch('/api/...')` (chat, generate-text, enhancer,
 * GitHub/GitLab/Netlify/Vercel integrations, etc.) need no changes at all, instead of
 * hand-editing every call site.
 */
export function installAuthFetchInterceptor(): void {
  if (typeof window === 'undefined' || fetchPatched) {
    return;
  }

  fetchPatched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const isSameOriginApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);

    if (!isSameOriginApi) {
      return originalFetch(input, init);
    }

    const token = await getAccessToken();

    if (!token) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(AUTH_TOKEN_HEADER, token);

    return originalFetch(input, { ...init, headers });
  };
}
