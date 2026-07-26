import { mvpRepository } from '~/lib/mvp/mvpRepository';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import { featureRepository } from '~/lib/features/featureRepository';
import type { Feature } from '~/lib/features/featureTypes';
import { productReviewRepository } from '~/lib/product-review/productReviewRepository';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import {
  addProjectArtifact,
  getProjectArtifacts,
  logProjectActivity,
  updateProjectArtifact,
  type Project,
} from '~/lib/stores/projects';
import { parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import { ARTIFACT_TYPES, createArtifact, getApprovedArtifactContent, type ProjectArtifact } from './artifacts';
import type { ProductOwnerDraft, RoadmapSkeletonEntry } from './prompts/productOwner';
import {
  buildRoadmapReviewUserPrompt,
  PRODUCT_OWNER_ROADMAP_REVIEW_SYSTEM_PROMPT,
  ROADMAP_REVIEW_OUTPUT_FIELDS,
  type ProductOwnerRoadmapOutput,
} from './prompts/roadmapReview';
import { roadmapReviewRepository } from '~/lib/roadmap-review/roadmapReviewRepository';
import type {
  RoadmapReview,
  RoadmapReviewUpdate,
  RoadmapReviewUpdateResult,
  RoadmapReviewWriteResult,
} from '~/lib/roadmap-review/roadmapReviewTypes';

/**
 * Roadmap Review Engine — Sprint 83 (Product Owner Roadmap Review workflow).
 *
 * Same orchestration-only shape every AI role's engine follows (`businessAnalystEngine.ts`,
 * `productReviewEngine.ts`): gathers context, builds a prompt, parses the AI's structured
 * response. Does NOT call an LLM itself.
 *
 * **This is a Product-Owner-only workflow.** After an approved Product Review is selected for
 * Roadmap Review, only this engine runs — no Architecture, Database, Frontend, Backend, or QA
 * role is invoked from here, and this engine never generates engineering tasks.
 *
 * **Architectural requirement (Sprint 83's own):** the Product Owner MUST consume an APPROVED
 * `ProductReview`, never raw customer feedback directly. `canGenerateRoadmapReview` and
 * `buildRoadmapReviewContext` both gate on `productReviewRepository.listProductReviewsByMvp`
 * filtered to `status === 'approved'` — there is no code path here that reads a Product Review's
 * feedback-derived fields off a `'draft'`/`'analysing'`/`'ready_for_review'` row.
 *
 * **Roadmap target resolution (Sprint 81 foundation, reused, never duplicated).**
 * `buildRoadmapReviewContext` calls `mvpRepository.resolveNextRoadmapTarget` exactly once — the
 * SAME idempotent, sequence-keyed resolver Sprint 81 built. This module never calls
 * `mvpRepository.createMvp` directly and never invents its own "find or create the next MVP"
 * logic; if a planned target row already exists, the resolver returns it, and this engine reuses
 * it as-is.
 *
 * **Transactional consistency (same discipline Sprint 82's polish established).**
 * `completePlanning`/`approveRoadmapReview` order their local-artifact writes and the real,
 * checked `RoadmapReview` write so neither function can report success on partial state — see
 * each function's own comment for its exact ordering and compensation, identical in spirit to
 * `productReviewEngine.completeAnalysis`/`approveProductReview`.
 *
 * **Final Approval Integration (Sprint 83's own correction).** `approveRoadmapReview` also
 * persists the authoritative `MvpApproval { stage: 'roadmap_review' }` record against
 * `targetMvpId`, reusing Sprint 81's `mvpRepository.recordMvpApproval`/`listMvpApprovals`
 * unchanged — see `ensureRoadmapReviewMvpApproval`'s own comment for the idempotency/ordering
 * this required. This is still NOT Gate A: no `Feature` is promoted, no `Mvp.status` transition
 * happens — `recordMvpApproval` itself already treats this stage as persist-only.
 */

export interface RoadmapReviewContext {
  project: { name: string; description?: string; productVision?: string };
  sourceMvp: Mvp;
  productReview: ProductReview;
  roadmapSkeleton: RoadmapSkeletonEntry[];
  targetMvp: Mvp;
  targetRoadmapEntry: RoadmapSkeletonEntry;
  currentFeatures: Feature[];
}

export type ParsedRoadmapReviewAnalysis = ParsedDraftResult<ProductOwnerRoadmapOutput>;

const ARTIFACT_GENERATOR_NAME = 'AI Product Owner';
const ARTIFACT_TYPE = ARTIFACT_TYPES.ROADMAP_REVIEW_ANALYSIS;
const ARTIFACT_TASK_ID = 'roadmap-review';

/** Every Product Review recorded as `'approved'` for `mvpId`, newest first. Shared by `canGenerateRoadmapReview`/`buildRoadmapReviewContext` so both agree on exactly what "an approved Product Review exists" means. */
async function listApprovedProductReviews(mvpId: string): Promise<ProductReview[]> {
  const reviews = await productReviewRepository.listProductReviewsByMvp(mvpId);
  return reviews.filter((review) => review.status === 'approved');
}

/** A Roadmap Review may only be started once a released MVP exists AND that MVP has at least one approved Product Review — see this file's own architectural-requirement comment. */
async function canGenerateRoadmapReview(projectId: string): Promise<boolean> {
  const sourceMvp = await mvpRepository.resolveLatestReleasedMvp(projectId);

  if (!sourceMvp) {
    return false;
  }

  const approved = await listApprovedProductReviews(sourceMvp.id);

  return approved.length > 0;
}

/**
 * Gathers the released MVP, its most recent APPROVED Product Review (or a specific one, via
 * `productReviewId`), the existing roadmap skeleton + product vision (read from the latest
 * approved `PRODUCT_OWNER_DRAFT` artifact — a local-store read, same "pipeline stays DB-agnostic,
 * caller resolves local data" split `mvpRepository.resolveNextRoadmapTarget`'s own comment
 * documents), the resolved next roadmap target (via `resolveNextRoadmapTarget`, never invented
 * here), and every Feature shipped so far. Returns `undefined` when any precondition isn't met —
 * no released MVP, no approved Product Review, or no roadmap entry sketched that far yet.
 */
async function buildRoadmapReviewContext(
  project: Project,
  options: { productReviewId?: string } = {},
): Promise<RoadmapReviewContext | undefined> {
  const sourceMvp = await mvpRepository.resolveLatestReleasedMvp(project.id);

  if (!sourceMvp) {
    return undefined;
  }

  const approvedReviews = await listApprovedProductReviews(sourceMvp.id);
  const productReview = options.productReviewId
    ? approvedReviews.find((review) => review.id === options.productReviewId)
    : approvedReviews[0];

  if (!productReview) {
    return undefined;
  }

  const ownerDraft = getApprovedArtifactContent<ProductOwnerDraft>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
  );
  const roadmapSkeleton = ownerDraft?.roadmapSkeleton ?? [];

  const resolution = await mvpRepository.resolveNextRoadmapTarget(project.id, roadmapSkeleton);

  if (!resolution) {
    return undefined;
  }

  const currentFeatures = await featureRepository.listFeaturesForProject(project.id);

  return {
    project: { name: project.name, description: project.description, productVision: ownerDraft?.productVision },
    sourceMvp,
    productReview,
    roadmapSkeleton,
    targetMvp: resolution.targetMvp,
    targetRoadmapEntry: resolution.roadmapEntry,
    currentFeatures,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/roadmapReview.ts — no prompt strings live here. */
function buildRoadmapReviewPrompt(context: RoadmapReviewContext): { system: string; prompt: string } {
  return {
    system: PRODUCT_OWNER_ROADMAP_REVIEW_SYSTEM_PROMPT,
    prompt: buildRoadmapReviewUserPrompt(context),
  };
}

/** Parses the AI's raw text response into a `ProductOwnerRoadmapOutput` via the shared generic parser, validated field-by-field against `ROADMAP_REVIEW_OUTPUT_FIELDS`. */
function parseAnalysis(rawText: string): ParsedRoadmapReviewAnalysis {
  return parseStructuredDraft<ProductOwnerRoadmapOutput>(rawText, ROADMAP_REVIEW_OUTPUT_FIELDS);
}

/**
 * Projects the AI's full output onto the `RoadmapReview` record's curated top-level fields — see
 * `prompts/roadmapReview.ts`'s own comments for why `removedFeatures`/`assumptions` exist on the
 * AI contract despite not being literally named in the sprint's ten output sections, and why
 * `futureVision` has no dedicated top-level bucket (stays in `analysis` only, same precedent
 * `productReviewEngine.toProductReviewFields` already established for its own unmapped sections).
 */
function toRoadmapReviewFields(
  analysis: ProductOwnerRoadmapOutput,
): Pick<
  RoadmapReviewUpdate,
  | 'executiveSummary'
  | 'roadmapChanges'
  | 'newFeatures'
  | 'deferredFeatures'
  | 'removedFeatures'
  | 'priorities'
  | 'dependencies'
  | 'technicalRisks'
  | 'businessRisks'
  | 'assumptions'
  | 'recommendedReleaseGoal'
  | 'analysis'
> {
  return {
    executiveSummary: analysis.executiveSummary,
    roadmapChanges: analysis.roadmapChanges ?? [],
    newFeatures: analysis.mvp2CandidateScope ?? [],
    deferredFeatures: analysis.deferredScope ?? [],
    removedFeatures: analysis.removedFeatures ?? [],
    priorities: analysis.featurePriorities ?? [],
    dependencies: analysis.dependencyAnalysis ?? [],
    technicalRisks: analysis.technicalRisks ?? [],
    businessRisks: analysis.businessRisks ?? [],
    assumptions: analysis.assumptions ?? [],
    recommendedReleaseGoal: analysis.releaseRecommendation,
    analysis,
  };
}

/**
 * Builds the `ProjectArtifact` holding the Product Owner's full report verbatim — same
 * `content: JSON.stringify(analysis, null, 2)` convention `productReviewEngine.buildProductReviewArtifact`
 * uses. Idempotent: reuses `review.artifactId` as the artifact's own id on a retry, exactly the
 * same mechanism that guarantees one Roadmap Review can only ever have one canonical Artifact.
 */
function buildRoadmapReviewArtifact(review: RoadmapReview, analysis: ProductOwnerRoadmapOutput): ProjectArtifact {
  const artifact = createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Roadmap Review Analysis — Target MVP ${review.targetMvpId}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(analysis, null, 2),
    status: 'draft',
    generatedBy: ARTIFACT_GENERATOR_NAME,
    version: 1,
  });

  return { ...artifact, id: review.artifactId ?? artifact.id, mvpId: review.targetMvpId };
}

