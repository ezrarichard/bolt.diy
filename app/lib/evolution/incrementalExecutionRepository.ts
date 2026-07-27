import { getBuildersDbClient } from '~/lib/builders-db/client';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import type {
  DiscoveredImpact,
  FullContextFallbackApproval,
  IncrementalExecution,
  IncrementalExecutionStatus,
  IncrementalReviewResult,
  IncrementalRoleRun,
  InvalidationDecision,
  RoleOverride,
  SafetyFallbackTrigger,
  ScopeExpansionDecision,
} from '~/lib/evolution/incrementalExecutionTypes';

/**
 * Incremental Execution Repository — Sprint 97, Parts 14 and 15.
 *
 * Follows the same defensive convention as every other BuildersDB repository: check for a
 * configured client up front, wrap each call, return an explicit result rather than throwing.
 *
 * NEVER OVERWRITES HISTORY. `createExecution` allocates the next `execution_version`; a role retry
 * inserts a new `attempt` row rather than updating the previous one; invalidations are written once
 * per execution. The only column that is ever updated in place is the execution's own progress
 * (status, current role, completed/failed lists) — which is the live state, not the record of what
 * happened.
 *
 * HISTORY, AS DECIDED IN THE MIGRATION. Execution-level events go to
 * `builders_deployment_history`; role-level events do not, because the role runs table already
 * holds them in queryable form and a nine-role execution would drown the project timeline. See the
 * header of supabase/migrations/20260810100000_incremental_execution.sql.
 */

const { unavailable, logError } = createRepositoryLogger('IncrementalExecutionRepository');

