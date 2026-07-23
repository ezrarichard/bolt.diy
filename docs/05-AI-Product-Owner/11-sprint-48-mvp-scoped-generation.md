# Sprint 48 — MVP-Aware Generation Engine

**Status: IMPLEMENTED.** This is the sprint that modifies the Generation Engine itself
(`GenerationPlan`, the Application Manifest, `resumeOrchestrator.ts`, `useCodeGeneration.ts`)
rather than the engineering-role prompts (Sprint 47) or the Product Owner subsystem
(Sprints 45/46, untouched again this sprint, per instruction).

## Summary

Sprint 47 made every engineering role's *prompt* MVP-aware but left the generation engine
itself operating project-wide: `GenerationPlan` carried no MVP identity, the manifest's
`mvp_id` was populated but never re-checked, and the resume/diff algorithm had no concept
of "this is a different MVP than last time." Sprint 48 closes that gap **without
redesigning any of the Sprint 44.2 manifest/resume machinery this sprint was told to build
on** — every change is additive to an existing type, function signature, or the manifest's
existing `metadata` JSON column. Zero new schema migrations were needed.

## Files Modified

- `app/lib/code-generation/codeGenerationTypes.ts` — new `GenerationPlanScope` type;
  `GenerationPlan.scope` (mandatory field, always present, empty/undefined-valued for a
  legacy project).
- `app/lib/code-generation/generationPipeline.ts` — `buildGenerationPlan` accepts an
  optional `scope: GenerationPlanScope` and attaches it to the returned plan;
  `runGenerationPipeline` accepts an optional `mvpScope` parameter, threaded through.
- `app/lib/code-generation/projectGenerator.ts` — passthrough of the new `mvpScope`
  parameter (this module has no logic of its own to change).
- `app/lib/application-manifest/manifestTypes.ts` — `ApplicationManifestDraft`/
  `ApplicationManifest` gain `mvpCode` and `featureScope`, both stored in the manifest's
  existing `metadata` JSON column, not new database columns.
- `app/lib/application-manifest/manifestBuilder.ts` — `BuildManifestInput` accepts
  `mvpCode`/`featureScope`, threaded straight onto the built manifest draft.
- `app/lib/application-manifest/applicationManifestRepository.ts` — `saveApplicationManifest`
  writes `mvpCode`/`featureScope` into `metadata` alongside the existing `fingerprints`;
  `fromManifestRow` reads them back.
- `app/lib/application-manifest/resumeOrchestrator.ts` — the sprint's real structural
  addition: a Part 7 out-of-scope guard (see below), plus `crossMvpTransition`/
  `previousMvpId` on `PrepareManifestResult`.
- `app/lib/hooks/useCodeGeneration.ts` — new `resolveMvpScope` helper (resolves the active
  MVP + its Engineering Handoff once, shared by plan-building and manifest-persistence);
  `createPlanReadyHandler` and `runGeneration` both use it; activity logging enriched with
  MVP code and cross-MVP-transition wording.
- `app/lib/projects/sprint48Validation.spec.ts` — 7 new tests (see Testing below).
- Documentation: this file, plus [04-Roadmap/01-phased-migration-plan.md](../04-Roadmap/01-phased-migration-plan.md),
  [04-Roadmap/03-implementation-blueprint.md](../04-Roadmap/03-implementation-blueprint.md),
  and [00-EXECUTIVE-SUMMARY.md](../00-EXECUTIVE-SUMMARY.md).

## Generation Engine Changes (Part 1)

`GenerationPlan.scope` carries `{ mvpId, mvpCode, inScopeFeatureIds, outOfScopeFeatureDescriptions }`,
resolved once per generation run by `useCodeGeneration.ts`'s new `resolveMvpScope` (reads
`mvpRepository.resolveActiveMvpId` plus the approved Product Owner artifact's
`currentMvp.engineeringHandoff`) and passed into `buildGenerationPlan`/`runGenerationPipeline`.

