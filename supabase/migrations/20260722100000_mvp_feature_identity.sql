-- Product Identity & Traceability Foundation — Sprint 46C (Builders Software Factory).
--
-- Adds `builders_mvps.code`: a permanent, human-readable MVP identifier (e.g. "MVP-001"),
-- distinct from the row's own surrogate `id` (uuid, meaningless outside the database) and
-- from `sequence` (the roadmap's current ordering, which can be revised later without the
-- identifier changing) — see docs/05-AI-Product-Owner/08-identity-and-traceability.md.
--
-- Feature identity (e.g. "FEAT-001") deliberately gets NO migration here: features live
-- entirely inside a Product Owner artifact's existing JSON `content` column
-- (`builders_role_outputs.content`), not their own table or column, so there is nothing new
-- to add to the schema for them — same reasoning already applied to `successMetrics`/
-- `exitCriteria` in the prior migration's header comment.
--
-- Purely additive: `code` is nullable, so every existing `builders_mvps` row (there should be
-- none yet, since this table's own migration is itself still staged) remains valid without a
-- backfill. Application code (mvpRepository.ts::createMvp) always supplies a value going
-- forward — either the caller's own proposed code or a computed fallback — so no row created
-- after this migration and that code both ship will ever have a null `code`, but the column
-- itself does not enforce that (matching this codebase's existing convention of enforcing
-- "should always be present" at the application layer rather than a NOT NULL + default).
--
-- A unique index on (project_id, code) is added (not a hard `unique` table constraint) so a
-- duplicate — which should never happen given how `code` is generated — fails loudly with a
-- clear constraint-violation error rather than silently creating two MVPs that claim the same
-- permanent identifier.
--
-- Idempotent (`add column if not exists` / `create ... if not exists`), matching every other
-- migration in this directory.

alter table builders_mvps add column if not exists code text;

create unique index if not exists builders_mvps_project_code_unique on builders_mvps (project_id, code);
