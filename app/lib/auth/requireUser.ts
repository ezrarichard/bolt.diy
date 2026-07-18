import type { AppLoadContext } from '@remix-run/cloudflare';
import { getServerAuthClient } from './authServer';
import { AUTH_TOKEN_HEADER } from './authClient';
import { deriveFirstName } from './deriveName';
import type { AuthUser } from './authTypes';

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Single shared server-side guard for every API route that must not run for an
 * unauthenticated caller (AI generation, code/package generation, repair engine,
 * BuildersDB-backed data, third-party integration proxies). Callers place this as the very
 * first statement in their exported `action`/`loader` — never inside an inner try/catch — so
 * the thrown 401 `Response` reaches the client untouched via Remix's standard
 * "a thrown Response becomes the response" behavior, instead of being caught and rewritten
 * into a generic 500 by a handler's own error handling.
 *
 * Verifies the `X-Builders-Auth` header (attached to every same-origin `/api/*` fetch by the
 * browser-side interceptor — see app/lib/auth/authClient.ts) against Supabase Auth. A
 * dedicated header, not the standard `Authorization` header, is used deliberately — see
 * AUTH_TOKEN_HEADER's comment in authClient.ts for the collision it avoids. No
 * cookie/session-storage layer is introduced for this sprint; this token-header pattern
 * integrates cleanly with the existing "every route reads what it needs off the request"
 * style already used throughout app/routes/api.*.ts.
 */
export async function requireAuthenticatedUser(request: Request, context: AppLoadContext): Promise<AuthUser> {
  const token = request.headers.get(AUTH_TOKEN_HEADER)?.trim() || null;

  if (!token) {
    throw unauthorized('Missing session token');
  }

  const client = getServerAuthClient(context);

  if (!client) {
    throw unauthorized('Authentication is not configured on this deployment');
  }

  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    throw unauthorized('Invalid or expired session');
  }

  return { id: data.user.id, email: data.user.email ?? null, firstName: deriveFirstName(data.user) };
}
