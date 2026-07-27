import type { ChangeArea } from '~/lib/evolution/changeRequestTypes';
import type { IncrementalRoleId, ReviewStage } from '~/lib/evolution/engineeringScopeTypes';
import type { ImpactConfidence, ImpactSectionId } from '~/lib/evolution/impactTypes';

/**
 * Incremental AI Execution Model — Sprint 97.
 *
 * Sprint 96 produced a PLAN: which roles a change needs, in what order, with what reduced context.
 * This sprint EXECUTES that plan — the selected roles only, each seeing only its approved scope.
 *
 * WHAT IS DELIBERATELY NOT HERE (the sprint's stated boundary, in the model itself):
 *  - no application code is generated; a role produces its own draft artifact, nothing more;
 *  - no release, manifest, generated file or deployment is touched;
 *  - no RELEASED engineering artifact is overwritten — see `IncrementalRoleRun.output`, which is
 *    persisted in its own table rather than written back into `project.artifacts`;
 *  - scope is never expanded automatically (Part 10) — a role that discovers new impact pauses
 *    the execution and waits for an operator decision.
 *
 * THE EXECUTION PATH IS THE EXISTING ONE. Nothing here is a second AI pipeline. The runner
 * composes `AUTO_ENGINEERING_ROLES`' own `buildContext`/`buildPrompt`/`parseDraft` with
 * `generateRoleWithRecovery` (Sprint 44's provider-agnostic retry core) — the same three steps
 * `useAutoEngineeringPipeline` performs. The only thing this sprint changes is WHAT GOES IN:
 * a scoped project projection plus a scoped instruction layer instead of full project context.
 */

export const INCREMENTAL_EXECUTION_MODEL_VERSION = '1.0.0';

// ── Execution status (Part 3) ───────────────────────────────────────────────

/**
 * `blocked` is distinct from `failed` on purpose: failed means something went wrong, blocked means
 * the execution is CORRECTLY refusing to continue until a human decides something (a safety
 * fallback, an unapproved scope expansion, a missing invalidated dependency).
 */
export type IncrementalExecutionStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export type IncrementalRoleRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked';

// ── Operator role overrides (Part 4) ────────────────────────────────────────

export type RoleOverrideAction = 'include' | 'exclude';

/** Every override carries a reason — Part 4 makes that mandatory, and validation enforces it. */
export interface RoleOverride {
  role: IncrementalRoleId;
  action: RoleOverrideAction;
  reason: string;
  decidedBy?: string;
  decidedAt?: string;
}

export type RoleOverrideViolationCode =
  | 'missing_reason'
  | 'unknown_role'
  | 'not_applicable'
  | 'qa_required'
  | 'dependency_broken'
  | 'no_reduced_context'
  | 'duplicate_override';

export interface RoleOverrideViolation {
  code: RoleOverrideViolationCode;
  role: IncrementalRoleId;
  message: string;
}

/**
 * The result of applying operator overrides to a plan's recommendation. `recommendedRoles` is kept
 * alongside `approvedRoles` because Part 4 requires the final approved selection to be persisted
 * SEPARATELY from the original recommendation — "restore recommended" has to remain possible, and
 * an audit has to be able to see what the machine proposed versus what the human decided.
 */
export interface RoleSelectionResolution {
  ok: boolean;
  recommendedRoles: IncrementalRoleId[];
  approvedRoles: IncrementalRoleId[];
  appliedOverrides: RoleOverride[];
  violations: RoleOverrideViolation[];
}

// ── Downstream invalidation (Part 5) ────────────────────────────────────────

export type InvalidationState = 'valid' | 'potentially_stale' | 'invalidated' | 'requires_review';

/**
 * One existing artifact's standing once the approved roles re-run. NOTHING IS DELETED and nothing
 * is silently re-approved (Part 5's two prohibitions) — this is a recorded judgement about an
 * artifact that stays exactly where it is.
 */
export interface InvalidationDecision {
  role: IncrementalRoleId;
  label: string;
  artifactType?: string;
  state: InvalidationState;

  /** True when the artifact cannot be trusted without a fresh run of its own role. */
  mustRerun: boolean;

  /** True when a human should look at it, but a re-run is not structurally required. */
  requiresReview: boolean;

  /** Which executing roles caused this, so the decision is never an unexplained label. */
  causedBy: IncrementalRoleId[];
  reasoning: string;

  /** The dependency edges the decision rests on, in "consumer ← producer" form. */
  evidence: string[];
}

