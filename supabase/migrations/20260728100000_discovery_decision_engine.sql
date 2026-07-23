-- Sprint 54 — Discovery Decision Engine.
--
-- Adds one column, `decision`, to `builders_business_understanding_models`, mirroring the
-- `assessment` column's own precedent exactly (Sprint 53): a single JSONB blob holding the
-- Discovery Decision Engine's deterministic output (state, overallConfidence, completenessScore,
-- missingAreas, partialAreas, readyForRequirementsDraft — see `DiscoveryDecision` in
-- app/lib/projects/requirementsSession.ts). Defaulted to '{}'::jsonb so every existing row (and
-- every row inserted before this sprint's logic runs) parses as "no decision yet computed",
-- matching how `assessment` already defaults for legacy rows — no backfill required, no
-- behavior change for any row until `updateBusinessUnderstandingModel` is next called with a
-- `decision` patch.
alter table builders_business_understanding_models
  add column if not exists decision jsonb not null default '{}'::jsonb;
