-- Sprint 36 — AI Knowledge Memory, Version History & Context Traceability.
--
-- Extends the Sprint 34 foundation (20260706120000_buildersdb_foundation.sql) rather
-- than replacing it. Two changes:
--
-- 1. builders_role_outputs currently has one row PER ARTIFACT, upserted-by-id on every
--    regenerate (see app/lib/builders-db/repositories/buildersDbRepository.ts's Sprint 34
--    createOrUpdateRoleOutput) — every previous version's content is overwritten in
--    place, matching the frontend's own in-memory behavior (updateProjectArtifact also
--    mutates the same ProjectArtifact.id, never keeping old content around). This
--    migration makes BuildersDB the durable version history the frontend itself doesn't
--    keep: `id` (the frontend's stable artifact id, constant across every regenerate of
--    the same role output) is renamed to `artifact_id`, a new surrogate `id` (uuid)
--    becomes the primary key — one distinct row per (artifact_id, version) pair — and
--    `generation_type`/`parent_version_id` are added so each version row can say how it
--    was produced and which version came before it.
--
-- 2. builders_context_traces is new: one row per context block actually built for a
--    role (app/lib/ai/context/buildersDbContextProvider.ts's buildRoleContextBlock),
--    recording which sources (prior role outputs, tasks, the original prompt) fed into
--    it — the "why did this AI generate this response" explanation the sprint calls for.

-- ── builders_role_outputs: version history ──────────────────────────────────
alter table builders_role_outputs rename column id to artifact_id;
alter table builders_role_outputs drop constraint if exists builders_role_outputs_pkey;
alter table builders_role_outputs add column if not exists id uuid not null default gen_random_uuid();
alter table builders_role_outputs add primary key (id);

-- 'manual' (a human clicked Generate/Regenerate in a *DraftPanel) or 'automatic' (the
-- Sprint 31 autonomous pipeline, see useAutoEngineeringPipeline.ts) — which workflow
-- produced this version.
alter table builders_role_outputs add column if not exists generation_type text not null default 'manual';

-- The immediately-previous version's row id for this same artifact_id, if any — lets a
-- version's history be walked backwards without re-deriving it from (artifact_id,
-- version - 1) every time. Null for a role output's first version.
alter table builders_role_outputs add column if not exists parent_version_id uuid references builders_role_outputs (id);

-- The upsert key createOrUpdateRoleOutput now targets: same (artifact_id, version) ->
-- update in place (e.g. a status-only change like approval); a version bump -> a new
-- row, preserving every earlier version untouched. Nullable version values (existing
-- placeholder artifacts predating any AI generation) are each treated as distinct by
-- Postgres's NULLS DISTINCT default, so they never spuriously conflict with each other.
alter table builders_role_outputs add constraint if not exists builders_role_outputs_artifact_version_unique unique (artifact_id, version);

create index if not exists builders_role_outputs_artifact_id_idx on builders_role_outputs (artifact_id);
create index if not exists builders_role_outputs_project_role_version_idx on builders_role_outputs (project_id, role_key, version);

-- ── builders_context_traces: context source traceability ───────────────────
-- One row per context block actually built for a role. `sources` is a JSONB array
-- (kept denormalized/lightweight rather than a second child table — see the sprint's
-- "keep logging lightweight" guidance) of entries shaped like:
--   { "type": "role-output" | "task" | "original-prompt", "label": "Business Analyst v2",
--     "roleKey": "requirements-draft", "version": 2 }
create table if not exists builders_context_traces (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references builders_projects (id) on delete cascade,
  role_key text not null,
  role_output_id uuid references builders_role_outputs (id) on delete set null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists builders_context_traces_project_role_idx on builders_context_traces (project_id, role_key);

alter table builders_context_traces enable row level security;
create policy "builders_context_traces_anon_all" on builders_context_traces for all using (true) with check (true);
