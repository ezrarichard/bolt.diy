# Implementation Blueprint: Dependency Analysis

This is the pre-implementation checklist. It exists to be read immediately before Phase 1 begins, and updated if reality diverges from it during implementation.

## Current Builders → Future Builders (One-Line Framing)

Current: a project plans its entire scope once, across 8 sequential roles, then generates the entire application once. Future: a project plans its entire scope once (Requirements) but re-plans and re-scopes per increment (Product Owner → per-MVP Engineering → per-MVP Generation), repeating until the roadmap is delivered.

## Gap Analysis (Condensed From 02-Architecture/01)

The only structurally missing concept is the MVP as a scoping and ownership dimension. Everything else the future vision needs — versioned artifacts, incremental file generation, activity logging, repair, approval gating — already exists and needs extension, not invention.

## Modules to Reuse (Unchanged)

- `app/lib/webcontainer/` and the Workbench UI (`Workbench.client.tsx`, `EditorPanel.tsx`, `FileTree.tsx`, `DiffView.tsx`) — orthogonal to MVP scoping, operate on whatever code currently exists.
- All 8 existing engineering role engines (`businessAnalystEngine.ts` through `devopsEngineerEngine.ts`) — logic unchanged; they gain one more context input (MVP scope) and one more required FK on write (`mvp_id`), nothing structural.
- The repository-pattern abstraction (`buildersDbRepository.ts`, local/Supabase providers) — designed for exactly this kind of additive evolution.
- Quick Build, entirely — explicitly out of scope for this whole initiative.

## Modules to Extend

| Module | Extension Required |
|---|---|
| `collaborationContext.ts` (`ROLE_ARTIFACT_CHAIN`) | Insert Product Owner stage before Solution Architect; add `phase` awareness |
| `autoEngineeringEngine.ts` (`getNextAutoRole()`) | Sequence Product Owner into the existing loop |
| `buildersDbContextProvider.ts` | Add MVP scope as a context source alongside Requirements |
| `resumeOrchestrator.ts` | **DONE (Sprint 48)** — `prepareManifestForGeneration` diffs against whatever manifest was previously active (already MVP N-1's, once MVP N-1 generated), now reports it explicitly (`crossMvpTransition`/`previousMvpId`), and structurally refuses to persist under a stale/superseded MVP (Part 7 enforcement) |
| `manifestBuilder.ts` / `GenerationPlan` | **DONE (Sprints 48-49)** — `GenerationPlan.scope` (MVP id/code + in-scope Feature IDs); manifest files now carry `featureIds` (Sprint 49), validated structurally against scope before persistence. Per-page/per-entity Feature ID PRECISION (as opposed to MVP-wide tagging) remains open — see Phase 3's "Not yet done" list |
| `generatedFilesRepository.ts` / `builders_generated_application_files` | **DONE (Sprint 49)** — `ownership`/`current_hash`/`user_modified_at`/`conflict_state` added; `app/lib/generated-files/fileOwnership.ts` implements the detection/classification/overwrite-policy rules, enforced in `useCodeGeneration.ts` |
| `ProductPackagePanel.tsx` | Relabel to Release Plan; group by MVP; rename "Generate Application" → "Generate MVP N" |
| `GenerationDashboard.tsx`, `ProjectHistoryPanel.tsx` | Filter/group by `mvp_id` once it exists (Phase 4, UI-only change — logic untouched) |
| `builders_role_outputs`, `builders_application_manifests`, `builders_project_activity` (schema) | Additive `mvp_id` columns, nullable → mandatory per [06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md) |
| `builders_ai_roles` (schema) | Additive `phase` column |
| WebContainer preview lifecycle | Extend to resume/upgrade rather than rebuild per MVP (Phase 5) |

## Modules to Replace

**None.** No existing module needs to be replaced under this plan. If any implementation phase discovers a module that appears to need replacement rather than extension, treat that as a signal to stop and re-review the architecture before proceeding — it would indicate a mismatch between this blueprint's assumptions and the actual code, not a normal implementation surprise.

## Modules to Deprecate (Not Delete)

- The standalone Project Dashboard entry point — deprecated only after Phase 4 ships and has parity, removed only in Phase 6.
- The "generate full product in one pass" code path inside `generationPipeline.ts` — kept functional and available (some projects may legitimately want a single-MVP, single-generation experience) until Phase 6, then formally deprecated, not deleted outright, in case rollback is needed.

## Implementation Order and Dependencies

```
Phase 1 (Schema Foundation)
   ↓  [no dependency on any other phase — can start immediately]
Phase 2 (Product Owner Role)
   ↓  [depends on Phase 1: needs mvp_id columns and phase column to exist]
Phase 3 (Scope-Aware Generation)
   ↓  [depends on Phase 2: needs an approved MVP Scope Definition to filter generation by]
Phase 4 (UI Consolidation)
   ↓  [depends on Phase 3: needs real per-MVP generation data to display; consolidating UI before this exists produces a relabeled but functionally empty workspace]
Phase 5 (Preview Persistence Hardening)
   ↓  [depends on Phase 3: only matters once MVP 2+ generation actually runs against a live prior MVP; can be developed in parallel with Phase 4 since it touches a different subsystem (WebContainer lifecycle, not UI), but should not ship as "done" until validated against a real multi-MVP project]
Phase 6 (Sunset Legacy Path)
   ↓  [depends on Phases 1-5 all being live and used across multiple real projects]
```

Phases 4 and 5 have no hard sequencing dependency on each other and can run concurrently once Phase 3 is complete, since one touches UI/IA and the other touches the WebContainer/container lifecycle.

## Estimated Risk and Complexity Per Phase

| Phase | Risk | Complexity | Why |
|---|---|---|---|
| 1 — Schema Foundation | Low | Low | Purely additive migrations, no behavior change, fully reversible |
| 2 — Product Owner Role | Medium | Medium | New role follows an established pattern (low complexity), but scope-definition *quality* is a genuine judgment-call risk (Risk R4) |
| 3 — Scope-Aware Generation | High | High | Two hard, previously-unsolved problems live here: cross-MVP manifest diffing and user-edit protection (Risk R1). This is the phase most likely to reveal unknowns. |
| 4 — UI Consolidation | Low | Medium | Mechanically straightforward (relabeling, filtering, tab consolidation of components that already work), but has real IA/UX judgment involved in getting information hierarchy right |
| 5 — Preview Persistence | High | High | Known-fragile subsystem with prior incident history (Sprint 44.1); success criteria (fast MVP 2+ preview) is the one most visible to the customer and hardest to fake |
| 6 — Sunset Legacy Path | Low | Low | Deletion/deprecation of code once superseded, low technical complexity, but should not be rushed — real risk is organizational (removing a fallback before it's truly safe to remove) |

**Overall assessment:** Phases 1, 2, 4, and 6 are comparatively low-risk, well-precedented engineering work. Phases 3 and 5 are where the actual hard problems of this initiative live, and estimation/planning effort should be weighted toward them, not toward the schema or UI work that looks larger on paper but is mechanically simpler.
