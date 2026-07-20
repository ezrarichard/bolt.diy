-- MVP Foundation — Sprint 45 (Builders Software Factory, Phase 1 of the MVP-first
-- migration; see docs/04-Roadmap/01-phased-migration-plan.md).
--
-- Adds `builders_mvps`/`builders_mvp_approvals` and threads an optional `mvp_id` through
-- the existing engineering/generation/activity tables, per
-- docs/02-Architecture/06-mvp-as-core-object.md and
-- docs/02-Architecture/04-buildersdb-future-schema.md.
--
-- This migration is purely additive and introduces ZERO behavior change to the running
-- application:
--  - `builders_mvps`/`builders_mvp_approvals` are new tables; nothing existing references
--    them, and no application code in this sprint writes to them from any user-facing flow.
--  - `mvp_id` on `builders_role_outputs` / `builders_application_manifests` /
--    `builders_project_activity` is NULLABLE. Every existing row, and every row the
--    current application code writes today (which never sets this column), remains
--    valid. Per the architecture docs, `mvp_id` is expected to become NOT NULL for
--    Architecture-or-later role outputs and for every generation manifest only once the
--    AI Product Owner role ships and begins populating it (Sprint 46+) — that constraint
--    is deliberately NOT added by this migration; adding it now would break every
--    existing project.
--  - `builders_ai_roles.phase` defaults every existing role row to `'engineering'` via
--    the column default, so no backfill statement is needed and no existing query
--    against this table changes behavior.
--
-- No existing table's ownership, RLS policy, or column is altered or removed. Existing
-- projects, generation, dashboard, history, reviews, and activity continue to read/write
-- exactly as they do today, entirely unaware these new columns/tables exist, until a
-- future sprint's application code starts populating them.
--
-- Idempotent throughout (`if not exists` / `drop ... if exists` guards), matching every
-- other migration in this directory.

-- ── builders_mvps ─────────────────────────────────────────────────────────
-- One row per MVP within a project. `sequence` is the MVP's position in the roadmap (1,
-- 2, 3, ...). `scope_artifact_id` will point at the AI Product Owner's MVP Scope
-- Definition role-output row once that role exists (Sprint 46) — nullable here because
-- nothing populates it yet. `status` is free text (`planned | scoped | generating |
-- ready_for_review | approved | superseded`), matching this codebase's existing
-- convention of unconstrained status columns validated at the application layer (see
-- builders_application_manifest_files.status, builders_role_outputs.status).
create table if not exists builders_mvps (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  sequence int not null,
  theme text,
  status text not null default 'planned',
  scope_artifact_id uuid references builders_role_outputs (id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (project_id, sequence)
);

create index if not exists builders_mvps_project_id_idx on builders_mvps (project_id);
create index if not exists builders_mvps_project_status_idx on builders_mvps (project_id, status);

-- ── builders_mvp_approvals ───────────────────────────────────────────────
-- Append-only customer review history at MVP granularity — the MVP-level equivalent of
-- builders_task_reviews (see docs/03-Development/01-human-approval-philosophy.md). An
-- MVP can be reviewed more than once (e.g. "changes requested", then later "approved"),
-- so this is a history table (one row per decision), not an upsert-on-conflict table
-- like builders_task_reviews.
create table if not exists builders_mvp_approvals (
  id uuid primary key default gen_random_uuid(),
  mvp_id uuid not null references builders_mvps (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,
  decision text not null,
  notes text,
  decided_by text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists builders_mvp_approvals_mvp_id_idx on builders_mvp_approvals (mvp_id);
create index if not exists builders_mvp_approvals_project_id_idx on builders_mvp_approvals (project_id);

-- ── Optional mvp_id on existing tables ────────────────────────────────────
-- Nullable throughout this migration. Project-level artifact types (Requirements,
-- Product Vision) are never expected to set this, even after Sprint 46 — they remain
-- project-scoped by design. Architecture-or-later role outputs and every generation
-- manifest are expected to start setting it from Sprint 46 onward.
alter table builders_role_outputs add column if not exists mvp_id uuid references builders_mvps (id) on delete set null;
alter table builders_application_manifests add column if not exists mvp_id uuid references builders_mvps (id) on delete set null;
alter table builders_project_activity add column if not exists mvp_id uuid references builders_mvps (id) on delete set null;

create index if not exists builders_role_outputs_mvp_id_idx on builders_role_outputs (mvp_id);
create index if not exists builders_application_manifests_mvp_id_idx on builders_application_manifests (mvp_id);
create index if not exists builders_project_activity_mvp_id_idx on builders_project_activity (mvp_id);

-- ── builders_ai_roles.phase ───────────────────────────────────────────────
-- Distinguishes Product Planning roles (the future AI Product Owner) from Engineering
-- roles (the existing 8) at the data layer, per docs/02-Architecture/02-ai-product-owner.md.
-- Every existing row defaults to 'engineering' via the column default below, so this is
-- safe to add without any backfill statement.
alter table builders_ai_roles add column if not exists phase text not null default 'engineering';

-- ── updated_at trigger (reuses builders_set_updated_at() from the canonical schema) ──
drop trigger if exists set_updated_at on builders_mvps;
create trigger set_updated_at before update on builders_mvps
  for each row execute function builders_set_updated_at();

-- ── RLS — same ownership-check helpers as every project-scoped table since Sprint 42
-- (see 20260710100000_project_ownership_and_rls.sql and
-- 20260718120000_application_manifest_foundation.sql for the identical pattern).
alter table builders_mvps enable row level security;
alter table builders_mvp_approvals enable row level security;

drop policy if exists "builders_mvps_select" on builders_mvps;
create policy "builders_mvps_select" on builders_mvps
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_mvps_write" on builders_mvps;
create policy "builders_mvps_write" on builders_mvps
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_mvp_approvals_select" on builders_mvp_approvals;
create policy "builders_mvp_approvals_select" on builders_mvp_approvals
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_mvp_approvals_write" on builders_mvp_approvals;
create policy "builders_mvp_approvals_write" on builders_mvp_approvals
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
