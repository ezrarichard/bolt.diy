import { getBuildersDbClient } from '~/lib/builders-db/client';
import { fromBlueprintRow, type BuildersDbBlueprintRow } from '~/lib/builders-db/blueprintDbTypes';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import type { ProjectBlueprint } from '~/lib/blueprints/types';

/**
 * Blueprint Repository — Sprint 59 (Blueprint Foundation).
 *
 * Async, network-backed read access to `builders_blueprints`, following the exact defensive
 * convention every other BuildersDB repository already uses (`requirementsSessionRepository.ts`,
 * `businessUnderstandingRepository.ts`): check for a configured client up front, wrap the
 * Supabase call in try/catch, and return a safe fallback (`[]`) rather than throwing — the one
 * caller (`blueprintEngine.hydrateBlueprints()`) never needs its own try/catch, and an
 * unconfigured/unreachable BuildersDB simply means "nothing to hydrate," never a crash.
 *
 * Read-only by design this sprint — see blueprintDbTypes.ts's header comment for why no
 * insert/update function exists yet.
 */

const { unavailable, logError } = createRepositoryLogger('BlueprintRepository');

/**
 * Every currently-active, latest-version blueprint, in the same order the existing hardcoded
 * registry declares them (`sort_order`) — so a caller that swaps a registry-backed list for
 * this one sees an identical ordering. Returns `[]` (never throws, never returns `null`) when
 * BuildersDB is unconfigured/unreachable or the table has no rows yet, so callers can treat an
 * empty result exactly like "nothing to hydrate."
 */
export async function listActiveBlueprints(): Promise<ProjectBlueprint[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listActiveBlueprints');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_blueprints')
      .select('*')
      .eq('is_latest', true)
      .eq('status', 'active')
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromBlueprintRow(row as BuildersDbBlueprintRow));
  } catch (error) {
    logError('listActiveBlueprints', error);
    return [];
  }
}

export const blueprintRepository = {
  listActiveBlueprints,
};
