import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';

/**
 * Shared Provider Settings Repository — Sprint 38.4.
 *
 * Mirrors `builders_shared_provider_settings` (see
 * supabase/migrations/20260709020000_shared_provider_settings.sql) — metadata ONLY
 * (which provider has a shared key configured, when that was last observed), never the
 * key value itself. The only caller is app/routes/api.shared-key-status.ts, which already
 * computed `configured` from Cloudflare/process env (see
 * app/lib/modules/llm/manager.ts's getSharedKeyStatus()) before this function ever runs —
 * this repository never touches an env var or a secret, it only records the boolean
 * result. Same defensive contract as every other builders-db repository: guarded on
 * BuildersDB being configured, every Supabase call wrapped in try/catch, every failure
 * path logs and returns false rather than throwing — the status endpoint's response to the
 * browser never depends on this succeeding.
 *
 * Assembly Auto-Repair — writes through the `builders_upsert_shared_provider_settings` RPC
 * (see supabase/migrations/20260718110000_ai_usage_rpc_repair_and_shared_settings_write_path.sql),
 * not a direct `.from(...).upsert(...)` against the table. This caller has no user session
 * (a server-side loader reporting env-derived status, not anything user-specific), so it
 * always executes as the `anon` Postgres role; `builders_shared_provider_settings` itself is
 * select-only for `authenticated` (see 20260710100000_project_ownership_and_rls.sql), so a
 * direct anon upsert against the table was always going to fail with 42501 — the RPC is the
 * write path that migration's own header comment calls out as a required follow-up.
 */

function unavailable(method: string): void {
  console.warn(`[BuildersDB] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[BuildersDB] ${method}() failed:`, error);
}

export interface SharedProviderSettingsInput {
  providerKey: string;
  displayName: string;
  sharedKeyConfigured: boolean;
}

/** Upserts one provider's observed shared-key status. `enabled` mirrors `sharedKeyConfigured` today — there's no separate admin toggle yet, so a provider is "enabled" for shared use exactly when its key is configured. */
export async function upsertSharedProviderSettings(input: SharedProviderSettingsInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isBuildersDbConfigured() || !client) {
    unavailable('upsertSharedProviderSettings');
    return false;
  }

  try {
    const { error } = await client.rpc('builders_upsert_shared_provider_settings', {
      p_provider_key: input.providerKey,
      p_display_name: input.displayName,
      p_shared_key_configured: input.sharedKeyConfigured,
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('upsertSharedProviderSettings', error);
    return false;
  }
}

export const providerSettingsRepository = {
  upsertSharedProviderSettings,
};
