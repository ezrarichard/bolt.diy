-- Deployment Verification — Sprint 92 (Deployment Verification & Live Application Validation).
--
-- Adds the persistence layer for verifying that a DEPLOYED application is actually usable — a
-- separate concern from "Vercel finished a build," which Sprint 91 already covers. Purely
-- additive: one new table plus one new function; no existing table, column, policy or function is
-- altered. Idempotent throughout, matching every other migration in this directory.
--
-- WHY A DEDICATED TABLE (Part 15). The alternative — stuffing reports into
-- `builders_project_deployments.metadata` — cannot support what verification needs: multiple
-- attempts per deployment, each with its own evidence, kept forever (a later attempt must never
-- overwrite an earlier one), plus "latest report" and "report history" as ordinary indexed
-- queries. `metadata` is a single JSONB blob with no version dimension; it is the right home for
-- Sprint 90's environment report (exactly one, always current) and the wrong home for this.
--
-- WHY A TRANSACTIONAL FUNCTION (Part 16). Finalising a verification is three writes that must
-- agree with each other: finalise the report row, transition `builders_project_deployments.status`
-- to 'verified', and append exactly one canonical `builders_deployment_history` event. Every other
-- multi-step deployment operation in this codebase (`attachProviderAndTransition`,
-- `updateDeploymentEnvironment`) accepts "one ordered client-side sequence" because a partial
-- failure there is self-evident on the next read — the provider row is either there or it isn't.
-- Verification is different: a partial failure produces a MISLEADING state that reads as
-- authoritative ("Deployment says verified" with no report backing it, or "report says passed"
-- with the Deployment still `deployed` and no history event). That is precisely the case Part 16
-- says to close, so this one operation gets a real transaction — narrowly scoped to those three
-- writes, not a generic workflow engine.
--
-- SECRETS. Nothing written here may contain a credential. The verification engine redacts every
-- evidence value before it reaches this table (see app/lib/deployment/verificationRedaction.ts),
-- and the transiently-held public Supabase anon key that one optional check may use is never
-- included in a report at all.

-- ── builders_deployment_verifications ───────────────────────────────────────
-- One row per verification ATTEMPT. Many rows per deployment — like
-- `builders_deployment_history`, older rows are never overwritten; unlike it, a row IS updated
-- once (from 'running' to its terminal status) as the attempt finishes, which is why this table
-- carries `updated_at`/a trigger and the history table does not.
create table if not exists builders_deployment_verifications (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every provider table in
  -- 20260804100000_deployment_foundation.sql. This is also the column that makes Part 22's
  -- multi-project isolation structural rather than conventional: a report is reachable only
  -- through its own project.
  project_id text not null references builders_projects (id) on delete cascade,

  -- Which Vercel deployment identity this attempt targeted (Part 17 — a retry after a redeploy
  -- must verify the NEW deployment). Null when the provider recorded no deployment id.
  vercel_deployment_id text,

  -- 1-based per deployment. `unique (deployment_id, verification_number)` makes "attempt N+1 never
  -- overwrites attempt N" a schema guarantee.
  verification_number integer not null,

  -- 'running' | 'passed' | 'warning' | 'failed' | 'cancelled' | 'incomplete' — free text validated
  -- at the application layer (app/lib/deployment/verificationTypes.ts), this schema's existing
  -- convention for every lifecycle/status column.
  status text not null default 'running',

  -- The policy that produced this report, pinned so an old report stays interpretable after the
  -- policy changes (app/lib/deployment/verificationPolicy.ts's VERIFICATION_POLICY_VERSION).
  policy_version text not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,

  target_url text,
  final_url text,

  -- Aggregate counts (VerificationSummary) — small, queryable, what the dashboard reads.
  summary jsonb not null default '{}'::jsonb,

  -- Every individual check with its evidence (VerificationCheck[]). Deliberately JSONB rather than
  -- a second child table: checks are only ever read as a whole report, never queried across
  -- deployments, and the check set changes with the policy version.
  checks jsonb not null default '[]'::jsonb,

  message text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deployment_id, verification_number)
);

create index if not exists builders_deployment_verifications_project_id_idx
  on builders_deployment_verifications (project_id);
create index if not exists builders_deployment_verifications_deployment_idx
  on builders_deployment_verifications (deployment_id, verification_number desc);
create index if not exists builders_deployment_verifications_status_idx
  on builders_deployment_verifications (deployment_id, status);

-- Part 17 — "only one active verification attempt per Deployment," enforced by the database rather
-- than by a client-side flag a second browser tab would not see.
create unique index if not exists builders_deployment_verifications_one_active_idx
  on builders_deployment_verifications (deployment_id)
  where status = 'running';

drop trigger if exists set_updated_at on builders_deployment_verifications;
create trigger set_updated_at before update on builders_deployment_verifications
  for each row execute function builders_set_updated_at();

alter table builders_deployment_verifications enable row level security;