interface ExecutionRow {
  id: string;
  engineering_plan_id: string;
  change_request_id: string;
  impact_analysis_id: string | null;
  deployment_id: string;
  project_id: string;
  release_id: string | null;
  status: IncrementalExecutionStatus;
  execution_version: number;
  model_version: string;
  recommended_roles: IncrementalRoleId[] | null;
  selected_roles: IncrementalRoleId[] | null;
  overrides: RoleOverride[] | null;
  current_role: IncrementalRoleId | null;
  completed_roles: IncrementalRoleId[] | null;
  skipped_roles: IncrementalRoleId[] | null;
  failed_roles: IncrementalRoleId[] | null;
  safety_fallbacks: SafetyFallbackTrigger[] | null;
  full_context_fallback: FullContextFallbackApproval | null;
  scope_expansion_decisions: ScopeExpansionDecision[] | null;
  reviews: IncrementalReviewResult[] | null;
  scope_fingerprint: string;
  failure: { code: string; message: string } | null;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RoleRunRow {
  id: string;
  execution_id: string;
  project_id: string;
  role: IncrementalRoleId;
  attempt: number;
  status: IncrementalRoleRun['status'];
  artifact_type: string | null;
  context: IncrementalRoleRun['context'] | null;
  output: IncrementalRoleRun['output'] | null;
  failure: { kind: string; message: string } | null;
  started_at: string;
  completed_at: string | null;
}

interface InvalidationRow {
  execution_id: string;
  role: IncrementalRoleId;
  artifact_type: string | null;
  state: InvalidationDecision['state'];
  must_rerun: boolean;
  requires_review: boolean;
  caused_by: IncrementalRoleId[] | null;
  evidence: string[] | null;
  reasoning: string;
}

interface DiscoveredImpactRow {
  id: string;
  execution_id: string;
  role_run_id: string | null;
  reported_by_role: IncrementalRoleId;
  description: string;
  category: DiscoveredImpact['category'];
  affected_artifact: string;
  reasoning: string;
  severity: DiscoveredImpact['severity'];
  recommended_action: DiscoveredImpact['recommendedAction'];
  scope_change_required: boolean;
  created_at: string;
}

function fromExecutionRow(row: ExecutionRow, extras: Partial<IncrementalExecution> = {}): IncrementalExecution {
  return {
    id: row.id,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    releaseId: row.release_id ?? undefined,
    changeRequestId: row.change_request_id,
    impactAnalysisId: row.impact_analysis_id ?? undefined,
    engineeringPlanId: row.engineering_plan_id,
    status: row.status,
    recommendedRoles: row.recommended_roles ?? [],
    selectedRoles: row.selected_roles ?? [],
    overrides: row.overrides ?? [],
    currentRole: row.current_role ?? undefined,
    completedRoles: row.completed_roles ?? [],
    skippedRoles: row.skipped_roles ?? [],
    failedRoles: row.failed_roles ?? [],
    invalidations: extras.invalidations ?? [],
    safetyFallbacks: row.safety_fallbacks ?? [],
    fullContextFallback: row.full_context_fallback ?? undefined,
    discoveredImpacts: extras.discoveredImpacts ?? [],
    scopeExpansionDecisions: row.scope_expansion_decisions ?? [],
    reviews: row.reviews ?? [],
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    failure: row.failure ?? undefined,
    executionVersion: row.execution_version,
    modelVersion: row.model_version,
    scopeFingerprint: row.scope_fingerprint,
    metadata: row.metadata ?? {},
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromRoleRunRow(row: RoleRunRow): IncrementalRoleRun {
  return {
    id: row.id,
    executionId: row.execution_id,
    role: row.role,
    label: row.role,
    attempt: row.attempt,
    status: row.status,
    artifactType: row.artifact_type ?? undefined,
    context: row.context ?? undefined,
    output: row.output ?? undefined,
    discoveredImpacts: [],
    failure: row.failure ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function fromInvalidationRow(row: InvalidationRow): InvalidationDecision {
  return {
    role: row.role,
    label: row.role,
    artifactType: row.artifact_type ?? undefined,
    state: row.state,
    mustRerun: row.must_rerun,
    requiresReview: row.requires_review,
    causedBy: row.caused_by ?? [],
    reasoning: row.reasoning,
    evidence: row.evidence ?? [],
  };
}

function fromDiscoveredImpactRow(row: DiscoveredImpactRow): DiscoveredImpact {
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    affectedArtifact: row.affected_artifact,
    reasoning: row.reasoning,
    severity: row.severity,
    recommendedAction: row.recommended_action,
    scopeChangeRequired: row.scope_change_required,
    reportedByRole: row.reported_by_role,
    reportedAt: row.created_at,
  };
}

export type ExecutionWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'unavailable' | 'error' | 'conflict'; message: string };

export interface CreateExecutionParams {
  engineeringPlanId: string;
  changeRequestId: string;
  impactAnalysisId?: string;
  deploymentId: string;
  projectId: string;
  releaseId?: string;
  modelVersion: string;
  recommendedRoles: IncrementalRoleId[];
  selectedRoles: IncrementalRoleId[];
  overrides: RoleOverride[];
  safetyFallbacks: SafetyFallbackTrigger[];
  fullContextFallback?: FullContextFallbackApproval;
  scopeFingerprint: string;
  status: IncrementalExecutionStatus;
  invalidations: InvalidationDecision[];
  createdBy?: string;
  changeRequestNumber?: number;
}

/**
 * Part 14/18 — creates one execution and its invalidation decisions.
 *
 * The "one active execution per engineering plan" rule is enforced by a partial unique index, not
 * by a read-then-write check: two operators clicking Start at the same moment would both pass a
 * check, and only the database can actually decide. A unique violation is therefore reported as
 * `conflict`, which is a real answer ("someone already started this"), not an error.
 */
export async function createExecution(
  params: CreateExecutionParams,
): Promise<ExecutionWriteResult<IncrementalExecution>> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createExecution');
    return { ok: false, code: 'unavailable', message: 'BuildersDB is not configured.' };
  }

  try {
    const { data: latestRows, error: latestError } = await client
      .from('builders_incremental_executions')
      .select('execution_version')
      .eq('engineering_plan_id', params.engineeringPlanId)
      .order('execution_version', { ascending: false })
      .limit(1);

    if (latestError) {
      throw latestError;
    }

    const executionVersion =
      ((latestRows?.[0] as { execution_version?: number } | undefined)?.execution_version ?? 0) + 1;

    const { data, error } = await client
      .from('builders_incremental_executions')
      .insert({
        engineering_plan_id: params.engineeringPlanId,
        change_request_id: params.changeRequestId,
        impact_analysis_id: params.impactAnalysisId ?? null,
        deployment_id: params.deploymentId,
        project_id: params.projectId,
        release_id: params.releaseId ?? null,
        status: params.status,
        execution_version: executionVersion,
        model_version: params.modelVersion,
        recommended_roles: params.recommendedRoles,
        selected_roles: params.selectedRoles,
        overrides: params.overrides,
        completed_roles: [],
        skipped_roles: params.recommendedRoles.filter((role) => !params.selectedRoles.includes(role)),
        failed_roles: [],
        safety_fallbacks: params.safetyFallbacks,
        full_context_fallback: params.fullContextFallback ?? null,
        scope_expansion_decisions: [],
        reviews: [],
        scope_fingerprint: params.scopeFingerprint,
        created_by: params.createdBy ?? null,
      })
      .select('*')
      .single();

    if (error) {
      /* 23505 — the partial unique index fired: an execution for this plan is already live. */
      if ((error as { code?: string }).code === '23505') {
        return {
          ok: false,
          code: 'conflict',
          message: 'An execution is already in progress for this engineering plan. Resume or cancel it first.',
        };
      }

      throw error;
    }

    const row = data as ExecutionRow;

    if (params.invalidations.length > 0) {
      const { error: invalidationError } = await client.from('builders_incremental_invalidations').insert(
        params.invalidations.map((decision) => ({
          execution_id: row.id,
          project_id: params.projectId,
          role: decision.role,
          artifact_type: decision.artifactType ?? null,
          state: decision.state,
          must_rerun: decision.mustRerun,
          requires_review: decision.requiresReview,
          caused_by: decision.causedBy,
          evidence: decision.evidence,
          reasoning: decision.reasoning,
        })),
      );

      if (invalidationError) {
        throw invalidationError;
      }
    }

    await deploymentRepository.recordDeploymentEvent({
      deploymentId: params.deploymentId,
      projectId: params.projectId,
      eventType: 'incremental_execution_started',
      message: `Incremental execution #${executionVersion} started for change request${
        params.changeRequestNumber ? ` #${params.changeRequestNumber}` : ''
      } — ${params.selectedRoles.length} role(s) approved.`,
      metadata: {
        executionId: row.id,
        engineeringPlanId: params.engineeringPlanId,
        changeRequestId: params.changeRequestId,
        executionVersion,
        selectedRoles: params.selectedRoles,
        overrides: params.overrides.length,
        safetyFallbacks: params.safetyFallbacks.length,
        scopeFingerprint: params.scopeFingerprint,
      },
      createdBy: params.createdBy,
    });

    return { ok: true, value: fromExecutionRow(row, { invalidations: params.invalidations }) };
  } catch (error) {
    logError('createExecution', error);
    return { ok: false, code: 'error', message: 'The incremental execution could not be created.' };
  }
}

export interface UpdateExecutionParams {
  status?: IncrementalExecutionStatus;
  currentRole?: IncrementalRoleId | null;
  completedRoles?: IncrementalRoleId[];
  failedRoles?: IncrementalRoleId[];
  skippedRoles?: IncrementalRoleId[];
  reviews?: IncrementalReviewResult[];
  scopeExpansionDecisions?: ScopeExpansionDecision[];
  safetyFallbacks?: SafetyFallbackTrigger[];
  fullContextFallback?: FullContextFallbackApproval | null;
  failure?: { code: string; message: string } | null;
  startedAt?: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  metadata?: Record<string, unknown>;
}

/** Progress only. Nothing here rewrites what already happened — see this file's header. */
export async function updateExecution(executionId: string, params: UpdateExecutionParams): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateExecution');
    return false;
  }

  const patch: Record<string, unknown> = {};

  if (params.status !== undefined) {
    patch.status = params.status;
  }

  if (params.currentRole !== undefined) {
    patch.current_role = params.currentRole;
  }

  if (params.completedRoles !== undefined) {
    patch.completed_roles = params.completedRoles;
  }

  if (params.failedRoles !== undefined) {
    patch.failed_roles = params.failedRoles;
  }

  if (params.skippedRoles !== undefined) {
    patch.skipped_roles = params.skippedRoles;
  }

  if (params.reviews !== undefined) {
    patch.reviews = params.reviews;
  }

  if (params.scopeExpansionDecisions !== undefined) {
    patch.scope_expansion_decisions = params.scopeExpansionDecisions;
  }

  if (params.safetyFallbacks !== undefined) {
    patch.safety_fallbacks = params.safetyFallbacks;
  }

  if (params.fullContextFallback !== undefined) {
    patch.full_context_fallback = params.fullContextFallback;
  }

  if (params.failure !== undefined) {
    patch.failure = params.failure;
  }

  if (params.startedAt !== undefined) {
    patch.started_at = params.startedAt;
  }

  if (params.completedAt !== undefined) {
    patch.completed_at = params.completedAt;
  }

  if (params.cancelledAt !== undefined) {
    patch.cancelled_at = params.cancelledAt;
  }

  if (params.metadata !== undefined) {
    patch.metadata = params.metadata;
  }

  if (Object.keys(patch).length === 0) {
    return true;
  }

  try {
    const { error } = await client.from('builders_incremental_executions').update(patch).eq('id', executionId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateExecution', error);
    return false;
  }
}

/** Part 17 — one execution with everything needed to resume it, read back rather than remembered. */
export async function getExecution(executionId: string): Promise<IncrementalExecution | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getExecution');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_executions')
      .select('*')
      .eq('id', executionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    const [invalidations, discoveredImpacts] = await Promise.all([
      listInvalidations(executionId),
      listDiscoveredImpacts(executionId),
    ]);

    return fromExecutionRow(data as ExecutionRow, { invalidations, discoveredImpacts });
  } catch (error) {
    logError('getExecution', error);
    return null;
  }
}

/** The live execution for a plan, if any. This is what a reload resumes from. */
export async function getActiveExecution(engineeringPlanId: string): Promise<IncrementalExecution | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getActiveExecution');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_executions')
      .select('*')
      .eq('engineering_plan_id', engineeringPlanId)
      .in('status', ['pending', 'ready', 'running', 'paused', 'blocked'])
      .order('execution_version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? await getExecution((data as ExecutionRow).id) : null;
  } catch (error) {
    logError('getActiveExecution', error);
    return null;
  }
}

/** Every execution for a deployment, newest first. Project isolation is enforced by RLS on top of this filter. */
export async function listExecutions(deploymentId: string): Promise<IncrementalExecution[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listExecutions');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_executions')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromExecutionRow(row as ExecutionRow));
  } catch (error) {
    logError('listExecutions', error);
    return [];
  }
}

export async function listInvalidations(executionId: string): Promise<InvalidationDecision[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listInvalidations');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_invalidations')
      .select('*')
      .eq('execution_id', executionId);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromInvalidationRow(row as InvalidationRow));
  } catch (error) {
    logError('listInvalidations', error);
    return [];
  }
}

// ── Role runs ───────────────────────────────────────────────────────────────

export interface StartRoleRunParams {
  executionId: string;
  projectId: string;
  role: IncrementalRoleId;
  attempt: number;
  artifactType?: string;
  context: IncrementalRoleRun['context'];
  startedAt: string;
}

/** Inserts a NEW attempt row. A retry never updates the previous attempt — both are kept. */
export async function startRoleRun(params: StartRoleRunParams): Promise<ExecutionWriteResult<string>> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('startRoleRun');
    return { ok: false, code: 'unavailable', message: 'BuildersDB is not configured.' };
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_role_runs')
      .insert({
        execution_id: params.executionId,
        project_id: params.projectId,
        role: params.role,
        attempt: params.attempt,
        status: 'running',
        artifact_type: params.artifactType ?? null,
        context: params.context ?? null,
        started_at: params.startedAt,
      })
      .select('id')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return {
          ok: false,
          code: 'conflict',
          message: `Attempt ${params.attempt} of ${params.role} already exists for this execution.`,
        };
      }

      throw error;
    }

    return { ok: true, value: (data as { id: string }).id };
  } catch (error) {
    logError('startRoleRun', error);
    return { ok: false, code: 'error', message: 'The role run could not be started.' };
  }
}

export interface FinishRoleRunParams {
  roleRunId: string;
  status: IncrementalRoleRun['status'];
  output?: IncrementalRoleRun['output'];
  failure?: { kind: string; message: string };
  completedAt: string;
}

export async function finishRoleRun(params: FinishRoleRunParams): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('finishRoleRun');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_incremental_role_runs')
      .update({
        status: params.status,
        output: params.output ?? null,
        failure: params.failure ?? null,
        completed_at: params.completedAt,
      })
      .eq('id', params.roleRunId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('finishRoleRun', error);
    return false;
  }
}

/** Part 17 — every attempt for an execution. Idempotent resume is built on this read, not on memory. */
export async function listRoleRuns(executionId: string): Promise<IncrementalRoleRun[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listRoleRuns');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_incremental_role_runs')
      .select('*')
      .eq('execution_id', executionId)
      .order('started_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromRoleRunRow(row as RoleRunRow));
  } catch (error) {
    logError('listRoleRuns', error);
    return [];
  }
}

// ── Discovered impact (Part 10) ─────────────────────────────────────────────

export async function recordDiscoveredImpacts(params: {
  executionId: string;
  roleRunId?: string;
  changeRequestId: string;
  projectId: string;
  discoveries: DiscoveredImpact[];
}): Promise<boolean> {
  if (params.discoveries.length === 0) {
    return true;
  }

  const client = getBuildersDbClient();

  if (!client) {
    unavailable('recordDiscoveredImpacts');
    return false;
  }

  try {
    const { error } = await client.from('builders_discovered_impacts').insert(
      params.discoveries.map((discovery) => ({
        execution_id: params.executionId,
        role_run_id: params.roleRunId ?? null,
        change_request_id: params.changeRequestId,
        project_id: params.projectId,
        reported_by_role: discovery.reportedByRole,
        description: discovery.description,
        category: discovery.category,
        affected_artifact: discovery.affectedArtifact,
        reasoning: discovery.reasoning,
        severity: discovery.severity,
        recommended_action: discovery.recommendedAction,
        scope_change_required: discovery.scopeChangeRequired,
      })),
    );

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('recordDiscoveredImpacts', error);
    return false;
  }
}

export async function listDiscoveredImpacts(executionId: string): Promise<DiscoveredImpact[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listDiscoveredImpacts');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_discovered_impacts')
      .select('*')
      .eq('execution_id', executionId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromDiscoveredImpactRow(row as DiscoveredImpactRow));
  } catch (error) {
    logError('listDiscoveredImpacts', error);
    return [];
  }
}

// ── History (Part 15) ───────────────────────────────────────────────────────

/** The canonical execution-level events. Role-level events are deliberately absent — see the migration header. */
export type IncrementalExecutionEvent =
  | 'incremental_execution_started'
  | 'incremental_execution_paused'
  | 'incremental_execution_completed'
  | 'incremental_execution_cancelled'
  | 'incremental_execution_blocked'
  | 'scope_expansion_requested'
  | 'scope_expansion_approved'
  | 'scope_expansion_rejected';

export async function recordExecutionEvent(params: {
  execution: Pick<IncrementalExecution, 'id' | 'deploymentId' | 'projectId' | 'executionVersion'>;
  eventType: IncrementalExecutionEvent;
  message: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}): Promise<void> {
  await deploymentRepository.recordDeploymentEvent({
    deploymentId: params.execution.deploymentId,
    projectId: params.execution.projectId,
    eventType: params.eventType,
    message: params.message,
    metadata: {
      executionId: params.execution.id,
      executionVersion: params.execution.executionVersion,
      ...params.metadata,
    },
    createdBy: params.createdBy,
  });
}

export const incrementalExecutionRepository = {
  createExecution,
  updateExecution,
  getExecution,
  getActiveExecution,
  listExecutions,
  listInvalidations,
  startRoleRun,
  finishRoleRun,
  listRoleRuns,
  recordDiscoveredImpacts,
  listDiscoveredImpacts,
  recordExecutionEvent,
};
