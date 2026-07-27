import { ARTIFACT_TYPES, getLatestApprovedArtifact, type ProjectArtifact } from '~/lib/projects/artifacts';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import {
  IMPACT_ROLE_TO_PIPELINE_ROLE,
  INCREMENTAL_ROLE_LABELS,
  type IncrementalEngineeringPlan,
  type IncrementalRoleId,
} from '~/lib/evolution/engineeringScopeTypes';
import type { EvolutionPlan } from '~/lib/evolution/evolutionPlan';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import type { ImpactAnalysis } from '~/lib/evolution/impactTypes';
import type {
  IncrementalRoleExecutionContext,
  InvalidationDecision,
  SafetyFallbackTrigger,
} from '~/lib/evolution/incrementalExecutionTypes';
import { blockingInvalidatedInputs } from '~/lib/evolution/invalidationPolicy';
import { upstreamArtifactsFor } from '~/lib/services/engineeringContextReducer';

/**
 * Reduced Context in the Real Execution Path — Sprint 97, Parts 6 and 7.
 *
 * Sprint 96 produced `ReducedRoleContext` DESCRIPTORS and said plainly that nothing consumed them
 * yet. This is the consumer. Two things happen here, and both are the actual mechanism rather than
 * a description of one:
 *
 *  1. `buildRoleExecutionContext` turns the approved plan into the concrete brief ONE role gets:
 *     the change request, the impact findings that name something that role owns, the evolution
 *     instructions it is responsible for, the affected identifiers, the release baseline it is
 *     changing, the upstream artifacts it may read, and — stated explicitly rather than implied by
 *     absence — what it must not touch.
 *
 *  2. `buildScopedProject` is the real reduction. Every engine's `buildXContext(project)` reads
 *     upstream design through `getApprovedArtifactContent(getProjectArtifacts(project), TYPE)`, so
 *     handing it a project whose artifact list contains ONLY the types `ReducedRoleContext`
 *     permits is a genuine narrowing of what the prompt can contain — achieved without editing a
 *     single engine, and therefore without a second pipeline. The engines' own gates still pass,
 *     because the permitted set is exactly `ROLE_ARTIFACT_CHAIN` up to that role, which is what
 *     `canGenerate` checks.
 *
 * FULL PROJECT CONTEXT IS NEVER A FALLBACK BY DEFAULT (Part 7). When reduction is unsafe, the
 * triggers are returned and the runner BLOCKS. A full-context run happens only when an operator
 * has approved one, and every context it produces is stamped `usedFullContextFallback: true`.
 */

// ── Scope fingerprint (Part 9) ──────────────────────────────────────────────

/**
 * A stable, dependency-free hash of the approved scope. FNV-1a over a canonical string: this is an
 * identity marker for "was this produced under the same brief", not a security primitive, and
 * saying so is more useful than reaching for a crypto API that differs between the browser, the
 * worker and the test runner.
 */
export function computeScopeFingerprint(plan: IncrementalEngineeringPlan, approvedRoles: IncrementalRoleId[]): string {
  const canonical = JSON.stringify({
    modelVersion: plan.modelVersion,
    changeRequestId: plan.scope.changeRequestId,
    releaseId: plan.scope.releaseId ?? null,
    manifestVersion: plan.scope.baselineManifestVersion ?? null,
    roles: [...approvedRoles].sort(),
    features: plan.scope.affectedFeatures.map((entry) => entry.identifier).sort(),
    pages: plan.scope.affectedPages.map((entry) => entry.identifier).sort(),
    components: plan.scope.affectedComponents.map((entry) => entry.identifier).sort(),
    database: plan.scope.affectedDatabaseObjects.map((entry) => entry.identifier).sort(),
    apis: plan.scope.affectedApis.map((entry) => entry.identifier).sort(),
    environment: plan.scope.affectedEnvironment.map((entry) => entry.identifier).sort(),
  });

  let hash = 0x811c9dc5;

  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `scope-${hash.toString(16).padStart(8, '0')}`;
}

// ── Safety fallback detection (Part 7) ──────────────────────────────────────

export interface SafetyFallbackInput {
  plan: IncrementalEngineeringPlan;
  impact: ImpactAnalysis;
  baseline: ProductBaselineSnapshot;
  approvedRoles: IncrementalRoleId[];
  invalidations: InvalidationDecision[];
  artifacts: ProjectArtifact[];
}

