# Sprint 47 — MVP-Aware Engineering Pipeline

**Status: IMPLEMENTED.** This is the first sprint that modifies the Engineering Pipeline (Architecture through QA) and the manifest layer. The Product Owner subsystem itself, Gate A, and the MVP schema were not touched, per this sprint's own constraints.

## What Changed

Every engineering role's context builder (`databaseDesignerEngine.ts`, `uiuxDesignerEngine.ts`, `backendEngineerEngine.ts`, `frontendEngineerEngine.ts`, `qaEngineerEngine.ts`) now reads the approved Product Owner artifact's `currentMvp.engineeringHandoff` and includes it in its context — exactly the pattern `solutionArchitectEngine.ts` already had since Sprint 46B. Each role's corresponding prompt file now renders that handoff (via a newly shared `formatEngineeringHandoff`, extracted from `prompts/architecture.ts` into `prompts/shared.ts` so all six roles use the identical formatting) and each role's system prompt gained one rule: design/validate ONLY for in-scope features, treat the handoff's `outOfScopeFeatures` as a hard constraint, and cite Feature IDs in relevant output fields where the mapping is clear.

## How "MVP-Scoped Generation" Is Actually Enforced — Read This Before Assuming More Than What's Built

**This is a prompt-level instruction, not a structural/runtime validator.** Nothing in this sprint parses a role's JSON output and rejects it if it designed something for an out-of-scope feature. The enforcement mechanism is: every downstream role's system prompt now explicitly states the scope boundary and is instructed to respect it, the same way every existing rule in these prompts (e.g. "do not write SQL," "treat the Architecture Draft as a settled constraint") is enforced by instruction, not by a code-level guard. This is consistent with how this entire pipeline already works — no role's system prompt has ever been mechanically enforced beyond "ask the model clearly and validate the JSON shape." A future sprint could add a post-generation validation pass that flags apparent scope violations (e.g., cross-referencing generated entity/endpoint names against `outOfScopeFeatures` text) — not implemented here, since it would be a new capability beyond "extend the existing pattern."

## Active MVP Resolution

`mvpRepository.resolveActiveMvpId(projectId)` (new) returns the highest-`sequence` MVP whose status has passed Gate A (i.e., not `'planned'`) and hasn't been superseded, or `undefined` if the project has no MVP at all. This function deliberately does not attempt to resolve ambiguity between multiple simultaneously-active MVPs — this codebase's own design (see [01-Vision/03-mvp-first-development.md](../01-Vision/03-mvp-first-development.md)) only ever has one MVP in active engineering/generation at a time, so there is nothing more sophisticated to resolve yet. If a future sprint allows parallel MVP work, this function's contract will need to change — flagged here explicitly rather than silently assumed to still be correct.

## Manifest Changes

`ApplicationManifestDraft`/`ApplicationManifest` gained an optional `mvpId` field, threaded through `buildApplicationManifest` (manifestBuilder.ts) → `prepareManifestForGeneration` (resumeOrchestrator.ts) → `saveApplicationManifest` (applicationManifestRepository.ts), which persists it into `builders_application_manifests.mvp_id` — the nullable column that has existed since the Sprint 45 migration but was never populated until now. `useCodeGeneration.ts`'s `createPlanReadyHandler` resolves the active MVP once per generation run and passes it through.

**What this does NOT do:** it does not extend the resume/diff algorithm (`resumeOrchestrator.ts`'s checksum comparison) to reason about MVP boundaries — a manifest is still compared only against its own prior version for the same project, not diffed against a different MVP's manifest. It also does not tag individual files (`builders_application_manifest_files`) with an MVP or feature association — only the manifest as a whole. Both are explicitly out of this sprint's scope ("do not redesign the manifest engine, extend it") and are the natural next step once cross-MVP generation (multiple MVPs' code coexisting in one project) is actually being built.

## Traceability Implementation

Feature IDs are preserved and citable end-to-end: `EngineeringHandoff.features[]` (with `id`) flows into every role's context; each role's system prompt asks it to cite the relevant Feature ID(s) directly inside its own existing JSON list/text fields (e.g. `"entities": ["Appointments table (FEAT-006, FEAT-007)"]`) — reusing the draft's existing structure rather than adding a new schema field, per this sprint's own instruction ("do not create unnecessary schema changes; reuse existing metadata and JSON structures"). This is a real, working trace path from Feature ID → every engineering artifact's own text, but it is **not** a queryable/structured index — finding "everything related to FEAT-007" today means reading each artifact's text, not running a query. A structured `relatedFeatureIds: string[]` field per artifact (or per manifest file) would make this queryable; not added here, since it wasn't necessary to satisfy "wherever practical" and would have been the kind of schema growth this sprint's instructions asked to avoid absent a concrete need.

## Backward Compatibility Verification

For a project with no approved Product Owner artifact (every project created before Sprint 46B, or one that hasn't reached Gate A yet), `getApprovedArtifactContent(artifacts, PRODUCT_OWNER_DRAFT)` returns `undefined`, so `engineeringHandoff` is `undefined` in every role's context, and `formatEngineeringHandoff(undefined)` renders "None — this project predates the AI Product Owner role. Proceed as before, scoping the full product." — the exact same fallback Solution Architect has used since Sprint 46B. No gate (`canGenerateDatabase`, `canGenerateUIUX`, `canGenerateBackend`, `canGenerateFrontend`, `canGenerateQA`) changed at all this sprint — only additional context was added alongside what already existed. Confirmed via `sprint47Validation.spec.ts`: every role's context builder returns `engineeringHandoff: undefined` for a legacy-shaped project while every other field and gate behaves identically to before.

## Testing

`app/lib/projects/sprint47Validation.spec.ts` (11 tests, all passing) exercises the real production context-builder functions for all 5 roles (both with and without an approved Product Owner artifact) and the manifest/MVP-resolution functions (`resolveActiveMvpId`'s Gate-A-aware selection logic, `buildApplicationManifest`'s `mvpId` threading). Full `pnpm typecheck` and the full `pnpm vitest run` suite (402 tests, up from 391) pass. The app was also confirmed to boot cleanly (no console/compile errors) after this sprint's changes.

## Documentation Updated

This document, plus [04-engineering-handoff.md](04-engineering-handoff.md), [00-EXECUTIVE-SUMMARY.md](../00-EXECUTIVE-SUMMARY.md), and [04-Roadmap/01-phased-migration-plan.md](../04-Roadmap/01-phased-migration-plan.md).
