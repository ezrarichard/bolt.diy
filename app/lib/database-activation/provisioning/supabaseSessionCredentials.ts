import { atom } from 'nanostores';

/**
 * Session-scoped Supabase Management PAT holder — Sprint 76 (Real Database Provisioning,
 * Phase 2), per docs/backend-activation/Provisioning-Architecture.md §4.
 *
 * Deliberately NOT `app/lib/stores/supabase.ts`'s `supabaseConnection` — that store persists
 * indefinitely to `localStorage`, which is appropriate for its low-stakes use (browsing your own
 * project list/env vars) but not for a token that authorizes executing real DDL against a
 * customer's database. This module holds the token in memory only, for the current tab; the only
 * persistence is an OPTIONAL `sessionStorage` mirror (cleared automatically when the tab closes) —
 * explicitly a session/development-safe convenience, not a security control (see the architecture
 * doc's §4.3 "explicit limitation").
 *
 * Never imported by `app/lib/stores/projects.ts`, `buildersDbRepository.ts`, or any artifact/
 * Product-Package assembly code — the token must never reach BuildersDB or persisted project state.
 */

const SESSION_STORAGE_KEY = 'builders_supabase_provisioning_session';

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

/** Reactive "is a provisioning session connected right now" atom — DatabaseActivationCard reads this to render Connected/Not connected, never the token itself. */
export const isSupabaseProvisioningConnected = atom<boolean>(Boolean(readSessionStorageMirror()));

let inMemoryCredential: SessionCredential | undefined = readSessionStorageMirror();

/** Stores the PAT in memory (+ the optional sessionStorage mirror) for this tab only. Never touches localStorage, BuildersDB, or any project field. */
export function connectSupabaseProvisioningSession(token: string): void {
  const credential: SessionCredential = { token, connectedAt: new Date().toISOString() };
  inMemoryCredential = credential;
  writeSessionStorageMirror(credential);
  isSupabaseProvisioningConnected.set(true);
}

/** Returns the raw PAT for use in a single outgoing request — never log, persist, or embed this value anywhere. Undefined when not connected. */
export function getSupabaseProvisioningToken(): string | undefined {
  return inMemoryCredential?.token;
}

/** Requirement: disconnecting removes ALL locally held credentials — clears both the in-memory value and the sessionStorage mirror. */
export function clearSupabaseProvisioningSession(): void {
  inMemoryCredential = undefined;
  writeSessionStorageMirror(undefined);
  isSupabaseProvisioningConnected.set(false);
}
