import type { LoaderFunction } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';
import { upsertSharedProviderSettings } from '~/lib/builders-db/repositories/providerSettingsRepository';

/**
 * Sprint 38.4 — shared (server-configured) LLM key status, for every provider at once.
 *
 * Deliberately distinct from /api/check-env-key: that endpoint's `isSet` includes the
 * REQUESTING USER's own cookie key, which is correct for its purpose (per-provider "do you
 * have a key at all" badge) but wrong for this one — a personal key must never be reported
 * as "the team has a shared key configured". This route only ever calls
 * LLMManager.getSharedKeyStatus(), which reads no cookie at all (see that method's own
 * comment in manager.ts).
 *
 * Response body is `{ providers: { [name]: { configured: boolean } } }` — booleans only,
 * never a key value, never even the env var's name. Safe to expose to any authenticated or
 * unauthenticated request.
 */
export const loader: LoaderFunction = async ({ context }) => {
  const serverEnv = context?.cloudflare?.env as Record<string, any> | undefined;
  const llmManager = LLMManager.getInstance((serverEnv ?? {}) as any);
  const status = llmManager.getSharedKeyStatus(serverEnv);

  // Best-effort metadata mirror — never blocks or affects the response to the browser.
  for (const [providerName, { configured }] of Object.entries(status)) {
    upsertSharedProviderSettings({
      providerKey: providerName,
      displayName: providerName,
      sharedKeyConfigured: configured,
    }).catch((error) => console.error('[shared-key-status] BuildersDB mirror failed:', error));
  }

  return Response.json({ providers: status });
};
