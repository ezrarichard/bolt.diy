import { useState, type FormEvent } from 'react';
import { useAuth } from '~/lib/auth/AuthProvider';
import { isAuthConfigured } from '~/lib/auth/authClient';
import { BuildersWordmark } from '~/components/branding/BuildersLogo';

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Compact, internal-tool login screen — no signup link, no social login, no marketing
 * copy. Rendered by AuthGate.tsx in place of the entire Builders app whenever there is no
 * valid session; Builders home/Workbench/BuildersDB hydration never mount behind this.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const configured = isAuthConfigured();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const signInError = await signIn(email, password);

    setSubmitting(false);

    if (signInError) {
      setError(signInError);
    }
  }

  return (
    <div className="flex items-center justify-center w-full min-h-screen bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-sm rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <BuildersWordmark iconSize={40} textClassName="text-2xl text-bolt-elements-textPrimary" className="mb-1" />
          <div className="text-sm text-bolt-elements-textSecondary">AI Product Engineering Workspace</div>
        </div>

        <div className="mb-6 text-center text-sm text-bolt-elements-textSecondary">Sign in to continue</div>

        {!configured ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            Authentication is not configured on this deployment. Set{' '}
            <code className="text-xs">BUILDERS_DB_SUPABASE_URL</code> and{' '}
            <code className="text-xs">BUILDERS_DB_SUPABASE_ANON_KEY</code>.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-medium text-bolt-elements-textSecondary">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary outline-none transition-colors focus:border-accent-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs font-medium text-bolt-elements-textSecondary">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary outline-none transition-colors focus:border-accent-500"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-bolt-elements-textSecondary opacity-70">
          Internal team access only.
        </div>
      </div>
    </div>
  );
}
