-- Roadmap Review Foundation — Sprint 83 (Product Owner Roadmap Review workflow).
--
-- Adds `builders_roadmap_reviews`: the first-class, persisted record of the AI Product Owner's
-- roadmap planning pass over an APPROVED Business Analyst Product Review (Sprint 82) — never raw
-- customer feedback directly (see `roadmapReviewEngine.ts`'s `buildRoadmapReviewContext`, which
-- structurally can only consume a `builders_product_reviews` row whose `status = 'approved'`).
-- One row per roadmap review, owned by exactly one Project, one source `ProductReview`, and one
-- target `Mvp` (the next roadmap sequence, resolved via `mvpRepository.resolveNextRoadmapTarget`
-- — Sprint 81 — never a second, bypassing MVP-creation path). Mirrors
-- `builders_product_reviews`'s shape and defensive conventions exactly (same RLS helper
-- functions, same `updated_at` trigger, same free-text status column convention, same
-- application-layer-only immutability/artifact-linkage enforcement — see that migration's own
-- header for why neither is a DB constraint/trigger).
--
-- Purely additive: a new table, nothing existing references it, no other table/column is
-- altered. Idempotent throughout (`if not exists` guards), matching every other migration here.
--
-- Sprint 83 — Final Approval Integration, Version Safety correction (this migration was never
-- shipped before this pass, so it lands here rather than as a follow-up migration):
--
-- 1. `unique (project_id, roadmap_version)` below — `roadmap_version` is a project-wide,
--    ever-increasing revision counter (see `roadmapReviewTypes.ts`'s `RoadmapReview.roadmapVersion`
--    comment for why the SCOPE changed from "per Product Review" to "per project"), and this
--    constraint is what actually makes two concurrent `createRoadmapReview` calls unable to
--    silently persist the same version number — the application-layer "highest + 1" computation
--    alone cannot guarantee that under real concurrency. See
--    `roadmapReviewRepository.createRoadmapReview`'s own comment for how a violation surfaces as
--    a clear, retry-safe `ok: false` result rather than a generic error.
-- 2. Approving a Roadmap Review now also persists an authoritative `MvpApproval` row (Sprint 81's
--    existing `builders_mvp_approvals` table, `stage = 'roadmap_review'`) against `target_mvp_id`
--    — reusing `mvpRepository.recordMvpApproval`/`listMvpApprovals` as-is, no schema change here.
--    `builders_mvp_approvals` is deliberately append-only with NO uniqueness constraint (Sprint 46B
--    — "one row per decision, not upsert", since an MVP can legitimately be reviewed more than
--    once) — so retry-safety for "don't record the SAME roadmap_review approval twice" is enforced
--    at the APPLICATION layer instead (`roadmapReviewEngine`'s own idempotency check against
--    `listMvpApprovals` before ever calling `recordMvpApproval`), exactly the same
--    query-before-insert discipline this file's own `roadmap_version` computation already uses.

