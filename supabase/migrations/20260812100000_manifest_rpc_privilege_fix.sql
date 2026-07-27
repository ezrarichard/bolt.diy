-- Manifest RPC privilege + NULL-guard fix — Sprint 98A live verification.
--
-- TWO DEFECTS FOUND BY VERIFYING THE APPLIED MIGRATION AGAINST THE LIVE DATABASE, both introduced
-- by 20260811100000 and neither detectable from unit tests (they are database-privilege behaviour).
--
-- DEFECT 1 — anon could execute the function.
--   20260811100000 did `revoke all ... from public` only. Supabase's default privileges grant
--   EXECUTE on new public-schema functions to `anon` DIRECTLY, and revoking from PUBLIC does not
--   remove a direct role grant. Verified live: calling the RPC with only the anon key reached the
--   INSERT and failed on a foreign key (23503), whereas the equivalent Sprint 92/94 function
--   (`builders_record_delivery_package`) correctly returned 42501 permission denied.
--   Those migrations revoke from `public` AND `anon`; this restores that proven pattern.
--
-- DEFECT 2 — the authorisation guard was skipped when the check returned NULL.
--   `builders_user_can_edit_project('<unknown project>')` returns NULL, not false. In plpgsql
--   `if not NULL then` evaluates to NULL, which is not true, so the `raise exception` branch never
--   ran and execution fell through to the INSERT. Verified live by the same probe.
--   `coalesce(..., false)` makes the guard fail closed.
--
-- NOTE ON SCOPE. The same `if not builders_user_can_edit_project(...)` pattern appears in the
-- Sprint 92/93/94/95 definer functions. Those are NOT changed here: they are protected by the
-- correct revoke, so they are not exploitable, and rewriting five applied migrations is outside a
-- verification sprint. Recorded as a Sprint 98B item.
--
-- Idempotent and safe to re-run. Replaces the function body in place; no table, column or data is
-- touched, and the signature is unchanged so no caller needs updating.

create or replace function builders_save_application_manifest(
  p_project_id text,
  p_version integer,
  p_framework text,
  p_package_manager text,
  p_entry_file text,
  p_total_files integer,
  p_plan_checksum text,
  p_source_content_checksum text,
  p_metadata jsonb,
  p_files jsonb,
  p_mvp_id uuid default null,
  p_source_package_assembled_at timestamptz default null,
  p_created_by text default null,
  p_supersede_manifest_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manifest builders_application_manifests%rowtype;
begin
  -- FAILS CLOSED. `coalesce` is the fix for Defect 2: an unknown project yields NULL, and without
  -- this the guard silently passed.
  if not coalesce(builders_user_can_edit_project(p_project_id), false) then
    raise exception 'Not authorised to save an application manifest for project %.', p_project_id;
  end if;

  if p_supersede_manifest_id is not null then
    update builders_application_manifests
      set status = 'superseded'
      where id = p_supersede_manifest_id
        and project_id = p_project_id
        and status = 'active';
  end if;

  insert into builders_application_manifests (
    project_id, mvp_id, version, status, source_package_assembled_at, framework, package_manager,
    entry_file, total_files, completed_files, failed_files, plan_checksum, source_content_checksum,
    metadata, persisted_at, created_by
  )
  values (
    p_project_id, p_mvp_id, p_version, 'active', p_source_package_assembled_at, p_framework,
    p_package_manager, p_entry_file, p_total_files, 0, 0, p_plan_checksum, p_source_content_checksum,
    coalesce(p_metadata, '{}'::jsonb), now(), p_created_by
  )
  returning * into v_manifest;

  if p_files is not null and jsonb_array_length(p_files) > 0 then
    insert into builders_application_manifest_files (
      manifest_id, project_id, path, file_type, category, component_name, display_name,
      generation_order, dependencies, required, source_kind, status, priority, queue_position,
      feature_ids
    )
    select
      v_manifest.id,
      p_project_id,
      file ->> 'path',
      file ->> 'file_type',
      file ->> 'category',
      file ->> 'component_name',
      file ->> 'display_name',
      coalesce((file ->> 'generation_order')::int, 0),
      coalesce(file -> 'dependencies', '[]'::jsonb),
      coalesce((file ->> 'required')::boolean, true),
      file ->> 'source_kind',
      coalesce(file ->> 'status', 'pending'),
      (file ->> 'priority')::int,
      (file ->> 'queue_position')::int,
      coalesce(file -> 'feature_ids', '[]'::jsonb)
    from jsonb_array_elements(p_files) as file;
  end if;

  return to_jsonb(v_manifest);
end;
$$;

-- Defect 1 — revoke from `anon` as well as `public`, matching every other definer function in this
-- schema. `create or replace` above re-grants EXECUTE to PUBLIC, so these must follow it.
revoke execute on function builders_save_application_manifest(
  text, integer, text, text, text, integer, text, text, jsonb, jsonb, uuid, timestamptz, text, uuid
) from public;

revoke execute on function builders_save_application_manifest(
  text, integer, text, text, text, integer, text, text, jsonb, jsonb, uuid, timestamptz, text, uuid
) from anon;

grant execute on function builders_save_application_manifest(
  text, integer, text, text, text, integer, text, text, jsonb, jsonb, uuid, timestamptz, text, uuid
) to authenticated;
