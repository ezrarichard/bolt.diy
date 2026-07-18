import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppLoadContext } from '@remix-run/cloudflare';

/**
 * Sprint 40 — Authentication Foundation.
 *
 * Server-side Supabase client used only to verify a browser-supplied access token
 * (`client.auth.getUser(token)`). Intentionally the SAME project as BuildersDB
 * (BUILDERS_DB_SUPABASE_URL/ANON_KEY, app/lib/builders-db/client.ts) — auth.users lives in
 * that project, so a second Supabase project would just be extra ops for no benefit. Uses
 * the anon key only; verifying a caller-supplied JWT against Supabase Auth never requires
 * the service-role key, and that key must never be introduced here or anywhere
 * browser-reachable.
 *
 * `context.cloudflare.env` is checked first (how every other server route in this codebase
 * reads env vars — see api.shared-key-status.ts, api.chat.ts) because this app runs under
 * `wrangler pages dev` even in the Oracle-hosted Docker container (see bindings.sh / package.json
 * `start`), not a plain Node server. `import.meta.env` is checked next — the same Vite
 * build-time fallback `app/lib/builders-db/client.ts`'s own `readEnv()` already uses for
 * these exact two var names (see `envPrefix` in vite.config.ts), and confirmed to actually
 * be populated on the Oracle deployment (BuildersDB itself works there) even when the
 * Cloudflare binding is empty — this was previously missing here, which was the entire
 * reason `getServerAuthClient()` returned null (and every authenticated route 401'd) on
 * that deployment despite BuildersDB using the identical env var names successfully.
 * `process.env` remains the last fallback, for local `remix vite:dev`.
 */
function readServerEnv(context: AppLoadContext | undefined, name: string): string | undefined {
  const cloudflareEnv = (context as { cloudflare?: { env?: Record<string, string | undefined> } } | undefined)
    ?.cloudflare?.env;

  if (cloudflareEnv?.[name]) {
    return cloudflareEnv[name];
  }

  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

  if (viteEnv?.[name]) {
    return viteEnv[name];
  }

  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

let cachedClient: SupabaseClient | null | undefined;

/** Memoized like getBuildersDbClient() — `undefined` means "not checked yet", `null` means "confirmed unconfigured". */
export function getServerAuthClient(context: AppLoadContext | undefined): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = readServerEnv(context, 'BUILDERS_DB_SUPABASE_URL');
  const anonKey = readServerEnv(context, 'BUILDERS_DB_SUPABASE_ANON_KEY');

  if (!url || !anonKey) {
    cachedClient = null;
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, anonKey, { auth: { persistSession: false } });
  } catch (error) {
    console.error('[auth] Failed to create server auth client:', error);
    cachedClient = null;
  }

  return cachedClient;
}
