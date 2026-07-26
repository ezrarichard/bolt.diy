-- Deployment Foundation — Sprint 87 (Part 0 architecture review: the deployment domain gap).
--
-- Establishes the long-term deployment architecture BEFORE any GitHub/Supabase/Vercel API
-- integration is implemented (that starts Sprint 88+). Per the sprint brief: design around
-- Deployment, not around providers — every Builders Project owns exactly one Deployment, and
-- the Deployment owns each provider integration as a pluggable child, never the other way
-- around. No future provider (GitLab, Firebase, Netlify, Cloudflare, ...) requires redesigning
-- this schema — it only requires a new child table + repository + adapter, the same shape
-- `builders_deployment_github`/`builders_deployment_supabase`/`builders_deployment_vercel`
-- already establish.
--
-- Purely additive, same as every other domain-foundation migration in this directory
-- (`mvp_foundation.sql`, `product_review_foundation.sql`, ...): five new tables, nothing
-- existing references them, no existing table/column is altered or removed. Idempotent
-- throughout (`if not exists` / `drop ... if exists` guards).
--
-- Shape:
--   builders_project_deployments  — the parent. Exactly one per project (unique `project_id`).
--   builders_deployment_github    — GitHub repo connection. Exactly one per deployment.
--   builders_deployment_supabase  — Supabase project connection. Exactly one per deployment.
--   builders_deployment_vercel    — Vercel project connection. Exactly one per deployment.
--   builders_deployment_history   — append-only event log, many rows per deployment (mirrors
--                                    `builders_blueprint_resolutions`'s append-only convention).
--
-- `status` on `builders_project_deployments` is free text, validated only at the application
-- layer (`app/lib/deployment/lifecycleTransitions.ts`'s `isValidDeploymentStatusTransition`) —
-- matching this schema's existing convention for every other lifecycle field
-- (`builders_mvps.status`, `builders_product_reviews.status`), never a DB enum or check
-- constraint. Same for each provider table's own `status` (its per-provider connection state:
-- `pending | connected | error`), which is deliberately independent of the parent Deployment's
-- overall lifecycle status.
--
-- Every provider table carries `project_id` directly (denormalized, not just reachable via
-- `deployment_id`), matching `builders_application_manifest_files`' existing convention of
-- denormalizing the project FK onto child rows for direct RLS/query access without a join.

-- ── builders_project_deployments ────────────────────────────────────────────
-- The parent entity. One row per project — `unique (project_id)` enforces the "exactly one
-- Deployment per Project" rule from the sprint brief at the schema level, not just by
-- application convention.
create table if not exists builders_project_deployments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,

  -- 'planning' | 'engineering' | 'generated' | 'repository_connected' | 'database_connected' |
  -- 'environment_ready' | 'deploying' | 'deployed' | 'verified' | 'released' | 'maintenance' |
  -- 'archived' | 'failed' — see app/lib/deployment/lifecycleTransitions.ts, the one place this
  -- is validated.
  status text not null default 'planning',

  -- 'production' | 'staging' | 'preview' — which environment this Deployment targets. Kept as a
  -- plain column rather than a separate table: Sprint 87 explicitly says "do not over-engineer,"
  -- and nothing yet needs more than one environment per deployment.
  environment text not null default 'production',

  last_error text,
  metadata jsonb not null default '{}'::jsonb,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  released_at timestamptz,
  archived_at timestamptz,

  unique (project_id)
);

create index if not exists builders_project_deployments_project_id_idx
  on builders_project_deployments (project_id);
create index if not exists builders_project_deployments_status_idx
  on builders_project_deployments (status);

drop trigger if exists set_updated_at on builders_project_deployments;
create trigger set_updated_at before update on builders_project_deployments
  for each row execute function builders_set_updated_at();

alter table builders_project_deployments enable row level security;

drop policy if exists "builders_project_deployments_select" on builders_project_deployments;
create policy "builders_project_deployments_select" on builders_project_deployments
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_project_deployments_write" on builders_project_deployments;
create policy "builders_project_deployments_write" on builders_project_deployments
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_deployment_github ──────────────────────────────────────────────
-- Exactly one GitHub connection per Deployment (`unique (deployment_id)`). No GitHub API call is
-- made by this migration or by Sprint 87's application code — this table only persists
-- connection state once a future sprint's integration populates it.
create table if not exists builders_deployment_github (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  repo_owner text,
  repo_name text,
  repo_full_name text,
  repo_url text,
  default_branch text not null default 'main',
  visibility text not null default 'private',

  -- 'pending' | 'connected' | 'error' — this provider row's own connection state, independent
  -- of the parent Deployment's overall lifecycle `status`.
  status text not null default 'pending',
  last_error text,
  connected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deployment_id)
);

