/**
 * MVP Foundation — Sprint 45 (Builders Software Factory, Phase 1 of the MVP-first
 * migration; see docs/04-Roadmap/01-phased-migration-plan.md).
 *
 * These types describe `builders_mvps`/`builders_mvp_approvals` (see
 * supabase/migrations/20260720100000_mvp_foundation.sql). Nothing in the current
 * application creates, reads, or displays an MVP yet — this module exists so the AI
 * Product Owner (Sprint 46) has a persistence layer to build on, without this sprint
 * touching the engineering pipeline, the generation engine, or the UI. See
 * docs/02-Architecture/06-mvp-as-core-object.md for why `mvp_id` is a second foreign key
 * threaded through existing tables rather than a re-parenting of them.
 */

import type { RoadmapSkeletonEntry } from '~/lib/projects/prompts/productOwner';

/**
 * Free text, matching this codebase's existing convention of unconstrained status
 * columns validated at the application layer (see ApplicationManifestFile['status'],
 * ProjectArtifactStatus).
 *
 * Sprint 78 Phase 0 — `released`/`superseded` are now enforced transitions (see
 * `lifecycleTransitions.ts`'s `isValidMvpStatusTransition`, the single place every write to this
 * field is validated). `released` means this MVP is the product's current, live, customer-facing
 * state; the moment a LATER MVP itself reaches `released`, this one moves to `superseded` — see
 * `mvpRepository.ts`'s `releaseMvp` for that auto-supersede rule. Per
 * docs/product-lifecycle/Product-Lifecycle-Architecture.md §2's revision, this remains the
 * ONLY status field in the whole lifecycle — "provisioned"/"generated"/"qa_passed"/
 * "ready for deployment" are deliberately NOT values here; they are derived, read live from
 * `Project.databaseActivation`, the `ApplicationManifest`, and this MVP's `Feature` rows'
 * `status`, never duplicated into a second stored state machine.
 */
export type MvpStatus =
  | 'planned'
  | 'scoped'
  | 'generating'
  | 'ready_for_review'
  | 'approved'
  | 'blocked'
  | 'released'
  | 'superseded';

/**
 * Sprint 46B — coarse T-shirt sizing only, deliberately not numeric (story points/engineering
 * weeks) — see docs/05-AI-Product-Owner/06-buildersdb-recommendations.md for why.
 */
export type MvpEstimatedEffort = 'small' | 'medium' | 'large';

/** Sprint 46B — reuses the same severity vocabulary as risk severity, applied to an MVP as a whole. Not redundant with `sequence` — see docs/05-AI-Product-Owner/06-buildersdb-recommendations.md. */
export type MvpBusinessPriority = 'critical' | 'high' | 'medium' | 'low';

/** One MVP within a project's roadmap. Mirrors a `builders_mvps` row. */
export interface Mvp {
  id: string;
  projectId: string;

  /**
   * Sprint 46C — permanent, human-readable identifier (e.g. "MVP-001"), distinct from `id`
   * (the surrogate uuid) and from `sequence` (which the roadmap can still reorder). Assigned
   * once at creation — normally supplied by the caller (the AI Product Owner's own
   * `currentMvp.id`, computed from `sequence` at the moment Gate A approval creates this
   * row), never recomputed afterward even if `sequence` changes later. See
   * docs/05-AI-Product-Owner/08-identity-and-traceability.md.
   */
  code?: string;

  /** The MVP's position in the roadmap (1, 2, 3, ...). Unique per project. */
  sequence: number;
  theme?: string;
  status: MvpStatus;

  /**
   * The AI Product Owner's MVP Scope Definition role-output row for this MVP (Sprint 46+).
   * Undefined until that role exists and writes one.
   */
  scopeArtifactId?: string;

  /** Sprint 46B — customer-editable, not AI-authoritative (see docs/05-AI-Product-Owner/06-buildersdb-recommendations.md). e.g. "v0.1", "v1.0". */
  targetRelease?: string;
  estimatedEffort?: MvpEstimatedEffort;
  businessPriority?: MvpBusinessPriority;

  /** Sprint 46B — free text, mirrors `last_error`-style fields elsewhere in this codebase. */
  blockedReason?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

/** Input for creating a new MVP. `sequence` is the caller's responsibility (e.g. "next unused sequence for this project") — this module does not compute it, to avoid a read-then-write race nothing calls yet needs solving. */
export interface MvpDraft {
  projectId: string;
  sequence: number;

  /** Sprint 46C — if omitted, `createMvp` mints one itself from `sequence` (see mvpRepository.ts) so a caller that doesn't yet know about identity (or a legacy call site) never fails to get one. */
  code?: string;
  theme?: string;
  status?: MvpStatus;
  targetRelease?: string;
  estimatedEffort?: MvpEstimatedEffort;
  businessPriority?: MvpBusinessPriority;
  createdBy?: string;
}

export interface MvpWriteResult {
  ok: boolean;
  mvp?: Mvp;
  error: string | null;
}

/** A customer's review decision on an MVP. Mirrors a `builders_mvp_approvals` row — one row per decision, not an upsert, since an MVP can be reviewed more than once (e.g. "changes requested" then later "approved"). */
export type MvpApprovalDecision = 'approved' | 'changes_requested';

/**
 * Sprint 46B — distinguishes Gate A (Scope Approval, before Engineering starts) from Gate B
 * (Delivery Approval, after Preview) — surfaced as a real gap during the Product Owner design
 * work, since both are legitimate, distinct approval moments that share this same table. See
 * docs/05-AI-Product-Owner/05-customer-review-workflow.md.
 *
 * Sprint 81 (Cross-MVP Foundation) adds `'roadmap_review'` — the Customer Approval stage between
 * an MVP's Roadmap Analysis (Product Owner) and its own Gate A (see
 * docs/product-management/Product-Management-Architecture.md Part 5). Deliberately does NOT drive
 * an `Mvp.status` transition the way `'scope'`/`'delivery'` do — see `recordMvpApproval`'s own
 * comment — it only gates whether Gate A may be invoked for this MVP at all, recorded here for the
 * same append-only audit trail every other approval decision already gets.
 */
export type MvpApprovalStage = 'scope' | 'delivery' | 'roadmap_review';

export interface MvpApproval {
  id: string;
  mvpId: string;
  projectId: string;
  stage: MvpApprovalStage;
  decision: MvpApprovalDecision;
  notes?: string;
  decidedBy?: string;
  decidedAt: string;
  createdAt: string;
}

export interface MvpApprovalInput {
  mvpId: string;
  projectId: string;
  stage: MvpApprovalStage;
  decision: MvpApprovalDecision;
  notes?: string;
  decidedBy?: string;
}

/**
 * Sprint 81 (Cross-MVP Foundation) — the result of `mvpRepository.resolveNextRoadmapTarget`
 * (see that function's own comment and
 * docs/product-management/Product-Management-Architecture.md Part 4). Bundles the three facts a
 * caller needs together so it never has to make a second round-trip: which `Mvp` row is the
 * target, which `roadmapSkeleton` entry it elaborates, and which MVP is currently `released` (the
 * SOURCE a Product Review would be about — see `resolveLatestReleasedMvp`'s own comment for why
 * that's a separate resolver from this one).
 */
export interface RoadmapTargetResolution {
  targetMvp: Mvp;
  roadmapEntry: RoadmapSkeletonEntry;
  previousReleasedMvp: Mvp | undefined;
}
