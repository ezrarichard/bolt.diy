import { getBuildersDbClient } from '~/lib/builders-db/client';
import {
  fromBusinessUnderstandingModelRow,
  toBusinessUnderstandingModelInsert,
  toBusinessUnderstandingModelUpdate,
  type BuildersDbBusinessUnderstandingModelRow,
  type BusinessUnderstandingModelPatch,
} from '~/lib/builders-db/requirementsSessionDbTypes';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';

/**
 * Business Understanding Repository — Sprint 50 (Durable Foundation).
 *
 * Async, network-backed persistence for `builders_business_understanding_models` — the
 * current-state (not versioned) model backing one Requirements Session. `unique (session_id)`
 * at the database level enforces "one session, one model row"; `initializeBusinessUnderstandingModel`
 * is written defensively against a session that already has one (returns the existing row
 * instead of erroring), so a caller never needs to check-then-create itself.
 */

const { unavailable, logError } = createRepositoryLogger('BusinessUnderstandingRepository');

/** Inserts a brand-new, empty Business Understanding Model row for a session. Fails (returns null) if one already exists for this session — use `initializeBusinessUnderstandingModel` when you want idempotent get-or-create behavior instead. */
export async function createBusinessUnderstandingModel(
  sessionId: string,
  projectId: string,
): Promise<BusinessUnderstandingModel | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createBusinessUnderstandingModel');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_business_understanding_models')
      .insert(toBusinessUnderstandingModelInsert(sessionId, projectId))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromBusinessUnderstandingModelRow(data as BuildersDbBusinessUnderstandingModelRow);
  } catch (error) {
    logError('createBusinessUnderstandingModel', error);
    return null;
  }
}

export async function getBusinessUnderstandingModel(sessionId: string): Promise<BusinessUnderstandingModel | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getBusinessUnderstandingModel');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_business_understanding_models')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromBusinessUnderstandingModelRow(data as BuildersDbBusinessUnderstandingModelRow) : null;
  } catch (error) {
    logError('getBusinessUnderstandingModel', error);
    return null;
  }
}

/**
 * Get-or-create: returns the session's existing model if one is already present, otherwise
 * creates and returns a fresh empty one. This is the function session-creation flows should
 * call, rather than assuming they're always first.
 */
export async function initializeBusinessUnderstandingModel(
  sessionId: string,
  projectId: string,
): Promise<BusinessUnderstandingModel | null> {
  const existing = await getBusinessUnderstandingModel(sessionId);

  if (existing) {
    return existing;
  }

  return createBusinessUnderstandingModel(sessionId, projectId);
}

/**
 * Partial update — only the sections present on `patch` are sent to Postgres (see
 * `toBusinessUnderstandingModelUpdate`), so updating e.g. `businessGoals` can never
 * accidentally clobber `risks` or any other untouched section back to its default.
 */
export async function updateBusinessUnderstandingModel(
  sessionId: string,
  patch: BusinessUnderstandingModelPatch,
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateBusinessUnderstandingModel');
    return false;
  }

  const row = toBusinessUnderstandingModelUpdate(patch);

  if (Object.keys(row).length === 0) {
    return true;
  }

  try {
    const { error } = await client
      .from('builders_business_understanding_models')
      .update(row)
      .eq('session_id', sessionId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateBusinessUnderstandingModel', error);
    return false;
  }
}

/**
 * Upsert convenience: initializes the model if it doesn't exist yet, then applies `patch` —
 * useful for callers that don't want to separately check whether initialization already
 * happened (e.g. a first Fact Extraction pass in a later sprint).
 */
export async function upsertBusinessUnderstandingModel(
  sessionId: string,
  projectId: string,
  patch: BusinessUnderstandingModelPatch,
): Promise<boolean> {
  const existing = await initializeBusinessUnderstandingModel(sessionId, projectId);

  if (!existing) {
    return false;
  }

  return updateBusinessUnderstandingModel(sessionId, patch);
}

export const businessUnderstandingRepository = {
  createBusinessUnderstandingModel,
  getBusinessUnderstandingModel,
  initializeBusinessUnderstandingModel,
  updateBusinessUnderstandingModel,
  upsertBusinessUnderstandingModel,
};
