import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import type { EvolutionPlan } from '~/lib/evolution/evolutionPlan';
import {
  IMPACT_ROLE_TO_PIPELINE_ROLE,
  INCREMENTAL_PLAN_MODEL_VERSION,
  INCREMENTAL_ROLE_LABELS,
  type ChangeSetFile,
  type EngineeringChangeSet,
  type EngineeringScope,
  type IncrementalEngineeringPlan,
  type IncrementalRoleId,
  type ScopedArtifact,
} from '~/lib/evolution/engineeringScopeTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ImpactAnalysis, ImpactItem, ImpactSectionId } from '~/lib/evolution/impactTypes';
import {
  buildExecutionOrder,
  detectStaleDownstreamRisks,
  resolveReviewRequirements,
  selectRoles,
} from '~/lib/evolution/roleSelection';
import { reduceEngineeringContext } from '~/lib/services/engineeringContextReducer';

/**
 * Incremental Engineering Service — Sprint 96, Parts 2/5/6.
 *
 * Turns an Evolution Plan into an Engineering Scope, a Change Set and an Incremental Generation
 * Plan. PURE, DETERMINISTIC and SIDE-EFFECT-FREE: no BuildersDB, no AI call, no network, no
 * generated file is read or written. The same inputs always produce the same plan.
 *
 * THE BOUNDARY, STATED ONCE. This sprint plans; it does not engineer. Nothing here generates code,
 * executes a role, modifies a release, deploys or verifies. `buildIncrementalPlan` returns a
 * document describing what WOULD run — the existing pipeline
 * (`AUTO_ENGINEERING_ROLES`/`useAutoEngineeringPipeline`) remains the only thing that runs
 * anything, and Sprint 97 is what teaches it to run a subset.
 *
 * SCOPE SOURCES (Part 2's constraint). Only the Evolution Plan, the Impact Analysis and the
 * Release Baseline. Never the current deployment, never a fresh read of project state — the whole
 * point is to engineer against what was released.
 */

function itemsToScoped(items: ImpactItem[]): ScopedArtifact[] {
  return items.map((item) => ({ identifier: item.identifier, label: item.label, evidence: item.evidence }));
}

function sectionItems(impact: ImpactAnalysis, id: ImpactSectionId): ImpactItem[] {
  const section = impact.sections?.find((entry) => entry.id === id);
  return section?.affected ? section.items : [];
}

export interface BuildScopeInput {
  request: ChangeRequest;
  impact: ImpactAnalysis;
  evolutionPlan: EvolutionPlan;
  baseline: ProductBaselineSnapshot;
  impactAnalysisId?: string;
  capturedAt: string;
}

/**
 * Part 2 — the Engineering Scope. Pages and components are separated by the MANIFEST'S OWN
 * category (`pages`/`components`), never by guessing from a path, and every entry keeps the
 * evidence that put it in scope.
 */
export function buildEngineeringScope(input: BuildScopeInput): EngineeringScope {
  const { impact, baseline } = input;

  const technicalItems = sectionItems(impact, 'technical');
  const uiItems = sectionItems(impact, 'ui');

  const categoryOf = (path: string) => baseline.files.find((file) => file.path === path)?.category;

  const pages = technicalItems.filter((item) => categoryOf(item.identifier) === 'pages');
  const components = technicalItems.filter((item) =>
    ['components', 'styles'].includes(categoryOf(item.identifier) ?? ''),
  );

  /* A route with no generated page behind it still belongs in the UI scope — it is a real surface. */
  const routeOnlyItems = uiItems.filter((item) => item.kind === 'route');

  return {
    changeRequestId: input.request.id,
    releaseId: impact.releaseId,
    releaseVersion: impact.releaseVersion,
    baselineManifestVersion: baseline.manifestVersion,
    affectedFeatures: itemsToScoped(sectionItems(impact, 'business')),
    affectedPages: itemsToScoped([...pages, ...routeOnlyItems]),
    affectedComponents: itemsToScoped(components),
    affectedDatabaseObjects: itemsToScoped(sectionItems(impact, 'database')),
    affectedApis: itemsToScoped(sectionItems(impact, 'backend').filter((item) => item.kind === 'api_surface')),
    affectedEnvironment: itemsToScoped(
      sectionItems(impact, 'infrastructure').filter((item) => item.kind === 'environment_variable'),
    ),
    affectedDocuments: itemsToScoped(sectionItems(impact, 'documentation')),

    /* Straight from the Evolution Plan's own role analysis, translated into real pipeline role ids. */
    affectedRoles: input.evolutionPlan.requiredRoles
      .map((entry) => IMPACT_ROLE_TO_PIPELINE_ROLE[entry.role])
      .filter((role, index, all): role is IncrementalRoleId => Boolean(role) && all.indexOf(role) === index),
    unaffectedAreas: impact.unaffectedAreas ?? [],
    metadata: {
      classification: impact.classification?.category ?? 'unknown',
      riskLevel: impact.risk?.level ?? 'low',
      complexityLevel: impact.complexity?.level ?? 'very_small',
      requiresHumanReview: impact.requiresHumanReview !== false,
      impactAnalysisId: input.impactAnalysisId,
      capturedAt: input.capturedAt,
    },
  };
}