create table if not exists builders_roadmap_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,

  -- The APPROVED Product Review this roadmap planning pass consumed. Immutable once set, same
  -- as Feature.mvpId / ProductReview.mvpId's identical contract.
  product_review_id uuid not null references builders_product_reviews (id) on delete cascade,

  -- The next roadmap sequence's Mvp row — resolved via `mvpRepository.resolveNextRoadmapTarget`
  -- (Sprint 81), which is itself idempotent by `sequence` (reuses an existing pre-release row
  -- rather than ever creating a duplicate). This column never has a row created FOR it directly —
  -- only ever populated with whatever id that resolver already returned.
  target_mvp_id uuid not null references builders_mvps (id) on delete cascade,

  -- Project-wide, ever-increasing revision counter (NOT scoped to product_review_id — see this
  -- migration's own header note #1). Computed by `roadmapReviewRepository.createRoadmapReview` as
  -- `max(existing roadmap_version for this project) + 1`, defaulting to 1, and enforced unique
  -- per-project by the constraint below.
  roadmap_version int not null default 1,

  -- 'draft' | 'planning' | 'ready_for_review' | 'approved' | 'archived' — see
  -- app/lib/roadmap-review/roadmapReviewLifecycle.ts, the one place this is validated.
  status text not null default 'draft',

  executive_summary text,
  roadmap_changes text[] not null default '{}',
  new_features text[] not null default '{}',
  deferred_features text[] not null default '{}',
  removed_features text[] not null default '{}',
  priorities text[] not null default '{}',
  dependencies text[] not null default '{}',
  technical_risks text[] not null default '{}',
  business_risks text[] not null default '{}',
  assumptions text[] not null default '{}',
  recommended_release_goal text,

  -- Captured at the Roadmap Review approval moment (mirrors `MvpApproval.notes`) — settable in
  -- the SAME update call that transitions `status` to `'approved'` (the immutability guard checks
  -- the row's CURRENT status before the write, not the target status), frozen thereafter with
  -- every other business-content field.
  approval_notes text,

  -- Full structured Product Owner output (Executive Summary, Roadmap Changes, Feature
  -- Priorities, MVP2 Candidate Scope, Deferred Scope, Future Vision, Dependency Analysis,
  -- Business Risks, Technical Risks, Release Recommendation — see
  -- app/lib/projects/prompts/roadmapReview.ts's `ProductOwnerRoadmapOutput`), kept verbatim
  -- alongside the denormalized columns above so no section of the AI's output is ever lost to
  -- the curated top-level projection.
  analysis jsonb,

  -- Links this review to the `ProjectArtifact` holding the Product Owner's generated report
  -- verbatim (`app/lib/projects/artifacts.ts`, `ARTIFACT_TYPES.ROADMAP_REVIEW_ANALYSIS`). Text,
  -- matching `ProjectArtifact.id`'s own application-minted string identity — same reasoning
  -- `builders_product_reviews.artifact_id` already documents. Application-layer enforces
  -- set-once-or-identical, never a free replacement — see
  -- `roadmapReviewLifecycle.ROADMAP_REVIEW_ARTIFACT_LINK_ERROR`. Nullable: unset until
  -- `roadmapReviewEngine.completePlanning` runs.
  artifact_id text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builders_roadmap_reviews_project_id_idx on builders_roadmap_reviews (project_id);
create index if not exists builders_roadmap_reviews_product_review_id_idx on builders_roadmap_reviews (product_review_id);
create index if not exists builders_roadmap_reviews_target_mvp_id_idx on builders_roadmap_reviews (target_mvp_id);
create index if not exists builders_roadmap_reviews_project_status_idx on builders_roadmap_reviews (project_id, status);

-- The actual concurrency guard for `roadmap_version` — see this migration's own header note #1.
-- Deliberately NOT unique on `product_review_id` (multiple Roadmap Reviews per Product Review
-- remain fully supported — see `RoadmapReview`'s own "One Product Review, many Roadmap Reviews"
-- comment) and NOT unique on `target_mvp_id` either, for the identical reason.
create unique index if not exists builders_roadmap_reviews_project_version_unique
  on builders_roadmap_reviews (project_id, roadmap_version);

drop trigger if exists set_updated_at on builders_roadmap_reviews;
create trigger set_updated_at before update on builders_roadmap_reviews
  for each row execute function builders_set_updated_at();

-- RLS — same ownership-check helpers as builders_mvps/builders_features/builders_product_reviews.
alter table builders_roadmap_reviews enable row level security;

drop policy if exists "builders_roadmap_reviews_select" on builders_roadmap_reviews;
create policy "builders_roadmap_reviews_select" on builders_roadmap_reviews
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_roadmap_reviews_write" on builders_roadmap_reviews;
create policy "builders_roadmap_reviews_write" on builders_roadmap_reviews
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
