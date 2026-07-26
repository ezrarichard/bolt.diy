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
import {
  fromDeploymentVerificationRow,
  toDeploymentVerificationInsert,
  type BuildersDbDeploymentVerificationRow,
} from '~/lib/deployment/verificationDbTypes';
import {
  reportPermitsVerified,
  type DeploymentVerification,
  type VerificationReport,
} from '~/lib/deployment/verificationTypes';
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

export type { DeploymentVerification, VerificationReport } from '~/lib/deployment/verificationTypes';

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
 *
 * Sprint 92 revisits exactly that judgement for ONE operation and reaches the opposite conclusion:
 * `recordDeploymentVerification` DOES use a Postgres transaction
 * (`builders_finalize_deployment_verification`). The difference is what a partial failure looks
 * like. A half-finished `attachGithub` is self-evident on the next read — the provider row is
 * either present or it isn't. A half-finished verification is MISLEADING: "Deployment says
 * verified" with no report behind it, or "report says passed" with the Deployment still `deployed`
 * and no history event, both of which read as authoritative. See that migration's header comment
 * for the full rationale. Nothing else in this file changed; the paragraph above still describes
 * every other operation here.
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

/**
 * Returns the project's existing Deployment, or creates one if this is the project's first ever
 * provider integration — Sprint 88 (GitHub Product Integration) pre-work: every real provider
 * integration needs a Deployment row to attach to, and a caller should never have to special-case
 * "does this project have a Deployment yet."
 *
 * `seedStatus` exists because this codebase does not yet wire the earlier `engineering`/
 * `generated` lifecycle stages to any real signal (the code-generation pipeline that produces
 * those states isn't itself Deployment-domain-aware yet — a future sprint's work, not this one).
 * A caller that only reaches this function because generation has ALREADY completed (e.g. the
 * GitHub "push" flow, which only runs once webcontainer files exist and the build succeeded) may
 * pass the status that already reflects reality so the very next `attachGithub` call's transition
 * validates correctly, without synthesizing history events for lifecycle stages this Deployment
 * never actually visited in a way Deployment History could describe. When omitted, a freshly
 * created Deployment starts at the table's own default (`'planning'`), matching `createDeployment`.
 */
