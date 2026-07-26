import { mvpRepository } from '~/lib/mvp/mvpRepository';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import { featureRepository } from '~/lib/features/featureRepository';
import type { Feature } from '~/lib/features/featureTypes';
import { addProjectArtifact, logProjectActivity, updateProjectArtifact } from '~/lib/stores/projects';
import { parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import { ARTIFACT_TYPES, createArtifact, type ProjectArtifact } from './artifacts';
import {
  BUSINESS_ANALYST_PRODUCT_REVIEW_SYSTEM_PROMPT,
  buildProductReviewUserPrompt,
  PRODUCT_REVIEW_OUTPUT_FIELDS,
  type BusinessAnalystProductReviewOutput,
} from './prompts/productReview';
import { productReviewRepository } from '~/lib/product-review/productReviewRepository';
import type {
  ProductReview,
  ProductReviewUpdate,
  ProductReviewUpdateResult,
  ProductReviewWriteResult,
} from '~/lib/product-review/productReviewTypes';

/** Sprint 82 polish — user-facing identity for the artifact persisted alongside a Product Review. See `completeAnalysis`. */
const ARTIFACT_GENERATOR_NAME = 'AI Business Analyst';
const ARTIFACT_TYPE = ARTIFACT_TYPES.PRODUCT_REVIEW_ANALYSIS;

/** Same "project-level anchor, not a specific execution task" convention `businessAnalystEngine`/`productOwnerEngine` use for their own `ARTIFACT_TASK_ID`. */
const ARTIFACT_TASK_ID = 'product-review';

/**
 * Product Review Engine — Sprint 82 (Business Analyst Product Review workflow).
 *
 * Same orchestration-only shape every AI role's engine follows (`businessAnalystEngine.ts`,
 * `productOwnerEngine.ts`): gathers context, builds a prompt, parses the AI's structured
 * response. Does NOT call an LLM itself — see those files' own header comments for why that
 * separation matters.
 *
 * This is a **Business Analyst-only workflow** (per the sprint brief): after a released MVP is
 * selected for Product Review, only this engine runs — no Product Owner, Architecture,
 * Engineering, or QA role is invoked from here. `canGenerateProductReview` is deliberately gated
 * on `mvpRepository.resolveLatestReleasedMvp`, never `resolveActiveMvpId` — a Product Review must
 * always be about a REAL, SHIPPED release, never a mid-engineering one (see
 * docs/product-management/Product-Management-Architecture.md Part 3's correction). Sprint 82
 * scope note: this engine never resolves or creates a next-MVP roadmap target — that belongs to
 * Sprint 83's Roadmap Review, not here.
 *
 * Sprint 82 polish adds two things, both still Business-Analyst-only: (1) `completeAnalysis` now
 * also persists the AI's full report as a normal `ProjectArtifact`
 * (`ARTIFACT_TYPES.PRODUCT_REVIEW_ANALYSIS`), linked back via `ProductReview.artifactId` — see
 * `buildProductReviewArtifact` below; (2) every lifecycle-write function now returns a
 * `ProductReviewUpdateResult` (`{ ok, error }`) instead of a bare `boolean`, so a caller can
 * surface WHY a write was refused — most notably `PRODUCT_REVIEW_IMMUTABLE_ERROR` when a review
 * has already reached `'approved'`/`'archived'` (see `productReviewRepository.updateProductReview`).
 *
 * Sprint 82 — Transactional Consistency Review adds a third thing: `completeAnalysis` and
 * `approveProductReview` are now written to never report success on partial state (Product Review
 * updated but its Artifact missing/unlinked, or vice versa) — see each function's own comment for
 * its exact write order and compensation. There is no cross-table Postgres transaction spanning
 * the local project store and `builders_product_reviews` (two genuinely different persistence
 * systems here — see those comments for why that would be disproportionate); ordering +
 * compensation is the chosen approach instead.
 */

export interface ProductReviewFeedbackInputs {
  customerFeedback?: string[];
  supportTickets?: string[];
  featureRequests?: string[];
  bugReports?: string[];
  usageAnalytics?: string[];
  businessGoals?: string[];
}

export interface ProductReviewContext {
  project: { name: string; description?: string };
  mvp: Mvp;
  features: Feature[];
  customerFeedback: string[];
  supportTickets: string[];
  featureRequestsInput: string[];
  bugReports: string[];
  usageAnalytics: string[];
  businessGoals: string[];
}

export type ParsedProductReviewAnalysis = ParsedDraftResult<BusinessAnalystProductReviewOutput>;

/** A Product Review may only be started once a real, shipped MVP exists — see this file's own header comment. */
async function canGenerateProductReview(projectId: string): Promise<boolean> {
  const released = await mvpRepository.resolveLatestReleasedMvp(projectId);
  return released !== undefined;
}

/**
 * Gathers the released MVP + its shipped Features + whatever feedback signal the caller supplies
 * (customer feedback, support tickets, feature requests, bug reports, usage analytics, business
 * goals — Part 3 of the architecture explicitly defers wiring a LIVE feedback channel to future
 * work; until one exists, a human supplies what they know and the AI organizes/elaborates it).
 * Returns `undefined` when no MVP has ever released yet — mirrors `resolveNextRoadmapTarget`'s
 * own "never throws, returns undefined" discipline; callers should check `canGenerateProductReview`
 * first.
 */
async function buildProductReviewContext(
  project: { id: string; name: string; description?: string },
  feedbackInputs: ProductReviewFeedbackInputs = {},
): Promise<ProductReviewContext | undefined> {
  const mvp = await mvpRepository.resolveLatestReleasedMvp(project.id);

  if (!mvp) {
    return undefined;
  }

  const features = await featureRepository.listFeaturesForMvp(mvp.id);

  return {
    project: { name: project.name, description: project.description },
    mvp,
    features,
    customerFeedback: feedbackInputs.customerFeedback ?? [],
    supportTickets: feedbackInputs.supportTickets ?? [],
    featureRequestsInput: feedbackInputs.featureRequests ?? [],
    bugReports: feedbackInputs.bugReports ?? [],
    usageAnalytics: feedbackInputs.usageAnalytics ?? [],
    businessGoals: feedbackInputs.businessGoals ?? [],
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/productReview.ts — no prompt strings live here. */
function buildProductReviewPrompt(context: ProductReviewContext): { system: string; prompt: string } {
  return {
    system: BUSINESS_ANALYST_PRODUCT_REVIEW_SYSTEM_PROMPT,
    prompt: buildProductReviewUserPrompt(context),
  };
}

/** Parses the AI's raw text response into a `BusinessAnalystProductReviewOutput` via the shared generic parser, validated field-by-field against `PRODUCT_REVIEW_OUTPUT_FIELDS`. */
function parseAnalysis(rawText: string): ParsedProductReviewAnalysis {
  return parseStructuredDraft<BusinessAnalystProductReviewOutput>(rawText, PRODUCT_REVIEW_OUTPUT_FIELDS);
}

/**
 * Projects the AI's full 12-section output onto the `ProductReview` record's curated top-level
 * fields (see `productReviewTypes.ts`'s `ProductReview` comment for why both the curated fields
 * and the verbatim `analysis` blob are kept). `customerPainPoints`/`uxObservations` intentionally
 * have no dedicated top-level bucket — they stay in `analysis` only, full fidelity preserved,
 * rather than being force-fit into a field they don't cleanly belong to.
 */
function toProductReviewFields(
  analysis: BusinessAnalystProductReviewOutput,
): Pick<
  ProductReviewUpdate,
  | 'summary'
  | 'recommendations'
  | 'businessRisks'
  | 'opportunities'
  | 'featureRequests'
  | 'technicalConcerns'
  | 'analysis'
> {
  return {
    summary: analysis.executiveSummary,
    recommendations: analysis.recommendedPriorities ?? [],
    businessRisks: analysis.businessRisks ?? [],
    opportunities: [...(analysis.businessSuccesses ?? []), ...(analysis.potentialFutureMvpScope ?? [])],
    featureRequests: [...(analysis.requestedImprovements ?? []), ...(analysis.missingFeatures ?? [])],
    technicalConcerns: [
      ...(analysis.technicalRisks ?? []),
      ...(analysis.complianceObservations ?? []),
      ...(analysis.performanceObservations ?? []),
    ],
    analysis,
  };
}

/**
 * Sprint 82 polish — builds the `ProjectArtifact` holding the Business Analyst's full report
 * verbatim (same `content: JSON.stringify(draft, null, 2)` convention every other role's
 * `createDraftArtifact` uses, e.g. `businessAnalystEngine.createDraftArtifact`). Does NOT
 * duplicate the `ProductReview` row's curated fields — this artifact IS the canonical full
 * document; the `ProductReview` row's `summary`/`recommendations`/etc. are a derived projection
 * of it (`toProductReviewFields`), not a second copy of the same source text.
 *
 * Sprint 82 — Transactional Consistency Review: idempotency. If `review.artifactId` is already
 * set (a retry of `completeAnalysis` — e.g. re-running analysis before approval, or recovering
 * from a previous failed attempt), the SAME id is reused rather than minting a new one, so a
 * retry updates the one canonical artifact in place instead of creating a second, orphaned one.
 * `completeAnalysis` below is what actually decides create-vs-update-in-place based on this.
 */
function buildProductReviewArtifact(
  review: ProductReview,
  analysis: BusinessAnalystProductReviewOutput,
): ProjectArtifact {
  const artifact = createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Product Review Analysis — MVP ${review.mvpId}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(analysis, null, 2),
    status: 'draft',
    generatedBy: ARTIFACT_GENERATOR_NAME,
    version: 1,
  });

  /*
   * `createArtifact` doesn't accept `mvpId`/a caller-supplied `id` itself (most callers are
   * project-level, not MVP-scoped, and never retry against a known prior id) — set both
   * directly, same as every other MVP-scoped artifact's own write path.
   */
  return { ...artifact, id: review.artifactId ?? artifact.id, mvpId: review.mvpId };
}

/**
 * Starts a new Product Review for a project's latest released MVP: creates the `status: 'draft'`
 * row and logs `product_review_started`. Callers should have already checked
 * `canGenerateProductReview`; `mvpId` is still required explicitly here (rather than re-resolved)
 * so a caller that already resolved it via `buildProductReviewContext` never pays for a second
 * round-trip. Always creates a NEW review row — see `productReviewRepository.createProductReview`'s
 * own comment for why a released MVP reviewed more than once is expected, not an error.
 */
async function startProductReview(input: {
  projectId: string;
  mvpId: string;
  createdBy?: string;
}): Promise<ProductReviewWriteResult> {
  const result = await productReviewRepository.createProductReview({
    projectId: input.projectId,
    mvpId: input.mvpId,
    createdBy: input.createdBy,
  });

  if (result.ok && result.review) {
    logProjectActivity(input.projectId, 'product_review_started', `Product Review started for MVP ${input.mvpId}`);
  }

  return result;
}

/** Moves a Product Review to `'analysing'` and logs `business_analysis_running` — called right before the AI generation call is made. */
async function beginAnalysis(review: ProductReview): Promise<ProductReviewUpdateResult> {
  const result = await productReviewRepository.updateProductReview(review.id, { status: 'analysing' });

  if (result.ok) {
    logProjectActivity(
      review.projectId,
      'business_analysis_running',
      `Business Analyst is analysing MVP ${review.mvpId}`,
    );
  }

  return result;
}

/**
 * Persists a completed analysis: the `ProductReview` row's curated fields + verbatim `analysis`
 * blob, PLUS (Sprint 82 polish) the full report as a linked `ProjectArtifact` — moves the review
 * to `'ready_for_review'` and logs `business_analysis_completed`.
 *
 * Sprint 82 — Transactional Consistency Review. Two systems are written here — the local project
 * store (`addProjectArtifact`/`updateProjectArtifact`, synchronous + a fire-and-forget BuildersDB
 * mirror, no real failure signal — the same convention every other AI role's artifact creation
 * already relies on) and `builders_product_reviews` (a real, awaited, ok/error-checked BuildersDB
 * write via `productReviewRepository`). No cross-table Postgres transaction spans both — they are
 * different persistence systems, and adding one here would be disproportionate to this sprint (see
 * this file's own "PREFERRED CONSISTENCY APPROACH" review). Instead, ordering + compensation:
 *
 *  1. Build the artifact in memory (id is deterministic — reused from `review.artifactId` on a
 *     retry, freshly minted otherwise — see `buildProductReviewArtifact`). No I/O yet.
 *  2. Persist it locally (`addProjectArtifact` for a first-time completion, `updateProjectArtifact`
 *     in place for a retry — never a second `addProjectArtifact` call, which would append a
 *     duplicate entry under the same id). Wrapped in try/catch: if this throws, `ProductReview` is
 *     never touched at all — no partial state, nothing to compensate.
 *  3. Only once the artifact write above has NOT thrown, attempt the real, checked write: link
 *     `artifactId` + curated fields + `status: 'ready_for_review'` onto the `ProductReview` row.
 *  4. If step 3 fails (invalid transition, immutable, BuildersDB error, ...) AND this was a
 *     first-time completion (no prior `review.artifactId`): compensate by invalidating the
 *     artifact just created (`status: 'discarded'`, the standing `ProjectArtifactStatus` value for
 *     exactly this) so it never lingers as a live-looking but unlinked document — "if Artifact
 *     creation succeeds but linking fails, remove or invalidate the newly created Artifact." A
 *     retry (artifact already existed and was already linked before this call) has nothing to
 *     invalidate — the canonical artifact's identity/link is unchanged, only its content was
 *     refreshed locally; no orphan is created either way.
 *  5. Activity is logged, and success returned, ONLY once step 3 has actually succeeded.
 */
async function completeAnalysis(
  review: ProductReview,
  analysis: BusinessAnalystProductReviewOutput,
): Promise<ProductReviewUpdateResult> {
  const isRetry = review.artifactId !== undefined;
  const artifact = buildProductReviewArtifact(review, analysis);

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
    return { ok: false, error: `Failed to persist the Business Analyst artifact: ${String(error)}` };
  }

  const result = await productReviewRepository.updateProductReview(review.id, {
    ...toProductReviewFields(analysis),
    status: 'ready_for_review',
    artifactId: artifact.id,
  });

  if (!result.ok) {
    if (!isRetry) {
      try {
        updateProjectArtifact(review.projectId, artifact.id, { status: 'discarded' });
      } catch (compensationError) {
        console.error(
          '[ProductReviewEngine] Failed to discard orphaned artifact after a failed link:',
          compensationError,
        );
      }
    }

    return result;
  }

  logProjectActivity(
    review.projectId,
    'business_analysis_completed',
    `Business analysis completed for MVP ${review.mvpId}`,
  );

  return result;
}