create index if not exists builders_deployment_github_project_id_idx
  on builders_deployment_github (project_id);
create index if not exists builders_deployment_github_deployment_id_idx
  on builders_deployment_github (deployment_id);

drop trigger if exists set_updated_at on builders_deployment_github;
create trigger set_updated_at before update on builders_deployment_github
  for each row execute function builders_set_updated_at();

alter table builders_deployment_github enable row level security;

drop policy if exists "builders_deployment_github_select" on builders_deployment_github;
create policy "builders_deployment_github_select" on builders_deployment_github
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_deployment_github_write" on builders_deployment_github;
create policy "builders_deployment_github_write" on builders_deployment_github
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_deployment_supabase ─────────────────────────────────────────────
-- Exactly one Supabase connection per Deployment. Unrelated to BuildersDB's own Supabase
-- project — this is the CUSTOMER project's generated-application database, matching the
-- distinction Sprint 75/76's provisioning work already established.
create table if not exists builders_deployment_supabase (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  supabase_project_ref text,
  supabase_project_url text,
  region text,

  status text not null default 'pending',
  last_error text,
  connected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deployment_id)
);

create index if not exists builders_deployment_supabase_project_id_idx
  on builders_deployment_supabase (project_id);
create index if not exists builders_deployment_supabase_deployment_id_idx
  on builders_deployment_supabase (deployment_id);

drop trigger if exists set_updated_at on builders_deployment_supabase;
create trigger set_updated_at before update on builders_deployment_supabase
  for each row execute function builders_set_updated_at();

alter table builders_deployment_supabase enable row level security;

drop policy if exists "builders_deployment_supabase_select" on builders_deployment_supabase;
create policy "builders_deployment_supabase_select" on builders_deployment_supabase
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_deployment_supabase_write" on builders_deployment_supabase;
create policy "builders_deployment_supabase_write" on builders_deployment_supabase
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_deployment_vercel ───────────────────────────────────────────────
-- Exactly one Vercel connection per Deployment.
create table if not exists builders_deployment_vercel (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  vercel_project_id text,
  vercel_project_name text,
  production_url text,

  status text not null default 'pending',
  last_error text,
  connected_at timestamptz,
  last_deployed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deployment_id)
);

create index if not exists builders_deployment_vercel_project_id_idx
  on builders_deployment_vercel (project_id);
create index if not exists builders_deployment_vercel_deployment_id_idx
  on builders_deployment_vercel (deployment_id);

drop trigger if exists set_updated_at on builders_deployment_vercel;
create trigger set_updated_at before update on builders_deployment_vercel
  for each row execute function builders_set_updated_at();

alter table builders_deployment_vercel enable row level security;

drop policy if exists "builders_deployment_vercel_select" on builders_deployment_vercel;
create policy "builders_deployment_vercel_select" on builders_deployment_vercel
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_deployment_vercel_write" on builders_deployment_vercel;
create policy "builders_deployment_vercel_write" on builders_deployment_vercel
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_deployment_history ──────────────────────────────────────────────
-- Append-only event log — mirrors `builders_blueprint_resolutions`' append-only convention (see
-- that migration's header comment). No `updated_at`/trigger: a history row is never modified
-- after it is written. Many rows per deployment (status transitions, provider attach/detach
-- events, freeform notes) — no unique constraint on `deployment_id`.
create table if not exists builders_deployment_history (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  -- 'status_changed' | 'github_connected' | 'supabase_connected' | 'vercel_connected' | 'note'
  -- — free text, this schema's existing convention for unconstrained type columns.
  event_type text not null,

  -- Populated only for 'status_changed' events; null otherwise.
  from_status text,
  to_status text,

  -- 'github' | 'supabase' | 'vercel' | null — which provider this event concerns, if any.
  provider text,

  message text,
  metadata jsonb not null default '{}'::jsonb,

  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists builders_deployment_history_project_id_idx
  on builders_deployment_history (project_id);
create index if not exists builders_deployment_history_deployment_id_idx
  on builders_deployment_history (deployment_id, created_at);

alter table builders_deployment_history enable row level security;

drop policy if exists "builders_deployment_history_select" on builders_deployment_history;
create policy "builders_deployment_history_select" on builders_deployment_history
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_deployment_history_write" on builders_deployment_history;
create policy "builders_deployment_history_write" on builders_deployment_history
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