export async function ensureDeploymentForProject(
  projectId: string,
  options: { createdBy?: string; seedStatus?: DeploymentStatus } = {},
): Promise<Deployment | null> {
  const existing = await getDeploymentByProject(projectId);

  if (existing) {
    return existing;
  }

  const created = await createDeployment({ projectId, createdBy: options.createdBy });

  if (!created || !options.seedStatus || options.seedStatus === created.status) {
    return created;
  }

  const client = getBuildersDbClient();

  if (!client) {
    unavailable('ensureDeploymentForProject');
    return created;
  }

  try {
    const { error } = await client
      .from('builders_project_deployments')
      .update({ status: options.seedStatus })
      .eq('id', created.id);

    if (error) {
      throw error;
    }

    return { ...created, status: options.seedStatus };
  } catch (error) {
    logError('ensureDeploymentForProject', error);
    return created;
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

/**
 * Environment Readiness — Sprint 90. Persists an already-computed
 * `EnvironmentReadinessReport` (see `environmentReadinessService.ts`'s `assessEnvironmentReadiness`
 * — this function does none of that assessment itself, matching the "assessment lives in a
 * service, mutation lives in the repository" boundary `attachSupabase`/`supabaseDeployService.ts`
 * already established) into `Deployment.metadata.environmentReadiness`, and transitions
 * `database_connected -> environment_ready` in the same call, with exactly one history event.
 *
 * Refuses (returns `null`, writes nothing) when the transition itself is illegal OR when the
 * report contains any `'invalid'` variable — the only status this sprint treats as a real
 * blocker; `missing`/`unknown` variables are still recorded and surfaced (Part 7's "Missing
 * Variables"/"Manual Actions Required"), they just don't block reaching `environment_ready` (see
 * `EnvironmentReadinessReport.ready`'s own comment for why).
 *
 * Never persists a variable's `value` when `EnvironmentVariable.sensitive` is true (Part 5) —
 * the report passed in already guarantees this (`assessEnvironmentReadiness` never sets `value`
 * on a sensitive entry), and this function stores the report verbatim rather than re-deriving it.
 */
export async function updateDeploymentEnvironment(
  deploymentId: string,
  projectId: string,
  report: {
    variables: Array<{
      name: string;
      status: string;
      source: string;
      sensitive: boolean;
      value?: string;
      detail: string;
    }>;
    ready: boolean;
    fullyResolved: boolean;
  },
  options: { performedBy?: string } = {},
): Promise<Deployment | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateDeploymentEnvironment');
    return null;
  }

  try {
    const { data: current, error: readError } = await client
      .from('builders_project_deployments')
      .select('*')
      .eq('id', deploymentId)
      .single();

    if (readError) {
      throw readError;
    }

    const fromStatus = current.status as DeploymentStatus;
    const hasInvalid = report.variables.some((v) => v.status === 'invalid');
    const toStatus: DeploymentStatus = hasInvalid ? fromStatus : 'environment_ready';

    if (toStatus !== fromStatus && !isValidDeploymentStatusTransition(fromStatus, toStatus)) {
      logError(
        'updateDeploymentEnvironment',
        new Error(`Illegal deployment status transition: ${fromStatus} -> ${toStatus}`),
      );
      return null;
    }

    if (hasInvalid) {
      logError(
        'updateDeploymentEnvironment',
        new Error('Refusing to transition to environment_ready — the report contains invalid variable(s).'),
      );
      return null;
    }

    const nextMetadata = {
      ...((current.metadata as Record<string, unknown>) ?? {}),
      environmentReadiness: report,
    };

    const { error: updateError } = await client
      .from('builders_project_deployments')
      .update({ status: toStatus, metadata: nextMetadata })
      .eq('id', deploymentId);

    if (updateError) {
      throw updateError;
    }

    await recordDeploymentEvent({
      deploymentId,
      projectId,
      eventType: 'environment_ready',
      fromStatus,
      toStatus,
      message: `Environment assessed: ${report.variables.filter((v) => v.status === 'resolved').length} resolved, ${
        report.variables.filter((v) => v.status !== 'resolved').length
      } missing/manual.`,
      createdBy: options.performedBy,
    });

    return fromProjectDeploymentRow({
      ...(current as BuildersDbProjectDeploymentRow),
      status: toStatus,
      metadata: nextMetadata,
    });
  } catch (error) {
    logError('updateDeploymentEnvironment', error);
    return null;
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

  /**
   * Sprint 91 — `defaultToStatus` stays `'environment_ready'` (the status a Deployment is
   * already at when Vercel gets attached) so attaching the provider is a NO-OP status
   * transition by default: connecting/creating the Vercel project is a distinct event from
   * actually triggering a deployment. `vercelDeployService.ts`'s `deployToVercel` calls
   * `attachVercel` first (this connection event), then explicitly calls
   * `updateDeploymentStatus` itself to advance `environment_ready -> deploying -> deployed` —
   * see that file's header comment for the full sequence and why this split matters (Part 11:
   * "assess the correct timing of attachVercel() carefully").
   */
  vercel: {
    table: 'builders_deployment_vercel',
    defaultToStatus: 'environment_ready',
    connectedEventType: 'vercel_connected',
    updatedEventType: 'vercel_updated',
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
 * Sprint 91 Part 4 — statuses `attachVercel` may run from. `'environment_ready'` is also legally
 * reachable FROM `'database_connected'` via `updateDeploymentEnvironment` (Sprint 90's own,
 * separate gate) — since `attachVercel`'s own default target status IS `'environment_ready'`, the
 * generic `isValidDeploymentStatusTransition` check alone would let a Vercel attach silently jump
 * a Deployment straight from `database_connected` to `environment_ready`, bypassing Sprint 90's
 * environment-readiness assessment entirely. This explicit allow-list closes that gap: Vercel may
 * only ever attach once the Deployment is ALREADY `environment_ready` (or further along, for a
 * reconnect/metadata-refresh call using an explicit `toStatus` override).
 */
const VERCEL_ATTACH_ALLOWED_FROM_STATUSES: DeploymentStatus[] = [
  'environment_ready',
  'deploying',
  'deployed',
  'verified',
  'released',
  'maintenance',
  'archived',
  'failed',
];

/**
 * Attaches (or updates) this Deployment's Vercel connection, transitions the Deployment lifecycle
 * (a no-op at `environment_ready` by default), and records the matching Deployment History event —
 * same shape as `attachGithub`, extended with the precondition above.
 */
export async function attachVercel(
  input: DeploymentVercelInput,
  options: AttachProviderOptions = {},
): Promise<DeploymentVercel | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('attachVercel');
    return null;
  }

  try {
    const { data: current, error: readError } = await client
      .from('builders_project_deployments')
      .select('status')
      .eq('id', input.deploymentId)
      .single();

    if (readError) {
      throw readError;
    }

    if (!VERCEL_ATTACH_ALLOWED_FROM_STATUSES.includes(current.status as DeploymentStatus)) {
      logError(
        'attachVercel',
        new Error(`Deployment must be environment_ready before attaching Vercel (currently: ${current.status}).`),
      );
      return null;
    }
  } catch (error) {
    logError('attachVercel', error);
    return null;
  }

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

/**
 * Deployment Verification — Sprint 92, Part 14/17.
 *
 * Statuses a verification attempt may START from. `deployed` is the normal case; `verified` is the
 * explicitly-supported retry state (re-verifying an already-verified Deployment is legitimate — a
 * redeploy, a corrected environment variable — and is handled without duplicating the lifecycle
 * event, see `recordDeploymentVerification`). Every other status is refused: verifying a
 * Deployment that has not actually deployed would be verifying nothing.
 */
const VERIFICATION_ALLOWED_FROM_STATUSES: DeploymentStatus[] = ['deployed', 'verified'];

export type StartVerificationFailureCode = 'unavailable' | 'not_deployed' | 'already_running' | 'error';

export type StartVerificationResult =
  | { ok: true; verification: DeploymentVerification }
  | { ok: false; code: StartVerificationFailureCode; message: string };

/** Postgres unique-violation — here, the partial unique index that allows only one `running` verification per deployment. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
  );
}

/**
 * Opens a verification attempt: validates the Deployment is in a verifiable state, allocates the
 * next `verification_number`, and inserts the `running` row that
 * `recordDeploymentVerification` will later finalise. Also records the one
 * `verification_started` history event.
 *
 * Duplicate-run protection (Part 17) is the DATABASE's, not this function's: the partial unique
 * index `builders_deployment_verifications_one_active_idx` rejects a second `running` row for the
 * same deployment, so two browser tabs (or a double-clicked button) cannot start parallel runs
 * even though they never see each other's state.
 */
export async function startDeploymentVerification(params: {
  deploymentId: string;
  projectId: string;
  policyVersion: string;
  targetUrl?: string;
  vercelDeploymentId?: string;
  createdBy?: string;
}): Promise<StartVerificationResult> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('startDeploymentVerification');
    return { ok: false, code: 'unavailable', message: 'BuildersDB is not configured.' };
  }

  try {
    const { data: deploymentRow, error: deploymentError } = await client
      .from('builders_project_deployments')
      .select('status')
      .eq('id', params.deploymentId)
      .single();

    if (deploymentError) {
      throw deploymentError;
    }

    const status = deploymentRow.status as DeploymentStatus;

    if (!VERIFICATION_ALLOWED_FROM_STATUSES.includes(status)) {
      return {
        ok: false,
        code: 'not_deployed',
        message: `This Deployment must be deployed before it can be verified (currently: ${status}).`,
      };
    }

    const { data: latestRows, error: latestError } = await client
      .from('builders_deployment_verifications')
      .select('verification_number')
      .eq('deployment_id', params.deploymentId)
      .order('verification_number', { ascending: false })
      .limit(1);

    if (latestError) {
      throw latestError;
    }

    const verificationNumber =
      ((latestRows?.[0] as { verification_number?: number } | undefined)?.verification_number ?? 0) + 1;

    const { data, error } = await client
      .from('builders_deployment_verifications')
      .insert(
        toDeploymentVerificationInsert({
          deploymentId: params.deploymentId,
          projectId: params.projectId,
          verificationNumber,
          policyVersion: params.policyVersion,
          targetUrl: params.targetUrl,
          vercelDeploymentId: params.vercelDeploymentId,
          createdBy: params.createdBy,
        }),
      )
      .select('*')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        return {
          ok: false,
          code: 'already_running',
          message: 'A verification is already running for this Deployment.',
        };
      }

      throw error;
    }

    const verification = fromDeploymentVerificationRow(data as BuildersDbDeploymentVerificationRow);

    await recordDeploymentEvent({
      deploymentId: params.deploymentId,
      projectId: params.projectId,
      eventType: 'verification_started',
      fromStatus: status,
      toStatus: status,
      provider: 'vercel',
      message: `Verification #${verificationNumber} started${params.targetUrl ? ` for ${params.targetUrl}` : ''}.`,
      metadata: { verificationId: verification.id, verificationNumber, policyVersion: params.policyVersion },
      createdBy: params.createdBy,
    });

    return { ok: true, verification };
  } catch (error) {
    logError('startDeploymentVerification', error);
    return { ok: false, code: 'error', message: 'Could not start verification — check server logs for details.' };
  }
}