/**
 * Starts a new Roadmap Review for a project: creates the `status: 'draft'` row and logs
 * `roadmap_review_started`. Callers should have already resolved `productReviewId`/`targetMvpId`
 * via `buildRoadmapReviewContext` (never re-derived here). Always creates a NEW row — see
 * `roadmapReviewRepository.createRoadmapReview`'s own comment for why re-planning the same
 * Product Review is expected, not an error.
 */
async function startRoadmapReview(input: {
  projectId: string;
  productReviewId: string;
  targetMvpId: string;
  createdBy?: string;
}): Promise<RoadmapReviewWriteResult> {
  const result = await roadmapReviewRepository.createRoadmapReview({
    projectId: input.projectId,
    productReviewId: input.productReviewId,
    targetMvpId: input.targetMvpId,
    createdBy: input.createdBy,
  });

  if (result.ok && result.review) {
    logProjectActivity(
      input.projectId,
      'roadmap_review_started',
      `Roadmap Review started for target MVP ${input.targetMvpId}`,
    );
  }

  return result;
}

/** Moves a Roadmap Review to `'planning'` and logs `roadmap_planning_running` — called right before the AI generation call is made. */
async function beginPlanning(review: RoadmapReview): Promise<RoadmapReviewUpdateResult> {
  const result = await roadmapReviewRepository.updateRoadmapReview(review.id, { status: 'planning' });

  if (result.ok) {
    logProjectActivity(
      review.projectId,
      'roadmap_planning_running',
      `Product Owner is planning the roadmap for target MVP ${review.targetMvpId}`,
    );
  }

  return result;
}