drop policy if exists "builders_deployment_verifications_select" on builders_deployment_verifications;
create policy "builders_deployment_verifications_select" on builders_deployment_verifications
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_deployment_verifications_write" on builders_deployment_verifications;
create policy "builders_deployment_verifications_write" on builders_deployment_verifications
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_finalize_deployment_verification ───────────────────────────────
-- The one transactional operation (Part 16). Given an already-started verification row, it:
--
--   1. Finalises that row with its terminal status, summary, checks and timings.
--   2. Transitions builders_project_deployments 'deployed' -> 'verified' — ONLY when the caller
--      says the report permits it (the pass/warning rule lives in
--      app/lib/deployment/verificationTypes.ts's `reportPermitsVerified`, not duplicated here) AND
--      the deployment is genuinely still 'deployed'.
--   3. Appends EXACTLY ONE canonical history event: 'verification_passed' when it transitioned,
--      'verification_failed'/'verification_cancelled' otherwise. Never one event per check —
--      Deployment History stays high-level lifecycle; the detail lives in the report.
--
-- Idempotency for retries (Part 17): a deployment that is ALREADY 'verified' does not transition
-- again and gets NO second 'verification_passed' event — the report is still persisted, so a
-- re-verification is fully recorded without duplicating the lifecycle event. The return value
-- tells the caller which of those happened.
--
-- security definer with a hard `builders_user_can_edit_project` check: the function must be able
-- to write all three tables in one transaction, but only ever for a project the caller may edit.
create or replace function builders_finalize_deployment_verification(
  p_verification_id uuid,
  p_status text,
  p_summary jsonb,
  p_checks jsonb,
  p_message text,
  p_final_url text,
  p_duration_ms integer,
  p_permits_verified boolean,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification builders_deployment_verifications%rowtype;
  v_deployment builders_project_deployments%rowtype;
  v_transitioned boolean := false;
  v_event_type text;
  v_to_status text;
begin
  select * into v_verification
  from builders_deployment_verifications
  where id = p_verification_id
  for update;

  if not found then
    raise exception 'Verification % does not exist.', p_verification_id;
  end if;

  if not builders_user_can_edit_project(v_verification.project_id) then
    raise exception 'Not authorised to finalise verifications for project %.', v_verification.project_id;
  end if;

  select * into v_deployment
  from builders_project_deployments
  where id = v_verification.deployment_id
  for update;

  if not found then
    raise exception 'Deployment % does not exist.', v_verification.deployment_id;
  end if;

  update builders_deployment_verifications
  set status = p_status,
      summary = coalesce(p_summary, '{}'::jsonb),
      checks = coalesce(p_checks, '[]'::jsonb),
      message = p_message,
      final_url = p_final_url,
      duration_ms = p_duration_ms,
      completed_at = now()
  where id = p_verification_id;

  -- Step 2 — the ONLY place this migration's domain moves a Deployment to 'verified'.
  if p_permits_verified and v_deployment.status = 'deployed' then
    update builders_project_deployments
    set status = 'verified'
    where id = v_deployment.id;

    v_transitioned := true;
  end if;

  -- Step 3 — exactly one canonical event, and never a duplicate 'verification_passed'.
  if v_transitioned then
    v_event_type := 'verification_passed';
    v_to_status := 'verified';
  elsif p_permits_verified then
    -- Already verified (a re-verification that passed again): report persisted, no second event.
    return jsonb_build_object(
      'transitioned', false,
      'duplicate', v_deployment.status = 'verified',
      'eventRecorded', false,
      'deploymentStatus', v_deployment.status
    );
  elsif p_status = 'cancelled' then
    v_event_type := 'verification_cancelled';
    v_to_status := v_deployment.status;
  else
    v_event_type := 'verification_failed';
    v_to_status := v_deployment.status;
  end if;

  insert into builders_deployment_history (
    deployment_id, project_id, event_type, from_status, to_status, provider, message, metadata, created_by
  ) values (
    v_verification.deployment_id,
    v_verification.project_id,
    v_event_type,
    v_deployment.status,
    v_to_status,
    'vercel',
    p_message,
    jsonb_build_object(
      'verificationId', p_verification_id,
      'verificationNumber', v_verification.verification_number,
      'policyVersion', v_verification.policy_version,
      'summary', coalesce(p_summary, '{}'::jsonb)
    ),
    p_created_by
  );

  return jsonb_build_object(
    'transitioned', v_transitioned,
    'duplicate', false,
    'eventRecorded', true,
    'deploymentStatus', case when v_transitioned then 'verified' else v_deployment.status end
  );
end;
$$;

revoke execute on function builders_finalize_deployment_verification(
  uuid, text, jsonb, jsonb, text, text, integer, boolean, text
) from public;
revoke execute on function builders_finalize_deployment_verification(
  uuid, text, jsonb, jsonb, text, text, integer, boolean, text
) from anon;
grant execute on function builders_finalize_deployment_verification(
  uuid, text, jsonb, jsonb, text, text, integer, boolean, text
) to authenticated;