/**
 * Moves a Product Review to `'approved'` and logs `product_review_approved` — the human approval
 * step, same `useDraftPanel`-style `handleApprove()` discipline every other role's draft uses.
 * Also flips the linked artifact (if any — a review approved without ever completing analysis has
 * none) from `'draft'` to `'approved'`, keeping the artifact's own status in sync with the
 * document it represents becoming a historical, immutable record.
 *
 * Sprint 82 — Transactional Consistency Review. `ProductReview.status: 'approved'` is the harder
 * write to reverse: once recorded, `isValidProductReviewStatusTransition` only allows
 * `approved -> archived`, never back to `ready_for_review` — approval is meant to be a real,
 * permanent business event, not a step this function could safely undo on a later failure. The
 * artifact's own status flip, by contrast, is a local, freely-retriable, best-effort write with no
 * lifecycle consequence of its own. So the artifact is flipped FIRST: if that fails (thrown
 * exception), the function stops before ever touching `ProductReview.status` — the review stays
 * `'ready_for_review'`, fully retriable, no irreversible state was recorded. Only once the
 * artifact-side write has NOT thrown does this function commit the actual (real, checked) approval
 * write, and only log the activity once THAT has also succeeded.
 */
async function approveProductReview(review: ProductReview): Promise<ProductReviewUpdateResult> {
  if (review.artifactId) {
    try {
      updateProjectArtifact(review.projectId, review.artifactId, { status: 'approved' });
    } catch (error) {
      return { ok: false, error: `Failed to approve the linked Business Analyst artifact: ${String(error)}` };
    }
  }

  const result = await productReviewRepository.updateProductReview(review.id, { status: 'approved' });

  if (result.ok) {
    logProjectActivity(review.projectId, 'product_review_approved', `Product Review approved for MVP ${review.mvpId}`);
  }

  return result;
}

export const productReviewEngine = {
  canGenerateProductReview,
  buildProductReviewContext,
  buildProductReviewPrompt,
  parseAnalysis,
  toProductReviewFields,
  buildProductReviewArtifact,
  startProductReview,
  beginAnalysis,
  completeAnalysis,
  approveProductReview,
};
