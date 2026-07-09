-- Sprint 39.7 — Unified Project Experience.
--
-- Every builders_projects row now carries a project_type (which Builders workflow drives
-- it: 'quick_build' | 'guided_engineering') and a created_from (analytics-only provenance
-- of how it originated — a superset of project_type, since a project can later be created
-- from a template/GitHub import while its project_type stays 'guided_engineering').
--
-- linkedChatId (the IndexedDB chat id/urlId a quick_build project's chat lives at) is
-- intentionally NOT a new column — it folds into the existing metadata jsonb column, same
-- treatment as githubRepo/roadmapStatus/etc. (see app/lib/builders-db/buildersDbTypes.ts).

alter table builders_projects
  add column if not exists project_type text not null default 'quick_build',
  add column if not exists created_from text not null default 'quick_build';

alter table builders_projects
  add constraint builders_projects_project_type_check check (project_type in ('quick_build', 'guided_engineering'));

-- Backfill: every row that existed before this migration was created via Guided
-- Engineering — Quick Build never persisted a project to BuildersDB before this sprint.
update builders_projects set project_type = 'guided_engineering', created_from = 'guided_engineering';
