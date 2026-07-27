-- Release Management & Customer Acceptance — Sprint 94.
--
-- A Release is the immutable baseline every future change request, bug fix, enhancement and MVP2
-- feature will be measured against. This migration adds the `delivery_ready -> released` step and
-- the persistence behind it. Purely additive: one new table, two new functions; no existing table,
-- column or policy is altered. Idempotent throughout.
--
-- WHY A DEDICATED TABLE (Part 7). A project accumulates releases over its whole life (1.0.0,
-- 1.0.1, 1.1.0, ...) and an old release must remain readable forever — it is the baseline a later
-- change is diffed against. That needs a version dimension, "latest release" and "release history"
-- as indexed queries, and an immutability guarantee. `builders_project_deployments.metadata` has
-- none of those. This mirrors the Sprint 92 verification and Sprint 93 delivery-package tables.
--
-- WHY TRANSACTIONS (Part 11/14). Creating a release is four writes that must agree: insert the
-- release, supersede whichever release currently holds `released`, transition the Deployment to
-- `released` (and stamp its existing, previously-unused `released_at` column), and append exactly
-- one canonical history event. Recording customer acceptance is two: update the release and append
-- one event. A partial failure in either would produce state that reads as authoritative but is
-- not — a Deployment claiming `released` with no release behind it, or two releases both claiming
-- to be the live one. Same reasoning as the two preceding sprints, applied to the same narrow
-- scope; this is not a general workflow engine.
--
-- IMMUTABILITY. Nothing here ever updates a release's baseline, notes, version or integrity. The
-- only mutable columns after insert are `release_status` (set to 'superseded' when a newer release
-- arrives) and the customer-acceptance columns — which is exactly Part 5's rule that acceptance
-- changes release state and nothing else.
--
-- SECRETS. A release stores identifiers, versions, checksums and URLs assembled by
-- app/lib/services/releaseManagementService.ts. No token, key or connection string reaches it.

-- ── builders_releases ───────────────────────────────────────────────────────
create table if not exists builders_releases (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references builders_project_deployments (id) on delete cascade,

  -- Denormalized for direct RLS/query access without a join, matching every other table in the
  -- Deployment domain, and what makes Part 13's multi-project isolation structural: a release is
  -- only ever reachable through its own project.
  project_id text not null references builders_projects (id) on delete cascade,

  -- 1-based per deployment, in creation order.
  release_number integer not null,

  -- MAJOR.MINOR.PATCH, always supplied explicitly by the operator — never auto-incremented (see
  -- app/lib/deployment/semanticVersion.ts, the one place this is parsed and validated).
  semantic_version text not null,
  release_name text not null,

  -- 'major' | 'minor' | 'patch' — the operator's stated intent.
  release_type text not null,

  -- 'released' | 'superseded'. Free text validated at the application layer, this schema's
  -- existing convention for every lifecycle column.
  release_status text not null default 'released',
  release_date timestamptz not null default now(),

  -- Frozen references (Part 8). Kept as real FKs so a deleted package/verification is visible
  -- rather than a dangling id, and `on delete set null` because losing the referenced row must
  -- never delete the release itself — the baseline's own frozen copy of those facts lives in
  -- `baseline`.
  delivery_package_id uuid references builders_delivery_packages (id) on delete set null,
  verification_id uuid references builders_deployment_verifications (id) on delete set null,
  manifest_version integer,

  -- The complete frozen baseline (ReleaseBaseline) — manifest/package/verification/blueprint/
  -- repository/database identity and versions as they were at release time. This is what Sprint 95
  -- will diff a new manifest against.
  baseline jsonb not null default '{}'::jsonb,

  -- Grounded release notes (ReleaseNotes), projected from the delivery package current at release
  -- time. Stored, not recomputed: the package can be regenerated later, the notes must not change.
  release_notes jsonb not null default '{}'::jsonb,

  -- Integrity checks + checksum over the baseline (ReleaseIntegrity).
  integrity jsonb not null default '{}'::jsonb,

  -- ── Customer acceptance (Part 5) ─────────────────────────────────────────
  -- 'pending' | 'accepted' | 'accepted_with_conditions' | 'needs_revision' | 'rejected'.
  -- These are the ONLY columns (besides release_status) that ever change after insert.
  customer_acceptance_state text not null default 'pending',
  customer_acceptance_notes text,
  customer_acceptance_conditions jsonb not null default '[]'::jsonb,
  customer_acceptance_recorded_by text,
  customer_acceptance_recorded_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Part 14 — a version is used at most once per deployment. The application checks this too, so
  -- the operator gets a sentence rather than a constraint violation; this is the real enforcement.
  unique (deployment_id, semantic_version),
  unique (deployment_id, release_number)
);

