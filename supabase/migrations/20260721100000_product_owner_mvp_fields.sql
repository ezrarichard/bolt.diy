-- AI Product Owner: MVP Field Additions — Sprint 46B (Builders Software Factory).
--
-- Adds the four `builders_mvps` columns and the `builders_mvp_approvals.stage` column
-- recommended during the Sprint 46A AI Product Owner design work (see
-- docs/05-AI-Product-Owner/06-buildersdb-recommendations.md) and now consumed by
-- app/lib/mvp/mvpTypes.ts / mvpRepository.ts and app/components/sidebar/
-- ProductOwnerDraftPanel.tsx.
--
-- Purely additive — every new column is nullable, so this migration introduces ZERO
-- behavior change to any existing row and requires no backfill. `builders_mvps` and
-- `builders_mvp_approvals` themselves were created by
-- 20260720100000_mvp_foundation.sql (Sprint 45) and are not touched structurally here,
-- only extended.
--
-- Field-by-field rationale (full reasoning in docs/05-AI-Product-Owner/
-- 06-buildersdb-recommendations.md):
--  - target_release: customer-editable release label (e.g. "v0.1", "v1.0"), NOT
--    authored/enforced by the AI — bridges internal `sequence` ordering to external
--    release identity. Free text, no CHECK constraint, matching this codebase's existing
--    convention for status-like columns.
--  - estimated_effort: coarse "small | medium | large" ONLY — deliberately not numeric
--    (story points / engineering weeks), which would imply false precision from an LLM
--    with no historical velocity baseline to calibrate against.
--  - business_priority: "critical | high | medium | low" — reuses the same severity
--    vocabulary already used for risk severity in the Product Owner artifact, applied to
--    an MVP as a whole. Not redundant with `sequence`: dependency-driven ordering can
--    differ from importance ordering.
--  - blocked_reason: free text, mirrors the existing `last_error`/
--    `manifest_persistence_error` pattern already used elsewhere in this schema for "why
--    is this stuck."
--  - builders_mvp_approvals.stage ('scope' | 'delivery'): distinguishes Gate A (Scope
--    Approval, before Engineering starts) from Gate B (Delivery Approval, after Preview)
--    — both are legitimate, distinct approval moments that share this one table. NOT
--    NULL with no default: every future approval insert must state which gate it's for:
--    existing rows from Sprint 45 (before this column existed) predate the two-gate model
--    entirely, so this migration adds the column as nullable first and does not attempt to
--    backfill a stage for them — there is no correct value to infer for a decision that
--    was recorded before the distinction existed. New application code (Sprint 46B) always
--    supplies `stage` explicitly on every insert going forward.
--
-- Idempotent throughout (`add column if not exists`), matching every other migration in
-- this directory.

alter table builders_mvps add column if not exists target_release text;
alter table builders_mvps add column if not exists estimated_effort text;
alter table builders_mvps add column if not exists business_priority text;
alter table builders_mvps add column if not exists blocked_reason text;

alter table builders_mvp_approvals add column if not exists stage text;
