# BuildersDB

Sprint 18 introduces the persistence architecture that will eventually let Builders — the internal AI engineering platform this repo implements (Project Workspace, Blueprint Engine, Requirements/Architecture/Database/UI-UX AI roles, Execution Engine, Review Engine, Context Engine, Artifact system) — move from a local-only application to a cloud-hosted, collaborative one.

This sprint does **not** add authentication, teams, secrets storage, or a working cloud backend. It adds the seam that lets a future sprint introduce all of those without another rewrite of the Project Store or any AI engine.

## Purpose

**BuildersDB** is the name reserved for a future, dedicated Supabase project that will store the Builders **platform's own control-plane data** — projects, project knowledge, artifacts, task state, review history, and (eventually) context bundles. It does not exist yet: no Supabase project has been provisioned, no `@supabase/supabase-js` dependency has been added, and no environment variables for it are configured anywhere in this repo.

## Control Plane vs. Product Database

This distinction is the most important thing to get right, because bolt.diy already has an unrelated, pre-existing Supabase feature that this sprint must never be confused with:

| | **BuildersDB (this sprint)** | **Generated app's Supabase (pre-existing)** |
|---|---|---|
| What it stores | Builders' own data: `Project`, `ProjectKnowledge`, `ProjectArtifact[]`, task status/notes, review records/history | Whatever database the **product being built in chat** needs |
| Who connects to it | The Builders platform itself | The end user's in-progress application |
| Where it lives in code | `app/lib/builders-db/` (new, this sprint) | `app/lib/stores/supabase.ts`, `app/lib/hooks/useSupabaseConnection.ts`, `app/routes/api.supabase*.ts`, `app/components/chat/SupabaseConnection.tsx` (pre-existing, untouched) |
| Env vars | `BUILDERS_DB_SUPABASE_URL` / `BUILDERS_DB_SUPABASE_ANON_KEY` (not yet set anywhere) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_ACCESS_TOKEN` (pre-existing) |
| Touches SQL/migrations/RLS? | Never — this is a control-plane persistence layer, not a schema generator | Yes — that's its entire purpose |

If a future sprint needs both systems to interact (e.g., "show which generated-app Supabase project a Builders project is linked to"), that link is a *value* stored in BuildersDB (`Project.supabaseProjectId`, which already exists as a field), never a second responsibility bolted onto either system.

## Repository Layer

Before this sprint, `app/lib/stores/projects.ts` read and wrote `localStorage` directly. The architecture is now:

```
UI
  ↓
Project Store        (app/lib/stores/projects.ts — nanostores atom, unchanged public API)
  ↓
Repository           (app/lib/builders-db/types.ts — ProjectRepository interface)
  ↓
Storage Provider     (app/lib/builders-db/providers/{local,supabase}Provider.ts)
  ↓
