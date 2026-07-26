import { getBuildersDbClient } from '~/lib/builders-db/client';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import {
  fromDeploymentGithubRow,
  fromDeploymentHistoryRow,
  fromDeploymentSupabaseRow,
  fromDeploymentVercelRow,
  fromProjectDeploymentRow,
  toDeploymentGithubUpsert,
  toDeploymentHistoryInsert,
  toDeploymentSupabaseUpsert,
  toDeploymentVercelUpsert,
  toProjectDeploymentInsert,
  type BuildersDbDeploymentGithubRow,
  type BuildersDbDeploymentHistoryRow,
  type BuildersDbDeploymentSupabaseRow,
  type BuildersDbDeploymentVercelRow,
  type BuildersDbProjectDeploymentRow,
} from '~/lib/deployment/deploymentDbTypes';
import { isValidDeploymentStatusTransition } from '~/lib/deployment/lifecycleTransitions';
import type {
  Deployment,
  DeploymentDraft,
  DeploymentEventProvider,
  DeploymentGithub,
  DeploymentGithubInput,
  DeploymentHistoryEvent,
  DeploymentStatus,
  DeploymentSupabase,
  DeploymentSupabaseInput,
  DeploymentVercel,
  DeploymentVercelInput,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';

export type {
  Deployment,
  DeploymentGithub,
  DeploymentHistoryEvent,
  DeploymentSupabase,
  DeploymentVercel,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';

/**
 * Deployment Repository — Sprint 87 (Deployment Architecture Foundation).
 *
 * Persistence for `builders_project_deployments` and its four child tables
 * (`builders_deployment_github`/`_supabase`/`_vercel`/`_history`) — see
 * supabase/migrations/20260804100000_deployment_foundation.sql for the DDL. Follows the exact
 * defensive convention every other BuildersDB repository uses (`blueprintResolutionRepository.ts`,
 * `mvpRepository.ts`): check for a configured client up front, wrap the Supabase call in
 * try/catch, and return a safe fallback (`null`/`false`/`[]`) rather than throwing.
 *
 * No provider API is called anywhere in this file — `attachGithub`/`attachSupabase`/
 * `attachVercel` only persist connection state a future sprint's real integration will supply.
 */

const { unavailable, logError } = createRepositoryLogger('DeploymentRepository');

/** Creates a project's Deployment. A project owns exactly one — the table's `unique (project_id)` enforces this; a second call for the same project fails at the DB layer. */
export async function createDeployment(draft: DeploymentDraft): Promise<Deployment | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createDeployment');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_project_deployments')
      .insert(toProjectDeploymentInsert(draft))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromProjectDeploymentRow(data as BuildersDbProjectDeploymentRow);
  } catch (error) {
    logError('createDeployment', error);
    return null;
  }
}

/** The project's Deployment row alone, without provider connections. Use `getDeploymentWithProviders` when the full picture is needed. */
export async function getDeploymentByProject(projectId: string): Promise<Deployment | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getDeploymentByProject');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_project_deployments')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromProjectDeploymentRow(data as BuildersDbProjectDeploymentRow) : null;
  } catch (error) {
    logError('getDeploymentByProject', error);
    return null;
  }
}

/** The Deployment plus every provider connection attached to it — the full picture the Workspace's Deployment surface needs in one call. */
export async function getDeploymentWithProviders(projectId: string): Promise<DeploymentWithProviders | null> {
  const deployment = await getDeploymentByProject(projectId);

  if (!deployment) {
    return null;
  }

  const [github, supabase, vercel] = await Promise.all([
    getDeploymentGithub(deployment.id),
    getDeploymentSupabase(deployment.id),
    getDeploymentVercel(deployment.id),
  ]);

  return { ...deployment, github, supabase, vercel };
}

/**
 * Validates the transition via `isValidDeploymentStatusTransition` before writing, and records a
 * `status_changed` history event alongside the update — the same "status write + history entry
 * together" shape `mvpRepository.releaseMvp` uses. Returns `false` (without writing anything) on
 * an illegal transition.
 */
export async function updateDeploymentStatus(
  deploymentId: string,
  projectId: string,
  toStatus: DeploymentStatus,
  options: { message?: string; createdBy?: string } = {},
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateDeploymentStatus');
    return false;
  }

  try {
    const { data: current, error: readError } = await client
      .from('builders_project_deployments')
      .select('status')
      .eq('id', deploymentId)
      .single();

    if (readError) {
      throw readError;
    }

    const fromStatus = current.status as DeploymentStatus;

    if (!isValidDeploymentStatusTransition(fromStatus, toStatus)) {
      logError(
        'updateDeploymentStatus',
        new Error(`Illegal deployment status transition: ${fromStatus} -> ${toStatus}`),
      );
      return false;
    }

    const { error: updateError } = await client
      .from('builders_project_deployments')
      .update({ status: toStatus })
      .eq('id', deploymentId);

    if (updateError) {
      throw updateError;
    }

    await recordDeploymentEvent({
      deploymentId,
      projectId,
      eventType: 'status_changed',
      fromStatus,
      toStatus,
      message: options.message,
      createdBy: options.createdBy,
    });

    return true;
  } catch (error) {
    logError('updateDeploymentStatus', error);
    return false;
  }
}

