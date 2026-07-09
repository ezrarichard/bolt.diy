-- BuildersDB Canonical Schema — Sprint 38.3.
--
-- Single, complete initializer for an empty BuildersDB Supabase project. Supersedes and
-- replaces every prior migration (20260706120000_buildersdb_foundation.sql,
-- 20260707090000_sprint36_knowledge_memory.sql, 20260707150000_sprint37_product_assembly.sql,
-- 20260709000000_consolidated_idempotent_repair.sql — all deleted; do not reintroduce them).
--
-- Derived directly from the CURRENT code, not from those old migration files: every table,
-- column, index, and upsert conflict target below was cross-checked against the actual
-- `.from(...)`/`.insert(...)`/`.update(...)`/`.upsert(...)`/`.select(...)` calls in
--   - app/lib/builders-db/repositories/buildersDbRepository.ts (projects, role outputs,
--     tasks, task reviews, execution logs, activity, context traces)
--   - app/lib/product-assembly/assemblyRepository.ts (product packages, package files)
--   - app/lib/builders-db/buildersDbTypes.ts (the BuildersDb*Row types those two files
--     serialize to/from)
--   - app/lib/builders-db/client.ts (the connectivity check's own `builders_projects` query)
-- These are confirmed (via grep) to be the ONLY files in the codebase that touch a
-- `builders_*` table — every other caller goes through their exported functions, so this
-- schema is exhaustive relative to what the application actually reads and writes today.
--
-- Every statement is idempotent (safe to run more than once against the same project):
-- `create extension/table/index if not exists`, `create or replace function`, and
-- `drop trigger/policy if exists` immediately before `create trigger/policy` (Postgres has
-- no `create policy/trigger if not exists`).
--
-- Auth is not implemented yet — every RLS policy is a permissive anon-key policy (`using
-- (true) with check (true)`), matching every prior migration's stated intent. Tighten these
-- once real auth lands; every `owner_id`/`user_id` column is a nullable placeholder for that
-- future work.

-- ── Extensions ────────────────────────────────────────────────────────────
-- gen_random_uuid(), used as the default for every uuid primary key below.
create extension if not exists pgcrypto;

-- ── builders_projects ────────────────────────────────────────────────────
-- One row per Project (app/lib/stores/projects.ts's `Project`). Ids are the app's own
-- `proj-<timestamp>-<random>` text ids, not uuids, so existing locally-created project ids
-- stay valid if ever migrated in. `metadata` folds every Project field that isn't a real
-- column here (roadmapStatus, taskStatus, taskNotes, generationSession, githubRepo,
-- supabaseProjectId, deploymentTarget, environmentVariables, members, templates,
-- mcpServers, knowledgeBase, projectKnowledge — see toProjectRow()/fromProjectRow() in
-- buildersDbTypes.ts, the only place this mapping is defined).
create table if not exists builders_projects (
  id text primary key,
  name text not null,
  description text,
  icon text,
  color text,
  blueprint_id text,
  status text not null default 'active',
  owner_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── builders_project_members ─────────────────────────────────────────────
-- Structural only — nothing in the current code writes to this table yet (no future-team
-- feature exists today). Kept so a later auth/team sprint doesn't need its own migration
-- for project-to-user membership.
create table if not exists builders_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  user_id text not null,
  role text,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- ── builders_ai_roles ─────────────────────────────────────────────────────
-- Static catalog of the AI Engineering Team roles. Lets builders_role_outputs.role_key be a
-- real foreign key instead of an unvalidated free-text column.
create table if not exists builders_ai_roles (
  role_key text primary key,
  role_name text not null,
  pipeline_order int not null
);

insert into builders_ai_roles (role_key, role_name, pipeline_order) values
  ('requirements-draft', 'Business Analyst', 1),
  ('architecture-draft', 'Solution Architect', 2),
  ('database-draft', 'Database Engineer', 3),
  ('uiux-draft', 'UX Engineer', 4),
  ('backend-draft', 'Backend Engineer', 5),
  ('frontend-draft', 'Frontend Engineer', 6),
  ('qa-draft', 'QA Engineer', 7),
  ('devops-draft', 'DevOps Engineer', 8)
on conflict (role_key) do nothing;

-- ── builders_role_outputs ────────────────────────────────────────────────
-- One row per role output VERSION (app/lib/projects/artifacts.ts's `ProjectArtifact`).
-- `id` is a surrogate uuid; `artifact_id` is the frontend's own stable artifact id, constant
-- across every regenerate of the same role output. createOrUpdateRoleOutput()
-- (buildersDbRepository.ts) upserts on the `(artifact_id, version)` unique constraint below:
-- a status-only change to an already-persisted version (e.g. approving it) updates that row
-- in place; a genuine version bump inserts a new row, so every earlier version survives —
-- this table IS the version history, not a mirror of a single "current" value.
-- `generation_type` ('manual' | 'automatic') and `parent_version_id` (the immediately-prior
-- version's row id, if any) are read/written exactly as named in BuildersDbRoleOutputRow.
create table if not exists builders_role_outputs (
  id uuid primary key default gen_random_uuid(),
  artifact_id text not null,
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text,
  role_key text references builders_ai_roles (role_key),
  role_name text,
  title text,
  status text not null default 'draft',
  content text,
  version int,
  generation_type text not null default 'manual',
  parent_version_id uuid references builders_role_outputs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artifact_id, version)
);

create index if not exists builders_role_outputs_project_id_idx on builders_role_outputs (project_id);
create index if not exists builders_role_outputs_artifact_id_idx on builders_role_outputs (artifact_id);
create index if not exists builders_role_outputs_project_role_version_idx on builders_role_outputs (project_id, role_key, version);

-- ── builders_project_tasks ───────────────────────────────────────────────
-- One row per (project, blueprint task id) — normalizes Project.taskStatus/taskNotes.
-- upsertProjectTask() (buildersDbRepository.ts) upserts on `(project_id, task_id)` below.
create table if not exists builders_project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text not null,
  status text not null default 'not-started',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, task_id)
);

create index if not exists builders_project_tasks_project_id_idx on builders_project_tasks (project_id);

-- ── builders_task_reviews ────────────────────────────────────────────────
-- Latest review verdict per (project, task) — one row per task, a new decision upserts over
-- the previous one (task HISTORY, as opposed to the current verdict, lives in
-- builders_execution_logs below). upsertTaskReview() upserts on `(project_id, task_id)`.
-- No `updated_at` column: `reviewed_at` (set by the caller on every upsert) already serves
-- that purpose, matching BuildersDbTaskReviewRow exactly (no updated_at field there either).
create table if not exists builders_task_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text not null,
  review_status text not null,
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, task_id)
);

