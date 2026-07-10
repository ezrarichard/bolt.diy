import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  getCurrentSession,
  installAuthFetchInterceptor,
  onAuthStateChange,
  signInWithPassword,
  signOut as signOutClient,
  syncDisplayNameToAuthMetadata,
  toAuthUser,
} from './authClient';
import { ensureUserProfile, fetchUserProfile, updateUserProfile, type ProfileUpdateInput } from './profileClient';
import type { AuthState } from './authTypes';

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  /** Sprint 41.6 — same cached value as `profile` above; exposed as a method too so callers can grab it once without subscribing to context updates. */
  getCurrentUserProfile: () => AuthState['profile'];

  /** Re-fetches `public.profiles` for the current user and updates `profile`. */
  refreshCurrentUserProfile: () => Promise<void>;

  /** Updates `public.profiles`, updates `profile` on success, and (best-effort) mirrors a changed display name into Supabase Auth metadata. */
  updateCurrentUserProfile: (updates: ProfileUpdateInput) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Single source of truth for "is anyone logged in" — restores the Supabase session on
 * mount, subscribes to auth-state changes (covers sign-in, sign-out, and token refresh), and
 * exposes sign-in/sign-out so no other component needs to import `~/lib/auth/authClient`
 * directly.
 *
 * Also owns the ONE place BuildersDB project hydration is triggered from. Previously
 * `hydrateProjectsFromBuildersDb()` fired at module load (app/lib/stores/projects.ts) —
 * before any auth check could exist — which is exactly the "unauthenticated browser
 * hydrates the whole shared project dataset" risk this sprint closes. It now fires once,
 * only after `status` first becomes `'authenticated'`.
 *
 * Sprint 41.6 — also owns `public.profiles`. The instant `user` resolves to non-null (both on
 * initial load and on every subsequent auth-state change, e.g. after sign-in), it calls
 * `ensureUserProfile()` (app/lib/auth/profileClient.ts) — an upsert that only ever INSERTs,
 * so it safely recovers a missing profile row for a pre-existing user without ever
 * overwriting one that already exists — then stores the result in `profile`. No other
 * component queries `profiles` directly; they all read `profile`/call these three methods.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, profile: null });
  const hasHydrated = useRef(false);

  const loadProfileFor = async (rawUser: SupabaseUser) => {
    const profile = await ensureUserProfile(rawUser);
    setState((prev) => (prev.user?.id === rawUser.id ? { ...prev, profile } : prev));
  };

  useEffect(() => {
    installAuthFetchInterceptor();

    let unsubscribe: () => void = () => undefined;
    let cancelled = false;

    (async () => {
      const session = await getCurrentSession();

      if (cancelled) {
        return;
      }

      const user = toAuthUser(session);
      setState({ status: user ? 'authenticated' : 'unauthenticated', user, profile: null });

      if (user && session?.user) {
        loadProfileFor(session.user);
      }

      unsubscribe = onAuthStateChange((nextUser, rawUser) => {
        setState((prev) => ({
          status: nextUser ? 'authenticated' : 'unauthenticated',
          user: nextUser,
          profile: nextUser && nextUser.id === prev.user?.id ? prev.profile : null,
        }));

        if (nextUser && rawUser) {
          loadProfileFor(rawUser);
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state.status === 'authenticated' && !hasHydrated.current) {
      hasHydrated.current = true;
      import('~/lib/stores/projects').then(({ hydrateProjectsFromBuildersDb }) => {
        hydrateProjectsFromBuildersDb();
      });
    }

    if (state.status === 'unauthenticated') {
      hasHydrated.current = false;
    }
  }, [state.status]);

  const value: AuthContextValue = {
    ...state,
    signIn: async (email, password) => {
      const { error } = await signInWithPassword(email, password);
      return error;
    },
    signOut: async () => {
      await signOutClient();
    },
    getCurrentUserProfile: () => state.profile,
    refreshCurrentUserProfile: async () => {
      const userId = state.user?.id;

      if (!userId) {
        return;
      }

      const profile = await fetchUserProfile(userId);
      setState((prev) => (prev.user?.id === userId ? { ...prev, profile } : prev));
    },
    updateCurrentUserProfile: async (updates) => {
      const userId = state.user?.id;

      if (!userId) {
        return { error: 'Not signed in.' };
      }

      const { profile, error } = await updateUserProfile(userId, updates);

      if (error) {
        return { error };
      }

      setState((prev) => (prev.user?.id === userId ? { ...prev, profile } : prev));

      if (updates.displayName !== undefined && updates.displayName.trim()) {
        syncDisplayNameToAuthMetadata(updates.displayName.trim()).catch(() => undefined);
      }

      return { error: null };
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAuth() must be used within <AuthProvider>');
  }

  return ctx;
}