**What this does NOT do, stated plainly (same shape as Sprint 47's own limitation):**
`pageHierarchy`/`entities`/`apiEndpoints` themselves are not filtered by Feature ID — there
is no structural tag on an individual page/entity/endpoint saying which Feature ID produced
it. Those lists already come from drafts Sprint 47's prompt-level instructions asked each
engineering role to keep in-scope; Sprint 48 makes the MVP boundary itself a structural,
carried value, but closing the remaining gap (rejecting an individual out-of-scope *feature*
inside an otherwise-valid MVP) needs a page-level Feature ID tag that does not exist in any
draft's schema today. Adding it would be a real schema change to the Frontend/Database/
Backend drafts, which this sprint's "extend, don't redesign" mandate does not cover —
flagged below as a Sprint 49 recommendation, not silently assumed solved.

## Manifest Changes (Part 2/3)

`mvpId` already existed on the manifest since Sprint 47. Sprint 48 adds `mvpCode` (display
convenience) and `featureScope` (the scope this manifest was built under), both inside the
manifest's existing `metadata` JSON column — no new `builders_application_manifests` column,
no new `builders_application_manifest_files` column. Per-file MVP traceability (Part 3) is
satisfied transitively, not by a new per-file column: every file row belongs to exactly one
`manifest_id`, and that manifest's `mvp_id` already answers "which MVP is this file part
of" — adding a duplicate `mvp_id` onto every file row would be exactly the kind of
unnecessary schema growth this sprint's instructions asked to avoid. The one nuance this
doesn't capture — a file *carried forward* into MVP 2's manifest was originally *authored*
under MVP 1 — is preserved in existing free text: `carryForwardFile`'s `change_reason`
already records `"Carried forward from manifest <id> ..."`, which is the origin-manifest
(and therefore origin-MVP) pointer, reused rather than duplicated into a new column.

## Diff Algorithm Changes (Part 4/5)

The Create/Modify/Preserve mechanism itself (`determineCategoryInvalidation`,
`resolveCarryForwardPlan`, `carryForwardFile`) is **unchanged** — it did not need to be.
`getActiveApplicationManifest(projectId)` already returns whatever manifest is currently
active for the *project*, regardless of which MVP produced it (manifests are project-scoped
with an `mvp_id` tag, not re-parented under MVP — see
[02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md)).
Once MVP 1 finishes generating and MVP 2 starts, that "previous active manifest" the diff
already ran against IS MVP 1's — cross-MVP diffing was mechanically already happening. What
Sprint 48 adds is *reporting* it: `prepareManifestForGeneration` now compares
`previousManifest.mvpId` against the new run's `mvpId` and returns
`crossMvpTransition: boolean` / `previousMvpId?: string`, so callers (and the activity log)
can say "extending MVP-001's manifest" instead of leaving a same-MVP replan and a genuine
MVP-to-MVP extension looking identical.

## Resume Changes (Part 6)

`resumeApplication` (useCodeGeneration.ts) already reconstructs from
`getActiveApplicationManifest(project.id)` — the project's single active manifest, which is
always whichever MVP most recently generated. Resume therefore already resumes within the
current MVP, never restarts the whole product; no logic change was needed here. This sprint
adds the MVP code to the resulting activity-log line for traceability only.

## Traceability Implementation (Part 8)

Feature ID -> Manifest lineage: `GenerationPlan.scope.inScopeFeatureIds` (real Feature IDs)
flows into `ApplicationManifest.featureScope.inScopeFeatureIds`. Manifest -> Activity/History
lineage: every manifest-related activity log entry (`manifest_created`/`manifest_superseded`)
now includes the MVP code when known, and cross-MVP transitions are named explicitly. This
is a real, working trace path, not a queryable index — finding "every manifest version that
ever touched FEAT-006" today means reading `featureScope` on each version's row, not running
a query. A structured, indexed version was not built here, matching Sprint 47's own
reasoning for the same tradeoff: it wasn't necessary to satisfy "wherever practical," and
would have been schema growth beyond what this sprint's data actually needed.

## Part 7 — Out-of-Scope Protection (Read This Before Assuming More Than What's Built)

**This is the one piece of Sprint 48 that is genuinely code-level enforcement, not a prompt
instruction — read carefully what it does and does not cover.**

`prepareManifestForGeneration` now re-resolves `mvpRepository.resolveActiveMvpId(projectId)`
at the moment of persistence and compares it against the `mvpId` the caller planned this run
under. If they disagree — the active MVP was superseded, or a different MVP advanced past
Gate A, while this run's AI generation was in flight (a real race: generation can take tens
of seconds to minutes) — persistence is refused outright (`{ ok: false, error }`), before any
file's status changes. This directly satisfies the sprint's "must never generate during
[a stale] MVP" requirement, and it is enforced in code, not suggested in a prompt.

