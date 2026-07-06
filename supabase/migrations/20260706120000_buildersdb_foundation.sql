-- BuildersDB Foundation — Sprint 34.
--
-- This is the schema that backs app/lib/builders-db/repositories/buildersDbRepository.ts.
-- It is the Builders PLATFORM's own control-plane database (see docs/buildersdb.md for
-- the distinction from the pre-existing, unrelated "generated app's Supabase" feature).
--
-- No previous sprint actually provisioned this schema anywhere in this repo — Sprint 33
-- ("BuildersDB Schema Foundation") was assumed complete but no SQL/migration artifact
-- existed to inspect, so this migration IS that schema, designed to mirror the existing
-- frontend data model (see app/lib/stores/projects.ts's `Project`, app/lib/projects/
-- artifacts.ts's `ProjectArtifact`, app/lib/projects/reviewEngine.ts's `TaskReviewRecord`/
-- `TaskHistoryEvent`) as closely as possible rather than inventing a new shape.
--
-- Run this against your BuildersDB Supabase project (via the SQL editor or
-- `supabase db push`) before setting BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY.
--
-- Auth is not implemented yet (see docs/buildersdb.md's "Future Auth" section) — every
-- `owner_id`/`user_id` column below is a nullable placeholder for a later sprint, and RLS
-- is deliberately permissive (anon-key read/write) so today's no-login app keeps working.
-- Tighten these policies when Sprint 35 (Builders Auth Foundation) lands.

-- ── builders_projects ───────────────────────────────────────────────────────
-- One row per Project (app/lib/stores/projects.ts's `Project`). Ids are kept as the
-- app's own `proj-<timestamp>-<random>` text ids rather than switched to uuid, so
-- existing locally-created project ids remain valid if ever migrated in.
create table if not exists builders_projects (
  id text primary key,
  name text not null,
  description text,
  icon text,
  color text,
  blueprint_id text,
  status text not null default 'active',
  owner_id text,
  -- Catch-all for fields not worth their own column yet: roadmapStatus, taskStatus,
  -- taskNotes, generationSession, githubRepo, supabaseProjectId, deploymentTarget,
  -- environmentVariables, members, templates, mcpServers, knowledgeBase, and the full
  -- projectKnowledge object. Keeping these denormalized avoids a much larger schema
  -- (and matching store rewrite) for fields nothing in this sprint needs to query on.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── builders_project_members ────────────────────────────────────────────────
-- Structural only — nothing writes to this table yet (see docs/buildersdb.md's "Future
-- Team Workspaces"). Exists now so Sprint 35 (Auth) doesn't need another migration to
-- introduce project-to-user membership.
create table if not exists builders_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  user_id text not null,
  role text,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- ── builders_ai_roles ────────────────────────────────────────────────────────
-- Static catalog of the AI Engineering Team roles (see
-- app/lib/projects/collaborationContext.ts's ROLE_ARTIFACT_CHAIN, the pipeline this
-- mirrors). Lets builders_role_outputs.role_key be a real foreign key instead of a
-- free-text column nothing validates.
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

-- ── builders_role_outputs ────────────────────────────────────────────────────
-- One row per ProjectArtifact (app/lib/projects/artifacts.ts). `role_key` reuses the
-- artifact's own `type` (already a stable ARTIFACT_TYPES value, e.g. 'backend-draft'),
-- which also happens to double as builders_ai_roles' primary key — no separate mapping
-- table needed. Multiple rows per (project_id, role_key) are expected — `version` is the
-- app's own regeneration counter, and the frontend already knows how to pick the latest
-- (see getLatestArtifact in artifacts.ts).
create table if not exists builders_role_outputs (
  id text primary key,
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text,
  role_key text references builders_ai_roles (role_key),
  role_name text,
  title text,
  status text not null default 'draft',
  content text,
  version int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builders_role_outputs_project_id_idx on builders_role_outputs (project_id);

-- ── builders_project_tasks ───────────────────────────────────────────────────
-- One row per (project, blueprint task id) — normalizes Project.taskStatus/taskNotes
-- (app/lib/stores/projects.ts) which are currently `Record<taskId, ...>` maps.
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

-- ── builders_task_reviews ────────────────────────────────────────────────────
-- Latest review verdict per (project, task) — mirrors Project.taskReview
-- (app/lib/projects/reviewEngine.ts's `TaskReviewRecord`). One row per task; a new
-- decision upserts over the previous one, matching how taskReview is already a
-- "current verdict" map rather than a history (task history lives in
-- builders_execution_logs below).
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

-- ── builders_execution_logs ──────────────────────────────────────────────────
-- Append-only lifecycle history — mirrors Project.taskHistory's
-- `TaskHistoryEvent[]` (app/lib/projects/reviewEngine.ts): started/paused/
-- submitted-for-review/approved/changes-requested, one row per event, never updated.
create table if not exists builders_execution_logs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  task_id text,
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists builders_execution_logs_project_id_idx on builders_execution_logs (project_id);

-- ── builders_project_activity ────────────────────────────────────────────────
-- Simple append-only activity feed (project created, role output saved, task
-- created/reviewed, execution started/completed, project deleted, ...). New in this
-- sprint — nothing in the existing frontend model tracks this today.
--
-- Deliberately `on delete set null`, unlike every other builders_* table above: an
-- activity feed is an audit trail, so the "project deleted" entry (and everything
-- before it) should survive the delete it's recording rather than being cascaded
-- away with it.
create table if not exists builders_project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id text references builders_projects (id) on delete set null,
  activity_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builders_project_activity_project_id_idx on builders_project_activity (project_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Permissive-by-design: no auth exists yet (see header comment). Every table is
-- readable/writable by the anon key so today's no-login app keeps working end to end.
-- Replace these with owner/member-scoped policies in the Sprint 35 auth follow-up.
alter table builders_projects enable row level security;
alter table builders_project_members enable row level security;
alter table builders_ai_roles enable row level security;
alter table builders_role_outputs enable row level security;
alter table builders_project_tasks enable row level security;
alter table builders_task_reviews enable row level security;
alter table builders_execution_logs enable row level security;
alter table builders_project_activity enable row level security;

create policy "builders_projects_anon_all" on builders_projects for all using (true) with check (true);
create policy "builders_project_members_anon_all" on builders_project_members for all using (true) with check (true);
create policy "builders_ai_roles_anon_all" on builders_ai_roles for all using (true) with check (true);
create policy "builders_role_outputs_anon_all" on builders_role_outputs for all using (true) with check (true);
create policy "builders_project_tasks_anon_all" on builders_project_tasks for all using (true) with check (true);
create policy "builders_task_reviews_anon_all" on builders_task_reviews for all using (true) with check (true);
create policy "builders_execution_logs_anon_all" on builders_execution_logs for all using (true) with check (true);
create policy "builders_project_activity_anon_all" on builders_project_activity for all using (true) with check (true);
