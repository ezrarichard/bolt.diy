-- ============================================================================
-- AI Usage Ledger — repair migration
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- The AI usage ledger (builders_ai_usage_events, its RLS policy, the
-- builders_record_ai_usage() write RPC, its indexes and the
-- builders_ai_usage_daily rollup view) was originally APPENDED to
-- 20260710100000_project_ownership_and_rls.sql, a migration that had already
-- been applied to the database by the time the ledger section was added to it
-- (see commit b2dd65e).
--
-- Supabase tracks applied migrations by version, not by content, so editing an
-- already-applied file never re-runs it. The result: every object below exists
-- in source but has never existed in the database. Because recordAiUsage() is
-- deliberately non-blocking and swallows its own failures (so a telemetry
-- problem can never break a generation), this failed SILENTLY — no AI usage has
-- ever been recorded, and the Observability dashboard correctly reported
-- "unavailable" because the table genuinely was not there.
--
-- This migration re-declares those objects in a NEW version so they actually
-- get created. It is a verbatim copy of that section and is fully idempotent
-- (create table if not exists / drop policy if exists / create or replace /
-- create index if not exists), so it is safe to run against a database where
-- some or all of it somehow already exists, and safe to re-run.
--
-- Nothing here alters or drops existing data.
-- ============================================================================

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