/**
 * Persists a completed roadmap plan: the curated fields + verbatim `analysis`, plus the full
 * report as a linked `ProjectArtifact` — moves the review to `'ready_for_review'` and logs
 * `roadmap_planning_completed`.
 *
 * Same ordering + compensation discipline as `productReviewEngine.completeAnalysis` (see that
 * function's own comment for the full reasoning — no cross-table Postgres transaction spans the
 * local project store and `builders_roadmap_reviews`, so ordering/compensation stands in for one):
 *  1. Build the artifact in memory (id reused from `review.artifactId` on a retry).
 *  2. Persist it locally (create for a first-time completion, update-in-place on a retry).
 *     Wrapped in try/catch: if this throws, the `RoadmapReview` row is never touched.
 *  3. Only then attempt the real, checked link write onto `RoadmapReview`.
 *  4. If that fails and this was a first-time completion, discard the just-created artifact
 *     (`status: 'discarded'`) — nothing to discard on a retry, since the canonical artifact/link
 *     is unchanged either way.
 *  5. Activity is logged only once step 3 has actually succeeded.
 */
async function completePlanning(
  review: RoadmapReview,
  analysis: ProductOwnerRoadmapOutput,
): Promise<RoadmapReviewUpdateResult> {
  const isRetry = review.artifactId !== undefined;
  const artifact = buildRoadmapReviewArtifact(review, analysis);

  try {
    if (isRetry) {
      updateProjectArtifact(review.projectId, artifact.id, {
        title: artifact.title,
        content: artifact.content,
        status: 'draft',
      });
    } else {
      addProjectArtifact(review.projectId, artifact);
    }
  } catch (error) {
    return { ok: false, error: `Failed to persist the Product Owner artifact: ${String(error)}` };
  }

  const result = await roadmapReviewRepository.updateRoadmapReview(review.id, {
    ...toRoadmapReviewFields(analysis),
    status: 'ready_for_review',
    artifactId: artifact.id,
  });

  if (!result.ok) {
    if (!isRetry) {
      try {
        updateProjectArtifact(review.projectId, artifact.id, { status: 'discarded' });
      } catch (compensationError) {
        console.error(
          '[RoadmapReviewEngine] Failed to discard orphaned artifact after a failed link:',
          compensationError,
        );
      }
    }

    return result;
  }

  logProjectActivity(
    review.projectId,
    'roadmap_planning_completed',
    `Roadmap planning completed for target MVP ${review.targetMvpId}`,
  );

  return result;
}

