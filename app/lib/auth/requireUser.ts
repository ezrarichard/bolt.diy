import type { AppLoadContext } from '@remix-run/cloudflare';
import { getServerAuthAnonKeyFingerprint, getServerAuthClient, getServerAuthProjectHost } from './authServer';
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
 * TEMPORARY DIAGNOSTIC — decodes a JWT's payload for logging ONLY iss/aud/exp/iat (never the
 * token itself, never any secret). Does not verify the signature — this is purely to see what
 * the token *claims* without ever printing it; real verification still happens via
 * `client.auth.getUser(token)` below. Remove once the getUser() 401 investigation is closed.
 */
function decodeJwtClaimsForDiagnostics(
  token: string,
): { iss?: string; aud?: string; exp?: number; iat?: number } | null {
  try {
    const payloadSegment = token.split('.')[1];

    if (!payloadSegment) {
      return null;
    }

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    const payload = JSON.parse(json) as Record<string, unknown>;

    return {
      iss: typeof payload.iss === 'string' ? payload.iss : undefined,
      aud: typeof payload.aud === 'string' ? payload.aud : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
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

  /*
   * TEMPORARY DIAGNOSTIC — see decodeJwtClaimsForDiagnostics's comment. Remove once the
   * getUser() 401 investigation is closed. Never logs the token, anon key, or any secret.
   */
  const diagnosticClaims = decodeJwtClaimsForDiagnostics(token);
  const serverAnonKeyFingerprint = await getServerAuthAnonKeyFingerprint(context);
  console.log('[auth-diagnostic]', {
    serverProjectHost: getServerAuthProjectHost(context),
    serverAnonKeyFingerprint,
    tokenReceived: true,
    tokenIss: diagnosticClaims?.iss,
    tokenAud: diagnosticClaims?.aud,
    tokenExpISO: diagnosticClaims?.exp ? new Date(diagnosticClaims.exp * 1000).toISOString() : undefined,
    tokenIatISO: diagnosticClaims?.iat ? new Date(diagnosticClaims.iat * 1000).toISOString() : undefined,
    containerUtcNowISO: new Date().toISOString(),
  });

  let getUserResult: Awaited<ReturnType<typeof client.auth.getUser>>;

  try {
    getUserResult = await client.auth.getUser(token);
  } catch (networkError) {
    console.log('[auth-diagnostic] getUser threw (network/transport error)', {
      errorType: networkError instanceof Error ? networkError.constructor.name : typeof networkError,
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
    });
    throw unauthorized('Invalid or expired session');
  }

  const { data, error } = getUserResult;

  if (error || !data.user) {
    console.log('[auth-diagnostic] getUser rejected the token', {
      supabaseErrorCode: (error as { code?: string } | null)?.code,
      supabaseErrorStatus: (error as { status?: number } | null)?.status,
      supabaseErrorMessage: error?.message,
    });
    throw unauthorized('Invalid or expired session');
  }

  return { id: data.user.id, email: data.user.email ?? null, firstName: deriveFirstName(data.user) };
}
