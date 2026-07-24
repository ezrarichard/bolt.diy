import { getBuildersDbClient } from '~/lib/builders-db/client';
import {
  fromBlueprintResolutionRow,
  toBlueprintResolutionInsert,
  type BlueprintResolution,
  type BuildersDbBlueprintResolutionRow,
} from '~/lib/builders-db/blueprintResolutionDbTypes';

export type { BlueprintResolution } from '~/lib/builders-db/blueprintResolutionDbTypes';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import type { BlueprintCandidate } from '~/lib/blueprints';

/**
 * Blueprint Resolution Repository — Sprint 61 (Blueprint Resolution Engine).
 *
 * Async, network-backed persistence for `builders_blueprint_resolutions`, following the exact
 * defensive convention every other BuildersDB repository already uses (`blueprintRepository.ts`,
 * `businessUnderstandingRepository.ts`): check for a configured client up front, wrap the
 * Supabase call in try/catch, and return a safe fallback (`null`/`[]`) rather than throwing.
 *
 * Append-only by design — see the migration's own header comment. `recordBlueprintResolution`
 * always inserts a new row; `selectBlueprint` is the only update, and it only ever touches
 * `selected_blueprint_id` on one already-existing row (a manual override), never the
 * recommendation or explanation that row was created with.
 */

const { unavailable, logError } = createRepositoryLogger('BlueprintResolutionRepository');

/** Records a new resolution run. Never overwrites a previous run — see this file's header comment. */
export async function recordBlueprintResolution(params: {
  projectId: string;
  sessionId: string | null;
  recommendedBlueprintId: string;
  confidence: number;
  explanation: string[];
  candidates: BlueprintCandidate[];
}): Promise<BlueprintResolution | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('recordBlueprintResolution');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_blueprint_resolutions')
      .insert(toBlueprintResolutionInsert(params))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromBlueprintResolutionRow(data as BuildersDbBlueprintResolutionRow);
  } catch (error) {
    logError('recordBlueprintResolution', error);
    return null;
  }
}

/** The most recent resolution for a project (recommended vs. selected may differ — see the type's own header comment). */
export async function getLatestBlueprintResolution(projectId: string): Promise<BlueprintResolution | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestBlueprintResolution');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_blueprint_resolutions')
      .select('*')
      .eq('project_id', projectId)
      .order('resolved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromBlueprintResolutionRow(data as BuildersDbBlueprintResolutionRow) : null;
  } catch (error) {
    logError('getLatestBlueprintResolution', error);
    return null;
  }
}

/** Every resolution ever recorded for a project, most-recent first — the complete history the brief requires. */
export async function listBlueprintResolutionHistory(projectId: string): Promise<BlueprintResolution[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listBlueprintResolutionHistory');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_blueprint_resolutions')
      .select('*')
      .eq('project_id', projectId)
      .order('resolved_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromBlueprintResolutionRow(row as BuildersDbBlueprintResolutionRow));
  } catch (error) {
    logError('listBlueprintResolutionHistory', error);
    return [];
  }
}

/**
 * Manual override — sets `selected_blueprint_id` on one specific resolution row without
 * touching its `recommended_blueprint_id`, `confidence`, or `explanation`. Per the Sprint 61
 * brief: "the recommendation must never force the user" — this is how a user's own choice is
 * recorded alongside (not instead of) what the engine recommended.
 */
export async function selectBlueprint(resolutionId: string, selectedBlueprintId: string): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('selectBlueprint');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_blueprint_resolutions')
      .update({ selected_blueprint_id: selectedBlueprintId })
      .eq('id', resolutionId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('selectBlueprint', error);
    return false;
  }
}

export const blueprintResolutionRepository = {
  recordBlueprintResolution,
  getLatestBlueprintResolution,
  listBlueprintResolutionHistory,
  selectBlueprint,
};
