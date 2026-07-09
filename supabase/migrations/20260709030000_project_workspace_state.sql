-- Project Workspace State & Workspace Snapshot — Sprint 38.5 (revised).
--
-- Closes the one real gap found while auditing "why does reopening a project feel like
-- starting over": the generated application's file CONTENT was never persisted anywhere
-- durable (only its file PATHS were cached in localStorage, for stale-file cleanup on the
-- next generation — see app/lib/code-generation/webcontainerWriter.ts). Everything else
-- about a project (requirements, role outputs, product package, activity) already survives
-- a reload via the tables from 20260709010000_buildersdb_canonical_schema.sql.
--
-- builders_project_workspace_state: one row per project, the persisted answer to "what
-- state was this project last in" (see app/lib/projects/workspaceState.ts for the
-- `ProjectWorkspaceState` type this mirrors field-for-field).
--
-- builders_workspace_snapshots: the actual generated application's file content, so
-- "Continue Development" can re-materialize it into a freshly-booted WebContainer without
-- calling the LLM again. Revised from the original design (a `builders_generated_files`
-- table, one row per file) to ONE consolidated row per project with `files` as a JSONB
-- array — this is a pluggable `WorkspaceSnapshotProvider` implementation (see
-- app/lib/workspace-snapshot/), not BuildersDB's permanent role as a source-code store:
-- keeping the per-file surface down to a single JSONB blob column (rather than a
-- normalized files table) keeps BuildersDB metadata-oriented, and once GitHub push/pull
-- is real (`project.githubRepo`), a `githubSnapshotProvider.ts` implementing the same
-- interface can take over with zero changes to any caller. Same "replace on every
-- (re)generation" model as builders_product_packages either way — no version history
-- (role-output version history already covers "what did the AI produce", this is just
-- "what's currently on disk in the workspace").
--
-- Drops the never-released `builders_generated_files` table from the original design in
-- case it was already applied — safe no-op if it wasn't.
drop table if exists builders_generated_files cascade;

create table if not exists builders_project_workspace_state (
  project_id text primary key references builders_projects (id) on delete cascade,
  last_opened_section text,
  last_generation_status text not null default 'not-generated',
  last_generation_time timestamptz,
  last_preview_status text not null default 'not-available',
  generated_application_exists boolean not null default false,
  preview_available boolean not null default false,
  workbench_files_created boolean not null default false,
  last_active_engineer text,
  last_activity text,
  last_selected_tab text,
  current_stage text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists builders_workspace_snapshots (
  project_id text primary key references builders_projects (id) on delete cascade,
  files jsonb not null default '[]'::jsonb,
  file_count int not null default 0,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function builders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on builders_project_workspace_state;
create trigger set_updated_at before update on builders_project_workspace_state
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_workspace_snapshots;
create trigger set_updated_at before update on builders_workspace_snapshots
  for each row execute function builders_set_updated_at();

alter table builders_project_workspace_state enable row level security;
alter table builders_workspace_snapshots enable row level security;

drop policy if exists "builders_project_workspace_state_anon_all" on builders_project_workspace_state;
create policy "builders_project_workspace_state_anon_all" on builders_project_workspace_state for all using (true) with check (true);

drop policy if exists "builders_workspace_snapshots_anon_all" on builders_workspace_snapshots;
create policy "builders_workspace_snapshots_anon_all" on builders_workspace_snapshots for all using (true) with check (true);
