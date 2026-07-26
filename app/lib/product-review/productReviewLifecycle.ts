import type { ProductReviewStatus } from './productReviewTypes';

/**
 * Product Review status-transition validation — Sprint 82, following the exact centralization
 * discipline `app/lib/mvp/lifecycleTransitions.ts` established for `Mvp`/`Feature`: one table,
 * checked in one place, before any status write, rather than reimplemented at each call site.
 *
 * Kept in its own file rather than folded into `lifecycleTransitions.ts` — a Product Review is
 * not part of the MVP/Feature engineering lifecycle that file's own header comment scopes itself
 * to; it is the Business Analyst's separate post-release review lifecycle.
 *
 * Linear happy path (`draft -> analysing -> ready_for_review -> approved`), with `archived`
 * reachable directly from any non-terminal state (a review can be shelved at any point without
 * completing its review cycle) and no forward transition out of a terminal state.
 */
export const PRODUCT_REVIEW_STATUS_TRANSITIONS: Record<ProductReviewStatus, ProductReviewStatus[]> = {
  draft: ['analysing', 'archived'],
  analysing: ['ready_for_review', 'archived'],
  ready_for_review: ['approved', 'archived'],
  approved: ['archived'],
  archived: [],
};

/** True for a legal transition OR a no-op (from === to, always valid — an idempotent retry of an already-applied write). */
export function isValidProductReviewStatusTransition(from: ProductReviewStatus, to: ProductReviewStatus): boolean {
  if (from === to) {
    return true;
  }

  return PRODUCT_REVIEW_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Sprint 82 polish — the append-only boundary. Once a Product Review reaches `'approved'` it is
 * a historical business document (the sprint's own framing) — its business content must never
 * change again. `'archived'` is included too, not just `'approved'`: the transition table above
 * already makes `archived` reachable directly from ANY non-terminal state (a review can be
 * shelved before ever completing analysis), and `archived` itself has no forward transitions at
 * all — there is no state past it a caller could still be legitimately writing content for. Only
 * `'draft'`/`'analysing'`/`'ready_for_review'` remain mutable.
 *
 * Mirrors this codebase's existing append-only conventions (`MvpApproval`/`docs/03-Development/
 * 01-human-approval-philosophy.md`) applied to a review's own content instead of a decision log.
 */
export function isProductReviewImmutable(status: ProductReviewStatus): boolean {
  return status === 'approved' || status === 'archived';
}

/** The domain error `productReviewRepository.updateProductReview` returns when a caller attempts to change business content on an immutable review — exported so callers/tests can assert on it precisely rather than matching prose. */
export const PRODUCT_REVIEW_IMMUTABLE_ERROR =
  'Product Review is approved (or archived) and immutable — business content can no longer be modified.';

/**
 * Sprint 82 — Transactional Consistency Review. `artifactId` is system-managed linkage metadata
 * (see `ProductReview.artifactId`'s own comment), not a free-form business-content field a caller
 * should be able to point at a different artifact after the fact — doing so would let a review
 * silently disown its canonical analysis document (or claim someone else's) with no audit trail.
 * The generic `updateProductReview` API therefore allows `artifactId` to be SET exactly once (from
 * unset to a value) and allows re-sending the SAME value (an idempotent retry of the same link —
 * see `productReviewEngine.completeAnalysis`'s reuse-on-retry behavior), but refuses to REPLACE an
 * already-linked artifact with a different one. This is the domain error returned in that case.
 */
export const PRODUCT_REVIEW_ARTIFACT_LINK_ERROR =
  'Product Review already has a linked Artifact — artifactId cannot be replaced through the generic update API.';
