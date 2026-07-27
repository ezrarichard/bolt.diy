-- Incremental AI Execution & Scoped Engineering — Sprint 97.
--
-- Persists the EXECUTION of a Sprint 96 incremental engineering plan: the approved role selection
-- (with the operator's overrides kept separate from the machine's recommendation), one row per
-- role attempt with the scoped context it was actually given and the incremental artifact it
-- produced, the downstream invalidation decisions, and any impact a role discovered outside scope.
--
-- Purely additive: four new tables, no new functions. No existing table, column, policy, trigger or
-- function is altered. Idempotent throughout.
--
-- WHAT THIS MIGRATION DOES NOT DO, structurally rather than by convention:
--   * It never writes to builders_role_outputs. An incremental role output lives in
--     builders_incremental_role_runs and links to the released artifact it would supersede. The
--     released engineering artifacts stay authoritative, because Sprint 97 generates no code and
--     cuts no release — see app/lib/evolution/incrementalExecutionTypes.ts's IncrementalArtifact.
--   * It has no write path to builders_application_manifests, builders_releases or
--     builders_project_deployments. A released product stays `released` while executions accumulate.
--   * Nothing here deletes or re-approves an existing artifact. Invalidation is a RECORDED
--     JUDGEMENT (builders_incremental_invalidations), not an action on the artifact itself.
--
-- HISTORY (Part 15) — DOCUMENTED DECISION. Execution-level events
-- (incremental_execution_started/paused/completed/cancelled, scope_expansion_requested/approved/
-- rejected) go to the existing builders_deployment_history, the project-wide lifecycle log. ROLE-
-- LEVEL events (incremental_role_started/completed/failed) do NOT: a nine-role execution would add
-- up to 27 rows to a timeline a human reads to understand the product's life, and the same
-- information is already first-class and queryable in builders_incremental_role_runs (status,
-- started_at, completed_at, attempt, failure). The role runs table IS the execution audit log.

-- ── builders_incremental_executions ─────────────────────────────────────────
create table if not exists builders_incremental_executions (
  id uuid primary key default gen_random_uuid(),

  engineering_plan_id uuid not null
    references builders_incremental_engineering_plans (id) on delete cascade,
  change_request_id uuid not null references builders_change_requests (id) on delete cascade,

  -- `on delete set null`: losing the analysis row must never delete the execution that ran from it.
  impact_analysis_id uuid references builders_change_impact_analyses (id) on delete set null,

  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every table in this domain.
  -- This column is what makes Part 12's multi-project isolation structural rather than a query habit.
  project_id text not null references builders_projects (id) on delete cascade,
  release_id uuid references builders_releases (id) on delete set null,

  -- pending | ready | running | paused | completed | failed | cancelled | blocked.
  -- `blocked` is distinct from `failed`: nothing went wrong, the execution is correctly waiting for
  -- a human decision (a safety fallback, or a scope expansion it must not make itself).
  status text not null default 'pending',

  -- 1-based per engineering plan. A re-execution inserts a new row; earlier executions are kept.
  execution_version integer not null,
  model_version text not null,

  -- Part 4 — the machine's recommendation and the operator's approved selection are stored
  -- SEPARATELY and on purpose. Without both, no audit can distinguish "the plan chose this" from
  -- "a human overrode it", and "restore recommended selection" has nothing to restore to.
  recommended_roles jsonb not null default '[]'::jsonb,
  selected_roles jsonb not null default '[]'::jsonb,
  overrides jsonb not null default '[]'::jsonb,

  -- NOT `current_role`: that is a reserved SQL-standard identifier (a niladic function in
  -- PostgreSQL, like `current_user`/`session_user`), so a bare column of that name fails to parse.
  -- Renamed rather than quoted — a column that only works when quoted is a trap for every later
  -- query. The application-level field stays `currentRole`; only the column name differs.
  active_role text,
  completed_roles jsonb not null default '[]'::jsonb,
  skipped_roles jsonb not null default '[]'::jsonb,
  failed_roles jsonb not null default '[]'::jsonb,

  -- Part 7 — triggers that made reduced context unsafe, and the operator approval (if any) that
  -- answered them. A full-context run is only ever an explicit, reasoned, auditable decision.
  safety_fallbacks jsonb not null default '[]'::jsonb,
  full_context_fallback jsonb,

  -- Part 10 — operator decisions on discovered impact. The findings themselves live in
  -- builders_discovered_impacts; this holds what was decided about them.
  scope_expansion_decisions jsonb not null default '[]'::jsonb,

  -- Part 12 — the review outcomes for the stages the approved plan required.
  reviews jsonb not null default '[]'::jsonb,

  -- A stable hash of the approved scope (see computeScopeFingerprint). Two runs sharing it saw the
  -- same brief; a changed fingerprint means the outputs answer different questions.
  scope_fingerprint text not null,

  failure jsonb,
  metadata jsonb not null default '{}'::jsonb,

  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (engineering_plan_id, execution_version)
);

-- Part 14's "one active execution per engineering plan". A partial unique index rather than a
-- constraint, because only the LIVE statuses may be exclusive — any number of finished executions
-- must be able to coexist as history, which is the whole point of never overwriting them.
create unique index if not exists builders_incremental_executions_one_active_idx
  on builders_incremental_executions (engineering_plan_id)
  where status in ('pending', 'ready', 'running', 'paused', 'blocked');

create index if not exists builders_incremental_executions_project_idx
  on builders_incremental_executions (project_id);
create index if not exists builders_incremental_executions_request_idx
  on builders_incremental_executions (change_request_id, execution_version desc);
create index if not exists builders_incremental_executions_deployment_idx
  on builders_incremental_executions (deployment_id);

