-- Sprint 37 — AI Product Assembly Engine.
--
-- Persists the assembled Product Package (app/lib/product-assembly/productAssembler.ts)
-- so it survives a refresh/session restart, same spirit as every other builders_* table.
-- Assembly itself always works from the in-memory Project regardless of whether this
-- schema has been applied — these tables are a best-effort persistence layer, not a
-- precondition for assembling (see app/lib/product-assembly/assemblyRepository.ts).
--
-- One project has at most one "current" package: re-assembling deletes the previous
-- package row (cascading to its files) and inserts a fresh one, rather than keeping a
-- history of past assemblies — Sprint 36 already owns version history for individual
-- role outputs; this table is just "the latest assembled snapshot", kept simple per the
-- sprint's own "keep schema simple" guidance.

create table if not exists builders_product_packages (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  assembled_at timestamptz not null default now(),
  missing_sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists builders_product_packages_project_id_unique on builders_product_packages (project_id);

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

alter table builders_product_packages enable row level security;
alter table builders_product_package_files enable row level security;

create policy "builders_product_packages_anon_all" on builders_product_packages for all using (true) with check (true);
create policy "builders_product_package_files_anon_all" on builders_product_package_files for all using (true) with check (true);
