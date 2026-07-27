import { getLatestApprovedArtifact } from '~/lib/projects/artifacts';
import { AUTO_ENGINEERING_ROLES } from '~/lib/projects/autoEngineeringEngine';
import { businessAnalystEngine } from '~/lib/projects/businessAnalystEngine';
import { generateRoleWithRecovery, type RecoveryGenerateFn } from '~/lib/projects/roleGenerationRecovery';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import {
  INCREMENTAL_ROLE_LABELS,
  type IncrementalPlanRecord,
  type IncrementalRoleId,
} from '~/lib/evolution/engineeringScopeTypes';
import { evolutionRepository } from '~/lib/evolution/evolutionRepository';
import {
  INCREMENTAL_EXECUTION_MODEL_VERSION,
  RESUMABLE_STATUSES,
  type DiscoveredImpact,
  type IncrementalArtifact,
  type IncrementalExecution,
  type IncrementalRoleRun,
  type RoleOverride,
  type ScopeExpansionDecision,
} from '~/lib/evolution/incrementalExecutionTypes';
import { incrementalExecutionRepository } from '~/lib/evolution/incrementalExecutionRepository';
import { applyInvalidationPolicy } from '~/lib/evolution/invalidationPolicy';
import {
  materialDiscoveries,
  parseDiscoveredImpacts,
  readDiscoveredImpactField,
} from '~/lib/evolution/discoveredImpact';
import { evaluateIncrementalReviews } from '~/lib/evolution/incrementalReview';
import { approvedExecutionOrder, resolveRoleSelection } from '~/lib/evolution/roleOverrides';
import { resolveBaselineSnapshot } from '~/lib/services/evolutionRunner';
import {
  ROLE_ARTIFACT_TYPE,
  buildRoleExecutionContext,
  buildScopedProject,
  computeScopeFingerprint,
  detectSafetyFallbacks,
} from '~/lib/services/incrementalExecutionContext';
import { buildIncrementalInstructionLayer } from '~/lib/services/incrementalExecutionPrompt';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('incrementalExecutionRunner');

/**
 * Incremental Execution Runner — Sprint 97, Part 13.
 *
 * The one orchestration point for executing an approved incremental engineering plan. It COMPOSES
 * the existing pieces and adds no AI provider logic of its own:
 *
 *   AUTO_ENGINEERING_ROLES + businessAnalystEngine   the real engines — `buildContext`,
 *       `buildPrompt`, `parseDraft`, exactly as the normal pipeline calls them.
 *   generateRoleWithRecovery (Sprint 44)             the provider-agnostic generation core with
 *       bounded, finish-reason-aware retries. `generate` is INJECTED, so this module never touches
 *       a provider, a cookie or the network, and tests drive it with a fake.
 *   resolveBaselineSnapshot (Sprint 95)              the release-frozen baseline, the same one the
 *       impact analysis and the plan were built against.
 *   roleOverrides / invalidationPolicy / incrementalExecutionContext / incrementalReview
 *       the pure decision modules, each tested on its own.
 *
 * WHAT MAKES THIS INCREMENTAL RATHER THAN A SECOND PIPELINE. Only two inputs change versus a full
 * run: the project handed to `buildContext` is narrowed to the artifacts the role's reduced context
 * permits (`buildScopedProject`), and the context block handed to `generateRoleWithRecovery` is the
 * scoped instruction layer instead of the full BuildersDB project block. Everything else — the
 * prompts, the parsing, the retry policy, the token budgets — is the existing behaviour untouched.
 *
 * WHAT IT REFUSES TO DO. It does not generate application code, write a file, touch the manifest,
 * modify a release, deploy, or overwrite a released engineering artifact. It does not widen scope:
 * a material discovery pauses the run and waits for a person.
 */

export type IncrementalExecutionCode =
  | 'no_plan'
  | 'no_impact'
  | 'no_baseline'
  | 'baseline_mismatch'
  | 'invalid_override'
  | 'blocked'
  | 'conflict'
  | 'persist_failed'
  | 'role_failed'
  | 'cancelled'
  | 'paused'
  | 'completed';

export interface IncrementalExecutionResult {
  ok: boolean;
  code: IncrementalExecutionCode;
  message: string;
  execution?: IncrementalExecution;
  roleRuns: IncrementalRoleRun[];
  discoveredImpacts: DiscoveredImpact[];
}

