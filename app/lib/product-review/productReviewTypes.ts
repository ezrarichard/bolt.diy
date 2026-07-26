/**
 * Product Review Foundation — Sprint 82 (Business Analyst Product Review workflow).
 *
 * The first-class, persisted record of a Business Analyst's analysis of an ALREADY-RELEASED
 * MVP — customer feedback, support tickets, feature requests, bug reports, usage analytics, and
 * business goals, organized into structured intelligence for the Product Owner's later Roadmap
 * Review (Sprint 83, not built here). Mirrors `app/lib/mvp/mvpTypes.ts` / `featureTypes.ts`'s own
 * shape exactly — a dedicated table, not a generic `ProjectArtifact`, because a Product Review is
 * a first-class domain object with its own lifecycle (see `ProductReviewStatus` below), the same
 * reasoning that promoted `Mvp` (Sprint 45) and `Feature` (Sprint 78) out of draft JSON blobs.
 *
 * Sprint 82 scope note: this review is about the SOURCE (released) MVP only — no target/next-MVP
 * field exists here. Roadmap planning, the next MVP's target row, and Product Owner recommendations
 * are Sprint 83's Roadmap Review, not this sprint's.
 *
 * **One MVP, many Product Reviews (Sprint 82 polish — verified, not changed).** `mvpId` is
 * deliberately NOT unique, at either the type level here or the `builders_product_reviews`
 * migration's own indexing — a single released MVP is architecturally expected to be reviewed
 * more than once over its lifetime (an initial business review right after release, a later
 * customer-feedback review, a quarterly review, a security review, ...), each its own independent
 * `ProductReview` row with its own lifecycle. `productReviewRepository.createProductReview` never
 * upserts or checks for an existing row at this `mvpId` — every call inserts a new review — and
 * `listProductReviewsByMvp` returns every one of them, newest first. See
 * `productReviewRepository.spec.ts`'s "multiple Product Reviews per MVP" coverage.
 *
 * **Append-only once approved (Sprint 82 polish).** `productReviewRepository.updateProductReview`
 * refuses to change any business-content field (`summary`/`recommendations`/`businessRisks`/
 * `opportunities`/`featureRequests`/`technicalConcerns`/`analysis`/`attachments`) once `status` is
 * `'approved'` or `'archived'` — see `productReviewLifecycle.isProductReviewImmutable`. `artifactId`
 * below is exempt (linkage metadata, not business content — see its own comment).
 */

/**
 * Free text, matching this codebase's existing convention of unconstrained status columns
 * validated at the application layer (see `MvpStatus`, `FeatureStatus`). Linear, no-skip
 * progression except `archived`, which any non-terminal state may reach directly — see
 * `productReviewLifecycle.ts`'s `isValidProductReviewStatusTransition`, the one place this is
 * enforced.
 */
export type ProductReviewStatus = 'draft' | 'analysing' | 'ready_for_review' | 'approved' | 'archived';

/** Free text (this schema's existing status/type convention) — the only kind Sprint 82 produces is 'post_release', but the column stays open for a future ad-hoc/quarterly review kind without a migration. */
export type ProductReviewType = 'post_release' | (string & {});

/** Future-ready per the domain model's own requirement — nothing writes one of these yet. */
export interface ProductReviewAttachment {
  id: string;
  name: string;
  url: string;
  contentType?: string;
}

/** One Business Analyst Product Review of a released MVP. Mirrors a `builders_product_reviews` row. */
export interface ProductReview {
  id: string;
  projectId: string;

  /** The released MVP this review is about. Immutable once set — see `Feature.mvpId`'s identical contract. */
  mvpId: string;

  reviewDate: string;
  reviewType: ProductReviewType;
  status: ProductReviewStatus;

  summary?: string;
  recommendations: string[];
  businessRisks: string[];
  opportunities: string[];
  featureRequests: string[];
  technicalConcerns: string[];

  /**
   * The full structured Business Analyst output (see
   * `app/lib/projects/prompts/productReview.ts`'s `BusinessAnalystProductReviewOutput`), kept
   * verbatim so no section is lost to the curated top-level fields above. Undefined until the
   * Business Analyst has actually run (a review created but not yet analysed).
   */
  analysis?: import('~/lib/projects/prompts/productReview').BusinessAnalystProductReviewOutput;

  attachments: ProductReviewAttachment[];

  /**
   * Sprint 82 polish — links to the `ProjectArtifact` (`ARTIFACT_TYPES.PRODUCT_REVIEW_ANALYSIS`)
   * holding the Business Analyst's generated report verbatim (markdown/JSON viewing, version
   * history, export, AI context reuse — see `app/lib/projects/artifacts.ts`'s comment on that
   * artifact type). Set once, by `productReviewEngine.completeAnalysis`, when analysis completes.
   * Treated as linkage metadata, not business content — exempt from the immutability rule above,
   * same as `createdAt`/`updatedAt`.
   *
   * Sprint 82 — Transactional Consistency Review: system-managed, not freely reassignable. Once
   * set, `updateProductReview` refuses to change it to a DIFFERENT value (re-sending the SAME
   * value is fine — an idempotent retry, see `productReviewEngine.completeAnalysis`) — see
   * `productReviewLifecycle.PRODUCT_REVIEW_ARTIFACT_LINK_ERROR`. This is what guarantees one
   * Product Review can only ever point at one canonical analysis Artifact.
   */
  artifactId?: string;

  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new Product Review. */
export interface ProductReviewDraft {
  projectId: string;
  mvpId: string;
  reviewType?: ProductReviewType;
  status?: ProductReviewStatus;
  createdBy?: string;
}

/**
 * Input for updating an existing Product Review (never `projectId`/`mvpId`, both immutable once
 * set). `summary` through `attachments` are business-content fields, refused by
 * `updateProductReview` once the review is `'approved'`/`'archived'` — see
 * `ProductReview`'s own "Append-only once approved" comment. `status`/`artifactId` are exempt.
 */
export interface ProductReviewUpdate {
  status?: ProductReviewStatus;
  summary?: string;
  recommendations?: string[];
  businessRisks?: string[];
  opportunities?: string[];
  featureRequests?: string[];
  technicalConcerns?: string[];
  analysis?: import('~/lib/projects/prompts/productReview').BusinessAnalystProductReviewOutput;
  attachments?: ProductReviewAttachment[];
  artifactId?: string;
}

/** Business-content keys of `ProductReviewUpdate` — the fields `updateProductReview` refuses to change once a review is immutable. Kept as one shared list so the repository's guard and any future caller agree on exactly what "business content" means. */
export const PRODUCT_REVIEW_CONTENT_FIELDS = [
  'summary',
  'recommendations',
  'businessRisks',
  'opportunities',
  'featureRequests',
  'technicalConcerns',
  'analysis',
  'attachments',
] as const satisfies readonly (keyof ProductReviewUpdate)[];

export interface ProductReviewWriteResult {
  ok: boolean;
  review?: ProductReview;
  error: string | null;
}

/** Result of `updateProductReview` — Sprint 82 polish replaces the old bare `boolean` so a caller can distinguish "not configured"/"not found"/"invalid transition"/"immutable" failures instead of a single opaque `false`. */
export interface ProductReviewUpdateResult {
  ok: boolean;
  error: string | null;
}