/**
 * Sprint 83 — Final Approval Integration. Ensures the authoritative `MvpApproval { stage:
 * 'roadmap_review', decision: 'approved' }` row exists for `review.targetMvpId`, reusing Sprint
 * 81's own `mvpRepository.recordMvpApproval`/`listMvpApprovals` — never a second, duplicated
 * persistence path. `builders_mvp_approvals` is deliberately append-only with no uniqueness
 * constraint (one row per decision, by design — an MVP can legitimately be reviewed more than
 * once), so idempotency here is enforced by checking FIRST: if a matching approval already
 * exists, this is a no-op success (a retry), never a second insert. Only ever persists — never
 * calls `updateMvpStatus`, promotes a `Feature`, or does anything Gate-A-shaped; `recordMvpApproval`
 * itself already treats `'roadmap_review'` as persist-only (see that function's own comment).
 */
async function ensureRoadmapReviewMvpApproval(
  review: RoadmapReview,
  options: { approvalNotes?: string; decidedBy?: string },
): Promise<RoadmapReviewUpdateResult> {
  const existingApprovals = await mvpRepository.listMvpApprovals(review.targetMvpId);
  const alreadyRecorded = existingApprovals.some(
    (approval) => approval.stage === 'roadmap_review' && approval.decision === 'approved',
  );

  if (alreadyRecorded) {
    return { ok: true, error: null };
  }

  const recorded = await mvpRepository.recordMvpApproval({
    mvpId: review.targetMvpId,
    projectId: review.projectId,
    stage: 'roadmap_review',
    decision: 'approved',
    notes: options.approvalNotes,
    decidedBy: options.decidedBy,
  });

  if (!recorded) {
    return {
      ok: false,
      error: `Failed to record the roadmap_review MVP approval for target MVP ${review.targetMvpId}`,
    };
  }

  return { ok: true, error: null };
}