// ── Reduced context in the real execution path (Part 6) ─────────────────────

/**
 * Exactly what ONE role receives for ONE incremental run. Everything here traces to the approved
 * plan, the impact analysis or the release baseline; nothing is derived from current project state.
 */
export interface IncrementalRoleExecutionContext {
  role: IncrementalRoleId;
  label: string;

  changeRequestSummary: string;

  /** Impact findings that name something this role owns — never the whole report. */
  relevantImpactFindings: Array<{ section: ImpactSectionId; detail: string; confidence: ImpactConfidence }>;

  /** Evolution-plan instructions this role is responsible for. */
  relevantInstructions: string[];

  affectedFeatures: string[];
  affectedFiles: string[];
  affectedRoutes: string[];
  affectedDatabaseObjects: string[];
  affectedApis: string[];
  affectedEnvironment: string[];

  /** Release-baseline references — what "the existing product" means for this run. */
  baseline: {
    releaseId?: string;
    releaseVersion?: string;
    manifestVersion?: number;
    manifestPlanChecksum?: string;
    totalReleasedFiles: number;
  };

  /** Approved upstream artifact TYPES this role may read. The scoped project projection is built from exactly this list. */
  upstreamArtifactTypes: string[];

  /**
   * The role's OWN released artifact type(s). Included in the scoped project on purpose: an
   * incremental run REVISES the released design, so withholding the role's own released output
   * would make it write from scratch — the exact "redesign unrelated areas" failure Part 8 forbids.
   */
  baselineArtifactTypes: string[];

  /** Review stages whose outcome this role must respect. */
  relevantReviews: ReviewStage[];

  /** Stated, not implied by absence — the role is told what it must not touch. */
  excludedAreas: string[];
  unaffectedAreas: Array<{ area: ChangeArea; detail: string }>;

  /** Role-specific constraints layered on top of the shared incremental rules. */
  constraints: string[];

  /** Proportion of the released file set this role sees (0..1). */
  contextReductionRatio: number;

  /** True only when a documented, operator-approved full-context fallback is in force (Part 7). */
  usedFullContextFallback: boolean;
}

// ── Safety fallback (Part 7) ────────────────────────────────────────────────

export type SafetyFallbackReason =
  | 'missing_upstream_artifact'
  | 'low_confidence_impact'
  | 'missing_file_mapping'
  | 'baseline_integrity_mismatch'
  | 'invalidated_dependency_missing';

export interface SafetyFallbackTrigger {
  reason: SafetyFallbackReason;
  role?: IncrementalRoleId;
  detail: string;
}

/**
 * A full-context run is never a silent degradation. It exists only as an explicit operator
 * decision, it is labelled on every context it produced, and the reason is stored with it.
 */
export interface FullContextFallbackApproval {
  approved: boolean;
  reason: string;
  approvedBy?: string;
  approvedAt: string;

  /** The triggers this approval answers — so an approval cannot silently cover a later, different problem. */
  coversReasons: SafetyFallbackReason[];
}

// ── Newly discovered impact (Part 10) ───────────────────────────────────────

export type DiscoveredImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DiscoveredImpactAction =
  | 'expand_scope'
  | 'return_to_impact_analysis'
  | 'monitor_only'
  | 'no_action_required';

/** A role's structured report of impact Sprint 95's analysis did not find. */
export interface DiscoveredImpact {
  id?: string;
  description: string;
  category: ImpactSectionId;

  /** The baseline identifier or artifact the role says is affected. */
  affectedArtifact: string;
  reasoning: string;
  severity: DiscoveredImpactSeverity;
  recommendedAction: DiscoveredImpactAction;
  scopeChangeRequired: boolean;

  /** Which role reported it — set by the runner, never by the model. */
  reportedByRole?: IncrementalRoleId;
  reportedAt?: string;
}

export type ScopeExpansionDecisionType =
  | 'approve_expansion'
  | 'reject_expansion'
  | 'return_to_impact_analysis'
  | 'continue_without_expansion';

export interface ScopeExpansionDecision {
  decision: ScopeExpansionDecisionType;
  reason: string;
  decidedBy?: string;
  decidedAt: string;

  /** The discovered-impact ids this decision answers. */
  discoveredImpactIds: string[];
}

// ── Reviews (Part 12) ───────────────────────────────────────────────────────

export type IncrementalReviewDecision = 'approved' | 'changes_requested' | 'rejected' | 'blocked_by_scope';

