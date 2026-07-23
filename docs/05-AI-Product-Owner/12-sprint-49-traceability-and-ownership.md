# Sprint 49 — File-Level Feature Traceability & Customer-Edit Protection

**Status: IMPLEMENTED.** Extends Sprint 48's MVP-aware Generation Engine down to individual
files: which Feature ID(s) a file was generated for, whether it's been manually modified
since, and whether Builders is allowed to touch it again. The Product Owner subsystem, the
engineering pipeline, and the manifest/resume engine's own tables/version model were not
redesigned — every change is additive to what Sprint 44.2/47/48 already built.

## Part 1 — Current-State Audit

Before writing any code, the following was inspected (via direct file reads plus a
read-only audit agent) to confirm what already existed and avoid duplicating it:

- **Generated file persistence** (`app/lib/generated-files/generatedFilesRepository.ts` /
  `generatedFileTypes.ts`): `builders_generated_application_files` (current state per
  manifest file) + `builders_generated_application_file_versions` (immutable content
  history). `latestChecksum` already existed — the "last content Builders generated"
  baseline this sprint's edit-detection needed. **No ownership/modification-tracking field
  existed anywhere.**
- **Application manifest files** (`applicationManifestRepository.ts` / `manifestTypes.ts`):
  path/category/status/checksum/dependencies — a PLANNING-time record. No Feature ID field.
- **Create/Modify/Preserve** (`resumeOrchestrator.ts`): category-fingerprint-based
  (`determineCategoryInvalidation`/`resolveCarryForwardPlan`), comparing STORED content
  states only — never live workspace content. This is exactly the gap Sprint 49 needed to
  close for edit detection.
