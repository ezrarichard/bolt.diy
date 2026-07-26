import type { RoadmapReviewStatus } from './roadmapReviewTypes';

/**
 * Roadmap Review status-transition validation — Sprint 83, following the exact centralization
 * discipline `app/lib/product-review/productReviewLifecycle.ts` established for `ProductReview`
 * (itself following `app/lib/mvp/lifecycleTransitions.ts`'s original discipline for `Mvp`/
 * `Feature`): one table, checked in one place, before any status write.
 *
 * Kept in its own file rather than folded into either of those — a Roadmap Review is a distinct
 * lifecycle (the Product Owner's post-review planning pass), not part of the MVP/Feature
 * engineering lifecycle or the Business Analyst's review lifecycle, even though all three share
 * the same shape of rule.
 *
 * Linear happy path (`draft -> planning -> ready_for_review -> approved`), with `archived`
 * reachable directly from any non-terminal state and no forward transition out of a terminal
 * state — identical structure to `PRODUCT_REVIEW_STATUS_TRANSITIONS`, just renamed to this
 * lifecycle's own stage name (`'planning'` instead of `'analysing'`).
 */
export const ROADMAP_REVIEW_STATUS_TRANSITIONS: Record<RoadmapReviewStatus, RoadmapReviewStatus[]> = {
  draft: ['planning', 'archived'],
  planning: ['ready_for_review', 'archived'],
  ready_for_review: ['approved', 'archived'],
  approved: ['archived'],
  archived: [],
};

/** True for a legal transition OR a no-op (from === to, always valid — an idempotent retry of an already-applied write). */
export function isValidRoadmapReviewStatusTransition(from: RoadmapReviewStatus, to: RoadmapReviewStatus): boolean {
  if (from === to) {
    return true;
  }

  return ROADMAP_REVIEW_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The append-only boundary — once a Roadmap Review reaches `'approved'` it is the historical
 * record of what the Product Owner decided for this planning cycle; `'archived'` is included too,
 * for the identical reasoning `productReviewLifecycle.isProductReviewImmutable` documents (no
 * forward transition exists past either state, so nothing should still be writable once there).
 */
export function isRoadmapReviewImmutable(status: RoadmapReviewStatus): boolean {
  return status === 'approved' || status === 'archived';
}

/** The domain error `roadmapReviewRepository.updateRoadmapReview` returns when a caller attempts to change business content on an immutable review. */
export const ROADMAP_REVIEW_IMMUTABLE_ERROR =
  'Roadmap Review is approved (or archived) and immutable — business content can no longer be modified.';

/**
 * Same rule, same reasoning as `productReviewLifecycle.PRODUCT_REVIEW_ARTIFACT_LINK_ERROR`:
 * `artifactId` may be SET exactly once (unset -> a value) or re-sent with the SAME value (an
 * idempotent retry of the same link), never REPLACED with a different one, through the generic
 * `updateRoadmapReview` API.
 */
export const ROADMAP_REVIEW_ARTIFACT_LINK_ERROR =
  'Roadmap Review already has a linked Artifact — artifactId cannot be replaced through the generic update API.';
