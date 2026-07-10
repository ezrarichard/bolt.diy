import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  getCurrentSession,
  installAuthFetchInterceptor,
  onAuthStateChange,
  signInWithPassword,
  signOut as signOutClient,
  toAuthUser,
} from './authClient';
import type { AuthState } from './authTypes';

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
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
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const hasHydrated = useRef(false);

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
      setState({ status: user ? 'authenticated' : 'unauthenticated', user });

      unsubscribe = onAuthStateChange((nextUser) => {
        setState({ status: nextUser ? 'authenticated' : 'unauthenticated', user: nextUser });
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