create index if not exists builders_task_reviews_project_id_idx on builders_task_reviews (project_id);

-- ── builders_execution_logs ──────────────────────────────────────────────
-- Append-only task lifecycle history (started/paused/submitted-for-review/approved/
-- changes-requested) — one row per event, never updated. createExecutionLog() only inserts.
create table if not exists builders_execution_logs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text,
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists builders_execution_logs_project_id_idx on builders_execution_logs (project_id);

-- ── builders_project_activity ────────────────────────────────────────────
-- Append-only activity feed (project created, role output saved, task created/reviewed,
-- product package assembled, generation started/failed, ...). Deliberately `on delete set
-- null`, unlike every other builders_* table: this is an audit trail, so the "project
-- deleted" entry (and everything before it) survives the delete it's recording.
create table if not exists builders_project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id text references builders_projects (id) on delete set null,
  activity_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builders_project_activity_project_id_idx on builders_project_activity (project_id);

-- ── builders_context_traces ──────────────────────────────────────────────
-- One row per context block built for a role (buildRoleContextBlock in
-- app/lib/ai/context/buildersDbContextProvider.ts) — which prior role outputs/tasks/the
-- original prompt fed into it. `sources` is a denormalized JSONB array of entries shaped
-- like `{ type, label, roleKey?, version? }` (see ContextTraceSource in buildersDbTypes.ts).
create table if not exists builders_context_traces (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  role_key text not null,
  role_output_id uuid references builders_role_outputs (id) on delete set null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builders_context_traces_project_role_idx on builders_context_traces (project_id, role_key);

-- ── builders_product_packages / builders_product_package_files ──────────
-- One project has at most one "current" Product Package: saveProductPackage()
-- (assemblyRepository.ts) deletes the previous package row (cascading to its files via the
-- package_id foreign key below) and inserts a fresh one on every re-assembly, rather than
-- keeping a history — role-output version history is already covered by
-- builders_role_outputs above, so this table is just "the latest assembled snapshot".
create table if not exists builders_product_packages (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  assembled_at timestamptz not null default now(),
  missing_sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists builders_product_packages_project_id_unique on builders_product_packages (project_id);

-- `project_id` is duplicated here (not just reachable via package_id -> builders_product_packages.project_id)
-- because listProductPackageFiles() (assemblyRepository.ts) filters directly on this
-- table's own project_id column, without joining through the package row.
create table if not exists builders_product_package_files (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references builders_product_packages (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,
  section text not null,
  path text not null,
  filename text not null,
  title text not null,
  content text not null,
  source_role text,
  source_artifact_id text,
  source_version int,
  source_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builders_product_package_files_package_id_idx on builders_product_package_files (package_id);
create index if not exists builders_product_package_files_project_id_idx on builders_product_package_files (project_id);

-- ── Triggers ──────────────────────────────────────────────────────────────
-- Defensive only: every `updated_at` write in the application code already sets it
-- explicitly on every insert/update (see toProjectRow(), toRoleOutputRow(), toFileRow(),
-- upsertProjectTask() — all of buildersDbRepository.ts/assemblyRepository.ts set it
-- themselves), so this trigger never overrides app-supplied values with an earlier
-- timestamp, it only protects against a future write path that forgets to. Applied only to
-- tables that actually have both created_at and updated_at columns.
create or replace function builders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on builders_projects;
create trigger set_updated_at before update on builders_projects
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_role_outputs;
create trigger set_updated_at before update on builders_role_outputs
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_project_tasks;
create trigger set_updated_at before update on builders_project_tasks
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_product_package_files;
create trigger set_updated_at before update on builders_product_package_files
  for each row execute function builders_set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────
-- Permissive-by-design: no auth exists yet (see header comment). Every table is
-- readable/writable by the anon key so today's no-login app works end to end.
alter table builders_projects enable row level security;
alter table builders_project_members enable row level security;
alter table builders_ai_roles enable row level security;
alter table builders_role_outputs enable row level security;
alter table builders_project_tasks enable row level security;
alter table builders_task_reviews enable row level security;
alter table builders_execution_logs enable row level security;
alter table builders_project_activity enable row level security;
alter table builders_context_traces enable row level security;
alter table builders_product_packages enable row level security;
alter table builders_product_package_files enable row level security;

drop policy if exists "builders_projects_anon_all" on builders_projects;
create policy "builders_projects_anon_all" on builders_projects for all using (true) with check (true);

drop policy if exists "builders_project_members_anon_all" on builders_project_members;
create policy "builders_project_members_anon_all" on builders_project_members for all using (true) with check (true);

drop policy if exists "builders_ai_roles_anon_all" on builders_ai_roles;
create policy "builders_ai_roles_anon_all" on builders_ai_roles for all using (true) with check (true);

drop policy if exists "builders_role_outputs_anon_all" on builders_role_outputs;
create policy "builders_role_outputs_anon_all" on builders_role_outputs for all using (true) with check (true);

drop policy if exists "builders_project_tasks_anon_all" on builders_project_tasks;
create policy "builders_project_tasks_anon_all" on builders_project_tasks for all using (true) with check (true);

drop policy if exists "builders_task_reviews_anon_all" on builders_task_reviews;
create policy "builders_task_reviews_anon_all" on builders_task_reviews for all using (true) with check (true);

drop policy if exists "builders_execution_logs_anon_all" on builders_execution_logs;
create policy "builders_execution_logs_anon_all" on builders_execution_logs for all using (true) with check (true);

drop policy if exists "builders_project_activity_anon_all" on builders_project_activity;
create policy "builders_project_activity_anon_all" on builders_project_activity for all using (true) with check (true);

drop policy if exists "builders_context_traces_anon_all" on builders_context_traces;
create policy "builders_context_traces_anon_all" on builders_context_traces for all using (true) with check (true);

drop policy if exists "builders_product_packages_anon_all" on builders_product_packages;
create policy "builders_product_packages_anon_all" on builders_product_packages for all using (true) with check (true);

drop policy if exists "builders_product_package_files_anon_all" on builders_product_package_files;
create policy "builders_product_package_files_anon_all" on builders_product_package_files for all using (true) with check (true);
