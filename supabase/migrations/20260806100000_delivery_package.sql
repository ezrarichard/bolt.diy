-- Customer Delivery Package — Sprint 93.
--
-- The official handover artifact for a verified Deployment, and the `verified -> delivery_ready`
-- lifecycle step that goes with it. Purely additive: one new table, one new function, and one
-- `create or replace` of the Sprint 92 verification finaliser (explained at the bottom). No
-- existing table, column or policy is altered. Idempotent throughout.
--
-- WHY A DEDICATED TABLE (Part 9). Same reasoning as Sprint 92's verification table, for the same
-- reasons: a Delivery Package is regenerated whenever the delivery story changes (a redeploy, a
-- re-verification, a corrected environment variable), and every generation must be kept — a
-- handover document that silently rewrites itself is not a handover document. That needs a version
-- dimension, "latest package" and "package history" as ordinary indexed queries, and a per-attempt
-- number. `builders_project_deployments.metadata` is a single blob with none of that.
--
-- WHY A TRANSACTIONAL FUNCTION (Part 15 / Sprint 92 precedent). Generating a package is three
-- writes that must agree: insert the package row, transition the Deployment to `delivery_ready`,
-- and append exactly one canonical history event. A partial failure here produces misleading
-- state in exactly the way Sprint 92 identified — "Deployment says delivery_ready" with no package
-- behind it, or a stored package the lifecycle and history never acknowledge. So this operation
-- gets the same narrow transaction treatment, and nothing broader.
--
-- SECRETS. `delivery_summary` is assembled by app/lib/services/deliveryPackageService.ts, which
-- carries environment variable NAMES and statuses only — never a value, token, key or connection
-- string. See that file's header comment.

-- ── builders_delivery_packages ──────────────────────────────────────────────
-- One row per package GENERATION. Many rows per deployment; an earlier package is never
-- overwritten (`unique (deployment_id, package_number)` makes that a schema guarantee, not a
-- convention).
create table if not exists builders_delivery_packages (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every other table in the
  -- Deployment domain. This is also what makes Part 14's multi-project isolation structural: a
  -- package is only ever reachable through its own project.
  project_id text not null references builders_projects (id) on delete cascade,

  -- 1-based per deployment.
  package_number integer not null,

  -- The DELIVERY PACKAGE MODEL's shape version (app/lib/deployment/deliveryPackageTypes.ts's
  -- DELIVERY_PACKAGE_MODEL_VERSION), pinned so an old package stays interpretable after the model
  -- changes. Distinct from `generator_version`, which is the Builders build that produced it.
  package_version text not null,
  generator_version text not null,

  -- 'generated' is the only status this sprint writes. Free text, validated at the application
  -- layer — this schema's existing convention. Reserved for Sprint 94's release states.
  status text not null default 'generated',

  -- Traceability back to the exact artifacts this package attests to.
  manifest_version integer,
  verification_id uuid references builders_deployment_verifications (id) on delete set null,

  -- Advisory completeness (Part 10) — stored denormalized so the dashboard and any future
  -- "delivery health" query never has to parse the JSONB.
  completeness_score integer not null default 0,
  completeness_level text not null default 'incomplete',

  -- The full sectioned DeliveryPackage. JSONB rather than a table per section: a package is only
  -- ever read as a whole document, never queried across projects, and its section set moves with
  -- `package_version`.
  delivery_summary jsonb not null default '{}'::jsonb,

  generated_at timestamptz not null default now(),
  generated_by text,
  created_at timestamptz not null default now(),

  unique (deployment_id, package_number)
);

create index if not exists builders_delivery_packages_project_id_idx
  on builders_delivery_packages (project_id);
create index if not exists builders_delivery_packages_deployment_idx
  on builders_delivery_packages (deployment_id, package_number desc);
create index if not exists builders_delivery_packages_verification_idx
  on builders_delivery_packages (verification_id);

alter table builders_delivery_packages enable row level security;

