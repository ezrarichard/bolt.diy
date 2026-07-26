/**
 * Roadmap Review Foundation — Sprint 83 (Product Owner Roadmap Review workflow).
 *
 * The first-class, persisted record of the AI Product Owner's roadmap planning pass over an
 * APPROVED Business Analyst Product Review (Sprint 82). Mirrors `app/lib/product-review/
 * productReviewTypes.ts`'s own shape and philosophy exactly — a dedicated table, not a generic
 * `ProjectArtifact`, for the same reason `ProductReview` was: a first-class domain object with
 * its own lifecycle (see `RoadmapReviewStatus` below), not a draft blob.
 *
 * **Architectural requirement (Sprint 83's own):** a Roadmap Review's `productReviewId` MUST
 * point at a Product Review whose `status === 'approved'` — the Product Owner never plans off raw
 * customer feedback directly. This is enforced in `roadmapReviewEngine.canGenerateRoadmapReview`/
 * `buildRoadmapReviewContext`, not at this type or the repository layer (same "gate lives in the
 * engine, not the persistence layer" split `productReviewEngine.canGenerateProductReview` already
 * established for its own precondition).
 *
 * Sprint 83 scope note: this review produces a roadmap PROPOSAL for the next MVP — it does not
 * itself authorize engineering. Gate A (`gateAApproval.ts`, unchanged) remains the only
 * engineering-authorizing transition, exactly as Sprint 80 Part 5 specifies. Approving a Roadmap
 * Review (`roadmapReviewEngine.approveRoadmapReview`) DOES persist the authoritative
 * `MvpApproval { stage: 'roadmap_review' }` record against `targetMvpId` (Sprint 81's own
 * `MvpApprovalStage` extension, reused — never duplicated) — but exactly like `'roadmap_review'`
 * already meant per that sprint's own doc, this is persist-only: it gates whether Gate A may
 * later be invoked for this MVP, it does not drive `Mvp.status` or promote `Feature` rows itself.
 * Sprint 84+ builds whatever actually consumes this approval to run Gate A.
 *
 * **One Product Review, many Roadmap Reviews.** `productReviewId` is deliberately NOT unique — a
 * roadmap can be re-planned more than once off the SAME approved Product Review (e.g. a later
 * "changes requested" cycle at Roadmap Approval, still Sprint 84+, re-runs planning without a new
 * Product Review being required).
 *
 * **Version scope (corrected).** `roadmapVersion` is a single, PROJECT-WIDE, ever-increasing
 * revision counter — `roadmapReviewRepository.createRoadmapReview` computes it as one past the
 * highest version already recorded for the PROJECT (not per `productReviewId`), and the database
 * enforces `unique(project_id, roadmap_version)` (see the migration) so two Roadmap Reviews in the
 * same project can never silently share a version number even under concurrent creation. Multiple
 * Roadmap Reviews for the same Product Review remain fully supported; they simply don't restart
 * their own `1, 2, 3...` sequence independent of the rest of the project's Roadmap Reviews.
 *
 * **Append-only once approved.** `roadmapReviewRepository.updateRoadmapReview` refuses to change
 * any business-content field (see `ROADMAP_REVIEW_CONTENT_FIELDS` below) once `status` is
 * `'approved'` or `'archived'` — see `roadmapReviewLifecycle.isRoadmapReviewImmutable`, the exact
 * same philosophy `ProductReview` already established. `artifactId` is exempt (linkage metadata).
 */

/**
 * Free text, matching this codebase's existing convention of unconstrained status columns. Linear
 * happy path (`draft -> planning -> ready_for_review -> approved`), with `archived` reachable
 * directly from any non-terminal state — see `roadmapReviewLifecycle.ts`'s
 * `isValidRoadmapReviewStatusTransition`, the one place this is enforced.
 */
export type RoadmapReviewStatus = 'draft' | 'planning' | 'ready_for_review' | 'approved' | 'archived';

/** One Product Owner Roadmap Review of an approved Product Review. Mirrors a `builders_roadmap_reviews` row. */
export interface RoadmapReview {
  id: string;
  projectId: string;

  /** The approved `ProductReview` this planning pass consumed. Immutable once set. */
  productReviewId: string;

  /** The next roadmap sequence's `Mvp` row, resolved via `mvpRepository.resolveNextRoadmapTarget` — never created directly by this module. Immutable once set. */
  targetMvpId: string;