export interface RecordVerificationResult {
  ok: boolean;

  /** True when this call moved the Deployment `deployed -> verified`. */
  transitioned: boolean;

  /** True when the Deployment was ALREADY verified, so no second lifecycle event was written (Part 17). */
  duplicate: boolean;
  deploymentStatus?: DeploymentStatus;
  message: string;
}

/**
 * Part 14 — the ONE repository operation that finalises a verification. Persists the report,
 * transitions `deployed -> verified` when (and only when) the report permits it, and records
 * exactly one canonical history event — all three inside a single Postgres transaction
 * (`builders_finalize_deployment_verification`), because a partial failure here would leave
 * genuinely misleading state (see that function's own comment in the migration for the full
 * rationale, and why the rest of this file legitimately does NOT need a transaction).
 *
 * The pass/warning rule itself is not duplicated here — `reportPermitsVerified`
 * (`verificationTypes.ts`) is the single source, and its answer is passed to the transaction.
 * A failed report is still persisted in full; it simply never transitions.
 */
export async function recordDeploymentVerification(
  verificationId: string,
  report: VerificationReport,
  options: { performedBy?: string } = {},
): Promise<RecordVerificationResult> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('recordDeploymentVerification');
    return { ok: false, transitioned: false, duplicate: false, message: 'BuildersDB is not configured.' };
  }

  try {
    const { data, error } = await client.rpc('builders_finalize_deployment_verification', {
      p_verification_id: verificationId,
      p_status: report.status,
      p_summary: report.summary,
      p_checks: report.checks,
      p_message: report.message,
      p_final_url: report.finalUrl ?? null,
      p_duration_ms: report.durationMs ?? null,
      p_permits_verified: reportPermitsVerified(report),
      p_created_by: options.performedBy ?? null,
    });

    if (error) {
      throw error;
    }

    const result = (data ?? {}) as {
      transitioned?: boolean;
      duplicate?: boolean;
      deploymentStatus?: DeploymentStatus;
    };

    return {
      ok: true,
      transitioned: result.transitioned === true,
      duplicate: result.duplicate === true,
      deploymentStatus: result.deploymentStatus,
      message: report.message,
    };
  } catch (error) {
    logError('recordDeploymentVerification', error);

    /*
     * The report could not be persisted. The Deployment is deliberately left as-is: never mark
     * `verified` outside the transaction that also stores the evidence for it (Part 23).
     */
    return {
      ok: false,
      transitioned: false,
      duplicate: false,
      message: 'Verification finished, but its report could not be saved — the Deployment was left unchanged.',
    };
  }
}

