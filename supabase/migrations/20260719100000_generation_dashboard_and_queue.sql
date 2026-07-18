-- Application Generation Dashboard & Generation Control Center — Sprint 44.2, Phase 4.
--
-- Adds exactly two nullable columns to `builders_application_manifest_files`, for the
-- future queue/worker architecture this phase's own instructions ask to design for
-- without implementing yet ("Do NOT implement parallel workers... queue should
-- naturally evolve later"):
--
--  - `priority int` — a file's scheduling priority once a real queue exists. Nullable,
--    unused by any code this phase (single-worker generation still runs in manifest
--    `generation_order`) — reserved so a future priority-aware scheduler needs no schema
--    change.
--  - `queue_position int` — a file's position in a future generation queue. Same
--    reservation as above.
--
-- No CHECK constraint exists on `builders_application_manifest_files.status` or
-- `builders_generated_application_files.status` (both are free `text` columns — see the
-- Phase 1/2 migrations) — so this phase's new lifecycle value (`'queued'`) needs no
-- migration at all, exactly like Phase 3's `'complete'` before it.
--
-- The dependency graph's "used_by" side (requirement: each file should optionally know
-- `depends_on`/`used_by`) is NOT a new column — `depends_on` already exists as
-- `dependencies jsonb` (Phase 1); `used_by` is its mathematical inverse, computed at read
-- time from the SAME data (see app/lib/application-manifest/dependencyGraph.ts) rather
-- than duplicated into a second column that could drift out of sync with the first.

alter table builders_application_manifest_files add column if not exists priority int;
alter table builders_application_manifest_files add column if not exists queue_position int;