  /** Project-wide, ever-increasing revision counter — see this file's own "Version scope" comment. Unique per `(projectId, roadmapVersion)`, enforced at the database layer. Starts at 1 for a project's first-ever Roadmap Review. */
  roadmapVersion: number;

  status: RoadmapReviewStatus;

  executiveSummary?: string;
  roadmapChanges: string[];
  newFeatures: string[];
  deferredFeatures: string[];
  removedFeatures: string[];
  priorities: string[];
  dependencies: string[];
  technicalRisks: string[];
  businessRisks: string[];
  assumptions: string[];
  recommendedReleaseGoal?: string;

  /** Captured at approval — see the migration's own comment on `approval_notes`. */
  approvalNotes?: string;

  /**
   * The full structured Product Owner output (see
   * `app/lib/projects/prompts/roadmapReview.ts`'s `ProductOwnerRoadmapOutput`), kept verbatim so
   * no section (e.g. Future Vision, which has no dedicated top-level field — see that prompt
   * file's own comment) is lost to the curated fields above. Undefined until planning completes.
   */
  analysis?: import('~/lib/projects/prompts/roadmapReview').ProductOwnerRoadmapOutput;

  /**
   * Links to the `ProjectArtifact` (`ARTIFACT_TYPES.ROADMAP_REVIEW_ANALYSIS`) holding the Product
   * Owner's generated report verbatim. System-managed: set once, by
   * `roadmapReviewEngine.completePlanning`, then refuses replacement with a different value
   * (idempotent re-sends of the SAME value are fine) — see
   * `roadmapReviewLifecycle.ROADMAP_REVIEW_ARTIFACT_LINK_ERROR`.
   */
  artifactId?: string;

  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new Roadmap Review. `roadmapVersion` is never supplied by the caller — the repository always computes it (see `RoadmapReview`'s own comment). */
export interface RoadmapReviewDraft {
  projectId: string;
  productReviewId: string;
  targetMvpId: string;
  status?: RoadmapReviewStatus;
  createdBy?: string;
}

/**
 * Input for updating an existing Roadmap Review (never `projectId`/`productReviewId`/
 * `targetMvpId`/`roadmapVersion`, all immutable once set). `executiveSummary` through
 * `approvalNotes` are business-content fields, refused once the review is
 * `'approved'`/`'archived'` — see `RoadmapReview`'s own "Append-only once approved" comment.
 * `status`/`artifactId` are exempt (though `artifactId` has its own, narrower set-once rule).
 */
export interface RoadmapReviewUpdate {
  status?: RoadmapReviewStatus;
  executiveSummary?: string;
  roadmapChanges?: string[];
  newFeatures?: string[];
  deferredFeatures?: string[];
  removedFeatures?: string[];
  priorities?: string[];
  dependencies?: string[];
  technicalRisks?: string[];
  businessRisks?: string[];
  assumptions?: string[];
  recommendedReleaseGoal?: string;
  approvalNotes?: string;
  analysis?: import('~/lib/projects/prompts/roadmapReview').ProductOwnerRoadmapOutput;
  artifactId?: string;
}

/** Business-content keys of `RoadmapReviewUpdate` — the fields `updateRoadmapReview` refuses to change once a review is immutable. Kept as one shared list so the repository's guard and any future caller agree on exactly what "business content" means (same discipline `PRODUCT_REVIEW_CONTENT_FIELDS` established). */
export const ROADMAP_REVIEW_CONTENT_FIELDS = [
  'executiveSummary',
  'roadmapChanges',
  'newFeatures',
  'deferredFeatures',
  'removedFeatures',
  'priorities',
  'dependencies',
  'technicalRisks',
  'businessRisks',
  'assumptions',
  'recommendedReleaseGoal',
  'approvalNotes',
  'analysis',
] as const satisfies readonly (keyof RoadmapReviewUpdate)[];

export interface RoadmapReviewWriteResult {
  ok: boolean;
  review?: RoadmapReview;
  error: string | null;
}

/** Result of `updateRoadmapReview` — same `{ ok, error }` shape `ProductReviewUpdateResult` established, so a caller can distinguish "not configured"/"not found"/"invalid transition"/"immutable"/"artifact link" failures instead of a single opaque `false`. */
export interface RoadmapReviewUpdateResult {
  ok: boolean;
  error: string | null;
}
