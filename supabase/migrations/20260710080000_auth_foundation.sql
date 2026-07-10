-- Sprint 40 — Authentication Foundation.
--
-- Additive migration. Does not touch table shapes from the canonical schema
-- (20260709010000_buildersdb_canonical_schema.sql) or later sprints — only adds a new
-- `profiles` table + its creation trigger, and swaps every existing `anon`-key-permissive RLS
-- policy for an `authenticated`-only equivalent (`to authenticated using (true) with check
-- (true))`, exactly as flagged as acceptable-for-now in the canonical schema's own header
-- comment ("every owner_id/user_id column is a nullable placeholder for future work").
--
-- Ownership filtering (auth.uid() = owner_id, team membership) is explicitly OUT of scope —
-- see Sprint 41. This migration only removes anonymous-key access; every authenticated team
-- member still sees the full shared project dataset until that sprint lands.

-- ============================================================================
-- profiles
-- ============================================================================

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Creates a profiles row the moment a new auth.users row is created (i.e. whenever a team
-- member is added via the Supabase Dashboard — see the Sprint 40 report for that manual
-- step). SECURITY DEFINER is required: this fires as part of the auth.users insert, before
-- the new user's own session/JWT exists, so it cannot rely on the inserting role having
-- write access to `public.profiles` under RLS.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create index if not exists profiles_email_idx on profiles (email);

-- ============================================================================
-- Replace every anon-key-permissive policy with an authenticated-only equivalent.
-- ============================================================================

drop policy if exists "builders_projects_anon_all" on builders_projects;
create policy "builders_projects_authenticated_all" on builders_projects for all to authenticated using (true) with check (true);

drop policy if exists "builders_project_members_anon_all" on builders_project_members;
create policy "builders_project_members_authenticated_all" on builders_project_members for all to authenticated using (true) with check (true);

drop policy if exists "builders_ai_roles_anon_all" on builders_ai_roles;
create policy "builders_ai_roles_authenticated_all" on builders_ai_roles for all to authenticated using (true) with check (true);

drop policy if exists "builders_role_outputs_anon_all" on builders_role_outputs;
create policy "builders_role_outputs_authenticated_all" on builders_role_outputs for all to authenticated using (true) with check (true);

drop policy if exists "builders_project_tasks_anon_all" on builders_project_tasks;
create policy "builders_project_tasks_authenticated_all" on builders_project_tasks for all to authenticated using (true) with check (true);

drop policy if exists "builders_task_reviews_anon_all" on builders_task_reviews;
create policy "builders_task_reviews_authenticated_all" on builders_task_reviews for all to authenticated using (true) with check (true);

drop policy if exists "builders_execution_logs_anon_all" on builders_execution_logs;
create policy "builders_execution_logs_authenticated_all" on builders_execution_logs for all to authenticated using (true) with check (true);

drop policy if exists "builders_project_activity_anon_all" on builders_project_activity;
create policy "builders_project_activity_authenticated_all" on builders_project_activity for all to authenticated using (true) with check (true);

drop policy if exists "builders_context_traces_anon_all" on builders_context_traces;
create policy "builders_context_traces_authenticated_all" on builders_context_traces for all to authenticated using (true) with check (true);

drop policy if exists "builders_product_packages_anon_all" on builders_product_packages;
create policy "builders_product_packages_authenticated_all" on builders_product_packages for all to authenticated using (true) with check (true);

drop policy if exists "builders_product_package_files_anon_all" on builders_product_package_files;
create policy "builders_product_package_files_authenticated_all" on builders_product_package_files for all to authenticated using (true) with check (true);

drop policy if exists "builders_shared_provider_settings_anon_all" on builders_shared_provider_settings;
create policy "builders_shared_provider_settings_authenticated_all" on builders_shared_provider_settings for all to authenticated using (true) with check (true);

drop policy if exists "builders_project_workspace_state_anon_all" on builders_project_workspace_state;
create policy "builders_project_workspace_state_authenticated_all" on builders_project_workspace_state for all to authenticated using (true) with check (true);

drop policy if exists "builders_workspace_snapshots_anon_all" on builders_workspace_snapshots;
create policy "builders_workspace_snapshots_authenticated_all" on builders_workspace_snapshots for all to authenticated using (true) with check (true);

drop policy if exists "builders_validation_runs_anon_all" on builders_validation_runs;
create policy "builders_validation_runs_authenticated_all" on builders_validation_runs for all to authenticated using (true) with check (true);

drop policy if exists "builders_code_repair_attempts_anon_all" on builders_code_repair_attempts;
create policy "builders_code_repair_attempts_authenticated_all" on builders_code_repair_attempts for all to authenticated using (true) with check (true);

drop policy if exists "builders_generation_profiles_anon_all" on builders_generation_profiles;
create policy "builders_generation_profiles_authenticated_all" on builders_generation_profiles for all to authenticated using (true) with check (true);

drop policy if exists "builders_generation_profile_roles_anon_all" on builders_generation_profile_roles;
create policy "builders_generation_profile_roles_authenticated_all" on builders_generation_profile_roles for all to authenticated using (true) with check (true);