export interface IncrementalReviewResult {
  stage: ReviewStage;
  label: string;
  decision: IncrementalReviewDecision;
  reasoning: string;

  /** Roles whose output this review covered. */
  coveredRoles: IncrementalRoleId[];
  reviewedAt: string;
}

// ── Role run (Part 3/9/14) ──────────────────────────────────────────────────

/**
 * One attempt at one role. Attempts are never overwritten — a retry inserts a new row with
 * `attempt + 1`, which is what makes the whole execution history auditable rather than a
 * last-write-wins status field.
 */
export interface IncrementalRoleRun {
  id?: string;
  executionId: string;
  role: IncrementalRoleId;
  label: string;
  attempt: number;
  status: IncrementalRoleRunStatus;

  /** Which artifact type this run produced, matching the released artifact it supersedes. */
  artifactType?: string;

  /** Part 9 — the incremental output, stored HERE and never written over the released artifact. */
  output?: IncrementalArtifact;

  /** Part 6 — the exact scoped context this run was given, stored so the reduction is auditable after the fact. */
  context?: IncrementalRoleExecutionContext;

  discoveredImpacts: DiscoveredImpact[];
  failure?: { kind: string; message: string };
  startedAt: string;
  completedAt?: string;
}

// ── Incremental artifacts (Part 9) ──────────────────────────────────────────

/**
 * A role output produced incrementally. Deliberately NOT a `ProjectArtifact`: writing one of those
 * would add a newer version of the released artifact type to `project.artifacts`, which every
 * `getLatestApprovedArtifact` reader would then treat as the product's current design. Sprint 97
 * does not generate code and does not cut a release, so the released artifacts must stay
 * authoritative — this record links to the one it would supersede instead of replacing it.
 */
export interface IncrementalArtifact {
  generationType: 'incremental';
  role: IncrementalRoleId;
  artifactType: string;

  /** The parsed draft exactly as the role's own `parseDraft` produced it. */
  content: unknown;

  baselineReleaseId?: string;
  changeRequestId: string;
  impactAnalysisId?: string;
  engineeringPlanId: string;
  executionId: string;

  /** The released artifact this output would supersede, when one is identifiable. */
  supersedesArtifactId?: string;

  /**
   * A stable hash of the approved scope this output was produced under. Two runs with the same
   * fingerprint saw the same scope; a changed fingerprint means the output answers a different
   * question and must not be compared with the previous one as if it were a straight revision.
   */
  scopeFingerprint: string;

  version: number;
  generatedBy: string;
  generatedAt: string;
}

// ── The execution (Part 3) ──────────────────────────────────────────────────

export interface IncrementalExecution {
  id: string;
  projectId: string;
  deploymentId: string;
  releaseId?: string;
  changeRequestId: string;
  impactAnalysisId?: string;
  evolutionPlanId?: string;
  engineeringPlanId: string;

  status: IncrementalExecutionStatus;

  /** Part 4 — the machine's recommendation, kept for comparison. */
  recommendedRoles: IncrementalRoleId[];

  /** Part 4 — what the operator actually approved. This, not the recommendation, is what runs. */
  selectedRoles: IncrementalRoleId[];
  overrides: RoleOverride[];

  currentRole?: IncrementalRoleId;
  completedRoles: IncrementalRoleId[];
  skippedRoles: IncrementalRoleId[];
  failedRoles: IncrementalRoleId[];

  invalidations: InvalidationDecision[];
  safetyFallbacks: SafetyFallbackTrigger[];
  fullContextFallback?: FullContextFallbackApproval;

  discoveredImpacts: DiscoveredImpact[];
  scopeExpansionDecisions: ScopeExpansionDecision[];
  reviews: IncrementalReviewResult[];

  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  failure?: { code: string; message: string };

  /** 1-based per engineering plan. A re-execution never overwrites an earlier one. */
  executionVersion: number;
  modelVersion: string;
  scopeFingerprint: string;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export const EXECUTION_STATUS_LABELS: Record<IncrementalExecutionStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};

export const INVALIDATION_STATE_LABELS: Record<InvalidationState, string> = {
  valid: 'Valid',
  potentially_stale: 'Potentially stale',
  invalidated: 'Invalidated',
  requires_review: 'Requires review',
};

/** Statuses from which a resume is meaningful. Anything else is either finished or needs a decision first. */
export const RESUMABLE_STATUSES: IncrementalExecutionStatus[] = ['pending', 'ready', 'running', 'paused'];
