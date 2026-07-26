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
 * Deployment Repository — Sprint 87 (Deployment Architecture Foundation), refactored in Sprint 88
 * pre-work so this repository is the ONLY supported entry point for a provider integration to
 * change Deployment state. Persists `builders_project_deployments` and its four child tables
 * (`builders_deployment_github`/`_supabase`/`_vercel`/`_history`) — see
 * supabase/migrations/20260804100000_deployment_foundation.sql for the DDL. Follows the exact
 * defensive convention every other BuildersDB repository uses (`blueprintResolutionRepository.ts`,
 * `mvpRepository.ts`): check for a configured client up front, wrap the Supabase call in
 * try/catch, and return a safe fallback (`null`/`false`/`[]`) rather than throwing.
 *
 * No provider API is called anywhere in this file — `attachGithub`/`attachSupabase`/
 * `attachVercel` only persist connection state a future sprint's real integration will supply.
 *
 * Sprint 88 pre-work — single entry point rule: a successful provider operation must never be
 * expressed as "write the provider row" and "advance Deployment.status" as two independent calls
 * scattered at the call site. `attachGithub`/`attachSupabase`/`attachVercel` now do both, plus the
 * one Deployment History event describing what happened, through the shared
 * `attachProviderAndTransition` helper below — a future Sprint 88/89/90 GitHub/Supabase/Vercel
 * integration calls exactly one of these three functions and nothing else ever needs to touch
 * `builders_project_deployments`/`builders_deployment_history` directly for a provider event.
 * Non-provider lifecycle moves that don't attach anything (e.g. "Deployment Started",
 * "Verification Passed") still go through `updateDeploymentStatus`, which now accepts a custom
 * `eventType` so its history entries can be as descriptive as an attach's.
 *
 * Atomicity caveat: BuildersDB access here goes through the Supabase REST client, and — matching
 * every other multi-step repository in this codebase (see `updateDeploymentStatus` itself, or
 * `mvpRepository.releaseMvp`) — no multi-table Postgres transaction wraps the provider-row write,
 * the status update, and the history insert. "Atomic" in this file means "one call site, one
 * ordered sequence, never scattered across callers," not an ACID guarantee; a failure partway
 * through is logged loudly (see `attachProviderAndTransition`'s own comment) rather than silently
 * losing the mismatch. A real cross-table transaction would need a dedicated Postgres function
 * (the way `builders_record_ai_usage` is one) — out of scope for this internal refactor, and not
 * needed unless a partial-failure incident actually occurs in practice.
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
 * history event alongside the update — the same "status write + history entry together" shape
 * `mvpRepository.releaseMvp` uses. Returns `false` (without writing anything) on an illegal
 * transition. For a status move that isn't tied to attaching a provider (e.g. "Deployment
 * Started", "Deployment Successful", "Verification Passed", "Release Created" — see the Sprint 88
 * pre-work brief's own history examples), pass a descriptive `eventType`; it defaults to the
 * generic `'status_changed'` for callers that don't care.
 */
export async function updateDeploymentStatus(
  deploymentId: string,
  projectId: string,
  toStatus: DeploymentStatus,
  options: { eventType?: string; message?: string; createdBy?: string } = {},
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
      eventType: options.eventType ?? 'status_changed',
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

/** Options every `attach*` function accepts, layered on top of its provider-specific input. */
export interface AttachProviderOptions {
  /**
   * The Deployment status to transition to once the provider row is written. Defaults to the
   * provider's canonical target (see `PROVIDER_ATTACH_CONFIG`) — override only when a caller
   * needs a different target (e.g. re-attaching provider details without progressing the
   * lifecycle any further: pass the deployment's own current status so the transition is a
   * no-op per `isValidDeploymentStatusTransition`'s "from === to is always valid" rule).
   */
  toStatus?: DeploymentStatus;
  message?: string;
  metadata?: Record<string, unknown>;
  performedBy?: string;
}

/**
 * Per-provider defaults for `attachProviderAndTransition` — the one place a new provider's
 * canonical lifecycle target and history event names are declared. Adding GitLab/Firebase/
 * Netlify/... later means adding one entry here (plus the table/repository/adapter the Sprint 87
 * migration's header comment already calls for), never touching the transition or history logic
 * itself.
 */
const PROVIDER_ATTACH_CONFIG: Record<
  DeploymentEventProvider,
  { table: string; defaultToStatus: DeploymentStatus; connectedEventType: string; updatedEventType: string }
> = {
  github: {
    table: 'builders_deployment_github',
    defaultToStatus: 'repository_connected',
    connectedEventType: 'repository_connected',
    updatedEventType: 'repository_updated',
  },
  supabase: {
    table: 'builders_deployment_supabase',
    defaultToStatus: 'database_connected',
    connectedEventType: 'database_connected',
    updatedEventType: 'database_updated',
  },
  vercel: {
    table: 'builders_deployment_vercel',
    defaultToStatus: 'environment_ready',
    connectedEventType: 'environment_configured',
    updatedEventType: 'environment_updated',
  },
};

/**
 * The single entry point every `attach*` function funnels through — see this file's header
 * comment for the Sprint 88 pre-work rule this exists to satisfy. One call does all of:
 *
 *  1. Reads the Deployment's current status and validates the target transition via
 *     `isValidDeploymentStatusTransition` — an illegal transition writes nothing at all.
 *  2. Upserts the provider row on `deployment_id` (distinguishing a fresh connection from an
 *     update to an existing one, so the history event reads "Repository Connected" vs.
 *     "Repository Updated", matching the Sprint 88 pre-work brief's own examples).
 *  3. Advances `Deployment.status` to the target.
 *  4. Records ONE Deployment History event capturing the provider, the status transition, and any
 *     caller-supplied message/metadata — never two separate events for what is one logical
 *     operation.
 *
 * See the file header for why this is "one ordered sequence" rather than a database transaction.
 */
async function attachProviderAndTransition<TInput extends { deploymentId: string; projectId: string }, TRow, TDomain>(
  provider: DeploymentEventProvider,
  input: TInput,
  toUpsert: (input: TInput) => Record<string, unknown>,
  fromRow: (row: TRow) => TDomain,
  options: AttachProviderOptions,
): Promise<TDomain | null> {
  const config = PROVIDER_ATTACH_CONFIG[provider];
  const logTag = `attach${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
  const client = getBuildersDbClient();

  if (!client) {
    unavailable(logTag);
    return null;
  }

  try {
    const { data: deploymentRow, error: deploymentError } = await client
      .from('builders_project_deployments')
      .select('status')
      .eq('id', input.deploymentId)
      .single();

    if (deploymentError) {
      throw deploymentError;
    }

    const fromStatus = deploymentRow.status as DeploymentStatus;
    const toStatus = options.toStatus ?? config.defaultToStatus;

    if (!isValidDeploymentStatusTransition(fromStatus, toStatus)) {
      logError(logTag, new Error(`Illegal deployment status transition: ${fromStatus} -> ${toStatus}`));
      return null;
    }

    const { data: existingRow } = await client
      .from(config.table)
      .select('id')
      .eq('deployment_id', input.deploymentId)
      .maybeSingle();

    const { data: providerRow, error: upsertError } = await client
      .from(config.table)
      .upsert(toUpsert(input), { onConflict: 'deployment_id' })
      .select('*')
      .single();

    if (upsertError) {
      throw upsertError;
    }

    const { error: statusError } = await client
      .from('builders_project_deployments')
      .update({ status: toStatus })
      .eq('id', input.deploymentId);

    if (statusError) {
      /*
       * The provider row is already written at this point — no cross-table transaction wraps
       * these writes (see this file's header comment). Logged loudly rather than silently
       * leaving Deployment.status out of sync with the provider row it now points at.
       */
      throw statusError;
    }

    await recordDeploymentEvent({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      eventType: existingRow ? config.updatedEventType : config.connectedEventType,
      fromStatus,
      toStatus,
      provider,
      message: options.message,
      metadata: options.metadata,
      createdBy: options.performedBy,
    });

    return fromRow(providerRow as TRow);
  } catch (error) {
    logError(logTag, error);
    return null;
  }
}

/**
 * Attaches (or updates) this Deployment's GitHub connection, transitions the Deployment lifecycle
 * (`generated -> repository_connected` by default), and records the matching Deployment History
 * event — all in one call, per the Sprint 88 pre-work rule. Exactly one GitHub connection per
 * deployment (upserts on `deployment_id`).
 */
export async function attachGithub(
  input: DeploymentGithubInput,
  options: AttachProviderOptions = {},
): Promise<DeploymentGithub | null> {
  return attachProviderAndTransition<DeploymentGithubInput, BuildersDbDeploymentGithubRow, DeploymentGithub>(
    'github',
    input,
    toDeploymentGithubUpsert,
    fromDeploymentGithubRow,
    options,
  );
}

/**
 * Attaches (or updates) this Deployment's Supabase connection, transitions the Deployment
 * lifecycle (`repository_connected -> database_connected` by default), and records the matching
 * Deployment History event — same shape as `attachGithub`, for Sprint 89 to build on.
 */
export async function attachSupabase(
  input: DeploymentSupabaseInput,
  options: AttachProviderOptions = {},
): Promise<DeploymentSupabase | null> {
  return attachProviderAndTransition<DeploymentSupabaseInput, BuildersDbDeploymentSupabaseRow, DeploymentSupabase>(
    'supabase',
    input,
    toDeploymentSupabaseUpsert,
    fromDeploymentSupabaseRow,
    options,
  );
}

/**
 * Attaches (or updates) this Deployment's Vercel connection, transitions the Deployment lifecycle
 * (`database_connected -> environment_ready` by default), and records the matching Deployment
 * History event — same shape as `attachGithub`, for Sprint 90 to build on.
 */
export async function attachVercel(
  input: DeploymentVercelInput,
  options: AttachProviderOptions = {},
): Promise<DeploymentVercel | null> {
  return attachProviderAndTransition<DeploymentVercelInput, BuildersDbDeploymentVercelRow, DeploymentVercel>(
    'vercel',
    input,
    toDeploymentVercelUpsert,
    fromDeploymentVercelRow,
    options,
  );
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
