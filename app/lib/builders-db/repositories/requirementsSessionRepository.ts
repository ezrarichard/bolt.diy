import { getBuildersDbClient } from '~/lib/builders-db/client';
import {
  fromRequirementsSessionRow,
  toRequirementsSessionInsert,
  type BuildersDbRequirementsSessionRow,
} from '~/lib/builders-db/requirementsSessionDbTypes';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import type {
  RequirementsSession,
  RequirementsSessionMode,
  RequirementsSessionStatus,
} from '~/lib/projects/requirementsSession';

/**
 * Requirements Session Repository — Sprint 50 (Durable Foundation).
 *
 * Async, network-backed persistence for `builders_requirements_sessions` (see
 * supabase/migrations/20260727100000_requirements_discovery_foundation.sql). Follows the same
 * defensive conventions as `buildersDbRepository.ts`: every function checks for a configured
 * client up front, wraps its Supabase call in try/catch, and returns a safe fallback
 * (`null`/`[]`/`false`) rather than throwing — callers never need their own try/catch.
 *
 * Nothing in this sprint calls these functions from any UI yet — Sprint 50 is foundation
 * only (see the sprint's implementation note). They exist so later sprints (Form Mode
 * migration, Interview Mode) have a stable, tested interface to build on.
 */

const { unavailable, logError } = createRepositoryLogger('RequirementsSessionRepository');

/** Creates a new Requirements Session for a project. RLS (`builders_requirements_sessions_write`) rejects this if the caller cannot edit the project. */
export async function createRequirementsSession(
  projectId: string,
  mode: RequirementsSessionMode,
): Promise<RequirementsSession | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createRequirementsSession');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_sessions')
      .insert(toRequirementsSessionInsert(projectId, mode))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromRequirementsSessionRow(data as BuildersDbRequirementsSessionRow);
  } catch (error) {
    logError('createRequirementsSession', error);
    return null;
  }
}

export async function getRequirementsSession(sessionId: string): Promise<RequirementsSession | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getRequirementsSession');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRequirementsSessionRow(data as BuildersDbRequirementsSessionRow) : null;
  } catch (error) {
    logError('getRequirementsSession', error);
    return null;
  }
}

/** Every session for a project, oldest first — a project may accumulate more than one over time (e.g. a later revision effort). */
export async function listRequirementsSessionsByProject(projectId: string): Promise<RequirementsSession[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listRequirementsSessionsByProject');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_sessions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromRequirementsSessionRow(row as BuildersDbRequirementsSessionRow));
  } catch (error) {
    logError('listRequirementsSessionsByProject', error);
    return [];
  }
}

/** The most recently created session for a project, or null if none exists yet. */
export async function getLatestRequirementsSession(projectId: string): Promise<RequirementsSession | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestRequirementsSession');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_sessions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRequirementsSessionRow(data as BuildersDbRequirementsSessionRow) : null;
  } catch (error) {
    logError('getLatestRequirementsSession', error);
    return null;
  }
}

/** Narrow status-only transition — mirrors `touchLastOpened`'s pattern of a single-column update so a status change can never race/clobber a concurrent field update. */
export async function updateRequirementsSessionStatus(
  sessionId: string,
  status: RequirementsSessionStatus,
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateRequirementsSessionStatus');
    return false;
  }

  try {
    const timestampColumn: Partial<Record<RequirementsSessionStatus, string>> = {
      active: 'started_at',
      complete: 'completed_at',
      approved: 'approved_at',
      abandoned: 'abandoned_at',
    };

    const column = timestampColumn[status];
    const payload: Record<string, unknown> = { status };

    if (column) {
      payload[column] = new Date().toISOString();
    }

    const { error } = await client.from('builders_requirements_sessions').update(payload).eq('id', sessionId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateRequirementsSessionStatus', error);
    return false;
  }
}

/** General-purpose partial update for the session's other fields (e.g. `selectedDiscoveryStrategy`/`assessmentConfidence`, reserved for a later sprint). */
export async function updateRequirementsSession(
  sessionId: string,
  patch: Partial<Pick<RequirementsSession, 'selectedDiscoveryStrategy' | 'assessmentConfidence'>>,
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateRequirementsSession');
    return false;
  }

  try {
    const payload: Record<string, unknown> = {};

    if (patch.selectedDiscoveryStrategy !== undefined) {
      payload.selected_discovery_strategy = patch.selectedDiscoveryStrategy;
    }

    if (patch.assessmentConfidence !== undefined) {
      payload.assessment_confidence = patch.assessmentConfidence;
    }

    if (Object.keys(payload).length === 0) {
      return true;
    }

    const { error } = await client.from('builders_requirements_sessions').update(payload).eq('id', sessionId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateRequirementsSession', error);
    return false;
  }
}

/** Convenience wrapper over `updateRequirementsSessionStatus('archived')` — named separately so call sites read as an intentional archival, not a generic status change. */
export async function archiveRequirementsSession(sessionId: string): Promise<boolean> {
  return updateRequirementsSessionStatus(sessionId, 'archived');
}

export const requirementsSessionRepository = {
  createRequirementsSession,
  getRequirementsSession,
  listRequirementsSessionsByProject,
  getLatestRequirementsSession,
  updateRequirementsSessionStatus,
  updateRequirementsSession,
  archiveRequirementsSession,
};
