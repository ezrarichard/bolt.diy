-- Product Evolution Engine & Change Impact Analysis — Sprint 95.
--
-- Persists what a customer ASKS for against an already-released product, and what analysing that
-- ask against the release baseline concluded. Purely additive: two new tables, no new functions;
-- no existing table, column, policy or function is altered. Idempotent throughout.
--
-- NOTHING HERE MODIFIES A RELEASE. A change request and its analysis are observations about a
-- released product, not changes to it — there is no write path from this migration to
-- builders_releases, builders_project_deployments, builders_application_manifests or any generated
-- artifact. The Deployment lifecycle is untouched by this sprint: a released product stays
-- `released` while any number of change requests accumulate against it.
--
-- WHY TWO TABLES. A request and its analysis have genuinely different lifetimes. The request is the
-- customer's words and barely changes; the analysis is re-runnable — a later analysis of the same
-- request against a newer release is a legitimate, separate result that must not overwrite the
-- earlier one (the same "never overwrite" rule Sprints 92/93/94 apply to verifications, delivery
-- packages and releases).
--
-- NO NEW HISTORY TABLE. Part 12's canonical events (`change_requested`, `impact_completed`,
-- `evolution_plan_created`) are written to the existing `builders_deployment_history`, which is
-- already the project-wide lifecycle log.

-- ── builders_change_requests ────────────────────────────────────────────────
create table if not exists builders_change_requests (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every other table in this
  -- domain, and what makes Part 14's multi-project isolation structural: a request is only ever
  -- reachable through its own project.
  project_id text not null references builders_projects (id) on delete cascade,

  -- The release this request is raised against. `on delete set null` because losing the release row
  -- must never delete the customer's request; `release_version` keeps the human reference either way.
  release_id uuid references builders_releases (id) on delete set null,
  release_version text,

  -- 1-based per deployment, in creation order.
  request_number integer not null,

  title text not null,
  description text not null,
  business_reason text,

  -- 'low' | 'medium' | 'high' | 'urgent'. Free text validated at the application layer, this
  -- schema's existing convention for every enum-like column.
  priority text not null default 'medium',

  -- The category the OPERATOR declared, or 'unknown'. An inferred classification is never written
  -- back here — it belongs to the analysis that inferred it, so the customer's own words and the
  -- machine's guess never become indistinguishable.
  category text not null default 'unknown',

  -- 'unknown' | 'single_feature' | 'multi_feature' | 'cross_cutting'.
  scope text not null default 'unknown',

  -- Operator-declared affected areas (ChangeArea[]).
  declared_areas jsonb not null default '[]'::jsonb,

  -- 'draft' | 'submitted' | 'analyzed' | 'planned' | 'cancelled'.
  status text not null default 'submitted',

  requested_by text,
  requested_at timestamptz not null default now(),
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deployment_id, request_number)
);

create index if not exists builders_change_requests_project_id_idx on builders_change_requests (project_id);
create index if not exists builders_change_requests_deployment_idx
  on builders_change_requests (deployment_id, request_number desc);
create index if not exists builders_change_requests_status_idx on builders_change_requests (deployment_id, status);
create index if not exists builders_change_requests_release_idx on builders_change_requests (release_id);

drop trigger if exists set_updated_at on builders_change_requests;
create trigger set_updated_at before update on builders_change_requests
  for each row execute function builders_set_updated_at();

alter table builders_change_requests enable row level security;

drop policy if exists "builders_change_requests_select" on builders_change_requests;
create policy "builders_change_requests_select" on builders_change_requests
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_change_requests_write" on builders_change_requests;
create policy "builders_change_requests_write" on builders_change_requests
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_change_impact_analyses ─────────────────────────────────────────
-- One row per ANALYSIS RUN of one change request. Re-analysing the same request (after a new
-- release, or after the request was reworded) creates a new row; the earlier analysis is kept.
create table if not exists builders_change_impact_analyses (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references builders_change_requests (id) on delete cascade,
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  -- Which release this was analysed against — the baseline, never a deployment (Part 7).
  release_id uuid references builders_releases (id) on delete set null,
  release_version text,

  -- 1-based per change request.
  analysis_number integer not null,

  -- Denormalized headline results, so the dashboard and any future "evolution health" query never
  -- has to parse the JSONB.
  classification text not null default 'unknown',
  risk_level text not null default 'low',
  complexity_level text not null default 'very_small',
  overall_confidence text not null default 'low',
  requires_human_review boolean not null default true,

  -- The full ImpactAnalysis (sections, findings, reasoning, risk/complexity factors, roles).
  impact jsonb not null default '{}'::jsonb,

  -- The EvolutionPlan derived from that analysis, when one was generated. Null until it is.
  evolution_plan jsonb,

  analysed_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (change_request_id, analysis_number)
);

create index if not exists builders_change_impact_analyses_project_id_idx
  on builders_change_impact_analyses (project_id);
create index if not exists builders_change_impact_analyses_request_idx
  on builders_change_impact_analyses (change_request_id, analysis_number desc);
create index if not exists builders_change_impact_analyses_deployment_idx
  on builders_change_impact_analyses (deployment_id);

drop trigger if exists set_updated_at on builders_change_impact_analyses;
create trigger set_updated_at before update on builders_change_impact_analyses
  for each row execute function builders_set_updated_at();

alter table builders_change_impact_analyses enable row level security;

drop policy if exists "builders_change_impact_analyses_select" on builders_change_impact_analyses;
create policy "builders_change_impact_analyses_select" on builders_change_impact_analyses
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_change_impact_analyses_write" on builders_change_impact_analyses;
create policy "builders_change_impact_analyses_write" on builders_change_impact_analyses
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
