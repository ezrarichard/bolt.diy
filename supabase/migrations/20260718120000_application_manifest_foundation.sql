-- Application Manifest Foundation — Sprint 44.2 (Phase 1 of Incremental Application
-- Manifest, File Persistence, Resume, Cascade Deletion & Customer Supabase Export).
--
-- Adds `builders_application_manifests`/`builders_application_manifest_files`: the exact
-- planned file structure for a generated application, persisted BEFORE any AI file
-- generation call runs (see app/lib/application-manifest/manifestBuilder.ts and its
-- integration point in app/lib/code-generation/generationPipeline.ts's `onPlanReady`
-- hook). This is deliberately NOT the same object as `builders_product_packages`
-- (approved engineering documents) or `builders_workspace_snapshots` (the final,
-- whole-project file-content snapshot, unchanged by this migration and still the
-- resume/"Continue Development" source of truth until a later phase supersedes it).
--
-- Design notes:
--  - `project_id` is `text` everywhere, matching `builders_projects.id` (text primary
--    key) — NOT `uuid`, per this repo's existing convention (see
--    20260710100000_project_ownership_and_rls.sql's own header note on this exact point).
--  - Versioning follows `builders_role_outputs`' immutable-row-per-version shape: a new
--    manifest version is only inserted when the planned file structure's checksum
--    (`plan_checksum`) actually changed (see applicationManifestRepository.ts) — an
--    unchanged plan re-generation is a no-op, never a duplicate row. The previous
--    `status = 'active'` row is flipped to `'superseded'` rather than deleted, so manifest
--    history survives.
--  - `persistence_status`/`persistence_error` (Phase 1 spec requirement) are NOT columns
--    on this table: a FAILED persistence attempt never produces a row to record its own
--    failure in. That state instead lives on `builders_project_workspace_state` (this
--    migration's `alter table` below), mirroring the exact same pattern that table
--    already uses for `last_repair_status`/`last_error` (see
--    20260709050000_code_review_and_repair.sql) — and is also returned directly by
--    `saveApplicationManifest()`'s own `{ ok, error }` result type, which Phase 3 can
--    then make a hard precondition for resumable generation without any schema change.
--  - Idempotent (`if not exists`/`if exists` guards throughout), same conventions as every
--    other migration in this directory.

-- ── builders_application_manifests ────────────────────────────────────────
create table if not exists builders_application_manifests (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  version int not null,
  status text not null default 'active',
  source_package_version int,
  source_package_assembled_at timestamptz,
  framework text not null default 'react-vite-ts',
  package_manager text not null default 'npm',
  entry_file text not null default 'src/main.tsx',
  total_files int not null default 0,
  completed_files int not null default 0,
  failed_files int not null default 0,
  plan_checksum text not null,
  persisted_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, version)
);

create index if not exists builders_application_manifests_project_id_idx
  on builders_application_manifests (project_id);
create index if not exists builders_application_manifests_project_status_idx
  on builders_application_manifests (project_id, status);

-- ── builders_application_manifest_files ───────────────────────────────────
create table if not exists builders_application_manifest_files (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references builders_application_manifests (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,
  path text not null,
  file_type text,
  category text,
  component_name text,
  display_name text,
  generation_order int not null default 0,
  dependencies jsonb not null default '[]'::jsonb,
  required boolean not null default true,
  source_kind text not null,
  status text not null default 'pending',
  generation_attempts int not null default 0,
  checksum text,
  last_error text,
  generated_at timestamptz,
  validated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manifest_id, path)
);

create index if not exists builders_application_manifest_files_manifest_id_idx
  on builders_application_manifest_files (manifest_id);
create index if not exists builders_application_manifest_files_project_id_idx
  on builders_application_manifest_files (project_id);
create index if not exists builders_application_manifest_files_status_idx
  on builders_application_manifest_files (manifest_id, status);

-- ── builders_project_workspace_state — manifest tracking columns ─────────
-- Mirrors the existing repair_attempts/last_repair_status pattern (Sprint 39) — see
-- app/lib/projects/workspaceState.ts's ProjectWorkspaceState.manifestStatus/
-- manifestVersion/manifestPersistenceError.
alter table builders_project_workspace_state add column if not exists manifest_status text;
alter table builders_project_workspace_state add column if not exists manifest_version int;
alter table builders_project_workspace_state add column if not exists manifest_persistence_error text;

-- ── updated_at triggers (reuses builders_set_updated_at() from the canonical schema) ──
drop trigger if exists set_updated_at on builders_application_manifests;
create trigger set_updated_at before update on builders_application_manifests
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_application_manifest_files;
create trigger set_updated_at before update on builders_application_manifest_files
  for each row execute function builders_set_updated_at();

-- ── RLS — same ownership-check helpers as every other project-scoped table since
-- Sprint 42 (20260710100000_project_ownership_and_rls.sql); no interim permissive
-- "authenticated using (true)" stage, since those helpers already exist.
alter table builders_application_manifests enable row level security;
alter table builders_application_manifest_files enable row level security;

drop policy if exists "builders_application_manifests_select" on builders_application_manifests;
create policy "builders_application_manifests_select" on builders_application_manifests
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_application_manifests_write" on builders_application_manifests;
create policy "builders_application_manifests_write" on builders_application_manifests
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_application_manifest_files_select" on builders_application_manifest_files;
create policy "builders_application_manifest_files_select" on builders_application_manifest_files
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_application_manifest_files_write" on builders_application_manifest_files;
create policy "builders_application_manifest_files_write" on builders_application_manifest_files
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
