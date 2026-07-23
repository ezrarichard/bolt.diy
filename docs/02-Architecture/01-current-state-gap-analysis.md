# Current State → Gap Analysis

This document is the factual baseline every other architecture doc builds on. It reflects the state of the `builders-v1` branch as audited, not aspiration.

## What Exists Today (Verified)

### AI Roles & Orchestration
- 8 roles, one engine file each, in `app/lib/projects/`: `businessAnalystEngine.ts`, `solutionArchitectEngine.ts`, `databaseDesignerEngine.ts`, `uiuxDesignerEngine.ts`, `backendEngineerEngine.ts`, `frontendEngineerEngine.ts`, `qaEngineerEngine.ts`, `devopsEngineerEngine.ts`.
- Orchestration is a **sequential loop**, not a state machine: `useAutoEngineeringPipeline.ts` repeatedly calls `getNextAutoRole()` (`autoEngineeringEngine.ts`), and each role follows the same four-step pattern: build context → build prompt → call LLM (`useGenerateText`, provider-agnostic) → parse and persist artifact.
- Role dependency order is declared in `collaborationContext.ts::ROLE_ARTIFACT_CHAIN` — each role is gated on its predecessor's artifact being approved.
- Resumability exists at the *role* level already: `hydrateProjectData()` restores BuildersDB role outputs into local state before deciding which role to run next, and `pipelineHydrationGate.ts` blocks auto-generation if hydration fails and no local artifacts exist (data-safety check).

### BuildersDB
- Real Supabase-backed control plane, not a stub. Schema documented in `docs/buildersdb.md`.
- Core tables: `builders_projects`, `builders_project_members` (structural, unused pending Auth), `builders_ai_roles`, `builders_role_outputs` (versioned, one row per artifact version), `builders_project_tasks`, `builders_task_reviews`, `builders_execution_logs`, `builders_project_activity`.
- Sprint 36 added version threading (`parent_version_id`) and `builders_context_traces` (records which upstream sources fed a given prompt context).
- Sprint 37 added `builders_product_packages` / `builders_product_package_files`.
- Access pattern: repository interface (`buildersDbRepository.ts`) behind a provider abstraction (local vs. Supabase), already designed for backend-swapping.
- Write pattern today is **fire-and-forget**: every local mutation in `projectsStore.ts` calls `mirrorToBuildersDb()` without awaiting it. This is fine for a best-effort mirror; it is a real risk once features (like MVP approval gates) need read-after-write guarantees. See Risk R3 in [04-Roadmap/02-risks-and-alternatives.md](../04-Roadmap/02-risks-and-alternatives.md).

### Generation Engine
- `app/lib/code-generation/generationPipeline.ts` runs an 11-stage pipeline: planning → generating-types → generating-services → generating-pages → generating-components → validating → assembling → writing-files → installing → launching-preview → complete.
- `GenerationPlan` includes per-category checksums (`GenerationPlanFingerprints`) used to detect what changed since the last run.
- **The Application Manifest** (`app/lib/application-manifest/`, Sprint 44.2) already gives per-file granularity: `ManifestFileStatus` is an 11-state lifecycle (pending → queued → generating → generated → validating → repairing → validated → complete | failed | skipped | superseded), persisted to BuildersDB (`builders_application_manifests`, `builders_application_manifest_files`).
- `resumeOrchestrator.ts` already implements the core of "Create / Modify / Preserve": it compares the current plan's checksum against the latest manifest and skips regenerating unchanged categories, only touching what changed.
- Generated files themselves are persisted with version numbers and checksums (`app/lib/generated-files/generatedFilesRepository.ts`).
- An auto-repair loop exists (`app/lib/code-review/`): generated code is validated, and failures trigger an internal repair pass, tracked in `builders_repair_attempts`.

### Dashboard, Package, Preview, Workbench
- **Dashboard**: `GenerationDashboard.tsx`, shipped in the most recent commit (`b959f32`), reads live from BuildersDB — progress, current activity, files by status/category, activity timeline, manifest version history. This is *not* legacy code to migrate away from; it is days old and already does much of what the vision's "Factory" workspace describes.
- **Product Package**: `productAssembler.ts` assembles all approved (or latest-draft) role outputs into structured markdown across 10 sections (requirements, architecture, database, uiux, api, backend, frontend, qa, devops, documentation). Persisted via `assemblyRepository.ts`. UI in `ProductPackagePanel.tsx`, which is also where "Generate Application" is triggered today.
- **Preview**: WebContainer-based, iframe served from `webcontainer.preview.$id.tsx`, rendered in `Preview.tsx`. Lifecycle is generate → install → launch — no persistence across separate generation runs today.
- **Workbench**: `Workbench.client.tsx` — editor, file tree, diff view, terminal, inspector. Not a route; a sidebar panel toggled via `workbenchStore`.
- **Timeline/Activity/Reviews**: all three already exist, backed by BuildersDB (`builders_project_activity`, `ProjectHistoryPanel.tsx`, `reviewEngine.ts`, `TaskDetailsDialog.tsx`). These are *not* aspirational — they are the closest thing to the vision's "Factory workspace" surface that already exists.

## What Does Not Exist (The Real Gap)

| Missing Concept | Notes |
|---|---|
| MVP / Release as a first-class entity | No table, no artifact type, no UI concept anywhere. This is the actual gap — everything else in the vision is really a consequence of this one missing concept. |
| AI Product Owner role | No 9th role, no Product Vision / MVP Roadmap / Release Plan artifact types. |
| Scope-bounded role execution | Every role plans for the full product; there is no mechanism to bound a role's context or output to "just MVP N." |
| Cross-MVP diffing in the generation engine | `resumeOrchestrator.ts` diffs a project's plan against its own prior version — there is no concept of "MVP N vs. MVP N-1" as distinct scopes. |
| User-edit protection in generated files | Nothing marks a file as customer-modified and therefore excluded from regeneration. This is a pre-existing latent gap, not something introduced by MVP-first — but MVP-first is what makes it load-bearing, because generation will now run repeatedly against a codebase the customer has had time to edit. |
| Preview persistence across generation runs | WebContainer preview lifecycle assumes one generation → one install → one launch. Repeated MVP generations need to resume/upgrade a running app, not rebuild it. |
| MVP-level approval gate | Approval exists per-artifact and per-task today (`applyReviewDecision`), not per-release. |

## Bottom Line

The infrastructure investment already made (manifest engine, BuildersDB versioning, repair loop, dashboard) is not wasted by adopting MVP-first — it is the foundation MVP-first needs. The work is concentrated in one new dimension (MVP/Release) threaded through existing systems, plus one new role, plus real engineering effort on the two hard problems (edit-protection, preview persistence) that nothing today solves.
