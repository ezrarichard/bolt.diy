-- Sprint 42 — Project Ownership, Team Collaboration & Secure BuildersDB.
--
-- Additive migration. Does not recreate or reshape any existing table — only adds columns,
-- backfills them, activates the previously-structural `builders_project_members` table, and
-- replaces every `to authenticated using (true)` project-scoped policy from Sprint 40
-- (20260710080000_auth_foundation.sql) with real ownership/membership checks. Sprint 40's own
-- header explicitly deferred this ("Ownership filtering ... is explicitly OUT of scope — see
-- Sprint 41") — this migration is that follow-up.
--
-- Design notes:
--  - `owner_id`/`created_by`/`builders_project_members.user_id` all stay `text`, matching the
--    existing `builders_projects.owner_id text` column (see the canonical schema) rather than
--    switching to `uuid` — that would be a breaking type change to an existing column.
--    `auth.uid()` (uuid) is cast to `::text` everywhere it's compared against them.
--  - Legacy rows: every `builders_projects` row created before this migration has
--    `owner_id is null` (Sprint 40's own placeholder). A NULL owner would be invisible to
--    everyone under real RLS ownership checks, which fails PART 14's "existing users keep
--    projects" requirement — but ONLY when the backfill target is unambiguous. The backfill
--    below only runs when exactly one `auth.users` row exists; with zero or multiple users it
--    deliberately leaves `owner_id is null` rather than guessing (see the pre-migration audit
--    — run its safety queries first to know which case applies and, if ambiguous, to resolve
--    ownership manually before/after running this file).
--  - Catalog tables (builders_ai_roles, builders_shared_provider_settings,
--    builders_generation_profiles, builders_generation_profile_roles) are NOT project-scoped
--    and have no owner concept, but Sprint 40's blanket `for all to authenticated using (true)`
--    on them let any signed-in user rewrite the AI role catalog / generation-profile model
--    assignments — this migration narrows them to `select`-only for `authenticated`. The one
--    existing write path (`upsertSharedProviderSettings()` in
--    providerSettingsRepository.ts, called from the server-side
--    app/routes/api.shared-key-status.ts loader) uses `getBuildersDbClient()` with no session
--    forwarded, so it already executes as Postgres role `anon`, not `authenticated` — under
--    Sprint 40's `to authenticated`-only policy that write was already silently failing
--    (swallowed by its own try/catch). Narrowing these tables to select-only therefore closes
--    the unrestricted-write hole with no regression. A proper server/service-role write path
--    for shared provider settings is a follow-up, not part of this migration.

-- ============================================================================
-- builders_projects — ownership + analytics columns
-- ============================================================================

alter table builders_projects
  add column if not exists created_by text,
  add column if not exists last_opened_at timestamptz,
  add column if not exists last_editor text,
  add column if not exists generation_count int not null default 0,
  add column if not exists repair_count int not null default 0,
  add column if not exists deployment_count int not null default 0;

-- Backfill: ONLY when the deployment has exactly one auth.users row is a legacy
-- (owner_id is null) project unambiguously "the current authenticated user"'s. With zero
-- users there's nothing to backfill yet; with two or more, assigning every ownerless project
-- to whichever user happens to be earliest-created would silently hand other users' data to
-- the wrong account — so those rows are deliberately left owner_id is null (invisible under
-- the new RLS policies below, same as before this migration existed) until a human resolves
-- the ambiguity with the manual query in this migration's own header/PR description. Run the
-- pre-migration safety queries (see the audit) BEFORE this migration to know which case you're
-- in and, if multiple users, to decide the correct per-project owner up front.
do $$
declare
  user_count int;
  single_user_id text;
  backfilled_count int;
begin
  select count(*) into user_count from auth.users;

  if user_count = 1 then
    select id::text into single_user_id from auth.users limit 1;

    update builders_projects
    set owner_id = coalesce(owner_id, single_user_id),
        created_by = coalesce(created_by, owner_id, single_user_id)
    where owner_id is null;

    get diagnostics backfilled_count = row_count;
    raise notice 'Sprint 42 backfill: % ownerless project(s) assigned to the sole auth user %.', backfilled_count, single_user_id;
  elsif user_count = 0 then
    raise notice 'Sprint 42 backfill: no auth.users exist yet — nothing to backfill.';
  else
    raise warning 'Sprint 42 backfill SKIPPED: % auth.users exist, so ownerless builders_projects rows were NOT auto-assigned (ambiguous). They will be invisible under the new RLS policies below until manually assigned — see the audit''s pre-migration safety queries for how to inspect and resolve this.', user_count;
  end if;
end $$;

-- ============================================================================
-- builders_project_members — activate (Sprint 38.3 left this structural-only)
-- ============================================================================

-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; guard manually so a rerun (e.g. after a
-- later statement in this file fails and the whole migration is reapplied) doesn't error on
-- "constraint already exists".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'builders_project_members_role_check'
  ) then
    alter table builders_project_members
      add constraint builders_project_members_role_check
        check (role in ('Owner', 'Editor', 'Viewer'));
  end if;
end $$;

-- Backfill: every project with a known owner gets an explicit Owner membership row, so
-- membership-based queries (listProjectsForCurrentUser, listMembers) don't need an `or
-- owner_id = ...` special case layered on top of every single one of them.
insert into builders_project_members (project_id, user_id, role)
select id, owner_id, 'Owner'
from builders_projects
where owner_id is not null
on conflict (project_id, user_id) do update set role = 'Owner';

-- Every future project insert gets the same treatment automatically, regardless of which
-- code path created it — belt-and-braces alongside the repository layer explicitly inserting
-- this row too.
create or replace function builders_add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into builders_project_members (project_id, user_id, role)
    values (new.id, new.owner_id, 'Owner')
    on conflict (project_id, user_id) do update set role = 'Owner';
  end if;

  return new;
end;
$$;

drop trigger if exists add_owner_membership on builders_projects;
create trigger add_owner_membership
  after insert on builders_projects
  for each row execute function builders_add_owner_membership();

-- ============================================================================
-- Activity / analytics attribution columns
-- ============================================================================

-- builders_project_activity — actor attribution (PART 8). `actor_display_name` is a snapshot
-- taken at write time (not a live join to `profiles`), so an activity entry still reads
-- correctly if the actor's display name later changes or their profile is deleted.
alter table builders_project_activity
  add column if not exists actor_id text,
  add column if not exists actor_display_name text;

-- builders_role_outputs — PART 9 ("Every AI Role Output must include generated_by_user").
alter table builders_role_outputs
  add column if not exists generated_by_user text;

-- ============================================================================
-- Access-check helper functions
-- ============================================================================

-- The caller's role on a project ('Owner' | 'Editor' | 'Viewer'), or null if they have no
-- access. SECURITY DEFINER + a fixed search_path so it can be safely called from inside RLS
-- policies (which themselves cannot see rows filtered out by the very policy being
-- evaluated) without risking a privilege-escalation search_path attack.
create or replace function builders_user_role_for_project(p_project_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from builders_project_members
  where project_id = p_project_id
    and user_id = auth.uid()::text
  order by case role when 'Owner' then 0 when 'Editor' then 1 else 2 end
  limit 1;
$$;

create or replace function builders_user_can_access_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select builders_user_role_for_project(p_project_id) is not null;
$$;

create or replace function builders_user_can_edit_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select builders_user_role_for_project(p_project_id) in ('Owner', 'Editor');
$$;

-- Least-privilege: Postgres grants EXECUTE to PUBLIC by default on function creation. These
-- three are only ever meant to be called from inside an RLS policy evaluated for an
-- `authenticated` role — revoke the default PUBLIC grant (which includes `anon`) and grant
-- explicitly only to `authenticated`.
revoke execute on function builders_user_role_for_project(text) from public;
revoke execute on function builders_user_can_access_project(text) from public;
revoke execute on function builders_user_can_edit_project(text) from public;
grant execute on function builders_user_role_for_project(text) to authenticated;
grant execute on function builders_user_can_access_project(text) to authenticated;
grant execute on function builders_user_can_edit_project(text) to authenticated;

-- ============================================================================
-- builders_projects — block ownership escalation via plain UPDATE
-- ============================================================================
--
-- builders_projects_update_editable (below) intentionally lets both Owner and Editor UPDATE
-- a project row (content fields, status, etc.) — but without this trigger, that same
-- broad permission lets an Editor run `update builders_projects set owner_id = auth.uid()`
-- and pass both USING and WITH CHECK (both only check builders_user_can_edit_project(id),
-- which is true for Editors too), self-promoting to Owner with no builders_project_members
-- row ever created. RLS's coarse "can edit this project" check has no concept of "except this
-- one column" — a BEFORE UPDATE trigger is the standard way to add that column-level
-- restriction on top of a table-level RLS policy.
create or replace function builders_protect_project_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.created_by is distinct from old.created_by then
    if old.owner_id is null or old.owner_id <> auth.uid()::text then
      raise exception 'Only the current project owner may change ownership.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_project_ownership on builders_projects;
create trigger protect_project_ownership
  before update on builders_projects
  for each row execute function builders_protect_project_ownership();

-- ============================================================================
-- builders_projects RLS — replace Sprint 40's using(true) with real ownership checks
-- ============================================================================

drop policy if exists "builders_projects_authenticated_all" on builders_projects;

create policy "builders_projects_select_accessible" on builders_projects
  for select to authenticated
  using (builders_user_can_access_project(id));

create policy "builders_projects_insert_own" on builders_projects
  for insert to authenticated
  with check (owner_id = auth.uid()::text and (created_by is null or created_by = auth.uid()::text));

create policy "builders_projects_update_editable" on builders_projects
  for update to authenticated
  using (builders_user_can_edit_project(id))
  with check (builders_user_can_edit_project(id));

-- Delete is Owner-only (PART 10 — "Editors cannot delete"), stricter than update.
create policy "builders_projects_delete_owner_only" on builders_projects
  for delete to authenticated
  using (owner_id = auth.uid()::text);

-- ============================================================================
-- builders_project_members RLS
-- ============================================================================

drop policy if exists "builders_project_members_authenticated_all" on builders_project_members;

create policy "builders_project_members_select_accessible" on builders_project_members
  for select to authenticated
  using (builders_user_can_access_project(project_id));

create policy "builders_project_members_owner_manage" on builders_project_members
  for insert to authenticated
  with check (builders_user_role_for_project(project_id) = 'Owner');

create policy "builders_project_members_owner_update" on builders_project_members
  for update to authenticated
  using (builders_user_role_for_project(project_id) = 'Owner')
  with check (builders_user_role_for_project(project_id) = 'Owner');

create policy "builders_project_members_owner_delete" on builders_project_members
  for delete to authenticated
  using (builders_user_role_for_project(project_id) = 'Owner');

-- ============================================================================
-- Project-scoped child tables — select for any accessible role, write for Owner/Editor.
-- ============================================================================

drop policy if exists "builders_role_outputs_authenticated_all" on builders_role_outputs;
create policy "builders_role_outputs_select" on builders_role_outputs for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_role_outputs_write" on builders_role_outputs for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_project_tasks_authenticated_all" on builders_project_tasks;
create policy "builders_project_tasks_select" on builders_project_tasks for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_project_tasks_write" on builders_project_tasks for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_task_reviews_authenticated_all" on builders_task_reviews;
create policy "builders_task_reviews_select" on builders_task_reviews for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_task_reviews_write" on builders_task_reviews for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_execution_logs_authenticated_all" on builders_execution_logs;
create policy "builders_execution_logs_select" on builders_execution_logs for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_execution_logs_write" on builders_execution_logs for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

-- project_id is nullable here (on delete set null — see the canonical schema comment), so a
-- row can outlive the project it described. Those rows stay selectable by anyone who could
-- see them before (no way to re-check membership once project_id is gone), but never
-- writable — new activity rows always carry a real project_id.
drop policy if exists "builders_project_activity_authenticated_all" on builders_project_activity;
create policy "builders_project_activity_select" on builders_project_activity for select to authenticated using (project_id is null or builders_user_can_access_project(project_id));
create policy "builders_project_activity_insert" on builders_project_activity for insert to authenticated with check (project_id is not null and builders_user_can_access_project(project_id));

drop policy if exists "builders_context_traces_authenticated_all" on builders_context_traces;
create policy "builders_context_traces_select" on builders_context_traces for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_context_traces_write" on builders_context_traces for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_product_packages_authenticated_all" on builders_product_packages;
create policy "builders_product_packages_select" on builders_product_packages for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_product_packages_write" on builders_product_packages for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_product_package_files_authenticated_all" on builders_product_package_files;
create policy "builders_product_package_files_select" on builders_product_package_files for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_product_package_files_write" on builders_product_package_files for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_project_workspace_state_authenticated_all" on builders_project_workspace_state;
create policy "builders_project_workspace_state_select" on builders_project_workspace_state for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_project_workspace_state_write" on builders_project_workspace_state for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_workspace_snapshots_authenticated_all" on builders_workspace_snapshots;
create policy "builders_workspace_snapshots_select" on builders_workspace_snapshots for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_workspace_snapshots_write" on builders_workspace_snapshots for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_validation_runs_authenticated_all" on builders_validation_runs;
create policy "builders_validation_runs_select" on builders_validation_runs for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_validation_runs_write" on builders_validation_runs for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

drop policy if exists "builders_code_repair_attempts_authenticated_all" on builders_code_repair_attempts;
create policy "builders_code_repair_attempts_select" on builders_code_repair_attempts for select to authenticated using (builders_user_can_access_project(project_id));
create policy "builders_code_repair_attempts_write" on builders_code_repair_attempts for all to authenticated using (builders_user_can_edit_project(project_id)) with check (builders_user_can_edit_project(project_id));

-- ============================================================================
-- Catalog/system tables — read for every authenticated user, write for nobody via the
-- anon/authenticated API (see the header comment's shared_provider_settings note). A
-- service_role key (server-only, bypasses RLS entirely) is the only way to write these going
-- forward, until a real admin/server write path exists.
-- ============================================================================

drop policy if exists "builders_ai_roles_authenticated_all" on builders_ai_roles;
create policy "builders_ai_roles_select" on builders_ai_roles for select to authenticated using (true);

drop policy if exists "builders_shared_provider_settings_authenticated_all" on builders_shared_provider_settings;
create policy "builders_shared_provider_settings_select" on builders_shared_provider_settings for select to authenticated using (true);

drop policy if exists "builders_generation_profiles_authenticated_all" on builders_generation_profiles;
create policy "builders_generation_profiles_select" on builders_generation_profiles for select to authenticated using (true);

drop policy if exists "builders_generation_profile_roles_authenticated_all" on builders_generation_profile_roles;
create policy "builders_generation_profile_roles_select" on builders_generation_profile_roles for select to authenticated using (true);

-- ============================================================================
-- Indexes for the new access-check predicates
-- ============================================================================

create index if not exists builders_projects_owner_id_idx on builders_projects (owner_id);
create index if not exists builders_project_members_user_id_idx on builders_project_members (user_id);
create index if not exists builders_project_activity_actor_id_idx on builders_project_activity (actor_id);

-- ============================================================================
-- Sprint 42.1 — AI Usage Ledger Foundation
-- ============================================================================
--
-- Immutable event ledger, one row per AI request (chat, one-shot role generation, future
-- code review/repair/runtime-debug) — deliberately NOT a pre-aggregated daily/user table, so
-- no detail is ever lost; daily/user/project rollups are computed from this table (see
-- builders_ai_usage_daily below), never stored as a second source of truth.
--
-- Write architecture (Option B from the audit — no service-role key exists anywhere in this
-- codebase, and introducing one is a bigger, riskier change than this table needs): every
-- insert goes through builders_record_ai_usage(), a SECURITY DEFINER RPC that derives
-- user_id from auth.uid() and independently re-validates project access — it is the ONLY
-- write path (`builders_ai_usage_events` has no INSERT policy for `authenticated` at all).
-- For auth.uid() to resolve inside that RPC, the caller must present a real user JWT, which
-- requires app/lib/ai-usage/aiUsageRepository.ts's `createAuthedClient()` — a fresh,
-- per-request Supabase client carrying the verified caller's own access token as its
-- Authorization header, NOT the shared anon-key `getBuildersDbClient()` singleton every other
-- BuildersDB repository uses (that one carries no session server-side — see the Sprint 42
-- security audit's Part 1 finding). This is the smallest change that makes Option B actually
-- work end to end; it requires no new secret and never touches a service-role key.

create table if not exists builders_ai_usage_events (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  user_id uuid not null references auth.users (id) on delete restrict,
  project_id text references builders_projects (id) on delete set null,
  team_id uuid,
  actor_display_name text,

  -- Request classification — request_type/role_key are deliberately plain text, not enums:
  -- a new AI role or request kind must never require a migration (see the header comment on
  -- the sprint's request_type examples).
  request_type text not null,
  role_key text,
  generation_profile_id text,
  operation_id text,
  parent_operation_id text,

  -- Provider/model
  provider text not null,
  model_key text,
  api_model text not null,

  -- Usage — prefer provider-reported values; store 0/null and set metadata.usage_source =
  -- "unavailable" rather than guess (see recordAiUsage.ts).
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  cached_output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,

  -- Cost — null whenever the model's price isn't in modelPricingRegistry.ts; never a
  -- fabricated estimate. pricing_version is stored alongside so a later price change never
  -- makes an old row look like it used a price it didn't.
  input_cost_usd numeric(14, 8),
  output_cost_usd numeric(14, 8),
  estimated_cost_usd numeric(14, 8),
  pricing_version text,

  -- Execution
  duration_ms integer,
  status text not null,
  error_code text,
  error_message text,
  provider_request_id text,
  repair_attempt_number integer,

  -- Metadata — operational only; never a prompt, response, key, token, or header (see
  -- recordAiUsage.ts's DO NOT STORE list).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint builders_ai_usage_events_status_check check (status in ('success', 'failed', 'cancelled')),

  -- Defense-in-depth: app/lib/ai-usage/recordAiUsage.ts already truncates/redacts
  -- error_message before calling builders_record_ai_usage() (see that function's own
  -- comment), but this constraint means the ledger itself can never accept an oversized
  -- value even from a future/unaudited caller of the RPC.
  constraint builders_ai_usage_events_error_message_length_check check (char_length(error_message) <= 1000)
);

alter table builders_ai_usage_events enable row level security;

-- SELECT-only, own rows only. No INSERT/UPDATE/DELETE policy for `authenticated` at all —
-- writes only ever happen through builders_record_ai_usage() below (SECURITY DEFINER, bypasses
-- RLS as the function owner), and this ledger is append-only/immutable by design, so there is
-- no UPDATE/DELETE path for anyone short of a service-role/admin connection.
drop policy if exists "builders_ai_usage_events_select_own" on builders_ai_usage_events;
create policy "builders_ai_usage_events_select_own" on builders_ai_usage_events
  for select to authenticated
  using (user_id = auth.uid());

-- The one and only write path. Security properties, verified (Sprint 42.2 audit):
--   - user_id is NEVER a parameter — there is no p_user_id. It comes exclusively from
--     auth.uid(), so the browser has no field to supply or override another user's id with,
--     even if it called this RPC directly instead of going through recordAiUsage.ts.
--   - project_id IS a parameter (p_project_id), but is only ever attached to the row when
--     builders_user_can_access_project(p_project_id) confirms the CALLER (auth.uid(), not
--     anything client-supplied) is that project's owner or a member. Chosen behavior for an
--     inaccessible/nonexistent project_id: the event is still recorded (never dropped/
--     rejected outright — a usage event is valuable even without project attribution), just
--     with project_id forced to null rather than the unverified value — see v_project_id
--     below. This means a browser can never attach its own usage, let alone forge someone
--     else's, to a project it doesn't belong to.
--   - No SQL here ever reads a request body / header directly — every value arrives as a
--     typed parameter, and p_error_message is expected to already be length-limited and
--     redacted by the caller (see app/lib/ai-usage/recordAiUsage.ts's sanitizeErrorMessage())
--     before it ever reaches this function.
create or replace function builders_record_ai_usage(
  p_project_id text,
  p_actor_display_name text,
  p_request_type text,
  p_role_key text,
  p_generation_profile_id text,
  p_operation_id text,
  p_parent_operation_id text,
  p_provider text,
  p_model_key text,
  p_api_model text,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_cached_input_tokens bigint default 0,
  p_cached_output_tokens bigint default 0,
  p_total_tokens bigint default 0,
  p_input_cost_usd numeric default null,
  p_output_cost_usd numeric default null,
  p_estimated_cost_usd numeric default null,
  p_pricing_version text default null,
  p_duration_ms integer default null,
  p_status text default 'success',
  p_error_code text default null,
  p_error_message text default null,
  p_provider_request_id text default null,
  p_repair_attempt_number integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_project_id text;
  v_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'builders_record_ai_usage requires an authenticated caller.';
  end if;

  if p_project_id is not null and builders_user_can_access_project(p_project_id) then
    v_project_id := p_project_id;
  else
    v_project_id := null;
  end if;

  insert into builders_ai_usage_events (
    user_id, project_id, actor_display_name, request_type, role_key, generation_profile_id,
    operation_id, parent_operation_id, provider, model_key, api_model,
    input_tokens, output_tokens, cached_input_tokens, cached_output_tokens, total_tokens,
    input_cost_usd, output_cost_usd, estimated_cost_usd, pricing_version,
    duration_ms, status, error_code, error_message, provider_request_id, repair_attempt_number,
    metadata
  ) values (
    v_user_id, v_project_id, p_actor_display_name, p_request_type, p_role_key, p_generation_profile_id,
    p_operation_id, p_parent_operation_id, p_provider, p_model_key, p_api_model,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_cached_input_tokens, 0),
    coalesce(p_cached_output_tokens, 0), coalesce(p_total_tokens, coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0)),
    p_input_cost_usd, p_output_cost_usd, p_estimated_cost_usd, p_pricing_version,
    p_duration_ms, coalesce(p_status, 'success'), p_error_code, p_error_message, p_provider_request_id,
    p_repair_attempt_number, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Explicit `from public` AND `from anon`: revoking from PUBLIC alone already removes anon's
-- only path to this privilege (anon never received an independent grant), but an explicit
-- second revoke means this stays locked down even if a future migration ever grants `anon`
-- something broader by accident — this line doesn't depend on that not happening.
revoke execute on function builders_record_ai_usage(
  text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, bigint, bigint,
  numeric, numeric, numeric, text,
  integer, text, text, text, text, integer, jsonb
) from public;
revoke execute on function builders_record_ai_usage(
  text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, bigint, bigint,
  numeric, numeric, numeric, text,
  integer, text, text, text, text, integer, jsonb
) from anon;
grant execute on function builders_record_ai_usage(
  text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, bigint, bigint,
  numeric, numeric, numeric, text,
  integer, text, text, text, text, integer, jsonb
) to authenticated;

create index if not exists builders_ai_usage_events_user_created_idx on builders_ai_usage_events (user_id, created_at desc);
create index if not exists builders_ai_usage_events_project_created_idx on builders_ai_usage_events (project_id, created_at desc);
create index if not exists builders_ai_usage_events_provider_model_created_idx on builders_ai_usage_events (provider, api_model, created_at desc);
create index if not exists builders_ai_usage_events_request_type_created_idx on builders_ai_usage_events (request_type, created_at desc);
create index if not exists builders_ai_usage_events_status_created_idx on builders_ai_usage_events (status, created_at desc);

-- ============================================================================
-- builders_ai_usage_daily — optional read-only rollup, NOT the source of truth
-- ============================================================================
--
-- `security_invoker = true` (Postgres 15+, which Supabase runs) is what keeps this safe:
-- without it, a view's underlying-table permission checks can use the view OWNER's
-- privileges instead of the querying user's. With it, the view is evaluated as the actual
-- caller, so builders_ai_usage_events' own `select own rows only` RLS policy applies to
-- every row this view reads, exactly as if the caller had queried the table directly — this
-- view has no `where` clause of its own restricting user_id, RLS is the only thing doing
-- that filtering, which is deliberate: it means there's exactly one place (the table's RLS
-- policy) that can ever get this wrong, not two.
create or replace view builders_ai_usage_daily
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as usage_date,
  user_id,
  project_id,
  provider,
  api_model,
  request_type,
  count(*) as request_count,
  count(*) filter (where status = 'success') as success_count,
  count(*) filter (where status = 'failed') as failed_count,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(total_tokens) as total_tokens,
  sum(estimated_cost_usd) as estimated_cost_usd
from builders_ai_usage_events
group by 1, 2, 3, 4, 5, 6;
