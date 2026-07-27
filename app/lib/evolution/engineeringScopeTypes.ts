import type { AutoEngineeringRoleId } from '~/lib/projects/autoEngineeringEngine';
import type { ChangeArea } from '~/lib/evolution/changeRequestTypes';
import type { ComplexityLevel, EngineeringRole, RiskLevel } from '~/lib/evolution/impactTypes';

/**
 * Incremental Engineering Model — Sprint 96, Parts 2/5/6.
 *
 * Describes WHAT WOULD BE ENGINEERED to satisfy an Evolution Plan, without engineering any of it.
 * Nothing in this sprint generates code, executes an AI role, modifies a release or touches a
 * generated file — the output is a plan an operator can read and a later sprint can execute.
 *
 * Part 1 audit — the existing engineering pipeline this model MAPS ONTO rather than replaces:
 *
 *   `AUTO_ENGINEERING_ROLES` (autoEngineeringEngine.ts)  The fixed-order registry of eight roles
 *       (productowner → architecture → database → uiux → backend → frontend → qa → devops), each
 *       already carrying its own `canGenerate`/`buildContext`/`buildPrompt`/`parseDraft`/
 *       `createDraftArtifact`. THE orchestrator. This sprint selects FROM it; it does not
 *       reimplement it, reorder it, or add a second one.
 *   `businessAnalystEngine` + `REQUIREMENTS_DRAFT`  The Business Analyst, which deliberately sits
 *       OUTSIDE that registry (it is the pipeline's entry point, not a stage of it). Represented
 *       here as `'requirements'`, mapped explicitly.
 *   `ROLE_ARTIFACT_CHAIN` (collaborationContext.ts)  Artifact-type ↔ role-label mapping and the
 *       upstream-notes traversal every role's context assembly already uses.
 *   Product Review / Roadmap Review / Code Review  The real review gates. Part 8 decides which of
 *       them run; it does not invent new ones.
 *
 * The scope comes ONLY from the Evolution Plan, the Impact Analysis and the Release Baseline
 * (Part 2's explicit constraint) — never from the current deployment, never from a fresh read of
 * project state.
 */

export const INCREMENTAL_PLAN_MODEL_VERSION = '1.0.0';

/**
 * Every role this sprint can select. `'requirements'` is the Business Analyst — see the header for
 * why it is not part of `AutoEngineeringRoleId`. Every other member IS an `AutoEngineeringRoleId`,
 * which is what lets the plan name real pipeline stages rather than a parallel vocabulary.
 */
export type IncrementalRoleId = 'requirements' | AutoEngineeringRoleId;

/** The one place Sprint 95's analysis vocabulary is translated into the real pipeline's. */
export const IMPACT_ROLE_TO_PIPELINE_ROLE: Record<EngineeringRole, IncrementalRoleId> = {
  business_analyst: 'requirements',
  product_owner: 'productowner',
  solution_architect: 'architecture',
  database_engineer: 'database',
  backend_engineer: 'backend',
  frontend_engineer: 'frontend',
  ui_ux: 'uiux',
  qa: 'qa',
  devops: 'devops',
};

export const INCREMENTAL_ROLE_LABELS: Record<IncrementalRoleId, string> = {
  requirements: 'Business Analyst',
  productowner: 'Product Owner',
  architecture: 'Solution Architect',
  database: 'Database Engineer',
  uiux: 'UI/UX Engineer',
  backend: 'Backend Engineer',
  frontend: 'Frontend Engineer',
  qa: 'QA Engineer',
  devops: 'DevOps Engineer',
};

// ── Engineering scope (Part 2) ──────────────────────────────────────────────

export interface ScopedArtifact {
  /** The baseline identifier — a feature code, route path, file path, table name, variable name. */
  identifier: string;
  label: string;

  /** Which impact finding put this in scope, carried through so nothing in the scope is unexplained. */
  evidence: string;
}

export interface EngineeringScope {
  changeRequestId: string;
  releaseId?: string;
  releaseVersion?: string;

  /** The manifest version the release froze — what an incremental change would be applied against. */
  baselineManifestVersion?: number;

  affectedFeatures: ScopedArtifact[];
  affectedPages: ScopedArtifact[];
  affectedComponents: ScopedArtifact[];
  affectedDatabaseObjects: ScopedArtifact[];
  affectedApis: ScopedArtifact[];
  affectedEnvironment: ScopedArtifact[];
  affectedDocuments: ScopedArtifact[];

  /** The roles the Evolution Plan called for, translated into real pipeline role ids. */
  affectedRoles: IncrementalRoleId[];

  /** Areas the impact analysis positively found untouched — the basis for skipping roles. */
  unaffectedAreas: Array<{ area: ChangeArea; detail: string }>;

  metadata: {
    classification: string;
    riskLevel: RiskLevel;
    complexityLevel: ComplexityLevel;

    /** Carried from the analysis — a scope built on low-confidence matching is not a licence to skip review. */
    requiresHumanReview: boolean;
    impactAnalysisId?: string;
    capturedAt: string;
  };
}

// ── Role selection (Part 3) ─────────────────────────────────────────────────

