-- Resumable Application Generation — Sprint 44.2, Phase 3.
--
-- Adds exactly two columns to `builders_application_manifests` (no new tables — Phase 3
-- reuses every table from Phase 1/2 unchanged, per its own "prefer repository changes
-- over schema expansion" instruction):
--
--  - `source_content_checksum text` — a checksum over the Product Package's CONTENT
--    (business vision, core features, page names, entities, API endpoints, layout
--    notes), independent of `plan_checksum` (which only fingerprints the FILE
--    STRUCTURE). See app/lib/application-manifest/manifestTypes.ts's own comment on
--    why both are needed: the resume algorithm's "manifest checksum vs Product Package
--    checksum" comparison is this column, not `plan_checksum`.
--  - `metadata jsonb not null default '{}'::jsonb` — holds the four small per-category
--    fingerprints (`{ fingerprints: { types, services, pages, components } }`) dependency
--    invalidation compares individually. Small, supplementary data only — never file
--    content (see this table's own Phase 1 migration header on that constraint).
--
-- No `ManifestFileStatus`/`GeneratedFileStatus` CHECK constraint exists on either the
-- Phase 1 (`builders_application_manifest_files.status`) or Phase 2
-- (`builders_generated_application_files.status`) table — both are free `text` columns —
-- so Phase 3's new lifecycle value (`'complete'`) needs no migration at all.

alter table builders_application_manifests add column if not exists source_content_checksum text;
alter table builders_application_manifests add column if not exists metadata jsonb not null default '{}'::jsonb;
