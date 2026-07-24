-- Blueprint Resolution Foundation — Sprint 61.
--
-- Persists the output of the new Blueprint Resolution Engine (app/lib/blueprints/
-- blueprintResolutionEngine.ts): "given this project's Business Understanding Model, which
-- Blueprint fits best?" This migration adds storage only — it does not change what a Blueprint
-- means, does not touch `builders_blueprints`, and nothing here is read by any AI role, prompt,
-- or the existing Builders workflow. Per the Sprint 61 brief, this sprint ends with a
-- recommendation only; nothing downstream consumes it yet.
--
-- Append-only history, not current-state-in-place: every resolution run inserts a NEW row rather
-- than updating a previous one (unlike `builders_business_understanding_models`'s mutable-in-place
-- model) — "future re-resolution should not overwrite history" is a hard requirement from the
-- brief, so a later run must never erase what an earlier run recommended. `selected_blueprint_id`
-- is the one mutable field on an existing row: it starts equal to `recommended_blueprint_id` and
-- is updated in place only when a human overrides the recommendation for that specific run — see
-- `blueprintResolutionRepository.ts`'s `selectBlueprint`.
--
-- `candidates` stores the full ranked list (not just the top pick) as JSONB, so a caller can
-- later show "here's what else we considered" without re-running the engine — the engine is
-- deterministic given the same inputs, but the Business Understanding Model it read from may
-- have changed since, so the stored snapshot is the source of truth for what a given resolution
-- actually saw.
create table if not exists builders_blueprint_resolutions (
  id uuid primary key default gen_random_uuid(),

  project_id text not null references builders_projects (id) on delete cascade,
  session_id uuid references builders_requirements_sessions (id) on delete cascade,

  recommended_blueprint_id text not null,
  selected_blueprint_id text not null,

  -- 0-100, the recommended blueprint's own confidence — duplicated out of `candidates[0]` for
  -- cheap querying/sorting without unpacking JSONB.
  confidence integer not null default 0,

  -- Human-readable reasons for the recommendation — duplicated out of `candidates[0].reasons`
  -- for the same reason as `confidence` above.
  explanation jsonb not null default '[]'::jsonb,

  -- Full ranked candidate list from that run (BlueprintCandidate[] — see
  -- blueprintResolutionEngine.ts), so alternates remain inspectable later without re-resolving.
  candidates jsonb not null default '[]'::jsonb,

  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint builders_blueprint_resolutions_confidence_check
    check (confidence >= 0 and confidence <= 100)
);

create index if not exists builders_blueprint_resolutions_project_id_idx
  on builders_blueprint_resolutions (project_id, resolved_at desc);

create index if not exists builders_blueprint_resolutions_session_id_idx
  on builders_blueprint_resolutions (session_id);

-- ============================================================================
-- Row Level Security — same project-scoped ownership model as every other project-scoped
-- child table (see 20260727100000_requirements_discovery_foundation.sql's own note).
-- ============================================================================
alter table builders_blueprint_resolutions enable row level security;

drop policy if exists "builders_blueprint_resolutions_select" on builders_blueprint_resolutions;
create policy "builders_blueprint_resolutions_select" on builders_blueprint_resolutions
  for select to authenticated
  using (builders_user_can_access_project(project_id));

-- Insert (new resolution run) + update (manual override of `selected_blueprint_id` on an
-- existing row) only — no delete policy, matching the append-only-history discipline above.
drop policy if exists "builders_blueprint_resolutions_insert" on builders_blueprint_resolutions;
create policy "builders_blueprint_resolutions_insert" on builders_blueprint_resolutions
  for insert to authenticated
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_blueprint_resolutions_update" on builders_blueprint_resolutions;
create policy "builders_blueprint_resolutions_update" on builders_blueprint_resolutions
  for update to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
