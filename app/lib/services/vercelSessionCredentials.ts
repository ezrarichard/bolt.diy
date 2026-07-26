import { atom } from 'nanostores';

/**
 * Session-scoped Vercel access token holder — Sprint 91 (Vercel Deployment Integration), Part 2.
 *
 * Deliberately NOT `app/lib/stores/vercel.ts`'s `vercelConnection` store — that legacy store
 * persists the raw token to `localStorage` (and a 365-day cookie via `VercelTab.tsx`), which this
 * sprint's own rules explicitly forbid for a token used to trigger real deployments. This module
 * mirrors `app/lib/database-activation/provisioning/supabaseSessionCredentials.ts` exactly: the
 * token lives in memory only, for the current tab, with an OPTIONAL `sessionStorage` mirror
 * (cleared automatically when the tab closes) — a convenience, not a security control.
 *
 * Never imported by `app/lib/stores/projects.ts` or any BuildersDB-writing code — the token must
 * never reach `Deployment.metadata`, `Deployment History`, or any persisted project state. The
 * legacy `vercel_connection` localStorage/cookie store is intentionally left untouched by this
 * sprint (out of scope — see the Sprint 91 final report's "remaining work" section); this new
 * flow simply never reads or writes it.
 */

const SESSION_STORAGE_KEY = 'builders_vercel_deploy_session';

interface SessionCredential {
  token: string;
  connectedAt: string;
}

function readSessionStorageMirror(): SessionCredential | undefined {
  if (typeof globalThis === 'undefined' || typeof globalThis.sessionStorage === 'undefined') {
    return undefined;
  }

  try {
    const raw = globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionCredential) : undefined;
  } catch {
    return undefined;
  }
}

function writeSessionStorageMirror(credential: SessionCredential | undefined): void {
  if (typeof globalThis === 'undefined' || typeof globalThis.sessionStorage === 'undefined') {
    return;
  }

  try {
    if (credential) {
      globalThis.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(credential));
    } else {
      globalThis.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable (private browsing, quota, SSR) — in-memory value still works for this tab.
  }
}

/** Reactive "is a deploy session connected right now" atom — UI reads this to render Connected/Not connected, never the token itself. */
export const isVercelSessionConnected = atom<boolean>(Boolean(readSessionStorageMirror()));

let inMemoryCredential: SessionCredential | undefined = readSessionStorageMirror();

/** Stores the token in memory (+ the optional sessionStorage mirror) for this tab only. Never touches localStorage, cookies, BuildersDB, or any project field. */
export function connectVercelSession(token: string): void {
  const credential: SessionCredential = { token, connectedAt: new Date().toISOString() };
  inMemoryCredential = credential;
  writeSessionStorageMirror(credential);
  isVercelSessionConnected.set(true);
}

/** Returns the raw token for use in a single outgoing request — never log, persist, or embed this value anywhere. Undefined when not connected. */
export function getVercelSessionToken(): string | undefined {
  return inMemoryCredential?.token;
}

/** Disconnecting removes ALL locally held credentials — clears both the in-memory value and the sessionStorage mirror. */
export function clearVercelSession(): void {
  inMemoryCredential = undefined;
  writeSessionStorageMirror(undefined);
  isVercelSessionConnected.set(false);
}