/**
 * Moves a Roadmap Review to `'approved'`, persists the authoritative `MvpApproval` against
 * `targetMvpId` (see `ensureRoadmapReviewMvpApproval` above), and logs `roadmap_review_approved`.
 * `approvalNotes`, when supplied, is written in the SAME call that transitions status — the
 * immutability guard checks the row's CURRENT status (still `'ready_for_review'` at that point),
 * so this is not blocked by the very transition it accompanies; the same text is also passed as
 * the `MvpApproval.notes` so both records agree.
 *
 * **Idempotency.** If `review.status` is already `'approved'` (a retry against the SAME, already
 * fully-approved review object — e.g. a UI double-submit), this returns success immediately
 * without touching the artifact, without re-checking/re-recording the MVP approval, and — this is
 * the important part — WITHOUT logging `roadmap_review_approved` again.
 *
 * **Write order (three systems, no shared transaction — same discipline
 * `productReviewEngine.approveProductReview` established, extended by one more step):**
 *  1. Flip the linked artifact to `'approved'` (local, freely retriable, no lifecycle
 *     consequence). If this throws, stop — `RoadmapReview`/`MvpApproval` are untouched.
 *  2. Ensure the `MvpApproval` record exists (idempotent-checked, see above). If this fails,
 *     stop — `RoadmapReview.status` is NEVER moved to `'approved'` without a prior successful (or
 *     already-existing) approval record, which is exactly what "never silently leave an approved
 *     Roadmap Review without its required MVP approval" requires structurally, not just by
 *     compensation.
 *  3. Only then commit the real, harder-to-reverse `RoadmapReview` approval write (per
 *     `isValidRoadmapReviewStatusTransition`, `approved` only ever moves forward to `archived`).
 *  4. Log activity only once step 3 has actually succeeded. If step 3 fails after step 2
 *     succeeded, the `MvpApproval` record is left in place (harmless — a retry will find it via
 *     the idempotency check and just retry step 3), never rolled back, since undoing an
 *     already-persisted approval decision would itself violate the append-only philosophy the
 *     whole `MvpApproval` table exists to enforce.
 */
async function approveRoadmapReview(
  review: RoadmapReview,
  options: { approvalNotes?: string; decidedBy?: string } = {},
): Promise<RoadmapReviewUpdateResult> {
  if (review.status === 'approved') {
    return { ok: true, error: null };
  }

  if (review.artifactId) {
    try {
      updateProjectArtifact(review.projectId, review.artifactId, { status: 'approved' });
    } catch (error) {
      return { ok: false, error: `Failed to approve the linked Product Owner artifact: ${String(error)}` };
    }
  }

  const mvpApprovalResult = await ensureRoadmapReviewMvpApproval(review, options);

  if (!mvpApprovalResult.ok) {
    return mvpApprovalResult;
  }

  const result = await roadmapReviewRepository.updateRoadmapReview(review.id, {
    status: 'approved',
    ...(options.approvalNotes !== undefined ? { approvalNotes: options.approvalNotes } : {}),
  });

  if (result.ok) {
    logProjectActivity(
      review.projectId,
      'roadmap_review_approved',
      `Roadmap Review approved for target MVP ${review.targetMvpId}`,
    );
  }

  return result;
}

export const roadmapReviewEngine = {
  canGenerateRoadmapReview,
  buildRoadmapReviewContext,
  buildRoadmapReviewPrompt,
  parseAnalysis,
  toRoadmapReviewFields,
  buildRoadmapReviewArtifact,
  startRoadmapReview,
  beginPlanning,
  completePlanning,
  approveRoadmapReview,
};
