-- Transactional Application Manifest persistence — Sprint 98A, BUG-009.
--
-- WHAT WENT WRONG (Acceptance Test Round 1). `saveApplicationManifest()` performed three writes in
-- sequence with no transaction: supersede the previous active manifest, insert the new manifest
-- row, insert its file rows. When the file insert failed (BUG-008's missing `feature_ids` column),
-- the first two writes had already committed. The result was an ORPHANED manifest — `status =
-- 'active'`, `total_files = 80`, `completed_files = 0`, and zero file rows — while the function
-- reported failure. Every retry superseded that orphan and created another one.
--
-- THE FIX. One `security definer` plpgsql function. A plpgsql function body runs inside a single
-- implicit transaction, so any exception rolls back every statement in it: either the manifest and
-- all of its files exist, or nothing does. There is no partial state to clean up because a partial
-- state can no longer be committed.
--
-- Follows the pattern established by `builders_record_delivery_package` and
-- `builders_finalize_deployment_verification` (Sprints 92/94), including the
-- `builders_user_can_edit_project` authorisation check that `security definer` makes mandatory —
-- without it this function would bypass RLS entirely.
--
-- BACKWARD COMPATIBLE. Purely additive: a new function, no table or column altered, no existing
-- function replaced. `applicationManifestRepository.saveApplicationManifest()` calls this RPC and
-- falls back to its previous sequential path when the function is absent, so a database that has
-- not applied this migration behaves exactly as it did before.

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
  -- `security definer` bypasses RLS, so authorisation is enforced explicitly. Same guard every
  -- other definer function in this schema uses.
  if not builders_user_can_edit_project(p_project_id) then
    raise exception 'Not authorised to save an application manifest for project %.', p_project_id;
  end if;

  -- Supersede the previous active manifest, if the caller identified one. Inside the same
  -- transaction as everything below: a failure further down un-supersedes it automatically.
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

  -- Files are expanded from a single jsonb array rather than passed as N parameters, so the whole
  -- file plan lands in one statement. An error here — a missing column, a constraint violation, a
  -- malformed row — aborts the function and rolls back the insert and the supersede above.
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

comment on function builders_save_application_manifest is
  'Sprint 98A BUG-009 — atomically supersedes the previous manifest, inserts the new manifest and inserts all of its file rows. Either everything commits or nothing does; orphaned manifests are structurally impossible through this path.';

revoke all on function builders_save_application_manifest(
  text, integer, text, text, text, integer, text, text, jsonb, jsonb, uuid, timestamptz, text, uuid
) from public;

grant execute on function builders_save_application_manifest(
  text, integer, text, text, text, integer, text, text, jsonb, jsonb, uuid, timestamptz, text, uuid
) to authenticated;