drop policy if exists "builders_delivery_packages_select" on builders_delivery_packages;
create policy "builders_delivery_packages_select" on builders_delivery_packages
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_delivery_packages_write" on builders_delivery_packages;
create policy "builders_delivery_packages_write" on builders_delivery_packages
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_record_delivery_package ────────────────────────────────────────
-- The one transactional operation. Given an assembled package, it:
--
--   1. Allocates the next `package_number` for this deployment and inserts the package row.
--   2. Transitions builders_project_deployments 'verified' -> 'delivery_ready'. Only from
--      'verified': a Deployment that was never verified must never be presented as ready to hand
--      over, and the caller's own precondition check is deliberately repeated here so the rule
--      holds even if a future call site forgets it.
--   3. Appends EXACTLY ONE canonical history event (Part 15):
--        'delivery_package_generated' — the first package, which also transitioned the lifecycle.
--        'delivery_package_updated'   — a regeneration for an already-delivery_ready Deployment.
--      Never one event per section, and never a second 'delivery_package_generated'.
--
-- Returns the inserted row's identity plus which of those happened, so the caller never has to
-- re-read to find out.
--
-- security definer with a hard `builders_user_can_edit_project` check: the function must write
-- three tables in one transaction, but only ever for a project the caller may edit.
create or replace function builders_record_delivery_package(
  p_deployment_id uuid,
  p_project_id text,
  p_package_version text,
  p_generator_version text,
  p_manifest_version integer,
  p_verification_id uuid,
  p_completeness_score integer,
  p_completeness_level text,
  p_delivery_summary jsonb,
  p_generated_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deployment builders_project_deployments%rowtype;
  v_package_number integer;
  v_id uuid;
  v_generated_at timestamptz;
  v_transitioned boolean := false;
  v_event_type text;
  v_to_status text;
begin
  if not builders_user_can_edit_project(p_project_id) then
    raise exception 'Not authorised to record delivery packages for project %.', p_project_id;
  end if;

  select * into v_deployment
  from builders_project_deployments
  where id = p_deployment_id
  for update;

  if not found then
    raise exception 'Deployment % does not exist.', p_deployment_id;
  end if;

  if v_deployment.project_id <> p_project_id then
    raise exception 'Deployment % does not belong to project %.', p_deployment_id, p_project_id;
  end if;

  if v_deployment.status not in ('verified', 'delivery_ready') then
    raise exception 'Deployment must be verified before a delivery package can be generated (currently: %).',
      v_deployment.status;
  end if;

  select coalesce(max(package_number), 0) + 1 into v_package_number
  from builders_delivery_packages
  where deployment_id = p_deployment_id;

  insert into builders_delivery_packages (
    deployment_id, project_id, package_number, package_version, generator_version,
    status, manifest_version, verification_id, completeness_score, completeness_level,
    delivery_summary, generated_by
  ) values (
    p_deployment_id, p_project_id, v_package_number, p_package_version, p_generator_version,
    'generated', p_manifest_version, p_verification_id, coalesce(p_completeness_score, 0),
    coalesce(p_completeness_level, 'incomplete'), coalesce(p_delivery_summary, '{}'::jsonb), p_generated_by
  )
  returning id, generated_at into v_id, v_generated_at;

  if v_deployment.status = 'verified' then
    update builders_project_deployments
    set status = 'delivery_ready'
    where id = p_deployment_id;

    v_transitioned := true;
    v_event_type := 'delivery_package_generated';
    v_to_status := 'delivery_ready';
  else
    -- Already delivery_ready: a regeneration. Recorded, but never as a second "generated" event.
    v_event_type := 'delivery_package_updated';
    v_to_status := v_deployment.status;
  end if;

  insert into builders_deployment_history (
    deployment_id, project_id, event_type, from_status, to_status, provider, message, metadata, created_by
  ) values (
    p_deployment_id,
    p_project_id,
    v_event_type,
    v_deployment.status,
    v_to_status,
    null,
    format('Delivery package #%s generated (%s%% complete).', v_package_number, coalesce(p_completeness_score, 0)),
    jsonb_build_object(
      'deliveryPackageId', v_id,
      'packageNumber', v_package_number,
      'packageVersion', p_package_version,
      'generatorVersion', p_generator_version,
      'completenessScore', coalesce(p_completeness_score, 0),
      'completenessLevel', coalesce(p_completeness_level, 'incomplete'),
      'verificationId', p_verification_id
    ),
    p_generated_by
  );

  return jsonb_build_object(
    'id', v_id,
    'packageNumber', v_package_number,
    'generatedAt', v_generated_at,
    'transitioned', v_transitioned,
    'eventType', v_event_type,
    'deploymentStatus', case when v_transitioned then 'delivery_ready' else v_deployment.status end
  );
end;
$$;

revoke execute on function builders_record_delivery_package(
  uuid, text, text, text, integer, uuid, integer, text, jsonb, text
) from public;
revoke execute on function builders_record_delivery_package(
  uuid, text, text, text, integer, uuid, integer, text, jsonb, text
) from anon;
grant execute on function builders_record_delivery_package(
  uuid, text, text, text, integer, uuid, integer, text, jsonb, text
) to authenticated;

-- ── builders_finalize_deployment_verification (replaced) ────────────────────
-- Sprint 92's verification finaliser, replaced ONLY to teach it about the new `delivery_ready`
-- status. Sprint 93 allows re-verifying a Deployment that has already been packaged (a redeploy
-- and re-verify is a normal thing to do after handover), and without this change such a run would
-- fall through the function's "already verified" branch and record nothing at all — the report
-- would persist with no history event and no explanation. The only edit is the duplicate check
-- below; every other line is identical to 20260805100000_deployment_verification.sql, and the
-- rules that file documents (transition only from 'deployed', exactly one canonical event, never a
-- duplicate 'verification_passed') are unchanged.
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

  if p_permits_verified and v_deployment.status = 'deployed' then
    update builders_project_deployments
    set status = 'verified'
    where id = v_deployment.id;

    v_transitioned := true;
  end if;

  if v_transitioned then
    v_event_type := 'verification_passed';
    v_to_status := 'verified';
  elsif p_permits_verified then
    -- Sprint 93: 'delivery_ready' joins 'verified' here — a re-verification of an already-packaged
    -- Deployment is a duplicate pass, not an unrecorded no-op.
    return jsonb_build_object(
      'transitioned', false,
      'duplicate', v_deployment.status in ('verified', 'delivery_ready'),
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