async function attachProvider<TRow, TDomain>(
  table: string,
  logTag: string,
  upsertPayload: Record<string, unknown>,
  fromRow: (row: TRow) => TDomain,
): Promise<TDomain | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable(logTag);
    return null;
  }

  try {
    const { data, error } = await client
      .from(table)
      .upsert(upsertPayload, { onConflict: 'deployment_id' })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromRow(data as TRow);
  } catch (error) {
    logError(logTag, error);
    return null;
  }
}

/** Attaches (or updates) this Deployment's GitHub connection. Exactly one per deployment — upserts on `deployment_id`. */
export async function attachGithub(input: DeploymentGithubInput): Promise<DeploymentGithub | null> {
  const result = await attachProvider<BuildersDbDeploymentGithubRow, DeploymentGithub>(
    'builders_deployment_github',
    'attachGithub',
    toDeploymentGithubUpsert(input),
    fromDeploymentGithubRow,
  );

  if (result) {
    await recordDeploymentEvent({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      eventType: 'github_connected',
      provider: 'github',
    });
  }

  return result;
}

/** Attaches (or updates) this Deployment's Supabase connection. Exactly one per deployment — upserts on `deployment_id`. */
export async function attachSupabase(input: DeploymentSupabaseInput): Promise<DeploymentSupabase | null> {
  const result = await attachProvider<BuildersDbDeploymentSupabaseRow, DeploymentSupabase>(
    'builders_deployment_supabase',
    'attachSupabase',
    toDeploymentSupabaseUpsert(input),
    fromDeploymentSupabaseRow,
  );

  if (result) {
    await recordDeploymentEvent({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      eventType: 'supabase_connected',
      provider: 'supabase',
    });
  }

  return result;
}

/** Attaches (or updates) this Deployment's Vercel connection. Exactly one per deployment — upserts on `deployment_id`. */
export async function attachVercel(input: DeploymentVercelInput): Promise<DeploymentVercel | null> {
  const result = await attachProvider<BuildersDbDeploymentVercelRow, DeploymentVercel>(
    'builders_deployment_vercel',
    'attachVercel',
    toDeploymentVercelUpsert(input),
    fromDeploymentVercelRow,
  );

  if (result) {
    await recordDeploymentEvent({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      eventType: 'vercel_connected',
      provider: 'vercel',
    });
  }

  return result;
}

export async function getDeploymentGithub(deploymentId: string): Promise<DeploymentGithub | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getDeploymentGithub');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_github')
      .select('*')
      .eq('deployment_id', deploymentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromDeploymentGithubRow(data as BuildersDbDeploymentGithubRow) : null;
  } catch (error) {
    logError('getDeploymentGithub', error);
    return null;
  }
}

export async function getDeploymentSupabase(deploymentId: string): Promise<DeploymentSupabase | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getDeploymentSupabase');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_supabase')
      .select('*')
      .eq('deployment_id', deploymentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromDeploymentSupabaseRow(data as BuildersDbDeploymentSupabaseRow) : null;
  } catch (error) {
    logError('getDeploymentSupabase', error);
    return null;
  }
}

export async function getDeploymentVercel(deploymentId: string): Promise<DeploymentVercel | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getDeploymentVercel');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_vercel')
      .select('*')
      .eq('deployment_id', deploymentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromDeploymentVercelRow(data as BuildersDbDeploymentVercelRow) : null;
  } catch (error) {
    logError('getDeploymentVercel', error);
    return null;
  }
}

/** Records one append-only history event. Never fails the caller's own operation — logs and returns `null` on error, same as every other repository function here. */
export async function recordDeploymentEvent(params: {
  deploymentId: string;
  projectId: string;
  eventType: string;
  fromStatus?: DeploymentStatus;
  toStatus?: DeploymentStatus;
  provider?: DeploymentEventProvider;
  message?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<DeploymentHistoryEvent | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('recordDeploymentEvent');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_history')
      .insert(toDeploymentHistoryInsert(params))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromDeploymentHistoryRow(data as BuildersDbDeploymentHistoryRow);
  } catch (error) {
    logError('recordDeploymentEvent', error);
    return null;
  }
}

/** Every history event for a deployment, most-recent first. */
export async function getDeploymentHistory(deploymentId: string): Promise<DeploymentHistoryEvent[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getDeploymentHistory');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_history')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromDeploymentHistoryRow(row as BuildersDbDeploymentHistoryRow));
  } catch (error) {
    logError('getDeploymentHistory', error);
    return [];
  }
}

export const deploymentRepository = {
  createDeployment,
  getDeploymentByProject,
  getDeploymentWithProviders,
  updateDeploymentStatus,
  attachGithub,
  attachSupabase,
  attachVercel,
  getDeploymentGithub,
  getDeploymentSupabase,
  getDeploymentVercel,
  recordDeploymentEvent,
  getDeploymentHistory,
};