/** The most recent attempt for a deployment, running or finished. */
export async function getLatestDeploymentVerification(deploymentId: string): Promise<DeploymentVerification | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestDeploymentVerification');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_verifications')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('verification_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromDeploymentVerificationRow(data as BuildersDbDeploymentVerificationRow) : null;
  } catch (error) {
    logError('getLatestDeploymentVerification', error);
    return null;
  }
}

/** Every attempt for a deployment, newest first — older evidence is never overwritten (Part 15). */
export async function listDeploymentVerifications(deploymentId: string): Promise<DeploymentVerification[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listDeploymentVerifications');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_deployment_verifications')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('verification_number', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromDeploymentVerificationRow(row as BuildersDbDeploymentVerificationRow));
  } catch (error) {
    logError('listDeploymentVerifications', error);
    return [];
  }
}

export const deploymentRepository = {
  createDeployment,
  getDeploymentByProject,
  ensureDeploymentForProject,
  getDeploymentWithProviders,
  updateDeploymentStatus,
  updateDeploymentEnvironment,
  attachGithub,
  attachSupabase,
  attachVercel,
  getDeploymentGithub,
  getDeploymentSupabase,
  getDeploymentVercel,
  recordDeploymentEvent,
  getDeploymentHistory,
  startDeploymentVerification,
  recordDeploymentVerification,
  getLatestDeploymentVerification,
  listDeploymentVerifications,
};
