import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { IncrementalEngineeringPlan, IncrementalPlanRecord } from '~/lib/evolution/engineeringScopeTypes';
import { evolutionRepository } from '~/lib/evolution/evolutionRepository';
import type { Project } from '~/lib/stores/projects';
import { resolveBaselineSnapshot } from '~/lib/services/evolutionRunner';
import { buildIncrementalPlan } from '~/lib/services/incrementalEngineeringService';

/**
 * Incremental Engineering Runner — Sprint 96.
 *
 * The one composition point between the pure planning service
 * (`incrementalEngineeringService.ts`, which touches nothing) and the repository that persists its
 * result. Exists so no UI component sequences "resolve baseline → load analysis → build plan →
 * persist" itself; the Architectural Rule since Sprint 92 is that the UI only displays.
 *
 * REUSES, DOES NOT DUPLICATE. The baseline comes from `evolutionRunner.resolveBaselineSnapshot`
 * (Sprint 95) — the same release-frozen snapshot impact analysis used, so a plan can never be
 * built against a different baseline than the analysis it derives from. The impact analysis and
 * evolution plan come from the persisted `builders_change_impact_analyses` row, never recomputed.
 */

export type RunIncrementalPlanCode =
  | 'no_deployment'
  | 'no_release'
  | 'no_impact'
  | 'no_evolution_plan'
  | 'invalid_scope'
  | 'cancelled'
  | 'persist_failed'
  | 'completed';

export interface RunIncrementalPlanResult {
  ok: boolean;
  code: RunIncrementalPlanCode;
  message: string;
  plan?: IncrementalEngineeringPlan;
  record?: IncrementalPlanRecord;
}

export interface RunIncrementalPlanParams {
  project: Project;
  request: ChangeRequest;
  createdBy?: string;

  /** Operator cancellation (Part 13). Checked before persistence — nothing is written once aborted. */
  signal?: AbortSignal;
  clock?: () => string;
}

export async function planIncrementalEngineering(params: RunIncrementalPlanParams): Promise<RunIncrementalPlanResult> {
  const clock = params.clock ?? (() => new Date().toISOString());

  /*
   * Part 13's "missing impact" — checked first because it is the cheapest and the most likely: a
   * change request that has not been analysed has nothing to plan from, and analysing it is the
   * operator's next step rather than something this function should do for them.
   */
  const analysis = await evolutionRepository.getLatestImpactAnalysis(params.request.id);

  if (!analysis) {
    return {
      ok: false,
      code: 'no_impact',
      message: 'Run impact analysis for this change request before planning the engineering work.',
    };
  }

  if (!analysis.evolutionPlan) {
    return {
      ok: false,
      code: 'no_evolution_plan',
      message: 'This change request has an impact analysis but no evolution plan — re-run the analysis to produce one.',
    };
  }

  const resolved = await resolveBaselineSnapshot(params.project, clock);

  if (resolved.code !== 'ok' || !resolved.snapshot) {
    return {
      ok: false,
      code: resolved.code === 'no_deployment' ? 'no_deployment' : 'no_release',
      message: resolved.message ?? 'No release baseline is available for this project.',
    };
  }

  if (params.signal?.aborted) {
    return { ok: false, code: 'cancelled', message: 'Planning was cancelled — nothing was saved.' };
  }

  const plan = buildIncrementalPlan({
    request: params.request,
    impact: analysis.impact,
    evolutionPlan: analysis.evolutionPlan,
    baseline: resolved.snapshot,
    impactAnalysisId: analysis.id,
    capturedAt: clock(),
    createdBy: params.createdBy,
  });

  /*
   * Part 13's "invalid scope". A plan that selects no role and touches no file is not a useful
   * plan — it means the analysis found nothing to engineer, and persisting an empty plan would
   * imply work was scoped when none was.
   */
  if (plan.executionOrder.length === 0 && plan.changeSet.summary.modifyCount === 0) {
    return {
      ok: false,
      code: 'invalid_scope',
      message:
        'The impact analysis found nothing to engineer, so there is no incremental scope to plan. Refine the change request first.',
      plan,
    };
  }

  if (params.signal?.aborted) {
    return { ok: false, code: 'cancelled', message: 'Planning was cancelled — nothing was saved.', plan };
  }

  const persisted = await evolutionRepository.recordIncrementalPlan({
    changeRequest: params.request,
    plan,
    impactAnalysisId: analysis.id,
    createdBy: params.createdBy,
  });

  if (!persisted.ok) {
    return { ok: false, code: 'persist_failed', message: persisted.message, plan };
  }

  return {
    ok: true,
    code: 'completed',
    message: `Incremental plan #${persisted.record.planNumber} created — ${plan.executionOrder.length} role(s) selected, ${plan.changeSet.summary.touchedPercentage}% of the application affected.`,
    plan,
    record: persisted.record,
  };
}
