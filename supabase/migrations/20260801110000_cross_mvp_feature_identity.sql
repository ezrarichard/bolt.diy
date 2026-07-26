-- Cross-MVP Feature Identity — Sprint 81 (Cross-MVP Foundation; see
-- docs/product-management/Product-Management-Architecture.md, Part 1's "Cross-MVP Feature
-- Identity" correction and Part 12's migration sketch).
--
-- `builders_features_mvp_code_unique` (20260801100000_feature_foundation.sql) only guarantees a
-- Feature's `code` (e.g. "FEAT-001") is unique WITHIN one MVP — two different MVPs in the same
-- project could each mint their own unrelated "FEAT-001". A cross-MVP `dependsOn`/`featureRef`
-- reference (a bare code string) is therefore ambiguous today. This migration makes Feature codes
-- unique at PROJECT scope instead, so a bare code string is unambiguous everywhere it already
-- flows (`dependsOn`, `HandoffFeatureRef.id`, `ApplicationManifestFileDraft.featureIds`) with zero
-- call-site type changes — see `app/lib/projects/productOwnerEngine.ts`'s `assignFeatureIds` for
-- the companion application-layer fix (project-wide id counter/carry-forward) that keeps new
-- codes from ever colliding going forward.
--
-- Safety policy (per the architecture's explicit "do not auto-repair" instruction): a colliding
-- project's `code` is persisted in more places than just this table (Product Owner/Roadmap
-- Analysis artifact JSON, ApplicationManifestFile.featureIds, engineering handoff references) —
-- silently renaming a row here would NOT fix those other references, it would just make the
-- collision undetectable. This migration therefore does not attempt any repair: the DO block
-- below aborts the ENTIRE migration (raising an exception, rolling back — no index is touched) if
-- ANY project has a `(project_id, code)` collision, surfacing exactly which project/codes/rows
-- are affected in the error message so a human can run the exclusion/reporting query below and
-- perform an explicit, project-specific, transactional repair before re-running this migration.
-- Every project today is expected to pass with zero collisions (Sprint 77-80's own research
-- finding: no project has ever had a second MVP reach the point where a colliding code could have
-- been minted), so this is expected to be a pure no-op constraint tightening in practice.
do $$
declare
  collision_summary text;
begin
  select string_agg(
    format('project=%s code=%s feature_ids=%s', project_id, code, feature_ids),
    E'\n'
  )
  into collision_summary
  from (
    select
      project_id,
      code,
      array_agg(id order by mvp_id, created_at) as feature_ids
    from builders_features
    group by project_id, code
    having count(*) > 1
  ) as collisions;

  if collision_summary is not null then
    raise exception '%', format(
      E'Cross-MVP Feature Identity migration aborted - one or more projects have a Feature code that collides across different MVPs (only guaranteed unique per-MVP until this migration applies). No automatic repair was attempted. Affected rows:\n%s\nResolve each collision with an explicit, project-specific, transactional repair (updating every persisted reference to the colliding code, not just this table, per docs/product-management/Product-Management-Architecture.md Part 1) before re-running this migration.',
      collision_summary
    );
  end if;
end $$;

drop index if exists builders_features_mvp_code_unique;
create unique index if not exists builders_features_project_code_unique on builders_features (project_id, code);
