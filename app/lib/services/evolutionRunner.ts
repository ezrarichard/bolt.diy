import { listApplicationManifestFiles } from '~/lib/application-manifest/applicationManifestRepository';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import { buildBaselineSnapshot, type ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import { buildEvolutionPlan, type EvolutionPlan } from '~/lib/evolution/evolutionPlan';
import { evolutionRepository, type ChangeImpactRecord } from '~/lib/evolution/evolutionRepository';
import type { ImpactAnalysis } from '~/lib/evolution/impactTypes';
import { analyseChangeImpact } from '~/lib/services/impactAnalysisService';
import type { Project } from '~/lib/stores/projects';

/**
 * Product Evolution Runner — Sprint 95.
 *
 * The one composition point between the pure analysis modules (`impactAnalysisService.ts`,
 * `evolutionPlan.ts`, `evolutionBaseline.ts` — none of which touch BuildersDB) and the repository
 * that persists their results. Exists so no UI component sequences "resolve baseline → analyse →
 * plan → persist" itself; the Architectural Rule for this sprint is that the UI only displays.
 *
 * Same shape as `deploymentVerificationRunner.ts` (S92), `deliveryPackageRunner.ts` (S93) and
 * `releaseManagementRunner.ts` (S94), for the same reason.
 *
 * THE BASELINE IS ALWAYS THE RELEASE. `resolveBaselineSnapshot` starts from
 * `deploymentRepository.getReleaseBaseline` — Sprint 94's frozen references, the "prepared, not
 * consumed" API that this sprint is the first caller of. It never reads current deployment state.
 */

export type ResolveBaselineCode = 'no_deployment' | 'no_release' | 'ok';

export interface ResolvedBaseline {
  code: ResolveBaselineCode;
  message?: string;
  snapshot?: ProductBaselineSnapshot;
  deploymentId?: string;
  releaseId?: string;
  releaseVersion?: string;
}

/**
 * Assembles the released product's baseline snapshot. Returns a stated reason rather than an empty
 * snapshot when there is nothing to build one from — an analysis against a fabricated baseline
 * would be worse than no analysis (Part 15).
 */
export async function resolveBaselineSnapshot(
  project: Project,
  clock = () => new Date().toISOString(),
): Promise<ResolvedBaseline> {
  const deployment = await deploymentRepository.getDeploymentWithProviders(project.id);

  if (!deployment) {
    return { code: 'no_deployment', message: 'This project has no Deployment yet — there is nothing to evolve.' };
  }

  const release = await deploymentRepository.getLatestRelease(deployment.id);

  if (!release || release.releaseStatus !== 'released') {
    return {
      code: 'no_release',
      message: 'This product has not been released yet. Product Evolution measures change against a release baseline.',
      deploymentId: deployment.id,
    };
  }

  /*
   * The delivery package and manifest files are fetched by the identity the RELEASE froze, not by
   * "latest" — that is the whole distinction Part 7 draws. `getLatestDeliveryPackage` is used only
   * as a fallback for a release whose baseline recorded no package id (an older release).
   */
  const [deliveryPackage, manifestFiles] = await Promise.all([
    deploymentRepository.getLatestDeliveryPackage(deployment.id),
    release.baseline.manifestId ? listApplicationManifestFiles(release.baseline.manifestId) : Promise.resolve([]),
  ]);

  const snapshot = buildBaselineSnapshot({
    releaseBaseline: release.baseline,
    releaseId: release.id,
    semanticVersion: release.semanticVersion,
    deliveryPackage: deliveryPackage?.deliverySummary ?? null,
    manifestFiles,
    schemaSql: project.databaseActivation?.schema?.schemaSql,
    capturedAt: clock(),
  });

  return {
    code: 'ok',
    snapshot,
    deploymentId: deployment.id,
    releaseId: release.id,
    releaseVersion: release.semanticVersion,
  };
}

export type RunImpactAnalysisCode = 'no_deployment' | 'no_release' | 'cancelled' | 'persist_failed' | 'completed';

export interface RunImpactAnalysisResult {
  ok: boolean;
  code: RunImpactAnalysisCode;
  message: string;
  impact?: ImpactAnalysis;
  plan?: EvolutionPlan;
  record?: ChangeImpactRecord;
}

export interface RunImpactAnalysisParams {
  project: Project;
  request: ChangeRequest;

  /** When false, only the impact analysis is produced and persisted — no Evolution Plan, no `evolution_plan_created` event. */
  withEvolutionPlan?: boolean;
  createdBy?: string;

  /** Operator cancellation (Part 15). Checked before persistence — nothing is written once aborted. */
  signal?: AbortSignal;
  clock?: () => string;
}

export async function runImpactAnalysis(params: RunImpactAnalysisParams): Promise<RunImpactAnalysisResult> {
  const clock = params.clock ?? (() => new Date().toISOString());
  const resolved = await resolveBaselineSnapshot(params.project, clock);

  if (resolved.code !== 'ok' || !resolved.snapshot) {
    return {
      ok: false,
      code: resolved.code === 'no_deployment' ? 'no_deployment' : 'no_release',
      message: resolved.message ?? 'No release baseline is available for this project.',
    };
  }

  const verification = resolved.deploymentId
    ? await deploymentRepository.getLatestDeploymentVerification(resolved.deploymentId)
    : null;

  if (params.signal?.aborted) {
    return { ok: false, code: 'cancelled', message: 'Impact analysis was cancelled — nothing was saved.' };
  }

  const impact = analyseChangeImpact({
    request: params.request,
    baseline: resolved.snapshot,
    verification,
    analysedAt: clock(),
  });

  const plan =
    params.withEvolutionPlan === false
      ? undefined
      : buildEvolutionPlan({ request: params.request, analysis: impact, createdAt: clock() });

  if (params.signal?.aborted) {
    return {
      ok: false,
      code: 'cancelled',
      message: 'Impact analysis was cancelled — nothing was saved.',
      impact,
      plan,
    };
  }

  const persisted = await evolutionRepository.recordImpactAnalysis({
    changeRequest: params.request,
    impact,
    evolutionPlan: plan,
    createdBy: params.createdBy,
  });

  if (!persisted.ok) {
    return { ok: false, code: 'persist_failed', message: persisted.message, impact, plan };
  }

  return {
    ok: true,
    code: 'completed',
    message: plan
      ? `Impact analysis and evolution plan created — ${impact.classification.category}, ${impact.risk.level} risk, ${impact.complexity.level} complexity.`
      : `Impact analysis created — ${impact.classification.category}, ${impact.risk.level} risk, ${impact.complexity.level} complexity.`,
    impact,
    plan,
    record: persisted.record,
  };
}