export interface RunIncrementalExecutionParams {
  project: Project;
  request: ChangeRequest;
  planRecord: IncrementalPlanRecord;

  /** Injected AI call — `useGenerateText().generate` in the app, a fake in tests. */
  generate: RecoveryGenerateFn;

  /** Part 4 — operator role overrides. Validated as a set; any violation aborts before anything runs. */
  overrides?: RoleOverride[];

  /** Part 7 — an operator's explicit approval to run with full project context, with its reason. */
  fullContextApproval?: { reason: string; approvedBy?: string };

  /** Part 10 — an operator's ruling on impact a previous attempt discovered. */
  scopeExpansionDecision?: Omit<ScopeExpansionDecision, 'decidedAt'> & { decidedAt?: string };

  /** Part 17 — resume an existing execution instead of creating one. */
  executionId?: string;

  createdBy?: string;
  signal?: AbortSignal;
  clock?: () => string;
}

/**
 * The engines this sprint can execute. `requirements` is the Business Analyst, which sits outside
 * `AUTO_ENGINEERING_ROLES` by design (it is the pipeline's entry point, not a stage of it) — it is
 * mapped here explicitly rather than being bolted into that registry.
 */
interface RoleEngine {
  label: string;
  artifactType: string;
  maxOutputTokens: number;
  buildContext: (project: Project) => unknown;
  buildPrompt: (context: any) => { system: string; prompt: string };
  parseDraft: (rawText: string) => { ok: true; draft: object } | { ok: false; error: string };
}

const REQUIREMENTS_MAX_OUTPUT_TOKENS = 8192;

export function resolveRoleEngine(role: IncrementalRoleId): RoleEngine | undefined {
  if (role === 'requirements') {
    return {
      label: INCREMENTAL_ROLE_LABELS.requirements,
      artifactType: ROLE_ARTIFACT_TYPE.requirements,
      maxOutputTokens: REQUIREMENTS_MAX_OUTPUT_TOKENS,
      buildContext: businessAnalystEngine.buildRequirementsContext,
      buildPrompt: businessAnalystEngine.buildBusinessPrompt,
      parseDraft: businessAnalystEngine.parseDraft,
    };
  }

  const registered = AUTO_ENGINEERING_ROLES.find((entry) => entry.id === role);

  if (!registered) {
    return undefined;
  }

  return {
    label: registered.label,
    artifactType: registered.artifactType,
    maxOutputTokens: registered.maxOutputTokens,
    buildContext: registered.buildContext,
    buildPrompt: registered.buildPrompt,
    parseDraft: registered.parseDraft,
  };
}

function emptyResult(code: IncrementalExecutionCode, message: string): IncrementalExecutionResult {
  return { ok: false, code, message, roleRuns: [], discoveredImpacts: [] };
}

