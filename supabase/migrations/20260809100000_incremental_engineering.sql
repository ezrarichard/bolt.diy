-- Incremental Engineering & Selective AI Execution — Sprint 96.
--
-- Persists the plan for engineering ONLY the parts of a released product an Evolution Plan
-- affects: the Engineering Scope, the selective role decisions, the Change Set, the reduced
-- per-role context descriptors and the execution order. Purely additive: one new table, no new
-- functions; no existing table, column, policy or function is altered. Idempotent throughout.
--
-- NOTHING HERE ENGINEERS ANYTHING. A plan is a document. There is no write path from this
-- migration to builders_application_manifests, builders_releases, builders_project_deployments or
-- any generated artifact, and no AI role is executed. The Deployment lifecycle is untouched: a
-- released product stays `released` while any number of incremental plans accumulate against it.
--
-- WHY A SEPARATE TABLE FROM builders_change_impact_analyses. An impact analysis answers "what is
-- affected"; an engineering plan answers "what would we therefore run". They are re-produced on
-- different cadences — a plan can be rebuilt (different role selection, revised scope) against the
-- SAME analysis, and re-analysing produces a new analysis that older plans must not be retro-fitted
-- to. Keeping them separate preserves both histories, the same "never overwrite" rule Sprints
-- 92-95 apply throughout.
--
-- NO NEW HISTORY TABLE. Part 10's canonical events (`engineering_scope_created`,
-- `incremental_plan_created`, `role_selection_completed`) are written to the existing
-- `builders_deployment_history`, the project-wide lifecycle log.

-- ── builders_incremental_engineering_plans ──────────────────────────────────
create table if not exists builders_incremental_engineering_plans (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references builders_change_requests (id) on delete cascade,

  -- The analysis this plan was built from. `on delete set null` because losing the analysis row
  -- must never delete the plan; the plan's own JSONB carries the scope it derived.
  impact_analysis_id uuid references builders_change_impact_analyses (id) on delete set null,

  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every other table in this
  -- domain, and what makes Part 12's multi-project isolation structural.
  project_id text not null references builders_projects (id) on delete cascade,

  -- 1-based per change request. Re-planning creates a new row; earlier plans are kept.
  plan_number integer not null,

  -- The plan MODEL's shape version (app/lib/evolution/engineeringScopeTypes.ts's
  -- INCREMENTAL_PLAN_MODEL_VERSION), pinned so an old plan stays interpretable.
  model_version text not null,

  -- Denormalized headline results, so the dashboard never has to parse the JSONB. `selected_roles`
  -- holds real pipeline role ids (see AUTO_ENGINEERING_ROLES) — not a parallel vocabulary.
  selected_roles jsonb not null default '[]'::jsonb,
  files_to_modify_count integer not null default 0,
  touched_percentage integer not null default 0,

  -- The full IncrementalEngineeringPlan: scope, role decisions with reasoning, execution order,
  -- change set, reduced context descriptors, review requirements, stated out-of-scope boundary.
  plan jsonb not null default '{}'::jsonb,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (change_request_id, plan_number)
);

create index if not exists builders_incremental_plans_project_id_idx
  on builders_incremental_engineering_plans (project_id);
create index if not exists builders_incremental_plans_request_idx
  on builders_incremental_engineering_plans (change_request_id, plan_number desc);
create index if not exists builders_incremental_plans_deployment_idx
  on builders_incremental_engineering_plans (deployment_id);
create index if not exists builders_incremental_plans_analysis_idx
  on builders_incremental_engineering_plans (impact_analysis_id);

drop trigger if exists set_updated_at on builders_incremental_engineering_plans;
create trigger set_updated_at before update on builders_incremental_engineering_plans
  for each row execute function builders_set_updated_at();

alter table builders_incremental_engineering_plans enable row level security;

drop policy if exists "builders_incremental_plans_select" on builders_incremental_engineering_plans;
create policy "builders_incremental_plans_select" on builders_incremental_engineering_plans
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_incremental_plans_write" on builders_incremental_engineering_plans;
create policy "builders_incremental_plans_write" on builders_incremental_engineering_plans
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
