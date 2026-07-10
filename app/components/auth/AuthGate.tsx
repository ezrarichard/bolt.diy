import type { ReactNode } from 'react';
import { useAuth } from '~/lib/auth/AuthProvider';
import { LoginScreen } from './LoginScreen';

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Renders exactly one of three things: a splash while the session is being restored (never
 * a flash of the real app before auth resolves), the login screen when there is no session,
 * or `children` (the real Builders app) once authenticated.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center w-full min-h-screen bg-bolt-elements-background-depth-1">
        <div className="i-ph:spinner-gap-bold animate-spin text-3xl text-accent-500" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginScreen />;
  }

  return <>{children}</>;
}