/**
 * Every documented condition under which reduced context is insufficient. All five are structural
 * checks against artifacts that already exist — none is a heuristic, and none is a guess about what
 * the model might need.
 */
export function detectSafetyFallbacks(input: SafetyFallbackInput): SafetyFallbackTrigger[] {
  const triggers: SafetyFallbackTrigger[] = [];

  /* 1. Baseline integrity — the plan must have been built against the baseline we are executing against. */
  if (
    input.plan.scope.baselineManifestVersion !== undefined &&
    input.baseline.manifestVersion !== undefined &&
    input.plan.scope.baselineManifestVersion !== input.baseline.manifestVersion
  ) {
    triggers.push({
      reason: 'baseline_integrity_mismatch',
      detail: `The plan was built against manifest version ${input.plan.scope.baselineManifestVersion}, but the release baseline now reports version ${input.baseline.manifestVersion}. Re-plan before executing.`,
    });
  }

  if (
    input.plan.scope.releaseId !== undefined &&
    input.baseline.releaseId !== undefined &&
    input.plan.scope.releaseId !== input.baseline.releaseId
  ) {
    triggers.push({
      reason: 'baseline_integrity_mismatch',
      detail: `The plan targets release ${input.plan.scope.releaseId}, but the resolved baseline is release ${input.baseline.releaseId}.`,
    });
  }

  /* 2. Ambiguous impact — a low-confidence analysis cannot justify withholding context from a role. */
  if (input.impact.overallConfidence === 'low') {
    triggers.push({
      reason: 'low_confidence_impact',
      detail:
        'The impact analysis has low overall confidence, so the reduced scope may not contain everything the change actually touches.',
    });
  }

  /* 3. Missing upstream artifacts — a role cannot be given a narrowed view of something that is not there. */
  for (const role of input.approvedRoles) {
    for (const artifactType of upstreamArtifactsFor(role)) {
      if (!getLatestApprovedArtifact(input.artifacts, artifactType)) {
        triggers.push({
          reason: 'missing_upstream_artifact',
          role,
          detail: `${INCREMENTAL_ROLE_LABELS[role]} requires the approved "${artifactType}" artifact, which this project does not have.`,
        });
      }
    }
  }

  /* 4. Missing file mapping — a file-driven role whose scoped paths are not in the released file set. */
  const baselinePaths = new Set(input.baseline.files.map((file) => file.path));
  const scopedPaths = [...input.plan.scope.affectedPages, ...input.plan.scope.affectedComponents].map(
    (entry) => entry.identifier,
  );
  const unmappedPaths = scopedPaths.filter((path) => !baselinePaths.has(path));

  if (unmappedPaths.length > 0) {
    triggers.push({
      reason: 'missing_file_mapping',
      detail: `The scope names ${unmappedPaths.length} path(s) the release baseline does not contain (${unmappedPaths
        .slice(0, 3)
        .join(
          ', ',
        )}${unmappedPaths.length > 3 ? ', …' : ''}), so a file-scoped role cannot be given a grounded file list.`,
    });
  }

  /*
   * 5. An INPUT to this execution is invalidated and nobody is regenerating it — a role would be
   *    handed a document the policy has just declared untrustworthy. See
   *    `blockingInvalidatedInputs` for why the broader "something downstream is stale" case is
   *    reported on the dashboard instead of blocking here.
   */
  for (const decision of blockingInvalidatedInputs(input.invalidations, input.approvedRoles)) {
    triggers.push({
      reason: 'invalidated_dependency_missing',
      role: decision.role,
      detail: `${decision.label}'s artifact is invalidated by this execution and will be read by a role that is running, but ${decision.label} is not in the approved selection. ${decision.reasoning}`,
    });
  }

  return triggers;
}

// ── The scoped role context (Part 6) ────────────────────────────────────────

/** Which impact sections each role legitimately reads. Mirrors Sprint 96's own role→section mapping. */
const ROLE_IMPACT_SECTIONS: Record<IncrementalRoleId, string[]> = {
  requirements: ['business', 'ui'],
  productowner: ['business'],
  architecture: ['business', 'technical', 'backend', 'database', 'infrastructure', 'security'],
  database: ['database', 'backend'],
  uiux: ['ui', 'technical'],
  backend: ['backend', 'database', 'technical', 'security'],
  frontend: ['ui', 'technical', 'backend'],
  qa: ['testing', 'ui', 'backend', 'database', 'business'],
  devops: ['infrastructure', 'deployment'],
};

