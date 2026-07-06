/**
 * BuildersDB client — Sprint 18, wired up for real in Sprint 34.
 *
 * Configuration/connection point for the BuildersDB Supabase project — the
 * Builders PLATFORM's own control-plane database. This is NEVER the
 * generated application's database; see types.ts for that distinction.
 * Nothing here talks to app/lib/stores/supabase.ts or
 * app/routes/api.supabase*.ts (the existing, unrelated feature that
 * connects a user's in-progress product to ITS OWN Supabase project) —
 * hence the deliberately different env var names below.
 *
 * `getBuildersDbClient()` returns null whenever `BUILDERS_DB_SUPABASE_URL`/
 * `BUILDERS_DB_SUPABASE_ANON_KEY` aren't set (the expected state until a
 * real BuildersDB Supabase project — see
 * supabase/migrations/20260706120000_buildersdb_foundation.sql for the
 * schema to run against it — is provisioned and configured). Every caller
 * in app/lib/builders-db/repositories/buildersDbRepository.ts treats a null
 * client as "BuildersDB unavailable, fall back to local-only behavior" —
 * never a crash.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface BuildersDbConfig {
  url: string;
  anonKey: string;
}

/** BuildersDB's own env var names — deliberately distinct from VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (app/lib/stores/supabase.ts), which configure a generated app's Supabase project, not this one. */
const BUILDERS_DB_URL_ENV = 'BUILDERS_DB_SUPABASE_URL';
const BUILDERS_DB_ANON_KEY_ENV = 'BUILDERS_DB_SUPABASE_ANON_KEY';

function readEnv(name: string): string | undefined {
  // Vite exposes build-time env vars via import.meta.env; fall back to process.env for Node/Cloudflare Worker contexts where only that's populated.
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = viteEnv?.[name];

  if (fromVite) {
    return fromVite;
  }

  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

/** Returns undefined whenever either env var is missing — never throws, never logs. An unconfigured BuildersDB is normal today. */
export function getBuildersDbConfig(): BuildersDbConfig | undefined {
  const url = readEnv(BUILDERS_DB_URL_ENV);
  const anonKey = readEnv(BUILDERS_DB_ANON_KEY_ENV);

  return url && anonKey ? { url, anonKey } : undefined;
}

export function isBuildersDbConfigured(): boolean {
  return getBuildersDbConfig() !== undefined;
}

let cachedClient: SupabaseClient | null | undefined;

/**
 * Returns a memoized `SupabaseClient` once `BUILDERS_DB_SUPABASE_URL`/
 * `BUILDERS_DB_SUPABASE_ANON_KEY` are both set, or `null` otherwise —
 * never throws. `cachedClient` is deliberately allowed to be `null` (not
 * just `undefined`) so an unconfigured environment doesn't retry
 * `createClient` on every call.
 */
export function getBuildersDbClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const config = getBuildersDbConfig();

  if (!config) {
    cachedClient = null;
    return cachedClient;
  }

  try {
    cachedClient = createClient(config.url, config.anonKey);
  } catch (error) {
    console.error('[BuildersDB] Failed to create Supabase client:', error);
    cachedClient = null;
  }

  return cachedClient;
}