Local Storage (today) / Supabase (future, optional)
```

The Store only ever calls `ProjectRepository` methods (`loadProjects`, `loadProject`, `saveProject`, `saveProjects`, `deleteProject`, `updateKnowledge`, `updateArtifacts`, `updateTasks`, `updateReviews`) — it has no knowledge of `localStorage`, Supabase, or any other backend. Which concrete provider backs those calls is decided in exactly one place: `createProjectRepository()` in `app/lib/builders-db/repositories/projectsRepository.ts`.

The interface deliberately exposes **Builder concepts**, not storage mechanics: there is no `runQuery()`, no table name, no SQL string anywhere in `app/lib/builders-db/types.ts`. A future Supabase provider translates `updateArtifacts(projects)` into whatever `UPDATE`/`UPSERT` statement is appropriate; the Store and every AI engine never need to know that translation happened.

### Why the interface is synchronous today

Every `ProjectRepository` method returns a plain value, not a `Promise`. This mirrors `localStorage`'s synchronous API and — critically — matches how the rest of the app already relies on `projectsStore` updating synchronously (many components call a Store function like `updateProjectKnowledge()` and expect `projectsStore.get()` to reflect the change immediately afterward). Converting the interface to `async`/`Promise`-returning is real, necessary work for a genuine Supabase backend (network calls cannot be synchronous) — but doing that conversion is out of scope for this sprint, which exists specifically to introduce the seam without touching any UI or engine behavior. See "Future migration plan" below.

## Local Provider

`app/lib/builders-db/providers/localProvider.ts` is the exact `localStorage` logic that used to live in `app/lib/stores/projects.ts`, relocated behind the `ProjectRepository` interface with **zero behavior change**:

- Same storage key (`builder_projects`).
- Same one-time cleanup of the Sprint-9-era legacy mock project ids on first read.
- Same `JSON.stringify`/`JSON.parse` round trip, same SSR guard (`typeof window === 'undefined'` returns `[]`/no-ops during server rendering).
- Every `update*` method is a full-array overwrite, because that's what persisting a single `localStorage` key has always meant — the distinct method names exist for the interface's sake, not because this provider treats them differently.

This is today's only active provider, selected automatically by `createProjectRepository()`.

## Supabase Provider (skeleton)

`app/lib/builders-db/providers/supabaseProvider.ts` implements `ProjectRepository` so it type-checks and can be returned by the selector — but every method is inert. Calling any method logs a `console.warn` and returns an empty result (`[]`/`undefined`/no-op) rather than making a network call or throwing. There is no `@supabase/supabase-js` dependency in this project, and this sprint deliberately does not add one.

`app/lib/builders-db/client.ts` defines `getBuildersDbConfig()`/`isBuildersDbConfigured()`, reading two env vars (`BUILDERS_DB_SUPABASE_URL`, `BUILDERS_DB_SUPABASE_ANON_KEY`) that are not set anywhere today. `getBuildersDbClient()` always returns `null`.

**Do not set those two env vars until `providers/supabaseProvider.ts` has a real implementation.** `createProjectRepository()` selects the Supabase provider whenever `isBuildersDbConfigured()` is true — and because that provider currently no-ops, doing so today would silently stop all project persistence. This is intentional (the sprint asked for a real selector, not a hardcoded one) and is safe only because nothing sets those variables yet.

## Future Auth

Not implemented. When it lands, expect: a `users`/`members` table in BuildersDB, a `userId` (or similar) column on every Builders-owned row, and Supabase Auth (or an equivalent) issuing sessions the repository layer can scope queries by. The `ProjectRepository` interface should not need to change shape for this — only providers gain a "current user" parameter or ambient context.

## Future Team Workspaces

Not implemented. `Project.members?: string[]` already exists as a placeholder field (unused since Sprint 1). A real implementation would introduce a `workspaces`/`teams` table, project-to-workspace ownership, and role-based access — layered on top of Future Auth above, not replacing it.

## Future Secrets

Not implemented. No Supabase Vault, no API key storage, no encrypted columns exist or are planned by this sprint. `Project.environmentVariables?: Record<string, string>` is an existing placeholder field for a **generated app's** env vars (unrelated to BuildersDB's own credentials) and is still unused. Whenever Builders needs to store real secrets (e.g., a team's own LLM API keys), that almost certainly means Supabase Vault or an equivalent, added deliberately in its own sprint — never as plaintext columns.

## Future Generated Supabase Projects

Not implemented. `Project.supabaseProjectId?: string` already exists as a placeholder — the eventual link between a Builders project and the Supabase project *generated for that product*. That generated project is provisioned and managed entirely through the pre-existing "Generated app's Supabase" system described above; BuildersDB only ever stores the *reference* to it, never the generated project's schema, data, or credentials.

## Future migration plan

1. Add the `@supabase/supabase-js` dependency and provision a real BuildersDB Supabase project (tables mirroring `Project` and its nested fields — see `app/lib/builders-db/types.ts` for the exact shapes to mirror).
2. Convert `ProjectRepository` (and every provider implementing it) to an `async`/`Promise`-returning interface — the one deliberate deferral from this sprint.
3. Convert `app/lib/stores/projects.ts`'s mutating functions (`addProject`, `updateProjectKnowledge`, `applyReviewDecision`, etc.) to `async`, and audit every call site across the UI for correct `await`/loading-state handling. This is the sprint most likely to touch UI files — everything in Sprint 18 was designed to avoid that.
4. Implement `providers/supabaseProvider.ts` for real, replacing each no-op with the query it's named for.
5. Only then does setting `BUILDERS_DB_SUPABASE_URL`/`BUILDERS_DB_SUPABASE_ANON_KEY` become safe — `createProjectRepository()` already switches on their presence today, so no selector change is needed at that point.
6. Layer Future Auth → Future Team Workspaces → Future Secrets → Future Generated Supabase Projects (as described above) on top, in that order, each its own sprint.

## Known limitations (as of Sprint 18)

- `ProjectRepository` is synchronous; a real network-backed provider cannot honor that contract yet (see above).
- `providers/supabaseProvider.ts` is a compile-time skeleton only — it has no tests against a real Supabase project because none exists.
- No env vars, migrations, tables, or Supabase project have actually been created — `docs/buildersdb.md` (this file) is the only artifact of "BuildersDB" that exists after this sprint.
- The `updateKnowledge`/`updateArtifacts`/`updateTasks`/`updateReviews` methods all currently accept the full `Project[]` list (matching what the Store already computes via its existing `.map()`-based mutations) rather than a partial delta. A future Supabase provider can still choose to write only the changed column(s) per project using whichever fields actually changed — the full-list argument doesn't prevent that, it just doesn't require it either.

## Sprint 34 — a real, additive write-through layer

Sprint 34 connects the frontend to an actual BuildersDB Supabase project **without**
doing the async rewrite this doc's "Future migration plan" describes above. Instead of
converting `ProjectRepository` (and auditing every UI call site), it adds a second,
parallel, genuinely-async repository:

```
app/lib/builders-db/repositories/buildersDbRepository.ts
```

backed by `@supabase/supabase-js` (now a real dependency) and the schema in
`supabase/migrations/20260706120000_buildersdb_foundation.sql` — 8 normalized tables:
`builders_projects`, `builders_project_members` (structural only, unused until Auth),
`builders_ai_roles` (a static catalog), `builders_role_outputs`,
`builders_project_tasks`, `builders_task_reviews`, `builders_execution_logs`, and
`builders_project_activity`. No schema like this existed anywhere in the repo before
this sprint — this migration IS the schema, designed to mirror the existing frontend
shapes (`Project`, `ProjectArtifact`, `TaskReviewRecord`, `TaskHistoryEvent`) documented
above rather than inventing new ones. Mapping between the two lives in
`app/lib/builders-db/buildersDbTypes.ts`.

`app/lib/stores/projects.ts`'s existing mutators (`addProject`, `deleteProject`,
`setRoadmapItemStatus`, `setTaskStatus`, `setTaskNotes`, `addProjectArtifact`,
`updateProjectArtifact`, `applyReviewDecision`, `updateProjectKnowledge`,
`clearProjectKnowledge`, `setGenerationSession`) are unchanged in their synchronous
public signatures. Each now additionally calls `mirrorToBuildersDb(...)` — fire-and-
forget, never awaited, a no-op whenever `BUILDERS_DB_SUPABASE_URL`/
`BUILDERS_DB_SUPABASE_ANON_KEY` aren't set (true for everyone until BuildersDB is
actually provisioned). `ProjectList.tsx` calls a new `hydrateProjectsFromBuildersDb()`
once on mount, which replaces `projectsStore` with BuildersDB's projects if and only if
BuildersDB is configured AND returns at least one project — local-only usage is
unaffected either way.

The Sprint 18 `ProjectRepository`/local/Supabase-provider seam described above is
untouched and still governs the single localStorage-persisted `Project[]` blob; Sprint
34's repository is additive, not a replacement.

### Known limitations (as of Sprint 34)

- ~~`getRoleOutputsForProject()` exists and works, but no AI engine's `buildContext`
  reads from it yet~~ — addressed in Sprint 35, see below.
- No RLS beyond "anon key can do anything" — there is no Auth yet, so every
  policy in the migration is permissive by design. Tighten these once a future Auth
  sprint lands.
- `builders_project_members`/`owner_id`/`user_id` columns exist but nothing writes to
  them yet — placeholders for a future Auth sprint, same spirit as `Project.members`
  above.
- Write-through is best-effort and unordered relative to the UI: if BuildersDB is
  slow or down, local state is still correct and current, but BuildersDB can fall
  behind or (rarely, on a lost race) miss a write. There is no retry/outbox queue.

## Sprint 35 — AI role context retrieval

Adds the read side Sprint 34 didn't: `app/lib/ai/context/buildersDbContextProvider.ts`
fetches prior role outputs + task/review state from BuildersDB and formats them into a
"## Persistent Project Context from BuildersDB" text block, appended (never replacing
anything) to the prompt at the three places a role's final prompt string is assembled —
`app/lib/hooks/useDraftPanel.ts`, `app/lib/hooks/useAutoEngineeringPipeline.ts`, and
`app/components/sidebar/RequirementsDraftPanel.tsx`. Priority rule: latest APPROVED
output per role, else latest of any status. `buildRoleContextBlock()` resolves to `''`
whenever BuildersDB is unconfigured/unreachable/empty — a pure no-op for local-only
usage. Which upstream roles are "relevant" to a given role reuses
`app/lib/projects/collaborationContext.ts`'s existing `ROLE_ARTIFACT_CHAIN` (exported
for this purpose) rather than re-declaring the pipeline order a second time.

## Sprint 36 — knowledge memory, version history & context traceability

Sprint 34/35's `builders_role_outputs` had one row PER ARTIFACT: every regenerate
upserted-by-id, overwriting the previous version's content in place (mirroring the
frontend's own in-memory behavior — `updateProjectArtifact` mutates the same
`ProjectArtifact.id`, never keeping old content around). Sprint 36 makes BuildersDB the
durable version history the frontend itself doesn't keep — see
`supabase/migrations/20260707090000_sprint36_knowledge_memory.sql`:

- `builders_role_outputs.id` (the old primary key) is renamed to `artifact_id` — the
  frontend's stable `ProjectArtifact.id`, constant across every regenerate of the same
  role output. A new surrogate `id` (uuid) becomes the primary key, one row per
  `(artifact_id, version)` pair (a unique constraint `createOrUpdateRoleOutput` now
  upserts against) — a status-only change (e.g. approval) updates that version's row in
  place; a genuine version bump inserts a new row, leaving every earlier version intact.
- `generation_type` ('manual' | 'automatic') and `parent_version_id` (the previous
  version's row id) are new columns — Sprint 36's "Output Metadata" requirement.
  Threaded in via a new, optional, default-preserving `generationType` parameter on
  `addProjectArtifact`/`updateProjectArtifact` (`app/lib/stores/projects.ts`);
  `useAutoEngineeringPipeline.ts` is the only caller that passes `'automatic'`.
- `builders_context_traces` (new table) records, per context block actually built for a
  role, which sources fed into it (prior role outputs, tasks, the original prompt) as a
  lightweight JSONB array — one row per build, not one row per source. Written by
  `buildRoleContextBlock` itself (fire-and-forget, via a new `recordContextTrace`), read
  back by `getContextExplanation()` to answer "why did this AI generate this response?".

New repository functions (`app/lib/builders-db/repositories/buildersDbRepository.ts`):
`getRoleVersionHistory`, `getLatestApproved`, `getLatestDraft`, `saveContextTrace`,
`getContextTrace`. New file `app/lib/ai/context/versionHistory.ts`: version-history
formatting (`formatVersionHistoryForPreview`), a project-wide "Context Preview"
(`buildContextPreview`), lightweight version-to-version diffing
(`summarizeVersionChange`/`getRoleChangeLog` — set-difference on list fields, "changed"
flag on everything else, no AI summarization), and `applyContextBudget` (a token-budget
trim over labeled sections, mirroring `app/lib/projects/contextEngine.ts`'s own
budget-trim loop shape, reusing its `estimateTokens`). All backend/helper-level per the
sprint's own scope — no new UI.

### Known limitations (as of Sprint 36)

- `applyContextBudget`/token budgeting is available but not yet wired into
  `buildRoleContextBlock`'s default path — that still uses Sprint 35's fixed
  `MAX_ROLE_OUTPUTS`/`MAX_CHARS_PER_ROLE_OUTPUT` caps. Opting a call site into
  token-based budgeting is future work.
- `builders_context_traces` keeps every trace ever recorded (append-only, no pruning) —
  fine at today's scale, but a future sprint should consider retention/cleanup once
  projects run for a long time.
- Change summaries are a simple list-field diff, not a real semantic summary of text
  field changes (a changed text field is flagged as "Changed: <Field>", not diffed) — as
  scoped ("large AI summarisation unnecessary").
- No UI surfaces any of this yet (version history, context trace, change summaries) —
  everything is a backend/helper implementation, per the sprint's own scope.

## Sprint 37 — AI Product Assembly Engine

New domain, deliberately separate from `app/lib/builders-db/`: `app/lib/product-assembly/`
(`assemblyTypes.ts`, `productAssembler.ts`, `assemblyMarkdown.ts`, `assemblyRepository.ts`).
Assembles every role's latest approved (or, failing that, latest draft) output into a
`ProductPackage` — a set of readable Markdown plan/spec files (`Requirements/BRD.md`,
`Architecture/architecture.md`, ...), reusing each role's own `*_DRAFT_FIELDS` config and
`formatDraftFields` (`app/lib/projects/prompts/shared.ts`) rather than inventing new
formatting. No code generation, file tree, or live preview — that's Sprint 38.

Two adaptations from the sprint brief's suggested structure, since this codebase has
exactly 8 AI roles (no "Project Manager" generation role/artifact exists —
`ProjectManagerPanel.tsx` is a read-only, locally-computed readiness view, never an LLM
call): "API" is derived from the Backend Engineer's own output (a curated field subset,
`api-spec.md`) rather than a separate role, and there is no "Project Management" section
at all — `Documentation/product-summary.md` (rule-based, no AI call) notes this
explicitly rather than silently omitting it.

`assembleProductPackage(project)` (`productAssembler.ts`) is synchronous and reads only
the in-memory `Project` — assembly always works identically regardless of whether
BuildersDB is configured. Persisting to `builders_product_packages`/
`builders_product_package_files` (see
`supabase/migrations/20260707150000_sprint37_product_assembly.sql`) is a separate,
best-effort step (`assemblyRepository.ts`'s `saveProductPackage`/`getProductPackage`/
`listProductPackageFiles`/`deleteProductPackage`) — one package per project (a
re-assembly deletes-then-reinserts rather than keeping assembly history; Sprint 36
already owns role-output version history). A discarded or still-empty-placeholder
artifact is treated as "missing", never as usable content.

UI: a new "Package" section in `ProjectDashboard.tsx` (`ProductPackagePanel.tsx`) — a
manual "Assemble Product Package" button, a file list grouped by section with
approved/draft/missing badges, and a read-only content preview. No file tree, no
editing, no redesign of any existing section.

### Known limitations (as of Sprint 37)

- One package per project (no assembly history) — re-assembling replaces the previous
  snapshot entirely.
- `Documentation/product-summary.md` is the only generated file with no AI-role source;
  everything else is a reformatted AI role output, not new content.
- No UI affordance to download/export the assembled package as an actual file tree yet
  (`ProductPackagePanel.tsx` is preview-only) — reading it back via
  `listProductPackageFiles()`/`getProductPackage()` already works for a future exporter.
- Sprint 38 is expected to consume `ProductPackage` as its input for real code
  generation; nothing here generates runnable code, a file tree on disk, or a live
  preview.
