-- Requirements Discovery Foundation — Sprint 50.
--
-- Durable BuildersDB foundation for the new Business Analyst architecture (see
-- docs/06-Requirements-Discovery/01-sprint-50-durable-foundation.md). Foundation only: this
-- migration introduces storage for a "Requirements Session" (one requirements-discovery
-- effort for one project), its append-only message/turn history, and its current-state
-- Business Understanding Model. No AI reasoning, no Interview/Document Mode UI, and no
-- change to the existing Form-based Requirements flow ships in this sprint — the existing
-- 18-field `projectKnowledge` blob and `projectDefinitionChat` metadata keep working exactly
-- as they do today (see METADATA_FIELDS in buildersDbTypes.ts, untouched by this migration).
--
-- Additive only. Does not alter builders_projects, builders_role_outputs, or any other
-- existing table's shape, data, or RLS policies. `RequirementsDraft`/builders_role_outputs
-- remain the sole terminal artifact and contract for downstream Requirements Approval / AI
-- Product Owner / Engineering — nothing in this migration is read by those stages.
--
-- Ownership model: matches every other project-scoped child table added since Sprint 42
-- (builders_role_outputs, builders_project_tasks, builders_context_traces, ...) — no
-- `owner_id` column on any table here; access is derived entirely from `project_id` via the
-- existing `builders_user_can_access_project()`/`builders_user_can_edit_project()` helper
-- functions (see 20260710100000_project_ownership_and_rls.sql). Deliberately consistent with
-- the plan's "owner_id, only if consistent with current BuildersDB ownership design" —
-- it is not.
--
-- Cascade chain: builders_projects (delete) -> builders_requirements_sessions (cascade) ->
-- builders_requirements_session_messages + builders_business_understanding_models (cascade).
-- builders_project_activity's existing `on delete set null` audit-trail behavior is
-- untouched by this migration.

-- ============================================================================
-- builders_requirements_sessions
-- ============================================================================
-- One row per requirements-discovery effort for one project. A project may have multiple
-- sessions over its lifetime (e.g. a later revision effort), but this sprint does not yet
-- populate more than one per project — that's a later-sprint UI concern, not a schema one.
--
-- `mode`/`status` are constrained to the sets the frozen architecture already anticipates
-- (Requirements Session Architecture, Part 1/Part 9). `selected_discovery_strategy` and
-- `assessment_confidence` are free text with no CHECK constraint: the Business Assessment &
-- Discovery Strategy Architecture names candidate values (Minimal/Standard/Deep/Enterprise/...)
-- but Sprint 50 implements no assessment logic yet, so constraining the value set now would
-- risk a destructive migration later once that logic is actually built (Sprint 53/54).
create table if not exists builders_requirements_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,

  mode text not null,
  status text not null default 'created',

  -- Reserved for Sprint 53/54 (Business Assessment / Discovery Strategy selection). Nullable
  -- and unconstrained on purpose — see header comment.
  selected_discovery_strategy text,
  assessment_confidence text,

  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  abandoned_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint builders_requirements_sessions_mode_check
    check (mode in ('form', 'interview', 'document')),
  constraint builders_requirements_sessions_status_check
    check (status in ('created', 'active', 'complete', 'approved', 'archived', 'abandoned'))
);

create index if not exists builders_requirements_sessions_project_id_idx
  on builders_requirements_sessions (project_id);

-- Fast "get the latest/active session for a project" lookup (getLatestRequirementsSession).
create index if not exists builders_requirements_sessions_project_created_idx
  on builders_requirements_sessions (project_id, created_at desc);

drop trigger if exists set_updated_at on builders_requirements_sessions;
create trigger set_updated_at before update on builders_requirements_sessions
  for each row execute function builders_set_updated_at();

-- ============================================================================
-- builders_requirements_session_messages
-- ============================================================================
-- Append-only conversation/source-input history for one session. `project_id` is
-- deliberately duplicated here (not just reachable via session_id ->
-- builders_requirements_sessions.project_id) so RLS and project-scoped queries never need to
-- join through the parent row first — the exact same pattern
-- builders_product_package_files already uses for package_id/project_id.
--
-- `sequence_number` is the deterministic ordering column the plan calls for, independent of
-- `created_at` (clock resolution/skew is never assumed to be strictly monotonic across rows).
-- No UPDATE/DELETE policy is granted below: messages are append-only through the repository
-- interface by design (Sprint 50 scope explicitly excludes message editing).
create table if not exists builders_requirements_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references builders_requirements_sessions (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  role text not null,
  message_type text not null default 'text',
  content text not null,
  sequence_number integer not null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint builders_requirements_session_messages_role_check
    check (role in ('user', 'assistant', 'system')),
  constraint builders_requirements_session_messages_type_check
    check (message_type in ('text', 'form_submission', 'document_input', 'recommendation', 'clarification', 'confirmation')),
  unique (session_id, sequence_number)
);