drop trigger if exists set_updated_at on builders_incremental_executions;
create trigger set_updated_at before update on builders_incremental_executions
  for each row execute function builders_set_updated_at();

-- ── builders_incremental_role_runs ──────────────────────────────────────────
-- One row per role ATTEMPT. A retry inserts a new row with attempt + 1 rather than updating the
-- previous one, so a failed-then-succeeded role keeps both records. This table is also the
-- execution audit log (see the history note in this file's header).
create table if not exists builders_incremental_role_runs (
  id uuid primary key default gen_random_uuid(),

  execution_id uuid not null references builders_incremental_executions (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  -- A real pipeline role id (see AUTO_ENGINEERING_ROLES), plus 'requirements' for the Business
  -- Analyst, which sits outside that registry. Never a parallel vocabulary.
  role text not null,
  attempt integer not null default 1,

  -- pending | running | completed | failed | skipped | blocked
  status text not null default 'pending',

  artifact_type text,

  -- Part 6 — the exact scoped context this run was given, stored so the reduction is auditable
  -- after the fact rather than merely intended before it.
  context jsonb,

  -- Part 9 — the incremental artifact: generation_type, baseline release, superseded artifact id,
  -- scope fingerprint and the parsed role draft. NOT written back over the released artifact.
  output jsonb,

  failure jsonb,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (execution_id, role, attempt)
);

create index if not exists builders_incremental_role_runs_execution_idx
  on builders_incremental_role_runs (execution_id, role, attempt desc);
create index if not exists builders_incremental_role_runs_project_idx
  on builders_incremental_role_runs (project_id);

drop trigger if exists set_updated_at on builders_incremental_role_runs;
create trigger set_updated_at before update on builders_incremental_role_runs
  for each row execute function builders_set_updated_at();

-- ── builders_incremental_invalidations ──────────────────────────────────────
-- Part 5. One row per pipeline role per execution: what happens to the artifact it already
-- produced, why, and on which dependency edges. Nothing is deleted and nothing is approved here —
-- this table only records a judgement about an artifact that stays exactly where it is.
create table if not exists builders_incremental_invalidations (
  id uuid primary key default gen_random_uuid(),

  execution_id uuid not null references builders_incremental_executions (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  role text not null,
  artifact_type text,

  -- valid | potentially_stale | invalidated | requires_review
  state text not null,
  must_rerun boolean not null default false,
  requires_review boolean not null default false,

  -- The executing roles that caused this state, and the dependency edges behind it.
  caused_by jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  reasoning text not null,

  created_at timestamptz not null default now(),

  unique (execution_id, role)
);

create index if not exists builders_incremental_invalidations_execution_idx
  on builders_incremental_invalidations (execution_id);
create index if not exists builders_incremental_invalidations_project_idx
  on builders_incremental_invalidations (project_id);

-- ── builders_discovered_impacts ─────────────────────────────────────────────
-- Part 10. Impact a role found that Sprint 95's analysis did not. Recorded, never acted on: there
-- is no path from a row here to a wider scope without an operator decision, which is stored on the
-- execution's scope_expansion_decisions.
create table if not exists builders_discovered_impacts (
  id uuid primary key default gen_random_uuid(),

  execution_id uuid not null references builders_incremental_executions (id) on delete cascade,
  role_run_id uuid references builders_incremental_role_runs (id) on delete set null,
  change_request_id uuid not null references builders_change_requests (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  reported_by_role text not null,
  description text not null,
  category text not null,
  affected_artifact text not null,
  reasoning text not null,

  -- low | medium | high | critical
  severity text not null,

  -- expand_scope | return_to_impact_analysis | monitor_only | no_action_required.
  -- A recommendation from a role, never a decision.
  recommended_action text not null,
  scope_change_required boolean not null default false,

  -- Set when an operator has ruled on this finding; null while it is still open.
  resolution text,
  resolved_by text,
  resolved_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists builders_discovered_impacts_execution_idx
  on builders_discovered_impacts (execution_id);
create index if not exists builders_discovered_impacts_project_idx
  on builders_discovered_impacts (project_id);
create index if not exists builders_discovered_impacts_request_idx
  on builders_discovered_impacts (change_request_id);

-- ── Row level security ──────────────────────────────────────────────────────
-- Identical shape to the Sprint 95/96 evolution tables: read through
-- builders_user_can_access_project, write through builders_user_can_edit_project, both keyed on the
-- denormalized project_id. Project isolation is therefore enforced by the database, not by callers.
alter table builders_incremental_executions enable row level security;
alter table builders_incremental_role_runs enable row level security;
alter table builders_incremental_invalidations enable row level security;
alter table builders_discovered_impacts enable row level security;

drop policy if exists "builders_incremental_executions_select" on builders_incremental_executions;
create policy "builders_incremental_executions_select" on builders_incremental_executions
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_incremental_executions_write" on builders_incremental_executions;
create policy "builders_incremental_executions_write" on builders_incremental_executions
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_incremental_role_runs_select" on builders_incremental_role_runs;
create policy "builders_incremental_role_runs_select" on builders_incremental_role_runs
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_incremental_role_runs_write" on builders_incremental_role_runs;
create policy "builders_incremental_role_runs_write" on builders_incremental_role_runs
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_incremental_invalidations_select" on builders_incremental_invalidations;
create policy "builders_incremental_invalidations_select" on builders_incremental_invalidations
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_incremental_invalidations_write" on builders_incremental_invalidations;
create policy "builders_incremental_invalidations_write" on builders_incremental_invalidations
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_discovered_impacts_select" on builders_discovered_impacts;
create policy "builders_discovered_impacts_select" on builders_discovered_impacts
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_discovered_impacts_write" on builders_discovered_impacts;
create policy "builders_discovered_impacts_write" on builders_discovered_impacts
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