/** Constraints beyond the shared incremental rules, one line each, grounded in what the role owns. */
const ROLE_CONSTRAINTS: Record<IncrementalRoleId, string[]> = {
  requirements: [
    'Restate only the requirements this change affects. Every other agreed requirement stands as released.',
  ],
  productowner: ['Place this change in the existing roadmap. Do not re-prioritise unrelated roadmap items.'],
  architecture: [
    'The released architecture is the starting point, not a blank page. Describe the delta, not a new design.',
    'Do not introduce a new framework, service or data store unless the change request requires one.',
  ],
  database: [
    'Additive changes only unless the change request explicitly asks otherwise. Never propose dropping a released table or column.',
    'Preserve existing row-level security policies on tables you do not change.',
  ],
  uiux: ['Keep the released design language. Change only the screens and components named in scope.'],
  backend: [
    'Preserve existing API request and response shapes unless the change request requires a break, and say so explicitly if it does.',
  ],
  frontend: ['Modify only the pages and components named in scope. Do not restructure routing or shared layout.'],
  qa: [
    'Verify the changed behaviour AND that the named unaffected areas still behave as released.',
    'Do not write tests for areas outside the approved scope.',
  ],
  devops: ['Change only the environment and deployment configuration named in scope. Do not alter release topology.'],
};

/**
 * The role's own released artifact type(s) — what an incremental run revises. The Database Engineer
 * gets two because `databaseDesignerEngine` keeps the narrative draft and the structured schema in
 * lockstep (see `ARTIFACT_TYPES.DATABASE_SCHEMA`); reducing one away would leave the pair
 * inconsistent.
 */
export function baselineArtifactTypesFor(role: IncrementalRoleId): string[] {
  const own = ROLE_ARTIFACT_TYPE[role];

  if (!own) {
    return [];
  }

  return role === 'database' ? [own, ARTIFACT_TYPES.DATABASE_SCHEMA] : [own];
}

/** Each incremental role's own artifact type, read from `ARTIFACT_TYPES` rather than restated as literals. */
export const ROLE_ARTIFACT_TYPE: Record<IncrementalRoleId, string> = {
  requirements: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
  productowner: ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
  architecture: ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
  database: ARTIFACT_TYPES.DATABASE_DRAFT,
  uiux: ARTIFACT_TYPES.UIUX_DRAFT,
  backend: ARTIFACT_TYPES.BACKEND_DRAFT,
  frontend: ARTIFACT_TYPES.FRONTEND_DRAFT,
  qa: ARTIFACT_TYPES.QA_DRAFT,
  devops: ARTIFACT_TYPES.DEVOPS_DRAFT,
};

export interface BuildRoleContextInput {
  role: IncrementalRoleId;
  plan: IncrementalEngineeringPlan;
  request: ChangeRequest;
  impact: ImpactAnalysis;
  evolutionPlan?: EvolutionPlan;
  baseline: ProductBaselineSnapshot;

  /** Set only when an operator approved a full-context run — see this file's header. */
  fullContextFallback?: boolean;
}

/**
 * The brief for one role. Built from the plan's own reduced-context descriptor when the plan
 * produced one; a role the OPERATOR added has no descriptor, so one is derived from the same scope
 * by the same rules (Part 4's "an operator-added role must receive a valid reduced context").
 */
