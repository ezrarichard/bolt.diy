-- Assembly Auto-Repair sprint — corrective migration for two recurring backend errors found
-- during the StyleHub Coimbatore smoke test.
--
-- ============================================================================
-- Issue 1: PGRST202 "Could not find the function public.builders_record_ai_usage(...)"
-- ============================================================================
--
-- Root cause (confirmed by directly probing the live BuildersDB REST API with the exact
-- named parameters app/lib/ai-usage/aiUsageRepository.ts's `insertUsageEvent()` sends — not
-- guessed): the function genuinely does not exist in the deployed schema. It IS defined in
-- 20260710100000_project_ownership_and_rls.sql (line ~478), but that migration only
-- partially landed — a companion function from the SAME file, `builders_user_can_edit_project`
-- (defined ~300 lines earlier, line 183), is confirmed present live (PostgREST's own error
-- "hint" field for the failing call suggested it as the nearest-name match), while
-- `builders_record_ai_usage`, defined near the end of that same file, is not. Something
-- between those two points in that migration run either errored out partway (leaving the
-- migration un-recorded as applied, so a later full re-run was never attempted) or the
-- deploy pipeline's application of that specific file was interrupted.
--
-- This migration does NOT try to re-run the entire ~550-line original file (too large a
-- surface to safely replay blind, and most of it — the ownership/RLS policy changes — may
-- already be live). It only re-issues the exact `builders_record_ai_usage` function body verbatim,
-- with `create or replace function`, which is always safe to run whether or not the function already
-- exists.
--
-- If, after running this, other symptoms suggest the ownership/RLS half of that migration
-- is ALSO missing (e.g. `builders_user_can_access_project` not found), the fix is to re-run
-- 20260710100000_project_ownership_and_rls.sql in full — every statement in it already uses
-- `create or replace` / `drop policy if exists` / `create table if not exists`, so it's safe
-- to replay wholesale even for the parts that did land.

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

-- ============================================================================
-- Issue 2: 42501 "new row violates row-level security policy for
-- table \"builders_shared_provider_settings\""
-- ============================================================================
--
-- Root cause: 20260710100000_project_ownership_and_rls.sql's own header comment already
-- diagnoses this precisely — it narrowed builders_shared_provider_settings (a catalog table
-- storing only "does provider X have a shared key configured", never a secret value — see
-- 20260709020000_shared_provider_settings.sql's header) from the original Sprint 38.4
-- `for all using(true) with check(true)` down to `select`-only for `authenticated`, closing an
-- unrestricted-write hole on the whole catalog-tables group. That migration's own comment
-- explicitly flags the one write path this leaves broken — providerSettingsRepository.ts's
-- `upsertSharedProviderSettings()`, called from the server-side loader
-- app/routes/api.shared-key-status.ts — as "a follow-up, not part of this migration."
-- This migration is that follow-up.
--
-- The fix mirrors builders_record_ai_usage's own pattern exactly: a SECURITY DEFINER RPC is
-- the only write path, so the underlying table stays locked down to select-only (no direct
-- INSERT/UPDATE/DELETE grant to anon or authenticated — this migration does NOT touch or
-- widen the table's own RLS policy at all). Unlike builders_record_ai_usage, this RPC cannot
-- require auth.uid() — providerSettingsRepository.ts's caller has no user session (it runs
-- from a server-side loader reporting server-configured env vars, not anything
-- user-specific), so it calls BuildersDB with only the anon key. Granting `anon` execute on a
-- SECURITY DEFINER function does mean anyone holding the (intentionally public) Supabase
-- anon key could call this RPC directly, bypassing the app route — so, as defense in depth
-- given that reality, the function validates its own inputs instead of trusting the caller:
-- provider_key/display_name are constrained to a short alphanumeric-ish shape (a real
-- provider slug/display name, never arbitrary long text), and the function can only ever
-- touch THIS one small catalog table — never any user or project data. Worst case for an
-- untrusted caller abusing this RPC directly is a cosmetic status flag flipped on this
-- catalog table, not a data-integrity or privacy issue.

create or replace function builders_upsert_shared_provider_settings(
  p_provider_key text,
  p_display_name text,
  p_shared_key_configured boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_provider_key is null or length(p_provider_key) = 0 or length(p_provider_key) > 64
     or p_provider_key !~ '^[a-zA-Z0-9_.-]+$' then
    raise exception 'builders_upsert_shared_provider_settings: invalid provider_key.';
  end if;

  if p_display_name is null or length(p_display_name) = 0 or length(p_display_name) > 128 then
    raise exception 'builders_upsert_shared_provider_settings: invalid display_name.';
  end if;

  insert into builders_shared_provider_settings (
    provider_key, display_name, enabled, shared_key_configured, last_verified_at
  ) values (
    p_provider_key, p_display_name, p_shared_key_configured, p_shared_key_configured, now()
  )
  on conflict (provider_key) do update set
    display_name = excluded.display_name,
    enabled = excluded.enabled,
    shared_key_configured = excluded.shared_key_configured,
    last_verified_at = excluded.last_verified_at;
end;
$$;

revoke execute on function builders_upsert_shared_provider_settings(text, text, boolean) from public;
grant execute on function builders_upsert_shared_provider_settings(text, text, boolean) to anon;
grant execute on function builders_upsert_shared_provider_settings(text, text, boolean) to authenticated;