**What it does NOT do:** it cannot detect an individually out-of-scope *feature* within an
MVP that is still correctly active — that would need the per-page Feature ID tagging
described in the Generation Engine Changes section above, which does not exist. This is the
same class of limitation Sprint 47 documented for the engineering-role prompts ("scope
enforcement is prompt-level instruction, not a runtime validator") — Sprint 48 closes the
MVP-level half of that gap and leaves the feature-level half open, explicitly, rather than
silently claiming more than was built.

## Backward Compatibility Verification (Part 9)

For a legacy project (no Product Owner artifact, or one generating before Gate A):
`resolveMvpScope` resolves `mvpId: undefined`, `mvpCode: undefined`,
`inScopeFeatureIds: []`, `outOfScopeFeatureDescriptions: []` — the same
all-undefined/empty degrade Sprint 47 established for every engineering role.
`buildGenerationPlan`'s `scope` parameter is optional and defaults to exactly that shape.
`prepareManifestForGeneration`'s Part 7 guard only runs `if (input.mvpId)` — a legacy call
never triggers `mvpRepository.resolveActiveMvpId` at all, verified directly in
`sprint48Validation.spec.ts` ("never runs the guard for a legacy/no-MVP project"). No
existing manifest/resume/generation code path changed behavior for a project that has no
MVP.

## Testing (Part 10)

`app/lib/projects/sprint48Validation.spec.ts` (7 tests, all passing):

- `GenerationPlan.scope` carries MVP id/code + Feature IDs when supplied, and degrades to
  empty/undefined for a legacy project.
- `buildApplicationManifest` threads `mvpId`/`mvpCode`/`featureScope` onto the manifest
  draft.
- The Part 7 guard refuses persistence when the resolved active MVP no longer matches the
  plan's MVP, and proceeds normally when it does.
- The guard is never invoked at all for a legacy/no-MVP project.
- A genuine cross-MVP transition (MVP 2 extending MVP 1's manifest) is reported via
  `crossMvpTransition`/`previousMvpId`.

Existing suites required two mechanical updates for the new mandatory `GenerationPlan.scope`
field (`manifestBuilder.spec.ts`, `resumeOrchestrator.spec.ts`'s `makePlan` helper) — no
existing assertion changed. Full `pnpm typecheck` and the full `pnpm vitest run` suite (409
tests, up from 402) pass. Zero new database migrations.

## Risks

- **Part 7's guard is a narrower safety net than "enforce scope" might suggest at first
  read.** It stops generation from silently completing under a stale/superseded MVP; it does
  not stop generation from including an individually out-of-scope feature inside an MVP that
  is still correctly active. Anyone relying on this sprint for the latter should read the
  limitation above before assuming it.
- The race this guard closes (active MVP changing mid-generation) is real but narrow — this
  codebase's own design keeps only one MVP in active engineering/generation at a time (see
  [01-Vision/03-mvp-first-development.md](../01-Vision/03-mvp-first-development.md)), so the
  guard is expected to fire rarely, mainly for a customer approving a new MVP's Gate A while
  a previous generation run they didn't wait for is still in flight.
- `user_modified` customer-edit protection (flagged as a prerequisite for MVP 2+ generation
  in [02-Architecture/03-generation-engine-create-modify-preserve.md](../02-Architecture/03-generation-engine-create-modify-preserve.md))
  remains unbuilt. A real MVP 2 generation today can still overwrite a customer's Workbench
  edit to a file that MVP 2's plan happens to regenerate.

## Recommendations for Sprint 49

1. **Per-page/per-entity Feature ID tagging** — the single biggest remaining gap named
   throughout this document. Requires a real (if small) schema addition to the Frontend/
   Database/Backend drafts, not just the generation engine, so plan it as its own sprint
   rather than squeezing it into an "extend" mandate.
2. **`user_modified` tracking** — add the boolean/checksum-mismatch detector to
   `builders_generated_application_files` and wire it into `resolveCarryForwardPlan` as a
   hard Preserve override, per the architecture doc's own prerequisite framing.
3. **UI**: rename "Generate Application" to "Generate MVP N" and surface `crossMvpTransition`/
   `mvpCode` in the Generation Dashboard/Activity views now that the data exists — a
   Phase-4-shaped, low-risk follow-up once Sprint 48's data is live in a real project.
