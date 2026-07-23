# Generation Engine: Create / Modify / Preserve

## The Vision's Ask

The vision asks for a generator that can distinguish between files that need to be created fresh, files that need to be modified because requirements changed, and files that should be preserved untouched — rather than regenerating an entire application on every run.

## What Already Exists

This is largely already built, one layer down from where the vision assumes it needs to be built. `app/lib/application-manifest/`:

- `ManifestFileStatus` gives every planned file an 11-state lifecycle (pending → queued → generating → generated → validating → repairing → validated → complete | failed | skipped | superseded).
- `ManifestFileSourceKind` already distinguishes `scaffold | ai_generated | derived | copied | repair_generated` — the "why does this file exist" dimension.
- `resumeOrchestrator.ts` compares the current `GenerationPlan`'s checksum (`GenerationPlanFingerprints`, per-category: types/services/pages/components) against the latest persisted manifest. If unchanged, it skips regenerating that category entirely (**Preserve**). If changed, it creates a new manifest version and regenerates only the affected categories (**Modify**/**Create**).

So Create/Modify/Preserve as a *mechanism* is not new work. What's missing is applying that mechanism across an **MVP boundary** rather than only within a single project's evolving spec.

## The Actual Gap: Cross-MVP Diffing

Today, `resumeOrchestrator.ts` answers: "has this project's plan changed since the last time I generated it?" MVP-first needs it to answer a different question: "given MVP N's manifest, what does MVP N+1 need to Create (new features), Modify (extend existing files, e.g. add a nav link to an existing layout), or Preserve (leave completely alone)?"

This requires:

1. Threading `mvp_id` through `builders_application_manifests` and `builders_application_manifest_files` (see [04-buildersdb-future-schema.md](04-buildersdb-future-schema.md)), so a manifest is scoped to an MVP, and successive MVPs' manifests can be diffed against each other explicitly rather than implicitly through a single evolving checksum.
2. Extending the resume orchestrator's diffing logic to compare *across* manifests belonging to the same project but different MVPs, not just against the immediately prior version of the same manifest.
3. Generation prompts for "Modify" files need the existing file's content as context (not just the plan), so the AI edits rather than replaces. This does not exist today because today's model never intentionally regenerates a file that already has customer-relevant content in it — every regeneration today is a repair or a resume of an incomplete run, not an intentional extension of working software.

## The Harder Gap: Protecting Customer Edits — IMPLEMENTED (Sprint 49)

This was the risk this document originally flagged as unsolved before MVP-first could ship
past a single MVP. Sprint 49 built exactly the mechanism recommended below: a checksum-
mismatch detector (`app/lib/generated-files/fileOwnership.ts`'s `detectManualEdit`, run at
the start of every "Generate MVP N" call via `useCodeGeneration.ts`'s
`detectFileOwnershipConflicts`) plus an ownership classification
(`builders_generated_application_files.ownership` — five states, not just a boolean; see
[05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md](../05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md)
for the full model). Default behavior for a manually-modified file is exactly "Preserve,
surface it" as recommended here — Builders does not overwrite it, and records a
`FileConflict` for a future review UI. The "explicit opt-in to replace" interaction
(customer says "yes, replace my edits too") is NOT built yet — the data model and
enforcement exist; the UI action to authorize a specific replacement does not.

**One caveat this document's original recommendation didn't anticipate:** detection only
works within a LIVE WebContainer session — there is no persistent disk across a full page
reload, so a customer's edit that was never otherwise persisted cannot be recovered after a
reboot. This is the pre-existing "Preview Persistence" limitation this document's own next
section already flags — Sprint 49 does not solve it, and says so explicitly rather than
overclaiming.

## Preview Persistence

Related and equally unsolved: the WebContainer preview lifecycle (`generate → install → launch`) assumes a fresh container per generation run. MVP-first needs the running app to be resumed and incrementally upgraded, not rebuilt, or every "Generate MVP N" pays a full reinstall/reboot cost — which reintroduces the exact "customer waits too long" problem this vision exists to solve. This system has direct incident history here (Sprint 44.1's install-hang root cause was a duplicate installer triggered by a replayed restore artifact), meaning container resume is known to be fragile today, not just untested. This should be treated as a distinct, tracked engineering risk (see [04-Roadmap/02-risks-and-alternatives.md](../04-Roadmap/02-risks-and-alternatives.md), Risk R2), not an assumed side-effect of the manifest work.

## Recommendation Summary

- Do not build a new generation engine. Extend `resumeOrchestrator.ts` and the manifest schema with an MVP dimension.
- Treat user-edit protection as a prerequisite for shipping MVP 2+ generation, not a nice-to-have.
- Treat preview persistence as its own workstream with its own risk tracking, given known fragility.
