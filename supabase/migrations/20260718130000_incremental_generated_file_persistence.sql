-- Incremental Generated Application File Persistence — Sprint 44.2, Phase 2.
--
-- Adds `builders_generated_application_files` (current lifecycle state of one planned
-- file — one row per `builders_application_manifest_files` row, see the Phase 1
-- migration 20260718120000_application_manifest_foundation.sql) and
-- `builders_generated_application_file_versions` (immutable content history for that
-- file — one row per actually-distinct checksum, never one per generation attempt: an
-- unchanged re-generation does NOT create a new version, see
-- app/lib/generated-files/generatedFilesRepository.ts's `persistGeneratedFile`).
--
-- Design notes:
--  - Two tables, not one, mirroring `builders_role_outputs`' own current-state-vs-history
--    split in spirit (that table folds both into one immutable-row-per-version table;
--    here the "current state" half is split out into its own table specifically so
--    Phase 3's resume logic can cheaply read ONE small row per file — status, latest
--    checksum, attempt count — without joining through full version history just to
--    decide whether a file needs regenerating).
--  - `project_id`/`manifest_id` are duplicated onto the versions table (not just reached
--    via `generated_file_id`) so RLS policies below can check project ownership directly
--    without a subquery through `builders_generated_application_files` — same
--    denormalization-for-RLS tradeoff `builders_product_package_files` already makes.
--  - `unique (manifest_file_id)` on `builders_generated_application_files` — this table
--    is a strict 1:1 companion to a manifest file row, never a history; `unique
--    (manifest_id, path)` is kept alongside it (redundant given the 1:1 with manifest
--    files, whose own paths are already unique per manifest) purely as a defensive
--    constraint matching the requested schema.
--  - project_id stays `text`, matching `builders_projects.id` — see the Phase 1
--    migration's own note on this.

-- ── builders_generated_application_files ──────────────────────────────────
create table if not exists builders_generated_application_files (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  manifest_id uuid not null references builders_application_manifests (id) on delete cascade,
  manifest_file_id uuid not null references builders_application_manifest_files (id) on delete cascade,
  path text not null,
  status text not null default 'pending',
  latest_version int not null default 0,
  latest_checksum text,
  validation_status text,
  generation_attempts int not null default 0,
  repair_count int not null default 0,
  last_error text,
  generated_by_role text,
  created_by text,
  generated_at timestamptz,
  validated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manifest_id, path),
  unique (manifest_file_id)
);

create index if not exists builders_generated_application_files_project_id_idx
  on builders_generated_application_files (project_id);
create index if not exists builders_generated_application_files_manifest_id_idx
  on builders_generated_application_files (manifest_id);
create index if not exists builders_generated_application_files_status_idx
  on builders_generated_application_files (manifest_id, status);

-- ── builders_generated_application_file_versions ──────────────────────────
create table if not exists builders_generated_application_file_versions (
  id uuid primary key default gen_random_uuid(),
  generated_file_id uuid not null references builders_generated_application_files (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,
  manifest_id uuid not null references builders_application_manifests (id) on delete cascade,
  version int not null,
  content text not null,
  checksum text not null,
  change_reason text not null,
  generation_source text not null,
  generation_attempt int,
  parent_version_id uuid references builders_generated_application_file_versions (id),
  created_by text,
  created_at timestamptz not null default now(),
  unique (generated_file_id, version)
);

create index if not exists builders_generated_application_file_versions_file_id_idx
  on builders_generated_application_file_versions (generated_file_id);
create index if not exists builders_generated_application_file_versions_project_id_idx
  on builders_generated_application_file_versions (project_id);

-- ── updated_at trigger (current-state table only — versions are immutable, no updates) ──
drop trigger if exists set_updated_at on builders_generated_application_files;
create trigger set_updated_at before update on builders_generated_application_files
  for each row execute function builders_set_updated_at();

-- ── RLS — same ownership-check helpers as every project-scoped table since Sprint 42 ──
alter table builders_generated_application_files enable row level security;
alter table builders_generated_application_file_versions enable row level security;

drop policy if exists "builders_generated_application_files_select" on builders_generated_application_files;
create policy "builders_generated_application_files_select" on builders_generated_application_files
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_generated_application_files_write" on builders_generated_application_files;
create policy "builders_generated_application_files_write" on builders_generated_application_files
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_generated_application_file_versions_select" on builders_generated_application_file_versions;
create policy "builders_generated_application_file_versions_select" on builders_generated_application_file_versions
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_generated_application_file_versions_write" on builders_generated_application_file_versions;
create policy "builders_generated_application_file_versions_write" on builders_generated_application_file_versions
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