/** Part 5 — the Change Set, expressed entirely in released-file terms. */
export function buildChangeSet(
  scope: EngineeringScope,
  impact: ImpactAnalysis,
  baseline: ProductBaselineSnapshot,
  reviewRequirements: EngineeringChangeSet['reviewRequirements'],
): EngineeringChangeSet {
  const technicalItems = sectionItems(impact, 'technical');
  const touchedPaths = new Set(technicalItems.map((item) => item.identifier));

  const filesToModify: ChangeSetFile[] = technicalItems.map((item) => ({
    path: item.identifier,
    category: baseline.files.find((file) => file.path === item.identifier)?.category ?? 'unknown',
    reason: item.evidence,
  }));

  const filesUnchanged: ChangeSetFile[] = baseline.files
    .filter((file) => !touchedPaths.has(file.path))
    .map((file) => ({ path: file.path, category: file.category, reason: 'No impact finding references this file.' }));

  const totalReleasedFiles = baseline.files.length;

  return {
    filesToModify,

    /*
     * Always empty — see `EngineeringChangeSet.filesToCreate`. Deriving new file paths means
     * re-planning the manifest, which is generation planning; inventing them here would be
     * fabricating paths that no artifact contains.
     */
    filesToCreate: [],
    filesUnchanged,
    databaseChanges: scope.affectedDatabaseObjects,
    apiChanges: scope.affectedApis,
    uiChanges: [...scope.affectedPages, ...scope.affectedComponents],
    testingTargets: itemsToScoped(sectionItems(impact, 'testing')),
    documentationUpdates: scope.affectedDocuments,
    reviewRequirements,
    summary: {
      modifyCount: filesToModify.length,
      createCount: 0,
      unchangedCount: filesUnchanged.length,
      totalReleasedFiles,
      touchedPercentage: totalReleasedFiles === 0 ? 0 : Math.round((filesToModify.length / totalReleasedFiles) * 100),
    },
  };
}

export interface BuildIncrementalPlanInput extends BuildScopeInput {
  createdBy?: string;
}

/** Part 6 — the whole planning output, assembled from the pure steps above. */
export function buildIncrementalPlan(input: BuildIncrementalPlanInput): IncrementalEngineeringPlan {
  const scope = buildEngineeringScope(input);
  const roleDecisions = selectRoles({ scope, impact: input.impact });
  const executionOrder = buildExecutionOrder(roleDecisions);
  const reviewRequirements = resolveReviewRequirements(roleDecisions, input.impact);
  const changeSet = buildChangeSet(scope, input.impact, input.baseline, reviewRequirements);
  const selectedRoles = executionOrder.map((phase) => phase.role);

  const reducedContexts = reduceEngineeringContext({
    scope,
    baseline: input.baseline,
    selectedRoles,
    reviews: reviewRequirements,
  });

  const staleRisks = detectStaleDownstreamRisks(roleDecisions);

  const outOfScope = [
    'No code is generated and no AI role is executed by this plan.',
    'No release, manifest, deployment or generated file is modified.',
    'Nothing is deployed and nothing is verified.',
    'New files are not planned — that requires re-planning the manifest, which this sprint does not do.',
  ];

  if (staleRisks.length > 0) {
    outOfScope.push(
      `Downstream artifact invalidation is reported but not resolved: re-running ${staleRisks
        .map((risk) => INCREMENTAL_ROLE_LABELS[risk.role])
        .join(', ')} may leave later approved artifacts stale.`,
    );
  }

  if (scope.metadata.requiresHumanReview) {
    outOfScope.push(
      'The impact analysis behind this scope requires human review, so the role selection should be confirmed before any of it is executed.',
    );
  }

  return {
    modelVersion: INCREMENTAL_PLAN_MODEL_VERSION,
    scope,
    roleDecisions,
    executionOrder,
    changeSet,
    reducedContexts,
    reviewRequirements,
    summary: buildSummary(scope, changeSet, selectedRoles),
    outOfScope,
    createdAt: input.capturedAt,
    createdBy: input.createdBy,
  };
}

function buildSummary(
  scope: EngineeringScope,
  changeSet: EngineeringChangeSet,
  selectedRoles: IncrementalRoleId[],
): string {
  if (selectedRoles.length === 0) {
    return `No engineering role is required for release ${scope.releaseVersion ?? '(unversioned)'} — the impact analysis found nothing to engineer.`;
  }

  const skipped = 9 - selectedRoles.length;

  return `${selectedRoles.length} of 9 engineering roles are required (${selectedRoles
    .map((role) => INCREMENTAL_ROLE_LABELS[role])
    .join(
      ' → ',
    )}), skipping ${skipped}. ${changeSet.summary.modifyCount} of ${changeSet.summary.totalReleasedFiles} released file(s) would be modified — ${changeSet.summary.touchedPercentage}% of the application.`;
}
