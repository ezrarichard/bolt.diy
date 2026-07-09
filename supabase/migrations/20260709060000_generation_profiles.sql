-- Generation Profiles & Safe Model Routing — Sprint 39.5.
--
-- Adds a per-project "Generation Profile" (Fast Prototype / Balanced / Production) that
-- maps each AI Engineering Team role (see builders_ai_roles) to a logical model key —
-- resolved at runtime through app/lib/generation-profiles/modelRegistry.ts, never a raw
-- provider API model id stored here. See that file's header for why the indirection
-- exists: adding a new provider/model later only touches the registry, never this table.
--
-- No enum/check constraint on `mode` and no assumption of exactly 3 rows anywhere below —
-- deliberately future-proof for more system profiles (Enterprise, Budget Mode,
-- Experimental, Autonomous, ...) without another migration; only 3 rows are seeded today.

create table if not exists builders_generation_profiles (
  id text primary key,
  name text not null,
  description text,
  mode text not null,
  is_default boolean not null default false,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `model_key` references app/lib/generation-profiles/modelRegistry.ts's logical keys
-- (e.g. 'claude-sonnet-4.6'), never a raw provider API model id. `temperature`/
-- `max_tokens` are optional PER-ROLE overrides of the registry entry's own behavior —
-- left null for every seeded row this sprint.
create table if not exists builders_generation_profile_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references builders_generation_profiles (id) on delete cascade,
  role_key text not null references builders_ai_roles (role_key),
  model_key text not null,
  temperature numeric,
  max_tokens int,
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, role_key)
);

create index if not exists builders_generation_profile_roles_profile_id_idx on builders_generation_profile_roles (profile_id);

-- Sprint 39.5 addition to builders_project_workspace_state (20260709030000) — mirrors
-- ProjectWorkspaceState.selectedGenerationProfileId (app/lib/projects/workspaceState.ts).
alter table builders_project_workspace_state
  add column if not exists selected_generation_profile_id text references builders_generation_profiles (id);

create or replace function builders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on builders_generation_profiles;
create trigger set_updated_at before update on builders_generation_profiles
  for each row execute function builders_set_updated_at();

drop trigger if exists set_updated_at on builders_generation_profile_roles;
create trigger set_updated_at before update on builders_generation_profile_roles
  for each row execute function builders_set_updated_at();

alter table builders_generation_profiles enable row level security;
alter table builders_generation_profile_roles enable row level security;

drop policy if exists "builders_generation_profiles_anon_all" on builders_generation_profiles;
create policy "builders_generation_profiles_anon_all" on builders_generation_profiles for all using (true) with check (true);

drop policy if exists "builders_generation_profile_roles_anon_all" on builders_generation_profile_roles;
create policy "builders_generation_profile_roles_anon_all" on builders_generation_profile_roles for all using (true) with check (true);

-- ── Seed: 3 system profiles ──────────────────────────────────────────────

insert into builders_generation_profiles (id, name, description, mode, is_default, is_system) values
  ('fast-prototype', 'Fast Prototype', 'Cheapest and fastest — best for early testing and throwaway prototypes.', 'fast-prototype', false, true),
  ('balanced', 'Balanced', 'The recommended, normal Builders default — a practical mix of speed and quality.', 'balanced', true, true),
  ('production', 'Production', 'Highest quality — uses the strongest model for every role. Best for final builds.', 'production', false, true)
on conflict (id) do nothing;

-- Fast Prototype
insert into builders_generation_profile_roles (profile_id, role_key, model_key, priority) values
  ('fast-prototype', 'requirements-draft', 'claude-haiku-4.5', 1),
  ('fast-prototype', 'architecture-draft', 'claude-haiku-4.5', 2),
  ('fast-prototype', 'database-draft', 'claude-haiku-4.5', 3),
  ('fast-prototype', 'uiux-draft', 'claude-haiku-4.5', 4),
  ('fast-prototype', 'backend-draft', 'claude-sonnet-4.5', 5),
  ('fast-prototype', 'frontend-draft', 'claude-sonnet-4.5', 6),
  ('fast-prototype', 'qa-draft', 'claude-haiku-4.5', 7),
  ('fast-prototype', 'devops-draft', 'claude-haiku-4.5', 8),
  ('fast-prototype', 'code-reviewer', 'claude-haiku-4.5', 9),
  ('fast-prototype', 'repair-engineer', 'claude-sonnet-4.5', 10),
  ('fast-prototype', 'build-validator', 'claude-haiku-4.5', 11)
on conflict (profile_id, role_key) do nothing;

-- Balanced
insert into builders_generation_profile_roles (profile_id, role_key, model_key, priority) values
  ('balanced', 'requirements-draft', 'claude-sonnet-4.5', 1),
  ('balanced', 'architecture-draft', 'claude-sonnet-4.6', 2),
  ('balanced', 'database-draft', 'claude-sonnet-4.5', 3),
  ('balanced', 'uiux-draft', 'claude-sonnet-4.5', 4),
  ('balanced', 'backend-draft', 'claude-sonnet-4.6', 5),
  ('balanced', 'frontend-draft', 'claude-sonnet-4.6', 6),
  ('balanced', 'qa-draft', 'claude-sonnet-4.5', 7),
  ('balanced', 'devops-draft', 'claude-sonnet-4.5', 8),
  ('balanced', 'code-reviewer', 'claude-sonnet-4.5', 9),
  ('balanced', 'repair-engineer', 'claude-sonnet-4.6', 10),
  ('balanced', 'build-validator', 'claude-haiku-4.5', 11)
on conflict (profile_id, role_key) do nothing;

-- Production — every role uses the strongest model.
insert into builders_generation_profile_roles (profile_id, role_key, model_key, priority) values
  ('production', 'requirements-draft', 'claude-sonnet-4.6', 1),
  ('production', 'architecture-draft', 'claude-sonnet-4.6', 2),
  ('production', 'database-draft', 'claude-sonnet-4.6', 3),
  ('production', 'uiux-draft', 'claude-sonnet-4.6', 4),
  ('production', 'backend-draft', 'claude-sonnet-4.6', 5),
  ('production', 'frontend-draft', 'claude-sonnet-4.6', 6),
  ('production', 'qa-draft', 'claude-sonnet-4.6', 7),
  ('production', 'devops-draft', 'claude-sonnet-4.6', 8),
  ('production', 'code-reviewer', 'claude-sonnet-4.6', 9),
  ('production', 'repair-engineer', 'claude-sonnet-4.6', 10),
  ('production', 'build-validator', 'claude-sonnet-4.6', 11)
on conflict (profile_id, role_key) do nothing;
