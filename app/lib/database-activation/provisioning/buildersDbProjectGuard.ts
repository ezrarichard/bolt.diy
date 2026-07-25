import { getBuildersDbConfig } from '~/lib/builders-db/client';

/**
 * BuildersDB Isolation Guard — Sprint 76 (Real Database Provisioning, Phase 2).
 *
 * The structural enforcement docs/backend-activation/Provisioning-Architecture.md §1 promises:
 * "No `DatabaseProvisioner` implementation may ever be pointed at `BUILDERS_DB_SUPABASE_URL`."
 * Every entry point that accepts a customer-supplied Supabase project id — connecting a project
 * (`databaseActivationService.connectSupabaseProject`) and provisioning/verifying
 * (`supabaseProvisioner.ts`) — calls `isBuildersDbProjectId` before doing anything else, so this
 * is checked in code at every layer, not just documented as a rule to follow.
 */

/** A Supabase project's id/ref is the subdomain of its URL, e.g. "abcdefghij" in "https://abcdefghij.supabase.co". */
function extractProjectRef(url: string): string | undefined {
  const match = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1]?.toLowerCase();
}

/**
 * True only when `projectId` resolves to the exact same Supabase project BuildersDB itself runs
 * on. Returns `false` (never blocks) when BuildersDB isn't configured in this environment, or when
 * its URL doesn't parse as a recognizable Supabase project URL — an ambiguous/unconfigured
 * BuildersDB must never accidentally block legitimate customer provisioning; the block only fires
 * on an exact, unambiguous match.
 */
export function isBuildersDbProjectId(projectId: string): boolean {
  const config = getBuildersDbConfig();

  if (!config) {
    return false;
  }

  const buildersDbRef = extractProjectRef(config.url);

  if (!buildersDbRef) {
    return false;
  }

  return projectId.trim().toLowerCase() === buildersDbRef;
}

export const BUILDERS_DB_PROJECT_REFUSAL_MESSAGE =
  'Refusing to connect or provision — this project resolves to the Builders platform database (BuildersDB), which must never be a target for customer application provisioning.';