- **WebContainer writes** (`webcontainerWriter.ts`): `writeGeneratedProjectToWebContainer`
  writes every file unconditionally and deletes stale ones (paths present in the previous
  generation's stored list, absent from the current one) — **no read-before-overwrite, no
  diffing.** `readGeneratedFileFromWebContainer(path)` already existed (Sprint 43B.1,
  originally for post-repair validation) and turned out to be exactly the primitive needed
  to read live content for edit detection — reused directly, not reinvented.
- **Checksums**: `fnv1a` via `computeFileChecksum` (generatedFilesRepository.ts) — reused
  directly for edit detection; no second hashing scheme introduced.
- **Project hydration** (`stores/projects.ts`'s `hydrateProjectData`): loads role output
  artifacts, requirements, task status/reviews, workspace state — does **not** touch
  manifests or generated files at all. No interaction with this sprint's changes.
- **`user_modified`/ownership/`conflict` concepts**: a full-codebase grep confirmed **zero**
  prior implementation — this is genuinely new code, not a rename/consolidation of
  something that already existed under a different name.

**Conclusion:** the gap was real and exactly where the sprint brief said it was — a live
disk-content comparison mechanism, an ownership classification, and a way to keep planned
files' Feature ID association. Nothing needed to be built twice.

## Part 2/3 — Feature Traceability Model

`ApplicationManifestFileDraft`/`ApplicationManifestFile` gained `featureIds: string[]`
(`manifestTypes.ts`). Tagged by `manifestBuilder.ts`'s `buildFileDrafts`: every
AI-generated file (types/services/pages/components) gets the WHOLE active MVP's
`GenerationPlan.scope.inScopeFeatureIds`; every deterministic scaffold file
(package.json, vite.config.ts, ...) gets `[]` — scaffold files don't implement a feature.

**Stated plainly, per this sprint's own "do not claim complete traceability" instruction:**
this is MVP-wide granularity, not per-file semantic precision. There is no signal anywhere
upstream (Frontend/Database/Backend drafts) saying "this exact page implements FEAT-003 and
not FEAT-004" — inventing that mapping would be fabricating precision the underlying data
doesn't have. Entities beyond files (pages/components/API routes/DB entities/services/tests
as GenerationPlan-level concepts) receive the identical coarse tagging implicitly, since
they ARE the files — no separate entity-level structure was added, because
`GenerationPlan`'s pages/entities/apiEndpoints are already 1:1 with the manifest files
built from them. **Deferred to a future sprint:** true per-page/per-entity Feature ID
precision, which needs a real schema addition to the Frontend/Database/Backend drafts
themselves (each page/entity/endpoint tagged with its originating Feature ID at
requirements time) — out of this sprint's "extend the generation engine, don't redesign
upstream roles" scope.

## Part 4 — Structural Feature-Scope Enforcement

`manifestBuilder.ts`'s new `validateFeatureIds(candidateIds, validFeatureIds)` filters any
candidate Feature ID list down to members of the active MVP's own `inScopeFeatureIds`.
Wired into `validateManifestFileDrafts` (called by `buildApplicationManifest`, the single
point every manifest passes through before persistence): every file's `featureIds` is
validated there, rejected IDs are stripped (never persisted) and reported as a warning
issue, never silently dropped or silently kept.

**Honest caveat on "future MVP" rejection specifically:** there is no cross-MVP Feature ID
registry in this codebase (Feature IDs live inside each Product Owner artifact's own JSON
`content`, replaced wholesale on regeneration — see [08-identity-and-traceability.md](08-identity-and-traceability.md)).
Rejecting "future MVP" IDs is achieved by the SAME mechanism as rejecting any unrecognized
ID: `validFeatureIds` is always the CURRENT active MVP's own list, so a different MVP's
Feature ID (past or future) is never a member of it and is rejected identically to a typo
or an invented ID — the effect is correct, but there is no separate "is this a real ID from
some OTHER MVP" check, because building one would require a registry this codebase doesn't
have and this sprint doesn't add.

**On "this must be code-level enforcement, not prompt instructions":** it is — `validateFeatureIds`
runs unconditionally inside `buildApplicationManifest`, not as an AI instruction. In
practice, because `buildFileDrafts` only ever tags a file with `scope.inScopeFeatureIds`
itself (Part 2), every ID it produces is valid by construction today — there is no current
caller that supplies a mismatched candidate list. The guard is real, tested directly with
synthetic bad input (`sprint49Validation.spec.ts`), and exists as defensive infrastructure
for the moment a future caller (a review UI letting someone hand-tag a file, or a
reconciled unplanned file) supplies an untrusted list — exactly the same "structural guard
built ahead of its full attack surface" pattern Sprint 47/48 used for prompt-level and
MVP-level scope enforcement.

## Part 5 — File Ownership Model

`app/lib/generated-files/fileOwnership.ts` — five states, the exact set the sprint brief
proposed, no more:

| State | Meaning | Who sets it |
|---|---|---|
| `builders_generated` | Builders authored it; still matches what Builders last generated | Automatic (edit-detection) |
| `user_modified` | Builders authored it originally; live content no longer matches | Automatic (edit-detection) |
| `user_owned` | Created outside Builders, or explicitly handed to the customer | **Not set automatically this sprint** — requires a future review UI action |
| `protected` | Builders must never overwrite it, full stop | **Not set automatically this sprint** — same as above |
| `unknown_legacy` | Predates ownership tracking; no comparison baseline exists yet | Automatic (bootstrap default) |

**Only `protected`/`user_owned` are sticky** (never downgraded by edit-detection evidence —
Part 5's own definition: these require an explicit decision to change, not a checksum
comparison). Every other state is RE-DERIVED from live evidence on every check, not a
one-way ratchet: a file flagged `user_modified` whose content later matches the last
generated checksum again (reverted, or round-tripped) is correctly reclassified
`builders_generated`. `unknown_legacy` is a bootstrap state, not a permanent one: the first
time a legacy row (predating this sprint, `ownership: null`) is checked and its live
content matches its existing `latestChecksum`, it promotes to `builders_generated` — real
evidence now exists, so "unknown" no longer applies (Part 13: "conservative" means
"conservative until there is evidence," not "conservative forever").

**What Sprint 49 does NOT build:** any UI or automatic trigger that assigns `protected` or
`user_owned`. The full model, schema, and enforcement machinery respect these states the
moment they're set (by any means — direct DB action today), but nothing in this sprint's
automatic pipeline ever sets them. Flagged as a Sprint 50 recommendation.

## Part 6 — Customer-Edit Detection

`fileOwnership.ts`'s `detectManualEdit(currentContent, lastGeneratedChecksum)` — pure
content-hash comparison (`computeFileChecksum`, the existing `fnv1a` hash, reused
directly), never timestamps, per this sprint's own instruction. `currentContent` is read
live via `readGeneratedFileFromWebContainer` (existing, Sprint 43B.1) at the moment a new
"Generate MVP N" run is about to start — `useCodeGeneration.ts`'s `detectFileOwnershipConflicts`
does this once per run, before any AI call, for every file the active manifest already has
generated content for.

**Scope limitation, stated plainly:** detection only works within a LIVE WebContainer
session — there is no persistent disk across a full page reload/reboot (a known,
pre-existing limitation; see [02-Architecture/03-generation-engine-create-modify-preserve.md](../02-Architecture/03-generation-engine-create-modify-preserve.md)'s
own "Preview Persistence" section and [04-Roadmap/02-risks-and-alternatives.md](../04-Roadmap/02-risks-and-alternatives.md) Risk R2).
A customer's live edit made in the browser and never otherwise persisted cannot be
recovered after a reboot — this sprint's `resumeApplication` change (Part 9) discloses
this honestly rather than claiming to solve it.

## Part 7 — Safe Overwrite Policy

`fileOwnership.ts`'s `resolveOverwritePolicy(ownership)` — exactly the table the sprint
brief specified:

| Ownership | Auto-overwrite | Raises conflict |
|---|---|---|
| `builders_generated` | Yes | No |
| `user_modified` | No | Yes |
| `user_owned` | No | Yes |
| `protected` | No | No (nothing to decide — a hard rule) |
| `unknown_legacy` | No | No (preserved conservatively, not raised for review) |

Enforced in `useCodeGeneration.ts`: `detectFileOwnershipConflicts` computes this for every
previously-generated file before a run starts; `createFileLifecycleHooks`'s `onFileReady`
discards (never persists) newly-generated content for a protected path even though the AI
still generated it (keeps `generationPipeline.ts` itself completely unaware of ownership —
see this file's own comment on why); the final write step rewrites each protected path with
its OWN CURRENT content (not omits it) — omitting would trigger
`writeGeneratedProjectToWebContainer`'s stale-file cleanup and **delete** it, which is the
exact bug this design deliberately avoids (see that function's own updated comment).

## Part 8 — Conflict Handling

`generatedFileTypes.ts`'s `FileConflict`: `path`, `mvpId`, `featureIds`, `existingHash`,
`lastGeneratedHash`, `proposedOperation`, `reason`, `recommendedAction`
(`preserve | replace | review_diff | defer | create_alternate`). Built by
`fileOwnership.ts`'s `buildFileConflict`. Surfaced on `CodeGenerationState.conflicts` (a new
optional field on the existing hook state) — **minimum UI plumbing only**, per this
sprint's own "implement only the minimum UI necessary... do NOT redesign the workspace"
instruction. No conflict-review panel/dialog was built; a future UI reads this field rather
than the engine inventing a second place to store it.

## Part 9 — Manifest and Resume Engine

- `manifestBuilder.ts`/`resumeOrchestrator.ts`'s existing Create/Modify/Preserve mechanism
  (category fingerprints, carry-forward) is **unchanged** — it already only ever compares
  STORED content states, which is exactly the layer ownership doesn't affect (ownership is
  about live-vs-stored, not stored-vs-stored).
- `generatedFilesRepository.ts`'s `carryForwardFile` (the actual cross-manifest content
  copy) now also copies `ownership`/`current_hash`/`user_modified_at` forward alongside the
  content they describe — resetting only `conflict_state` (a conflict against the previous
  run isn't automatically re-opened against a new one). Verified directly:
  `generatedFilesRepository.spec.ts`'s new "carries ownership/edit-detection state forward"
  test.
- `resumeApplication` (useCodeGeneration.ts, cold WebContainer reboot): now excludes
  `user_owned`/`protected` paths from reconstruction entirely (never auto-materialize
  those, resume or otherwise) — see Part 6 for why `user_modified` files are still written
  (best-effort continuity, honestly disclosed) rather than also excluded.

## Part 10 — Cross-MVP Behavior

Validated end-to-end via the carry-forward ownership test (Part 9): a file classified
`protected` under MVP 1's manifest keeps that classification when carried into MVP 2's
manifest for the same path — a cross-MVP transition never resets protection back to
unclassified. One conflicting file never aborts the run: `detectFileOwnershipConflicts`
loops over every previously-generated file independently, and `onFileReady`'s per-path skip
means every OTHER file's generation/persistence/write proceeds normally regardless of how
many conflicts were found.

## Part 11 — Activity, History, and Reviews

Reused `logActivity`/`addProjectActivity` (existing infrastructure) — no second audit
system. New activity types: `file_marked_user_modified`, `protected_file_preserved`,
`generation_conflict_detected`. `out-of-scope Feature ID rejected` is reported as a
`ManifestValidationIssue` (existing mechanism, Sprint 44.1's own convention) rather than a
separate activity type — consistent with how every other manifest-build-time issue already
surfaces.

## Part 12 — BuildersDB

One migration, purely additive: `supabase/migrations/20260726100000_file_ownership_and_feature_traceability.sql`.
`builders_application_manifest_files.feature_ids` (jsonb, default `[]`).
`builders_generated_application_files`: `ownership`, `current_hash`, `user_modified_at`,
`conflict_state` (all nullable text/timestamptz). **`last_generated_hash` was evaluated and
deliberately NOT added** — it would exactly duplicate the already-existing `latest_checksum`
column (Part 12's own "do not add purely derived fields"). Not yet applied — staged for
manual execution like every migration in this initiative.

## Part 13 — Backward Compatibility

Every new field is nullable/defaulted; no backfill. A legacy project's files (predating
this sprint) have `ownership: null`, treated identically to `unknown_legacy` by every
consumer. **Real, disclosed behavior change:** a legacy project's SECOND generation run
after this sprint ships will, for the first time, preserve rather than silently
regenerate/carry-forward any previously-generated file whose live content can't be proven
unchanged (no baseline existed before this sprint tracked one) — this is exactly the safety
this sprint exists to add, not a regression, and doesn't block the REST of that same
generation run (Part 10). Verified: `sprint49Validation.spec.ts`'s legacy-scope tests,
`fileOwnership.spec.ts`'s no-baseline tests.

## Testing (Part 14)

- `app/lib/generated-files/fileOwnership.spec.ts` — 17 tests: edit detection, ownership
  transition table (including the sticky-vs-re-derived distinction), overwrite policy
  table, conflict construction.
- `app/lib/generated-files/generatedFilesRepository.spec.ts` — 3 new tests:
  `updateFileOwnership` persistence, carry-forward ownership passthrough.
- `app/lib/projects/sprint49Validation.spec.ts` — 8 tests: Feature ID tagging (Part 2),
  structural rejection of unknown/future-MVP IDs (Part 4), legacy degrade (Part 13).
- Full `pnpm typecheck` and `pnpm vitest run`: **438 tests passing (up from 409)**, zero
  regressions, migration staged but not applied.
- **Not independently unit-tested:** `useCodeGeneration.ts`'s `detectFileOwnershipConflicts`
  itself (the WebContainer-reading glue) — it is thin sequencing logic over
  already-tested pure functions plus `readGeneratedFileFromWebContainer`, consistent with
  how `createFileLifecycleHooks` and this hook's other orchestration were never
  independently unit-tested either; only its pure dependencies are. Live validation
  (an authenticated Builders session actually generating a second MVP against a
  manually-edited file) was not performed this sprint — flagged below, not silently
  assumed to have passed.

## Live Validation

**Not performed this sprint** — no authenticated Builders session was available in this
environment. Stated plainly rather than assumed: the ownership/conflict logic is verified
by unit tests against realistic mocked BuildersDB responses, not against a real
WebContainer + real production database. Recommended as the first thing Sprint 50 (or a
dedicated validation pass) should do before this feature is considered field-proven, the
same way Sprint 46D's live validation caught two real defects Sprint 46B/C's tests missed.

## Risks and Limitations

- **Per-file Feature ID precision is not implemented** — every file in an MVP gets the
  WHOLE MVP's feature set, not its own specific subset. Anyone querying "which files
  implement FEAT-003" today gets every file in that MVP, not just the ones that actually do.
- **`protected`/`user_owned` have no UI to set them yet** — the model and enforcement exist,
  but nothing in the product surfaces a way for a customer/user to actually mark a file this
  way. Until Sprint 50+ builds that, only `builders_generated`/`user_modified`/
  `unknown_legacy` are ever reachable in practice.
- **Customer edits cannot survive a full WebContainer reboot** — edit detection only works
  within a live session; this is a pre-existing, separately-tracked limitation
  (Risk R2), not something this sprint's ownership model claims to fix.
- **Not live-validated** — see above.
- **A protected file still costs one AI generation call it then discards** — accepted
  tradeoff to keep `generationPipeline.ts` itself ownership-unaware (this sprint's "do not
  redesign the engineering pipeline" instruction); a future optimization could pre-filter
  known-protected paths before the AI call, at the cost of coupling the pipeline to
  ownership state.

## Recommendations for Sprint 50

1. **Build the minimum UI to set `protected`/`user_owned`** — the model has existed since
   this sprint but is unreachable without it. Likely the highest-value, lowest-risk next
   step (Phase-4-shaped: UI over already-correct engine logic).
2. **Live validation pass** — run this feature against a real authenticated session, a real
   WebContainer, and a real hand-edited file, the way Sprint 46D validated the planning
   layer. Treat any defect found the same way Sprint 46D did (fix, document, don't hide).
3. **Per-page/per-entity Feature ID precision** — still the single biggest traceability gap
   named across Sprints 48 and 49. Requires a real schema addition to the Frontend/Database/
   Backend drafts, planned as its own sprint.
4. **Surface conflicts in the UI** — `CodeGenerationState.conflicts` exists and is populated;
   nothing renders it yet. A small, focused addition once Recommendation 1's review UI exists.