export function buildRoleExecutionContext(input: BuildRoleContextInput): IncrementalRoleExecutionContext {
  const { role, plan, baseline } = input;
  const descriptor = plan.reducedContexts.find((entry) => entry.role === role);

  const scopedFiles = descriptor
    ? descriptor.includedFiles
    : [...plan.scope.affectedPages, ...plan.scope.affectedComponents].map((entry) => entry.identifier);

  const allowedSections = ROLE_IMPACT_SECTIONS[role] ?? [];
  const relevantImpactFindings = (input.impact.sections ?? [])
    .filter((section) => section.affected && allowedSections.includes(section.id))
    .map((section) => ({ section: section.id, detail: section.detail, confidence: section.confidence }));

  /* Evolution-plan instructions that name this role, plus the plan's own phase guidance. */
  const relevantInstructions = collectInstructions(role, input.evolutionPlan);

  const upstreamArtifactTypes = descriptor?.includedUpstreamArtifacts ?? upstreamArtifactsFor(role);

  const routes = plan.scope.affectedPages
    .filter((entry) => entry.identifier.startsWith('/'))
    .map((entry) => entry.identifier);

  const excludedAreas = [
    ...(descriptor?.excluded ?? []),
    `${plan.changeSet.summary.unchangedCount} released file(s) not named in the change set`,
  ];

  return {
    role,
    label: INCREMENTAL_ROLE_LABELS[role],
    changeRequestSummary: `#${input.request.requestNumber} ${input.request.title} — ${input.request.description}`,
    relevantImpactFindings,
    relevantInstructions,
    affectedFeatures: descriptor?.includedFeatures ?? plan.scope.affectedFeatures.map((entry) => entry.identifier),
    affectedFiles: scopedFiles,
    affectedRoutes: routes,
    affectedDatabaseObjects:
      descriptor?.includedDatabaseObjects ?? plan.scope.affectedDatabaseObjects.map((entry) => entry.identifier),
    affectedApis: descriptor?.includedApis ?? plan.scope.affectedApis.map((entry) => entry.identifier),
    affectedEnvironment:
      descriptor?.includedEnvironment ?? plan.scope.affectedEnvironment.map((entry) => entry.identifier),
    baseline: {
      releaseId: baseline.releaseId,
      releaseVersion: baseline.semanticVersion,
      manifestVersion: baseline.manifestVersion,
      manifestPlanChecksum: baseline.manifestPlanChecksum,
      totalReleasedFiles: baseline.files.length,
    },
    upstreamArtifactTypes,
    baselineArtifactTypes: baselineArtifactTypesFor(role),
    relevantReviews: descriptor?.includedReviews ?? [],
    excludedAreas,
    unaffectedAreas: plan.scope.unaffectedAreas,
    constraints: ROLE_CONSTRAINTS[role] ?? [],
    contextReductionRatio:
      descriptor?.contextReductionRatio ??
      (baseline.files.length === 0 ? 0 : Number((scopedFiles.length / baseline.files.length).toFixed(3))),
    usedFullContextFallback: input.fullContextFallback === true,
  };
}

/**
 * The evolution plan's instructions FOR THIS ROLE, matched on the plan's own role vocabulary via
 * `IMPACT_ROLE_TO_PIPELINE_ROLE` — never by string-matching a label. A role is not handed another
 * role's phase notes.
 */
function collectInstructions(role: IncrementalRoleId, evolutionPlan?: EvolutionPlan): string[] {
  if (!evolutionPlan) {
    return [];
  }

  const roleNotes = (evolutionPlan.requiredRoles ?? [])
    .filter((entry) => IMPACT_ROLE_TO_PIPELINE_ROLE[entry.role] === role)
    .map((entry) => entry.reason)
    .filter(Boolean);

  const phaseNotes = (evolutionPlan.estimatedPhases ?? [])
    .filter((phase) => phase.roles.some((entry) => IMPACT_ROLE_TO_PIPELINE_ROLE[entry] === role))
    .map((phase) => `${phase.name}: ${phase.detail}`);

  return [...roleNotes, ...phaseNotes];
}

// ── The real reduction (Part 6) ─────────────────────────────────────────────

/**
 * A project whose artifact list contains only what this role is permitted to read. THE ENGINES ARE
 * NOT MODIFIED — they read the project they are given, so narrowing the project narrows the prompt.
 *
 * The permitted set is the role's upstream artifact chain, which is exactly what its own
 * `canGenerate` gate requires, so a scoped project never fails a gate the full project would pass.
 * When `usedFullContextFallback` is set, the project is returned untouched and the caller has
 * already recorded why (Part 7).
 */
export function buildScopedProject(project: Project, context: IncrementalRoleExecutionContext): Project {
  if (context.usedFullContextFallback) {
    return project;
  }

  const permitted = new Set([...context.upstreamArtifactTypes, ...context.baselineArtifactTypes]);
  const artifacts = getProjectArtifacts(project).filter((artifact) => permitted.has(artifact.type));

  return { ...project, artifacts };
}