export interface RoleDecision {
  role: IncrementalRoleId;
  label: string;

  /** Part 3's YES/NO, with the reasoning attached to both answers. */
  selected: boolean;
  reasoning: string;

  /** Which artifact this role would produce if it runs — the existing `ARTIFACT_TYPES` value. */
  artifactType?: string;

  /** Roles that must run (or already be approved) before this one — from the pipeline's own order. */
  dependsOn: IncrementalRoleId[];
}

// ── Change set (Part 5) ─────────────────────────────────────────────────────

export interface ChangeSetFile {
  path: string;
  category: string;

  /** Why this file is in the set — the feature it belongs to or the finding that named it. */
  reason: string;
}

export interface EngineeringChangeSet {
  /** Files the release already contains that the change touches. */
  filesToModify: ChangeSetFile[];

  /**
   * Files that would need to exist and do not. ALWAYS EMPTY in this sprint, and documented as
   * such: knowing a change needs a NEW file requires planning the new file set, which is
   * generation planning against a re-run manifest builder — Sprint 97's work. Claiming otherwise
   * would be inventing paths.
   */
  filesToCreate: ChangeSetFile[];

  /** Released files with no finding against them — the "what can remain untouched" answer, in file terms. */
  filesUnchanged: ChangeSetFile[];

  databaseChanges: ScopedArtifact[];
  apiChanges: ScopedArtifact[];
  uiChanges: ScopedArtifact[];

  /** Existing verification checks that cover the affected areas and would need re-running. */
  testingTargets: ScopedArtifact[];
  documentationUpdates: ScopedArtifact[];

  /** Which real review gates this change would have to pass (Part 8). */
  reviewRequirements: ReviewRequirement[];

  summary: {
    modifyCount: number;
    createCount: number;
    unchangedCount: number;
    totalReleasedFiles: number;

    /** `filesToModify / totalReleasedFiles`, rounded — the headline "how much of the product is this". */
    touchedPercentage: number;
  };
}

// ── Review impact (Part 8) ──────────────────────────────────────────────────

/** Only gates this platform genuinely has. */
export type ReviewStage = 'product_review' | 'roadmap_review' | 'code_review' | 'customer_signoff';

export interface ReviewRequirement {
  stage: ReviewStage;
  label: string;
  required: boolean;
  reasoning: string;
}

export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  product_review: 'Product Review',
  roadmap_review: 'Roadmap Review',
  code_review: 'Code Review',
  customer_signoff: 'Customer sign-off',
};

// ── Reduced context (Part 4) ────────────────────────────────────────────────

/**
 * What ONE selected role should receive when it eventually runs. A DESCRIPTOR, not a prompt:
 * this sprint does not execute roles, and the existing engines' `buildContext(project)` still
 * builds full project context. Sprint 97 will feed these descriptors into that step; persisting
 * them now is what makes the reduction auditable before it is applied.
 */
export interface ReducedRoleContext {
  role: IncrementalRoleId;
  label: string;

  /** Baseline identifiers this role needs, and nothing else. */
  includedFeatures: string[];
  includedFiles: string[];
  includedDatabaseObjects: string[];
  includedApis: string[];
  includedEnvironment: string[];

  /** Upstream approved artifacts this role legitimately reads — from `ROLE_ARTIFACT_CHAIN`'s existing order. */
  includedUpstreamArtifacts: string[];

  /** Review outputs relevant to this role. */
  includedReviews: ReviewStage[];

  /** Named explicitly so the reduction is inspectable rather than implied by absence. */
  excluded: string[];

  /** Rough proportion of the released file set this role would see (0..1) — the point of the exercise. */
  contextReductionRatio: number;
}

// ── Incremental generation plan (Part 6) ────────────────────────────────────

export interface IncrementalPlanPhase {
  order: number;
  role: IncrementalRoleId;
  label: string;
  artifactType?: string;
  reasoning: string;
}

/** The whole planning output. Plans only — see this file's header. */
export interface IncrementalEngineeringPlan {
  modelVersion: string;
  scope: EngineeringScope;
  roleDecisions: RoleDecision[];

  /** Selected roles in the pipeline's own fixed order, skipping the unselected (Part 7). */
  executionOrder: IncrementalPlanPhase[];
  changeSet: EngineeringChangeSet;
  reducedContexts: ReducedRoleContext[];
  reviewRequirements: ReviewRequirement[];

  summary: string;

  /** Stated boundary — what this plan deliberately is not. */
  outOfScope: string[];
  createdAt: string;
  createdBy?: string;
}

/** A persisted plan — a `builders_incremental_engineering_plans` row in application shape. */
export interface IncrementalPlanRecord {
  id: string;
  changeRequestId: string;
  impactAnalysisId?: string;
  deploymentId: string;
  projectId: string;

  /** 1-based per change request. Re-planning never overwrites an earlier plan. */
  planNumber: number;
  modelVersion: string;
  selectedRoles: IncrementalRoleId[];
  filesToModifyCount: number;
  touchedPercentage: number;
  plan: IncrementalEngineeringPlan;
  createdAt: string;
  createdBy?: string;
}
