/**
 * BuildersDB client — Sprint 18.
 *
 * Configuration/connection point for the future BuildersDB Supabase
 * project — the Builders PLATFORM's own control-plane database. This is
 * NEVER the generated application's database; see types.ts for that
 * distinction. Nothing here talks to app/lib/stores/supabase.ts or
 * app/routes/api.supabase*.ts (the existing, unrelated feature that
 * connects a user's in-progress product to ITS OWN Supabase project).
 *
 * No `@supabase/supabase-js` dependency exists in this project yet, and
 * this sprint deliberately does not add one — see docs/buildersdb.md.
 * `getBuildersDbClient()` always returns null until a future sprint adds
 * that dependency and wires up a real client here. Reading configuration
 * below never throws and never requires the environment variables to be
 * set — an unconfigured BuildersDB is the expected state today.
 */

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

/**
 * TODO (future sprint): once `@supabase/supabase-js` is added as a
 * dependency, replace this stub with `createClient(config.url,
 * config.anonKey)` from that package and return a real `SupabaseClient`.
 * Returns null unconditionally today, regardless of configuration — no
 * client library is installed yet.
 */
export function getBuildersDbClient(): null {
  return null;
}
