-- Fix: Seed the Product Owner role into builders_ai_roles — Sprint 46D (live E2E validation).
--
-- Root cause, confirmed live against the production BuildersDB during this sprint's
-- validation run: `builders_role_outputs.role_key` has a foreign key constraint against
-- `builders_ai_roles.role_key` (see 20260709010000_buildersdb_canonical_schema.sql). Sprint
-- 46B added the `PRODUCT_OWNER_DRAFT` artifact type and Sprint 46B/46C added the
-- `builders_ai_roles.phase` column, but no migration ever INSERTed a `product-owner-draft`
-- catalog row itself. Every attempt to mirror a Product Owner artifact to BuildersDB has
-- been failing since Sprint 46B shipped:
--
--   insert or update on table "builders_role_outputs" violates foreign key constraint
--   "builders_role_outputs_role_key_fkey"
--   Key is not present in table "builders_ai_roles". (Postgres 23503, surfaced as HTTP 409)
--
-- This did not block the user-facing pipeline (BuildersDB mirroring is fire-and-forget by
-- design — see docs/buildersdb.md), which is why it went unnoticed until this sprint's live
-- validation run. But it is a real data-integrity defect: every Product Owner draft's version
-- history is silently absent from BuildersDB, and — more seriously — a user who refreshes or
-- resumes a session before Solution Architect has run again would have their approved Product
-- Owner draft NOT restored by `hydrateProjectData` (which reads from BuildersDB), even though
-- the local UI showed it as approved before the refresh.
--
-- Fix: insert the missing catalog row, and renumber `pipeline_order` for the existing 8 roles
-- so Product Owner correctly sits at position 2 (between Requirements and Architecture),
-- matching `ROLE_ARTIFACT_CHAIN` in app/lib/projects/collaborationContext.ts. Renumbering is
-- purely cosmetic/informational — nothing in the application code reads `pipeline_order` for
-- behavior (verified: no call site references it) — but correctness here still matters for
-- any future consumer and for anyone reading this table directly.
--
-- Idempotent: `on conflict do nothing` for the insert; the `update` statements are safe to
-- run more than once (they just re-assert the same values).

insert into builders_ai_roles (role_key, role_name, pipeline_order, phase) values
  ('product-owner-draft', 'Product Owner', 2, 'product_planning')
on conflict (role_key) do nothing;

update builders_ai_roles set pipeline_order = 3 where role_key = 'architecture-draft';
update builders_ai_roles set pipeline_order = 4 where role_key = 'database-draft';
update builders_ai_roles set pipeline_order = 5 where role_key = 'uiux-draft';
update builders_ai_roles set pipeline_order = 6 where role_key = 'backend-draft';
update builders_ai_roles set pipeline_order = 7 where role_key = 'frontend-draft';
update builders_ai_roles set pipeline_order = 8 where role_key = 'qa-draft';
update builders_ai_roles set pipeline_order = 9 where role_key = 'devops-draft';
