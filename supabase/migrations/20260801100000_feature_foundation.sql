-- Feature Foundation — Sprint 78 Phase 0 (Product Lifecycle & Backend Generation Architecture,
-- Sprints 77-78; see docs/product-lifecycle/Product-Lifecycle-Architecture.md §3 and
-- docs/backend-generation/Backend-Generation-Architecture.md's Phase 0 implementation roadmap).
--
-- Adds `builders_features`: the first-class, persisted counterpart to a Product Owner's
-- `CurrentMvpPlan.features` (ProductOwnerFeature[]), which today lives only inside a Product
-- Owner artifact's JSON `content` column (see 20260722100000_mvp_feature_identity.sql's header
-- comment, which deliberately deferred this). One row per Feature, owned by exactly one MVP —
-- mirrors `builders_mvps`/`builders_mvp_approvals`'s existing shape and defensive conventions
-- exactly (same RLS helper functions, same `updated_at` trigger, same free-text status column
-- convention used throughout this schema).
--
-- `(mvp_id, code)` is the natural/idempotency key: Gate A approval can be re-triggered (resume
-- after interruption, or a genuine re-approval after "changes requested"), and promotion must
-- upsert on this key rather than ever inserting a duplicate row for the same Feature under the
-- same MVP — see app/lib/features/featureRepository.ts's `promoteFeaturesForMvp`.
--
-- Purely additive: a new table, nothing existing references it, no other table/column is
-- altered. Idempotent throughout (`if not exists` guards), matching every other migration here.

create table if not exists builders_features (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,

  -- Immutable once set (application-layer contract — see featureRepository.ts's own comment):
  -- a Feature is never re-parented to a different MVP.
  mvp_id uuid not null references builders_mvps (id) on delete cascade,

  -- Permanent identifier (e.g. "FEAT-001") — the SAME id ProductOwnerFeature.id already mints,
  -- never re-minted here. Unique per MVP (not globally, and not per-project — a hypothetical
  -- future re-parenting concern doesn't apply since mvp_id is immutable in practice).
  code text not null,

  -- Feature Slice/Module ownership (Product Lifecycle Architecture §3 / Backend Generation
  -- Architecture §5, pulled forward as the minimum Phase 0 slice of Sprint 79 item 1 — see
  -- featureTypes.ts's `Feature.moduleSlug` comment). Nullable at the DB layer; the application
  -- layer always writes a value (defaulting to `code`) on insert, and `fromFeatureRow` falls back
  -- to `code` for any pre-existing row this default predates — never enforced NOT NULL here so a
  -- future backfill/rename never needs a blocking migration.
  module_slug text,

  title text not null,
  description text,

  -- Free text, matching this schema's existing convention of unconstrained status/priority
  -- columns validated at the application layer (see builders_mvps.status).
  priority text,
  depends_on text[] not null default '{}',
  customer_value text,

  -- 'planned' | 'in_progress' | 'generated' | 'qa_passed' | 'deployed' — see featureTypes.ts.
  status text not null default 'planned',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists builders_features_mvp_code_unique on builders_features (mvp_id, code);
create index if not exists builders_features_project_id_idx on builders_features (project_id);
create index if not exists builders_features_mvp_id_idx on builders_features (mvp_id);
create index if not exists builders_features_project_status_idx on builders_features (project_id, status);
create index if not exists builders_features_module_slug_idx on builders_features (mvp_id, module_slug);

drop trigger if exists set_updated_at on builders_features;
create trigger set_updated_at before update on builders_features
  for each row execute function builders_set_updated_at();

-- RLS — same ownership-check helpers as builders_mvps (20260720100000_mvp_foundation.sql).
alter table builders_features enable row level security;

drop policy if exists "builders_features_select" on builders_features;
create policy "builders_features_select" on builders_features
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_features_write" on builders_features;
create policy "builders_features_write" on builders_features
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