export async function runIncrementalExecution(
  params: RunIncrementalExecutionParams,
): Promise<IncrementalExecutionResult> {
  const clock = params.clock ?? (() => new Date().toISOString());
  const plan = params.planRecord.plan;

  if (!plan || !plan.executionOrder) {
    return emptyResult('no_plan', 'This change request has no incremental engineering plan to execute.');
  }

  /* ── Load the analysis this plan derives from. Never recomputed — the plan and the run must agree. ── */
  const analysis = await evolutionRepository.getLatestImpactAnalysis(params.request.id);

  if (!analysis) {
    return emptyResult('no_impact', 'The impact analysis behind this plan is no longer available. Re-analyse first.');
  }

  const resolved = await resolveBaselineSnapshot(params.project, clock);

  if (resolved.code !== 'ok' || !resolved.snapshot) {
    return emptyResult('no_baseline', resolved.message ?? 'No release baseline is available for this project.');
  }

  const baseline = resolved.snapshot;
  const artifacts = getProjectArtifacts(params.project);

  /* ── Part 4 — the operator's approved selection. A violation aborts before anything is created. ── */
  const selection = resolveRoleSelection({ plan, overrides: params.overrides });

  if (!selection.ok) {
    return {
      ...emptyResult(
        'invalid_override',
        `The role selection was not applied: ${selection.violations.map((violation) => violation.message).join(' ')}`,
      ),
    };
  }

  const approvedRoles = approvedExecutionOrder(selection.approvedRoles);

  /* ── Part 5 — what happens to every existing artifact once these roles run. ── */
  const invalidations = applyInvalidationPolicy({
    approvedRoles,
    artifactTypeByRole: Object.fromEntries(
      plan.roleDecisions.map((decision) => [decision.role, decision.artifactType]),
    ) as Partial<Record<IncrementalRoleId, string | undefined>>,
  });

  /* ── Part 7 — is reduced context safe here at all? ── */
  const safetyFallbacks = detectSafetyFallbacks({
    plan,
    impact: analysis.impact,
    baseline,
    approvedRoles,
    invalidations,
    artifacts,
  });

  const baselineMismatch = safetyFallbacks.filter((trigger) => trigger.reason === 'baseline_integrity_mismatch');

  /*
   * A baseline mismatch is not something an operator can wave through with more context: the plan
   * describes a product that is not the one in front of us, so the scope itself is wrong. It fails
   * before an execution row is created rather than blocking one.
   */
  if (baselineMismatch.length > 0) {
    return emptyResult('baseline_mismatch', baselineMismatch.map((trigger) => trigger.detail).join(' '));
  }

  const fullContextFallback = params.fullContextApproval
    ? {
        approved: true,
        reason: params.fullContextApproval.reason,
        approvedBy: params.fullContextApproval.approvedBy,
        approvedAt: clock(),
        coversReasons: [...new Set(safetyFallbacks.map((trigger) => trigger.reason))],
      }
    : undefined;

  const blockedBySafety = safetyFallbacks.length > 0 && !fullContextFallback;

  const scopeFingerprint = computeScopeFingerprint(plan, approvedRoles);

  /* ── Part 17 — resume an existing execution, or create one. ── */
  let execution: IncrementalExecution | null = null;

  if (params.executionId) {
    execution = await incrementalExecutionRepository.getExecution(params.executionId);

    if (!execution) {
      return emptyResult('no_plan', 'That execution no longer exists.');
    }

    if (!RESUMABLE_STATUSES.includes(execution.status) && execution.status !== 'blocked') {
      return {
        ok: false,
        code: 'conflict',
        message: `Execution #${execution.executionVersion} is ${execution.status} and cannot be resumed.`,
        execution,
        roleRuns: await incrementalExecutionRepository.listRoleRuns(execution.id),
        discoveredImpacts: execution.discoveredImpacts,
      };
    }
  } else {
    const created = await incrementalExecutionRepository.createExecution({
      engineeringPlanId: params.planRecord.id,
      changeRequestId: params.request.id,
      impactAnalysisId: analysis.id,
      deploymentId: params.request.deploymentId,
      projectId: params.request.projectId,
      releaseId: params.request.releaseId,
      modelVersion: INCREMENTAL_EXECUTION_MODEL_VERSION,
      recommendedRoles: selection.recommendedRoles,
      selectedRoles: approvedRoles,
      overrides: selection.appliedOverrides,
      safetyFallbacks,
      fullContextFallback,
      scopeFingerprint,
      status: blockedBySafety ? 'blocked' : 'running',
      invalidations,
      createdBy: params.createdBy,
      changeRequestNumber: params.request.requestNumber,
    });

    if (!created.ok) {
      return emptyResult(created.code === 'conflict' ? 'conflict' : 'persist_failed', created.message);
    }

    execution = created.value;
  }

  const executionId = execution.id;

  if (blockedBySafety) {
    await incrementalExecutionRepository.updateExecution(executionId, {
      status: 'blocked',
      safetyFallbacks,
      failure: null,
    });

    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: 'incremental_execution_blocked',
      message: `Incremental execution #${execution.executionVersion} is blocked: reduced context is not safe (${safetyFallbacks
        .map((trigger) => trigger.reason)
        .join(', ')}).`,
      metadata: { safetyFallbacks },
      createdBy: params.createdBy,
    });

    return {
      ok: false,
      code: 'blocked',
      message: `Execution blocked before any role ran — ${safetyFallbacks
        .map((trigger) => trigger.detail)
        .join(' ')} Approve a full-context run with a recorded reason, or resolve the cause and start again.`,
      execution: { ...execution, status: 'blocked', safetyFallbacks },
      roleRuns: [],
      discoveredImpacts: [],
    };
  }

  /* ── Part 10 — record an operator's ruling on a previous attempt's discoveries before continuing. ── */
  const scopeDecisions = [...execution.scopeExpansionDecisions];

  if (params.scopeExpansionDecision) {
    const decision: ScopeExpansionDecision = {
      ...params.scopeExpansionDecision,
      decidedAt: params.scopeExpansionDecision.decidedAt ?? clock(),
    };
    scopeDecisions.push(decision);

    await incrementalExecutionRepository.updateExecution(executionId, { scopeExpansionDecisions: scopeDecisions });
    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: decision.decision === 'approve_expansion' ? 'scope_expansion_approved' : 'scope_expansion_rejected',
      message: `Scope decision on execution #${execution.executionVersion}: ${decision.decision} — ${decision.reason}`,
      metadata: { decision: decision.decision, discoveredImpactIds: decision.discoveredImpactIds },
      createdBy: params.createdBy,
    });

    /*
     * An approved expansion does NOT resume this run. A wider scope is a different scope, so it
     * needs a re-planned engineering plan — resuming here would execute the OLD plan while claiming
     * the new one, which is precisely the silent expansion Part 10 forbids.
     */
    if (decision.decision === 'approve_expansion' || decision.decision === 'return_to_impact_analysis') {
      return {
        ok: false,
        code: 'blocked',
        message:
          decision.decision === 'approve_expansion'
            ? 'Scope expansion approved. Re-plan the incremental engineering work and start a new execution — this one stays blocked with its completed roles intact.'
            : 'Returned to impact analysis. Re-analyse the change request before executing anything further.',
        execution: { ...execution, status: 'blocked', scopeExpansionDecisions: scopeDecisions },
        roleRuns: await incrementalExecutionRepository.listRoleRuns(executionId),
        discoveredImpacts: execution.discoveredImpacts,
      };
    }
  }

  /* ── Part 17 — what already happened. Resume is derived from persisted runs, never from memory. ── */
  const priorRuns = await incrementalExecutionRepository.listRoleRuns(executionId);
  const completedRoles = new Set<IncrementalRoleId>(
    priorRuns.filter((run) => run.status === 'completed').map((run) => run.role),
  );
  const failedRoles = new Set<IncrementalRoleId>(execution.failedRoles);
  const allDiscoveries: DiscoveredImpact[] = [...execution.discoveredImpacts];
  const roleRuns: IncrementalRoleRun[] = [...priorRuns];

  await incrementalExecutionRepository.updateExecution(executionId, {
    status: 'running',
    startedAt: execution.startedAt ?? clock(),
  });

  let outcome: IncrementalExecutionCode = 'completed';
  let outcomeMessage = '';

  for (const role of approvedRoles) {
    if (params.signal?.aborted) {
      outcome = 'cancelled';
      outcomeMessage = 'Execution cancelled by the operator.';
      break;
    }

    /* Part 17's idempotency: a role that already completed is never re-run on resume. */
    if (completedRoles.has(role)) {
      continue;
    }

    const engine = resolveRoleEngine(role);

    if (!engine) {
      outcome = 'role_failed';
      outcomeMessage = `${INCREMENTAL_ROLE_LABELS[role]} has no engine registered in this pipeline.`;
      failedRoles.add(role);
      break;
    }

    const context = buildRoleExecutionContext({
      role,
      plan,
      request: params.request,
      impact: analysis.impact,
      evolutionPlan: analysis.evolutionPlan,
      baseline,
      fullContextFallback: fullContextFallback?.approved === true,
    });

    const attempt = priorRuns.filter((run) => run.role === role).length + 1;
    const startedAt = clock();

    const started = await incrementalExecutionRepository.startRoleRun({
      executionId,
      projectId: params.request.projectId,
      role,
      attempt,
      artifactType: engine.artifactType,
      context,
      startedAt,
    });

    if (!started.ok) {
      outcome = started.code === 'conflict' ? 'conflict' : 'persist_failed';
      outcomeMessage = started.message;
      break;
    }

    const roleRunId = started.value;

    await incrementalExecutionRepository.updateExecution(executionId, { currentRole: role });

    const run: IncrementalRoleRun = {
      id: roleRunId,
      executionId,
      role,
      label: engine.label,
      attempt,
      status: 'running',
      artifactType: engine.artifactType,
      context,
      discoveredImpacts: [],
      startedAt,
    };

    try {
      /* THE REDUCTION, applied to the real execution path — see incrementalExecutionContext.ts. */
      const scopedProject = buildScopedProject(params.project, context);
      const engineContext = engine.buildContext(scopedProject);
      const { system, prompt } = engine.buildPrompt(engineContext);

      /*
       * The role's own parser drops fields it does not own, including `discoveredImpact`. The raw
       * response is captured here so Part 10's report survives that — see
       * `readDiscoveredImpactField`. Kept out of the persisted artifact content, which stays
       * exactly the role's typed draft.
       */
      let rawResponse = '';

      const generated = await generateRoleWithRecovery({
        projectId: params.request.projectId,
        roleKey: engine.artifactType,
        system,
        prompt,

        /*
         * The scoped instruction layer takes the slot the FULL BuildersDB project context block
         * occupies in a normal run. That substitution is the whole of Part 6's "do not send the
         * full project context": there is no code path here that assembles the full block.
         */
        contextBlock: buildIncrementalInstructionLayer(context),
        maxOutputTokens: engine.maxOutputTokens,
        parseDraft: ((rawText: string) => {
          rawResponse = rawText;
          return engine.parseDraft(rawText);
        }) as never,
        generate: params.generate,
        baseOptions: {
          ...getRoleGenerateOptions(params.project, engine.artifactType),
          projectId: params.request.projectId,
          roleKey: engine.artifactType,
          requestType: 'incremental_role_execution',
        },
        onAttempt: (log) =>
          logger.debug(
            `incremental role=${log.roleKey} execution=${executionId} attempt=${log.attempt} ` +
              `retry=${log.isRetry} finishReason=${log.finishReason ?? 'n/a'} outcome=${log.outcome}`,
          ),
      });

      if (!generated.ok) {
        run.status = 'failed';
        run.failure = { kind: generated.kind, message: generated.message };
        run.completedAt = clock();
        failedRoles.add(role);

        await incrementalExecutionRepository.finishRoleRun({
          roleRunId,
          status: 'failed',
          failure: run.failure,
          completedAt: run.completedAt,
        });

        roleRuns.push(run);
        outcome = 'role_failed';
        outcomeMessage = `${engine.label} could not be completed: ${generated.message}`;
        break;
      }

      /* Part 9 — the incremental artifact. Linked to what it would supersede; never written over it. */
      const released = getLatestApprovedArtifact(artifacts, engine.artifactType);

      const output: IncrementalArtifact = {
        generationType: 'incremental',
        role,
        artifactType: engine.artifactType,
        content: generated.draft,
        baselineReleaseId: baseline.releaseId,
        changeRequestId: params.request.id,
        impactAnalysisId: analysis.id,
        engineeringPlanId: params.planRecord.id,
        executionId,
        supersedesArtifactId: released?.id,
        scopeFingerprint,
        version: (released?.version ?? 0) + attempt,
        generatedBy: engine.label,
        generatedAt: clock(),
      };

      /* Part 10 — impact the role found outside scope. Recorded; never acted on. */
      const discoveries = parseDiscoveredImpacts(readDiscoveredImpactField(rawResponse), role, clock());

      if (discoveries.length > 0) {
        await incrementalExecutionRepository.recordDiscoveredImpacts({
          executionId,
          roleRunId,
          changeRequestId: params.request.id,
          projectId: params.request.projectId,
          discoveries,
        });
        allDiscoveries.push(...discoveries);
      }

      run.status = 'completed';
      run.output = output;
      run.discoveredImpacts = discoveries;
      run.completedAt = clock();
      completedRoles.add(role);

      await incrementalExecutionRepository.finishRoleRun({
        roleRunId,
        status: 'completed',
        output,
        completedAt: run.completedAt,
      });

      roleRuns.push(run);

      await incrementalExecutionRepository.updateExecution(executionId, {
        completedRoles: [...completedRoles],
      });

      /* A material discovery pauses the run here — the next role must not consume a scope nobody has confirmed. */
      const material = materialDiscoveries(discoveries);

      if (material.length > 0 && scopeDecisions.length === 0) {
        outcome = 'paused';
        outcomeMessage = `${engine.label} reported ${material.length} finding(s) outside the approved scope. The execution is paused until you decide whether to expand it.`;
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${engine.label} failed unexpectedly.`;
      run.status = 'failed';
      run.failure = { kind: 'error', message };
      run.completedAt = clock();
      failedRoles.add(role);

      await incrementalExecutionRepository.finishRoleRun({
        roleRunId,
        status: 'failed',
        failure: run.failure,
        completedAt: run.completedAt,
      });

      roleRuns.push(run);
      outcome = 'role_failed';
      outcomeMessage = message;
      break;
    }
  }

  /* ── Part 12 — the review stages the approved plan requires, over what actually ran. ── */
  const reviews = evaluateIncrementalReviews({
    reviewRequirements: plan.reviewRequirements,
    roleRuns,
    discoveredImpacts: allDiscoveries,
    scopeExpansionDecisions: scopeDecisions,
    reviewedAt: clock(),
  });

  const finalStatus =
    outcome === 'completed'
      ? 'completed'
      : outcome === 'cancelled'
        ? 'cancelled'
        : outcome === 'paused'
          ? 'paused'
          : outcome === 'role_failed'
            ? 'failed'
            : 'blocked';

  const completedAt = outcome === 'completed' ? clock() : undefined;

  await incrementalExecutionRepository.updateExecution(executionId, {
    status: finalStatus,
    currentRole: null,
    completedRoles: [...completedRoles],
    failedRoles: [...failedRoles],
    reviews,
    completedAt: completedAt ?? null,
    cancelledAt: outcome === 'cancelled' ? clock() : null,
    failure: outcome === 'role_failed' ? { code: outcome, message: outcomeMessage } : null,
  });

  if (outcome === 'completed') {
    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: 'incremental_execution_completed',
      message: `Incremental execution #${execution.executionVersion} completed — ${completedRoles.size} role(s) ran within the approved scope.`,
      metadata: { completedRoles: [...completedRoles], reviews: reviews.map((review) => review.decision) },
      createdBy: params.createdBy,
    });
  } else if (outcome === 'cancelled') {
    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: 'incremental_execution_cancelled',
      message: `Incremental execution #${execution.executionVersion} cancelled after ${completedRoles.size} completed role(s).`,
      metadata: { completedRoles: [...completedRoles] },
      createdBy: params.createdBy,
    });
  } else if (outcome === 'paused') {
    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: 'scope_expansion_requested',
      message: outcomeMessage,
      metadata: {
        discoveries: materialDiscoveries(allDiscoveries).map((discovery) => ({
          role: discovery.reportedByRole,
          severity: discovery.severity,
          affectedArtifact: discovery.affectedArtifact,
        })),
      },
      createdBy: params.createdBy,
    });
  }

  const finalExecution: IncrementalExecution = {
    ...execution,
    status: finalStatus,
    selectedRoles: approvedRoles,
    overrides: selection.appliedOverrides,
    recommendedRoles: selection.recommendedRoles,
    completedRoles: [...completedRoles],
    failedRoles: [...failedRoles],
    invalidations,
    safetyFallbacks,
    fullContextFallback,
    scopeExpansionDecisions: scopeDecisions,
    discoveredImpacts: allDiscoveries,
    reviews,
    currentRole: undefined,
    completedAt,
    scopeFingerprint,
  };

  return {
    ok: outcome === 'completed',
    code: outcome,
    message:
      outcome === 'completed'
        ? `Incremental engineering complete — ${completedRoles.size} of ${approvedRoles.length} approved role(s) ran, ${
            reviews.filter((review) => review.decision === 'approved').length
          }/${reviews.length} review(s) passed.`
        : outcomeMessage,
    execution: finalExecution,
    roleRuns,
    discoveredImpacts: allDiscoveries,
  };
}

/** Part 13/18 — operator cancellation of an execution that is not currently in this runner's loop. */
export async function cancelIncrementalExecution(
  execution: IncrementalExecution,
  options: { reason?: string; cancelledBy?: string; clock?: () => string } = {},
): Promise<boolean> {
  const clock = options.clock ?? (() => new Date().toISOString());

  const updated = await incrementalExecutionRepository.updateExecution(execution.id, {
    status: 'cancelled',
    currentRole: null,
    cancelledAt: clock(),
  });

  if (updated) {
    await incrementalExecutionRepository.recordExecutionEvent({
      execution,
      eventType: 'incremental_execution_cancelled',
      message: `Incremental execution #${execution.executionVersion} cancelled${
        options.reason ? `: ${options.reason}` : '.'
      }`,
      createdBy: options.cancelledBy,
    });
  }

  return updated;
}