create index if not exists builders_releases_project_id_idx on builders_releases (project_id);
create index if not exists builders_releases_deployment_idx on builders_releases (deployment_id, release_number desc);
create index if not exists builders_releases_status_idx on builders_releases (deployment_id, release_status);
create index if not exists builders_releases_delivery_package_idx on builders_releases (delivery_package_id);

drop trigger if exists set_updated_at on builders_releases;
create trigger set_updated_at before update on builders_releases
  for each row execute function builders_set_updated_at();

alter table builders_releases enable row level security;

drop policy if exists "builders_releases_select" on builders_releases;
create policy "builders_releases_select" on builders_releases
  for select to authenticated
  using (builders_user_can_access_project(project_id));

drop policy if exists "builders_releases_write" on builders_releases;
create policy "builders_releases_write" on builders_releases
  for all to authenticated
  using (builders_user_can_edit_project(project_id))
  with check (builders_user_can_edit_project(project_id));

-- ── builders_create_release ─────────────────────────────────────────────────
-- The release transaction. Given an already-assembled Release, it:
--
--   1. Verifies the Deployment is 'delivery_ready' (or already 'released', for a follow-up
--      release such as 1.0.0 -> 1.0.1). The caller checks this too; this is the enforcement.
--   2. Allocates the next release_number and inserts the release.
--   3. Supersedes whichever release currently holds 'released' — at most one live release per
--      deployment, the same rule mvpRepository.releaseMvp applies to MVPs.
--   4. Transitions the Deployment to 'released' and stamps `released_at` (an existing column that
--      has had no writer until now).
--   5. Appends EXACTLY ONE canonical history event: 'release_created'.
--
-- Deliberately does NOT touch builders_mvps. Moving an MVP to 'released' is a Product-scope
-- decision with its own auto-supersede side effects (mvpRepository.releaseMvp); bundling it into
-- a Deployment-scope transaction would make one operator action silently rewrite two lifecycles.
-- The MVP is recorded in the baseline for traceability instead.
create or replace function builders_create_release(
  p_deployment_id uuid,
  p_project_id text,
  p_semantic_version text,
  p_release_name text,
  p_release_type text,
  p_delivery_package_id uuid,
  p_verification_id uuid,
  p_manifest_version integer,
  p_baseline jsonb,
  p_release_notes jsonb,
  p_integrity jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deployment builders_project_deployments%rowtype;
  v_release_number integer;
  v_id uuid;
  v_release_date timestamptz;
  v_superseded integer := 0;
  v_transitioned boolean := false;
begin
  if not builders_user_can_edit_project(p_project_id) then
    raise exception 'Not authorised to create releases for project %.', p_project_id;
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

  if v_deployment.status not in ('delivery_ready', 'released', 'maintenance') then
    raise exception 'Deployment must have a delivery package before it can be released (currently: %).',
      v_deployment.status;
  end if;

  select coalesce(max(release_number), 0) + 1 into v_release_number
  from builders_releases
  where deployment_id = p_deployment_id;

  insert into builders_releases (
    deployment_id, project_id, release_number, semantic_version, release_name, release_type,
    release_status, delivery_package_id, verification_id, manifest_version,
    baseline, release_notes, integrity, metadata, created_by
  ) values (
    p_deployment_id, p_project_id, v_release_number, p_semantic_version, p_release_name, p_release_type,
    'released', p_delivery_package_id, p_verification_id, p_manifest_version,
    coalesce(p_baseline, '{}'::jsonb), coalesce(p_release_notes, '{}'::jsonb),
    coalesce(p_integrity, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb), p_created_by
  )
  returning id, release_date into v_id, v_release_date;

  -- At most one live release per deployment.
  update builders_releases
  set release_status = 'superseded'
  where deployment_id = p_deployment_id
    and id <> v_id
    and release_status = 'released';

  get diagnostics v_superseded = row_count;

  if v_deployment.status <> 'released' then
    update builders_project_deployments
    set status = 'released',
        released_at = coalesce(released_at, now())
    where id = p_deployment_id;

    v_transitioned := true;
  end if;

  insert into builders_deployment_history (
    deployment_id, project_id, event_type, from_status, to_status, provider, message, metadata, created_by
  ) values (
    p_deployment_id,
    p_project_id,
    'release_created',
    v_deployment.status,
    case when v_transitioned then 'released' else v_deployment.status end,
    null,
    format('Release %s (%s) created.', p_semantic_version, p_release_type),
    jsonb_build_object(
      'releaseId', v_id,
      'releaseNumber', v_release_number,
      'semanticVersion', p_semantic_version,
      'releaseType', p_release_type,
      'deliveryPackageId', p_delivery_package_id,
      'verificationId', p_verification_id,
      'supersededReleases', v_superseded
    ),
    p_created_by
  );

  return jsonb_build_object(
    'id', v_id,
    'releaseNumber', v_release_number,
    'releaseDate', v_release_date,
    'transitioned', v_transitioned,
    'supersededReleases', v_superseded,
    'deploymentStatus', case when v_transitioned then 'released' else v_deployment.status end
  );
end;
$$;

revoke execute on function builders_create_release(
  uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text
) from public;
revoke execute on function builders_create_release(
  uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text
) from anon;
grant execute on function builders_create_release(
  uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

-- ── builders_record_release_acceptance ──────────────────────────────────────
-- Part 5/11. Records the customer's decision on a release and appends exactly one canonical
-- history event: 'customer_accepted' for accepted/accepted_with_conditions, 'customer_rejected'
-- for rejected/needs_revision (the precise state is kept on the release and in the event
-- metadata — see app/lib/deployment/releaseTypes.ts's `acceptanceHistoryEvent`).
--
-- Touches NOTHING else. No engineering artifact, no manifest, no feature, no deployment status:
-- a customer rejecting a release does not un-deploy or un-verify anything that really happened.
-- Re-recording a decision updates the same release and writes one further event, so the history
-- reads as the genuine sequence of customer responses rather than collapsing them.
create or replace function builders_record_release_acceptance(
  p_release_id uuid,
  p_state text,
  p_event_type text,
  p_notes text default null,
  p_conditions jsonb default '[]'::jsonb,
  p_recorded_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release builders_releases%rowtype;
  v_recorded_at timestamptz;
begin
  select * into v_release
  from builders_releases
  where id = p_release_id
  for update;

  if not found then
    raise exception 'Release % does not exist.', p_release_id;
  end if;

  if not builders_user_can_edit_project(v_release.project_id) then
    raise exception 'Not authorised to record acceptance for project %.', v_release.project_id;
  end if;

  if p_state not in ('pending', 'accepted', 'accepted_with_conditions', 'needs_revision', 'rejected') then
    raise exception 'Unknown customer acceptance state: %.', p_state;
  end if;

  v_recorded_at := now();

  update builders_releases
  set customer_acceptance_state = p_state,
      customer_acceptance_notes = p_notes,
      customer_acceptance_conditions = coalesce(p_conditions, '[]'::jsonb),
      customer_acceptance_recorded_by = p_recorded_by,
      customer_acceptance_recorded_at = v_recorded_at
  where id = p_release_id;

  if p_event_type is not null then
    insert into builders_deployment_history (
      deployment_id, project_id, event_type, from_status, to_status, provider, message, metadata, created_by
    ) values (
      v_release.deployment_id,
      v_release.project_id,
      p_event_type,
      null,
      null,
      null,
      format('Customer response recorded for release %s: %s.', v_release.semantic_version, p_state),
      jsonb_build_object(
        'releaseId', p_release_id,
        'semanticVersion', v_release.semantic_version,
        'acceptanceState', p_state,
        'previousState', v_release.customer_acceptance_state
      ),
      p_recorded_by
    );
  end if;

  return jsonb_build_object(
    'releaseId', p_release_id,
    'state', p_state,
    'previousState', v_release.customer_acceptance_state,
    'recordedAt', v_recorded_at,
    'eventRecorded', p_event_type is not null
  );
end;
$$;

revoke execute on function builders_record_release_acceptance(uuid, text, text, text, jsonb, text) from public;
revoke execute on function builders_record_release_acceptance(uuid, text, text, text, jsonb, text) from anon;
grant execute on function builders_record_release_acceptance(uuid, text, text, text, jsonb, text) to authenticated;