create index if not exists builders_requirements_session_messages_session_id_idx
  on builders_requirements_session_messages (session_id, sequence_number);

create index if not exists builders_requirements_session_messages_project_id_idx
  on builders_requirements_session_messages (project_id);

-- ============================================================================
-- builders_business_understanding_models
-- ============================================================================
-- Current-state (NOT versioned) structured understanding for one session — see the frozen
-- Requirements Session Architecture, Part 2/7: this is deliberately mutable-in-place, unlike
-- builders_role_outputs' append-only version chain. `unique (session_id)` enforces "one
-- session has exactly one current model" at the database level, not just by convention.
--
-- One JSONB column per Business Understanding Model section (rather than one giant blob, and
-- rather than one table per section) — chosen so a partial update to one section (e.g.
-- `business_goals`) can never accidentally clobber another section (e.g. `risks`) the way a
-- single-blob merge-in-application-code could if a caller forgot to preserve every key. This
-- follows the plan's "avoid over-normalizing into many small tables" instruction while still
-- giving per-section update safety. `schema_version` lets a future sprint evolve any section's
-- internal JSON shape without needing a fresh migration for existing rows to keep parsing.
--
-- `target_users`/`business_constraints` (not `users`/`constraints`) to avoid any ambiguity
-- with Postgres system identifiers or the `constraint` keyword family.
create table if not exists builders_business_understanding_models (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references builders_requirements_sessions (id) on delete cascade,
  project_id text not null references builders_projects (id) on delete cascade,

  schema_version integer not null default 1,

  assessment jsonb not null default '{}'::jsonb,
  business_identity jsonb not null default '{}'::jsonb,
  business_goals jsonb not null default '[]'::jsonb,
  processes jsonb not null default '[]'::jsonb,
  target_users jsonb not null default '[]'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  business_constraints jsonb not null default '[]'::jsonb,
  current_systems jsonb not null default '[]'::jsonb,
  functional_requirements jsonb not null default '[]'::jsonb,
  non_functional_requirements jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  traceability jsonb not null default '[]'::jsonb,
  completeness jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (session_id)
);

create index if not exists builders_business_understanding_models_project_id_idx
  on builders_business_understanding_models (project_id);

drop trigger if exists set_updated_at on builders_business_understanding_models;
create trigger set_updated_at before update on builders_business_understanding_models
  for each row execute function builders_set_updated_at();

-- ============================================================================
-- Row Level Security — same ownership model as every other project-scoped child table.
-- ============================================================================

alter table builders_requirements_sessions enable row level security;
alter table builders_requirements_session_messages enable row level security;
alter table builders_business_understanding_models enable row level security;

drop policy if exists "builders_requirements_sessions_select" on builders_requirements_sessions;
create policy "builders_requirements_sessions_select" on builders_requirements_sessions
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_requirements_sessions_write" on builders_requirements_sessions;
create policy "builders_requirements_sessions_write" on builders_requirements_sessions
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- Messages: select + insert only for authenticated — no update/delete policy at all, so the
-- only way a message row disappears is the project/session cascade, never a direct app write.
drop policy if exists "builders_requirements_session_messages_select" on builders_requirements_session_messages;
create policy "builders_requirements_session_messages_select" on builders_requirements_session_messages
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_requirements_session_messages_insert" on builders_requirements_session_messages;
create policy "builders_requirements_session_messages_insert" on builders_requirements_session_messages
  for insert to authenticated
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_business_understanding_models_select" on builders_business_understanding_models;
create policy "builders_business_understanding_models_select" on builders_business_understanding_models
  for select to authenticated
  using (builders_user_can_access_project(project_id));

-- Current-state model: insert (initialize) + update (per-turn), no delete policy — same
-- cascade-only removal discipline as messages.
drop policy if exists "builders_business_understanding_models_insert" on builders_business_understanding_models;
create policy "builders_business_understanding_models_insert" on builders_business_understanding_models
  for insert to authenticated
  with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_business_understanding_models_update" on builders_business_understanding_models;
create policy "builders_business_understanding_models_update" on builders_business_understanding_models
  for update to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));
