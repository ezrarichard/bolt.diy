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
    const { error } = await client.from('builders_shared_provider_settings').upsert(
      {
        provider_key: input.providerKey,
        display_name: input.displayName,
        enabled: input.sharedKeyConfigured,
        shared_key_configured: input.sharedKeyConfigured,
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: 'provider_key' },
    );

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
