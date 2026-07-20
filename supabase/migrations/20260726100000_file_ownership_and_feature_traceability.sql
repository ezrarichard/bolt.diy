-- File-Level Feature Traceability & Customer-Edit Protection — Sprint 49 (Builders
-- Software Factory).
--
-- Closes two gaps Sprint 48 (MVP-Aware Generation Engine) left open:
--  1. No manifest file recorded which Feature ID(s) it was generated in service of.
--  2. No mechanism recorded whether a previously-generated file had been manually
--     modified (in the live WebContainer workspace) since Builders last generated it —
--     meaning a later "Generate MVP N+1" run could silently overwrite a customer's edit.
--
-- Purely additive, matching every migration in this directory: every new column is
-- nullable (or has a safe default), no existing row/query changes behavior, no backfill
-- is attempted for existing data (there is no reliable way to infer feature scope or
-- edit history for a file that predates this tracking — see this sprint's own
-- documentation, docs/05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md,
-- for why "unknown_legacy" is the deliberately conservative default rather than an
-- inferred one).
--
-- Design notes:
--  - `feature_ids` lives on `builders_application_manifest_files` (the PLANNING-time
--    table) because Feature ID association is decided when a file is planned, not when
--    it's generated — see app/lib/application-manifest/manifestBuilder.ts's
--    `buildFileDrafts`. It is NOT duplicated onto `builders_generated_application_files`:
--    that table already references `manifest_file_id`, so the association is reachable
--    by join without a second column (Part 12's own "do not add purely derived fields").
--  - `ownership`/`current_hash`/`user_modified_at`/`conflict_state` live on
--    `builders_generated_application_files` (the GENERATION-STATE table) because they
--    describe the relationship between a file's CONTENT and what Builders last
--    generated — a planning-time concept (`builders_application_manifest_files`) has no
--    content to compare. `last_generated_hash` was evaluated and deliberately NOT added:
--    it would exactly duplicate the already-existing `latest_checksum` column — see
--    app/lib/generated-files/fileOwnership.ts's own header comment.
--  - `ownership` is free text (`builders_generated | user_modified | user_owned |
--    protected | unknown_legacy`), matching this codebase's existing convention of
--    unconstrained status columns validated at the application layer (see
--    `ManifestFileStatus`, `MvpStatus`).
--  - `conflict_state` is free text (`none | pending_review | resolved`), same convention.
--  - Idempotent (`add column if not exists`), matching every other migration here.

alter table builders_application_manifest_files
  add column if not exists feature_ids jsonb not null default '[]'::jsonb;

alter table builders_generated_application_files
  add column if not exists ownership text,
  add column if not exists current_hash text,
  add column if not exists user_modified_at timestamptz,
  add column if not exists conflict_state text;

create index if not exists builders_generated_application_files_ownership_idx
  on builders_generated_application_files (ownership);
