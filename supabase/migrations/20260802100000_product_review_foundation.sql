-- Product Review Foundation — Sprint 82 (Business Analyst Product Review workflow).
--
-- Adds `builders_product_reviews`: the first-class, persisted record of a Business Analyst's
-- Product Review of an ALREADY-RELEASED MVP (see docs/product-management/Product-Management-Architecture.md
-- Part 3 for the originating architecture; Sprint 82 narrows that design to source-MVP analysis
-- only — no roadmap/target-MVP fields here, that belongs to the Sprint 83 Roadmap Review). One
-- row per review, owned by exactly one Project and exactly one (released) MVP — mirrors
-- `builders_mvps`/`builders_features`'s existing shape and defensive conventions exactly (same
-- RLS helper functions, same `updated_at` trigger, same free-text status/type column convention
-- used throughout this schema).
--
-- Purely additive: a new table, nothing existing references it, no other table/column is
-- altered. Idempotent throughout (`if not exists` guards), matching every other migration here.
--
-- Sprint 82 polish — two clarifications baked into this table's shape from the start (this
-- migration was never shipped before the polish pass, so both land here rather than as a
-- follow-up migration):
--
-- 1. `mvp_id` is intentionally NOT unique. A single released MVP may be reviewed more than once
--    (an initial business review, a later customer-feedback review, a quarterly review, a
--    security review, ...) — `builders_product_reviews_mvp_id_idx` below is a plain (non-unique)
--    index for exactly this reason. See `app/lib/product-review/productReviewRepository.ts`'s
--    `listProductReviewsByMvp` for the read side.
-- 2. Immutability of an `approved` (or `archived`) review's business content
--    (`summary`/`recommendations`/`business_risks`/`opportunities`/`feature_requests`/
--    `technical_concerns`/`analysis`/`attachments`) is enforced at the APPLICATION layer only
--    (`productReviewRepository.updateProductReview`, gated by
--    `productReviewLifecycle.isProductReviewImmutable`) — same convention as every other
--    status/lifecycle rule in this schema (e.g. `isValidMvpStatusTransition`), not a DB
--    constraint/trigger.
--
-- Sprint 82 — Transactional Consistency Review — one more clarification, same reasoning as #2
-- above: `artifact_id` may be SET exactly once (or re-sent with the SAME value, an idempotent
-- retry) and is refused if a caller tries to REPLACE it with a different value once already
-- linked (`productReviewLifecycle.PRODUCT_REVIEW_ARTIFACT_LINK_ERROR`). Also application-layer
-- only — no DB constraint/trigger enforces this either, matching #2's convention exactly.

create table if not exists builders_product_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,

  -- The released MVP this review is ABOUT — see productReviewEngine.ts's
  -- `canGenerateProductReview` (gated on `mvpRepository.resolveLatestReleasedMvp`, never the
  -- mid-engineering `resolveActiveMvpId`). Immutable once set, same as Feature.mvpId.
  mvp_id uuid not null references builders_mvps (id) on delete cascade,

  review_date timestamptz not null default now(),

  -- Free text, matching this schema's existing convention of unconstrained status/type columns
  -- validated at the application layer (see builders_mvps.status). Defaults to the only kind
  -- Sprint 82 produces — a post-release review of one MVP.
  review_type text not null default 'post_release',

  -- 'draft' | 'analysing' | 'ready_for_review' | 'approved' | 'archived' — see
  -- app/lib/product-review/productReviewLifecycle.ts, the one place this is validated.
  status text not null default 'draft',

  summary text,
  recommendations text[] not null default '{}',
  business_risks text[] not null default '{}',
  opportunities text[] not null default '{}',
  feature_requests text[] not null default '{}',
  technical_concerns text[] not null default '{}',

  -- Full structured Business Analyst output (Executive Summary, Business Successes, Customer
  -- Pain Points, ... — see app/lib/projects/prompts/productReview.ts's
  -- `BusinessAnalystProductReviewOutput`), kept verbatim alongside the denormalized columns
  -- above so no section of the AI's analysis is ever lost to the curated top-level projection.
  analysis jsonb,

  -- Future-ready per the sprint's own domain-model requirement — nothing writes to this yet.
  attachments jsonb not null default '[]',

  -- Sprint 82 polish — links this review to the `ProjectArtifact` holding the Business
  -- Analyst's generated report verbatim (`app/lib/projects/artifacts.ts`,
  -- `ARTIFACT_TYPES.PRODUCT_REVIEW_ANALYSIS`). Text, matching `ProjectArtifact.id`'s own
  -- application-minted string identity (`artifact-${Date.now()}-...`) and the SAME stable
  -- identity `builders_role_outputs.artifact_id` already uses to key its own upsert
  -- (`onConflict: 'artifact_id,version'`) — deliberately NOT a uuid FK to
  -- `builders_role_outputs.id` the way `builders_mvps.scope_artifact_id` is, since that id is
  -- per-version and this column only ever needs "which artifact," not "which version of it."
  -- Nullable: unset until `productReviewEngine.completeAnalysis` runs.
  artifact_id text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builders_product_reviews_project_id_idx on builders_product_reviews (project_id);
create index if not exists builders_product_reviews_mvp_id_idx on builders_product_reviews (mvp_id);
create index if not exists builders_product_reviews_project_status_idx on builders_product_reviews (project_id, status);

drop trigger if exists set_updated_at on builders_product_reviews;
create trigger set_updated_at before update on builders_product_reviews
  for each row execute function builders_set_updated_at();

-- RLS — same ownership-check helpers as builders_mvps/builders_features.
alter table builders_product_reviews enable row level security;

drop policy if exists "builders_product_reviews_select" on builders_product_reviews;
create policy "builders_product_reviews_select" on builders_product_reviews
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_product_reviews_write" on builders_product_reviews;
create policy "builders_product_reviews_write" on builders_product_reviews
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
