-- Code Review & Self-Healing Engine — Sprint 39.
--
-- Adds three new AI Engineering Team roles (Code Reviewer, Repair Engineer, Build
-- Validator — see app/lib/code-review/) to the existing builders_ai_roles catalog
-- (supabase/migrations/20260709010000_buildersdb_canonical_schema.sql), plus two new
-- tables: builders_validation_runs (one row per validator execution, pass or fail — every
-- generation's validation history, not just the ones that needed a repair) and
-- builders_code_repair_attempts (one row per AI repair attempt). Idempotent, same
-- conventions as every other migration in this directory.

-- Sprint 39 additions to builders_project_workspace_state (20260709030000) — mirrors the
-- two new fields on ProjectWorkspaceState (app/lib/projects/workspaceState.ts).
alter table builders_project_workspace_state add column if not exists repair_attempts int not null default 0;
alter table builders_project_workspace_state add column if not exists last_repair_status text;

insert into builders_ai_roles (role_key, role_name, pipeline_order) values
  ('code-reviewer', 'Code Reviewer', 9),
  ('repair-engineer', 'Repair Engineer', 10),
  ('build-validator', 'Build Validator', 11)
on conflict (role_key) do nothing;

-- ── builders_validation_runs ──────────────────────────────────────────────
-- One row per validator execution (see app/lib/code-review/codeValidator.ts's
-- ValidatorDefinition registry) — persisted whether it passed or failed, so later analysis
-- can answer "which validators fail most" without only having repair rows to look at.
create table if not exists builders_validation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  attempt_number int not null,
  validator_id text not null,
  validator_label text not null,
  stage text not null,
  role_key text references builders_ai_roles (role_key),
  status text not null,
  issue_count int not null default 0,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builders_validation_runs_project_id_idx on builders_validation_runs (project_id);

-- ── builders_code_repair_attempts ─────────────────────────────────────────
-- One row per AI repair attempt (static review repair or build/install repair — see
-- app/lib/code-review/repairEngine.ts). `patch_signature` is a cheap hash of
-- stage+validator_id+error_message, stored so a future sprint can look up and reuse a
-- previously-successful patch by signature instead of always calling the LLM — the lookup
-- itself is not implemented this sprint.
create table if not exists builders_code_repair_attempts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  attempt_number int not null,
  stage text not null,
  validator_id text not null,
  role_key text references builders_ai_roles (role_key),
  error_type text,
  error_message text,
  affected_files jsonb not null default '[]'::jsonb,
  patch_summary text,
  files_created jsonb not null default '[]'::jsonb,
  files_updated jsonb not null default '[]'::jsonb,
  files_deleted jsonb not null default '[]'::jsonb,
  status text not null,
  model_used text,
  patch_signature text,
  created_at timestamptz not null default now()
);

create index if not exists builders_code_repair_attempts_project_id_idx on builders_code_repair_attempts (project_id);
create index if not exists builders_code_repair_attempts_signature_idx on builders_code_repair_attempts (patch_signature);

alter table builders_validation_runs enable row level security;
alter table builders_code_repair_attempts enable row level security;

drop policy if exists "builders_validation_runs_anon_all" on builders_validation_runs;
create policy "builders_validation_runs_anon_all" on builders_validation_runs for all using (true) with check (true);

drop policy if exists "builders_code_repair_attempts_anon_all" on builders_code_repair_attempts;
create policy "builders_code_repair_attempts_anon_all" on builders_code_repair_attempts for all using (true) with check (true);
