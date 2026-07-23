# Builders Software Factory — Executive Summary

**Status:** Architecture & Vision Sprint output, updated after a final architecture review pass. No code, migrations, or UI were changed to produce this document set. This is the reference architects should read first; the numbered folders contain the supporting detail. See [00-PRODUCT-REQUIREMENTS.md](00-PRODUCT-REQUIREMENTS.md) for the product-level (not architecture-level) view, and [04-Roadmap/03-implementation-blueprint.md](04-Roadmap/03-implementation-blueprint.md) for the pre-implementation dependency/risk checklist.

**Sprint 49 (2026-07-20): File-Level Feature Traceability & Customer-Edit Protection.** Closes Sprint 48's remaining Phase 3 gaps at the FILE level. `ApplicationManifestFileDraft.featureIds` tags every AI-generated file with the active MVP's in-scope Feature IDs (coarse, MVP-wide — not per-file precision, stated plainly); `manifestBuilder.ts`'s new `validateFeatureIds` structurally strips any out-of-scope/unrecognized ID before persistence (a real code-level guard, tested directly). The larger addition: a five-state file ownership model (`builders_generated | user_modified | user_owned | protected | unknown_legacy`, `app/lib/generated-files/fileOwnership.ts`) plus deterministic checksum-based edit detection — `useCodeGeneration.ts` now reads each previously-generated file's LIVE WebContainer content before a new "Generate MVP N" run, compares it against the last-generated checksum (reusing the existing `fnv1a` hash, no new hashing scheme), and refuses to silently overwrite a file whose content diverged. A subtle correctness fix along the way: protected files are REWRITTEN with their own current content, not omitted, because `writeGeneratedProjectToWebContainer`'s stale-file cleanup would otherwise delete an omitted path. Ownership survives cross-MVP carry-forward (a file protected under MVP 1 stays protected under MVP 2) and resume (`resumeApplication` excludes `user_owned`/`protected` paths from cold-boot reconstruction). **Stated limitations:** no UI exists yet to actually assign `protected`/`user_owned` or review a `FileConflict` — the engine enforces states once set, nothing sets them automatically; edit detection cannot survive a full WebContainer reboot (a pre-existing, separately-tracked limitation, not solved here); per-file Feature ID precision (vs. MVP-wide breadth) remains open, same as Sprint 48's own stated gap. One migration, purely additive, not yet applied. Verified via `fileOwnership.spec.ts`, `sprint49Validation.spec.ts`, and new `generatedFilesRepository.spec.ts` cases (438 tests total, up from 409); no live authenticated-session validation was performed this sprint — flagged as the top Sprint 50 follow-up. Details: [05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md](05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md).

**Sprint 48 (2026-07-20): MVP-Aware Generation Engine.** Closes the gap Sprint 47 left open: the generation engine itself is now MVP-scoped, not just the engineering-role prompts. `GenerationPlan` gained a `scope` field (MVP id/code + in-scope Feature IDs) threaded from the approved Product Owner artifact, through `buildApplicationManifest`, into the persisted manifest's existing `metadata` column (zero new schema columns). The real structural addition is in `resumeOrchestrator.ts`: `prepareManifestForGeneration` now RE-RESOLVES the active MVP at the moment of persistence and refuses (`{ ok: false, error }`) to write a manifest if the MVP it was planned for is no longer active — a genuine code-level block, not a prompt suggestion, closing the race where a multi-minute AI generation run could complete after the active MVP changed underneath it. Cross-MVP transitions (MVP 2 extending MVP 1's manifest) are now explicitly reported (`crossMvpTransition`/`previousMvpId`) rather than silently indistinguishable from a same-MVP replan — the underlying carry-forward/diff mechanism itself was already correct by construction (manifests are project-scoped with an `mvp_id` tag, not re-parented) and needed no rewrite. **Stated limitation, same shape as Sprint 47's:** this protects against generating under a *stale MVP*, not against generating an individually *out-of-scope feature* within a still-valid MVP — no page/entity/endpoint carries a structural Feature ID tag yet, so feature-level filtering remains prompt-level (Sprint 47's own documented gap, still open). `user_modified` customer-edit protection also remains unbuilt — recommended for Sprint 49. Verified via `sprint48Validation.spec.ts` (7 new tests); full typecheck + 409-test suite pass, zero schema migrations. Details: [05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md](05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md).

**Sprint 47 (2026-07-22): MVP-Aware Engineering Pipeline.** Database, UI/UX, Backend, Frontend, and QA engines now all receive the Product Owner's Engineering Handoff (feature IDs, scope, out-of-scope boundary) in their context, matching the pattern Solution Architect already had — extracted `formatEngineeringHandoff` into shared prompt helpers so all 6 roles render it identically. Each role's system prompt now instructs it to design/validate only in-scope features and cite Feature IDs in its own output. **Important limitation, stated plainly:** scope enforcement is prompt-level instruction, not a runtime validator — nothing rejects an out-of-scope artifact structurally. `builders_application_manifests.mvp_id` (nullable since Sprint 45, never populated until now) is populated via a new `mvpRepository.resolveActiveMvpId` — the highest-sequence MVP past Gate A. The manifest's resume/diff algorithm itself and per-file MVP/feature tagging were NOT touched (explicitly out of scope — extend, don't redesign). Legacy projects (no Product Owner artifact) get `engineeringHandoff: undefined` in every role's context, falling back to unchanged pre-Sprint-46 behavior — verified via `sprint47Validation.spec.ts` (11 new tests). Full typecheck + 402-test suite pass. Details: [05-AI-Product-Owner/10-sprint-47-mvp-scoped-engineering.md](05-AI-Product-Owner/10-sprint-47-mvp-scoped-engineering.md).

**Sprint 46D (2026-07-22): Live end-to-end validation — READY FOR SPRINT 47.** A real, authenticated, live run through the actual app (real LLM calls, real production BuildersDB) confirmed the entire planning pipeline works: Product Owner generation, Gate A approval, live MVP creation (`builders_mvps`/`builders_mvp_approvals` rows confirmed via network log), automatic resumption into Solution Architect, and full backward compatibility on a genuine pre-Sprint-46 project. Two real defects were found and fixed: (1) Pipeline Blocking — `product-owner-draft` was missing from every Generation Profile tier, causing a hard API-key failure on first use; (2) Data Integrity — `product-owner-draft` was never seeded into `builders_ai_roles`, causing every Product Owner BuildersDB write to fail its foreign key silently (fire-and-forget, so invisible in the UI, but meant approved Product Owner drafts would not survive a session resume). Both fixed; the second requires a new staged migration (`20260723100000_seed_product_owner_role_catalog.sql`). Full report: [05-AI-Product-Owner/09-sprint-46d-validation-report.md](05-AI-Product-Owner/09-sprint-46d-validation-report.md).

**Sprint 46C (2026-07-22): Product Identity & Traceability Foundation.** Permanent `MVP-NNN`/`FEAT-NNN` identifiers, assigned entirely by the application (never the AI, and never derived from array position or feature title — both explicitly rejected as ID sources). Feature IDs are carried forward across Product Owner regenerations by name-matching against the previous draft; MVP codes are locked in permanently the moment Gate A creates the real `builders_mvps` row, independent of any later roadmap reordering. Engineering Handoff's `featurePriority` (name-keyed) replaced by an `id`-carrying `features[]` array. New `builders_mvps.code` column staged (`20260722100000_mvp_feature_identity.sql`); feature IDs required no migration (they live inside existing JSON content). Traceability for Database/Backend/Frontend/QA/Activity/Reviews/Deployment/Analytics/Customer Feedback is *designed*, not implemented — see [05-AI-Product-Owner/08-identity-and-traceability.md](05-AI-Product-Owner/08-identity-and-traceability.md). Full typecheck + 383-test suite pass.

**Sprint 46B (2026-07-21): AI Product Owner implemented in code.** New role (`productOwnerEngine.ts`), inserted into the existing `ROLE_ARTIFACT_CHAIN`/`AUTO_ENGINEERING_ROLES` (no second orchestrator), Gate A (Scope Approval) wired via `ProductOwnerDraftPanel.tsx`, MVP 1 auto-created in BuildersDB on approval, Solution Architect now reads the Product Owner's structured `engineeringHandoff` instead of nothing. Legacy projects verified to bypass the new gate via `hasLegacyEngineeringProgress`. Migration for the four new `builders_mvps` columns + `builders_mvp_approvals.stage` is staged (`20260721100000_product_owner_mvp_fields.sql`), not yet applied. Full typecheck + 377-test suite pass. Details and deviations in [05-AI-Product-Owner/07-sprint-46b-implementation-plan.md](05-AI-Product-Owner/07-sprint-46b-implementation-plan.md).

**Sprint 46A (2026-07-20): AI Product Owner fully specified, documentation-only.** Complete responsibilities, MVP planning decision framework, MoSCoW feature prioritization, artifact structure + JSON Schema, engineering handoff design, a two-gate customer review model (Scope Approval, then Delivery Approval), and BuildersDB field recommendations (`target_release`, `estimated_effort`, `business_priority`, `blocked_reason` adopted; `planned_start`/`planned_finish`/`actual_finish`/`customer_priority`/`completion_percentage` explicitly rejected, with reasons) now live in [05-AI-Product-Owner/](05-AI-Product-Owner/01-responsibilities-and-decision-framework.md). This is the reference for Sprint 46B (implementation).

**Refinements from the final review pass (read this before implementing):**
1. The AI Product Owner is confirmed as the bridge between Product Planning and Engineering, not a 9th engineering role — implemented as a `phase` tag on the existing role chain, not a second orchestrator. See [02-Architecture/02-ai-product-owner.md](02-Architecture/02-ai-product-owner.md).
2. The "MVP as core object" proposal is **conceptually adopted, literally rejected**: MVP becomes the primary way to *think about and query* engineering/generation/review/activity data, implemented via a second FK (`mvp_id`) that becomes mandatory post-Phase 2, not via re-parenting existing tables under a new MVP entity. See [02-Architecture/06-mvp-as-core-object.md](02-Architecture/06-mvp-as-core-object.md).
3. Requirements, Product Vision, and Deployment remain project-level (never MVP-scoped) by design — confirmed, not just assumed.

## 1. Overall Architectural Assessment

Builders is **not** a greenfield product deciding whether to adopt an MVP-first philosophy. It is a production system that has already been evolving toward incrementality for several sprints, from a different entry point: the **code generation engine**, not the **product planning layer**.

What already exists (verified in code, not aspirational):

- A sequential 8-role AI pipeline (Business Analyst → Solution Architect → Database Designer → UI/UX Designer → Backend Engineer → Frontend Engineer → QA Engineer → DevOps Engineer), each producing a versioned artifact gated on its predecessor's approval (`app/lib/projects/collaborationContext.ts` — `ROLE_ARTIFACT_CHAIN`).
- BuildersDB: a real Supabase-backed control plane (`docs/buildersdb.md`) with versioned role outputs, execution logs, activity feed, and a repository-pattern abstraction that already supports swapping storage backends.
- A manifest-driven, resumable, per-file code generation engine (`app/lib/application-manifest/`) with an 11-state file lifecycle and checksum-based plan diffing that skips unchanged categories on resume.
- An auto-repair loop that validates generated code and re-invokes an internal repair pass on failure.
- A generation dashboard and activity timeline reading live from BuildersDB.

This means the vision's central complaint — "huge prompts, long waits, large JSON, context truncation, no early preview" — is **already partially solved at the file-generation layer**, and the team has direct scar tissue from it (see `docs/buildersdb.md` history and the truncated-role-JSON recovery work in Sprint 44). The remaining problem is one layer up: **the product-planning layer still designs the entire product in one pass** before any code is generated. Requirements → Architecture → Database → UI/UX → Backend → Frontend → QA → DevOps all run once, for the full scope, before "Generate Application" is ever pressed. There is currently no concept of an MVP boundary anywhere in the artifact model, the manifest model, or the Product Package model.

**Conclusion: the vision is directionally correct and should be adopted.** The gap is real and the stated motivation is grounded in this codebase's own incident history. But the vision document, read literally, asks for more demolition than the platform needs. Section 2 below gives the specific corrections.

## 2. Recommended Changes to the Vision (Read Before Adopting Literally)

1. **The AI Product Owner should be a pipeline stage, not a new orchestrator.** The vision describes the Product Owner as sitting "above" engineering roles and producing a Generation Manifest. Implemented literally, this means inventing a second orchestration system parallel to `autoEngineeringEngine.ts`. Instead: insert Product Owner as artifact stage zero in the existing `ROLE_ARTIFACT_CHAIN`, upstream of Solution Architect, reusing the existing `buildXContext → buildXPrompt → generate → parse → persist` pattern every other role already follows. Its artifact is an **MVP Scope Definition**, consumed by every downstream role as a scoping constraint alongside Requirements. This is roughly a role addition, not a new subsystem. See [02-Architecture/02-ai-product-owner.md](02-Architecture/02-ai-product-owner.md).

2. **Don't build a new Create/Modify/Preserve generator — extend the one that exists.** `resumeOrchestrator.ts` and `ManifestFileStatus` already implement per-file create/skip/regenerate semantics via plan-checksum diffing. The real gap is that this diffing only compares a project's spec against its own prior version — it has no concept of "MVP N's manifest vs. MVP N-1's manifest," and critically, **no mechanism today marks a file as user-edited in the Workbench and therefore off-limits to regeneration.** That second gap is the actual risk in an MVP-first world (see Risk R1 in [04-Roadmap/02-risks-and-alternatives.md](04-Roadmap/02-risks-and-alternatives.md)), and it exists independent of whether MVP-first ships.

3. **Don't delete or defer the Dashboard — extend it additively.** `GenerationDashboard.tsx` and `ProjectHistoryPanel.tsx` are weeks old (Sprint 44.2), already read live from BuildersDB, and already give the team most of the "Timeline / Deliverables / Activity" surface the vision asks the future Factory workspace to provide. Recommend adding an "MVP Roadmap" panel alongside the existing dashboard first, then folding legacy views into it as tabs once the MVP dimension exists in the data model — only sunset the standalone dashboard after feature parity, consistent with the "don't remove immediately" instruction already in the vision.

4. **BuildersDB should gain a dimension, not a rewrite.** Every table the vision wants (Product Vision, MVP Releases, Release Reviews, Approvals, Generation Manifest) already has a structural cousin in the current schema (`builders_role_outputs`, `builders_application_manifests`, `builders_product_packages`, `builders_project_activity`). The missing piece is a single `builders_mvps` table and an `mvp_id` foreign key threaded through the existing versioned tables. This is materially lower-risk than the vision implies. See [02-Architecture/04-buildersdb-future-schema.md](02-Architecture/04-buildersdb-future-schema.md).

5. **Preview persistence is the unglamorous blocker.** MVP-first requires the *running app* to survive and be incrementally upgraded across MVP boundaries, not regenerated into a fresh WebContainer each time. This system has already been bitten by container-resume fragility once (Sprint 44.1 install-hang incident). Solve this before scaling MVP count, or every "Generate MVP 2" will pay a full reinstall/rehydrate tax and reintroduce the exact wait-time problem the vision is trying to eliminate.

## 3. Gap Analysis (Current → Future), Condensed

| Vision Requirement | Current State | Gap Size |
|---|---|---|
| MVP-scoped planning | No MVP concept anywhere; roles plan full product scope | **Large** — new role, new schema dimension, new UI |
| Incremental code generation | Manifest + resume orchestrator already do per-file create/skip/regenerate | **Small** — extend diffing across MVP boundaries, add edit-protection |
| Product Owner orchestration | 8-role sequential pipeline exists; no owner-level role | **Medium** — additive role, not new engine |
| Unified workspace (Factory/Code/Preview) | Dashboard + Product Package + Workbench already cover this, as separate panels | **Medium** — consolidation/IA work, not new capability |
| Release approval gates | Per-artifact approval already exists (`applyReviewDecision`) | **Small** — extend gate to MVP granularity |
| Preview persistence across MVPs | WebContainer preview is per-session; resume is fragile | **Large** — this is the highest-risk unsolved piece |
| BuildersDB schema evolution | Repository-pattern abstraction already supports it | **Small** — additive migrations |

## 4. Phased Migration Plan (Summary — full detail in 04-Roadmap)

1. **Phase 0 (this sprint):** Documentation only. Done.
2. **Phase 1:** Schema additions — `builders_mvps`, `mvp_id` FKs, `builders_mvp_approvals`. No behavior change.
3. **Phase 2:** Product Owner role — MVP Scope Definition artifact, added to `ROLE_ARTIFACT_CHAIN` as stage zero. Downstream roles read it as scoping context but keep producing full-product artifacts (no behavior change to generation yet).
4. **Phase 3:** Scope-aware generation — manifest builder accepts an MVP scope filter; resume orchestrator diffs MVP N vs MVP N-1; add "user-edited, do not regenerate" file flag.
5. **Phase 4:** UI consolidation — MVP Roadmap panel added beside existing dashboard; Package tab relabeled/grouped by MVP.
6. **Phase 5:** Preview persistence hardening — solve container resume/upgrade across MVP boundaries.
7. **Phase 6:** Sunset legacy full-product generation path once MVP-first has parity; Dashboard fully folds into unified workspace.

## 5. Documentation Structure

```
docs/
  00-EXECUTIVE-SUMMARY.md          (this file)
  00-PRODUCT-REQUIREMENTS.md       (product-level PRD — what/who, not how)
  01-Vision/
    01-builders-vision.md
    02-software-factory-philosophy.md    (updated: Product Planning vs Engineering phases)
    03-mvp-first-development.md
  02-Architecture/
    01-current-state-gap-analysis.md
    02-ai-product-owner.md               (updated: phase-bridge framing)
    03-generation-engine-create-modify-preserve.md
    04-buildersdb-future-schema.md       (updated: mandatory mvp_id post-Phase 2, phase column)
    05-workspace-migration.md
    06-mvp-as-core-object.md             (new: FK-based scoping vs literal re-parenting)
  03-Development/
    01-human-approval-philosophy.md
    02-ui-philosophy.md
  04-Roadmap/
    01-phased-migration-plan.md          (Phase 1 implemented Sprint 45; Phase 2 spec finalized Sprint 46A)
    02-risks-and-alternatives.md
    03-implementation-blueprint.md       (reuse/extend/replace/deprecate, order, risk/complexity)
  05-AI-Product-Owner/                   (new, Sprint 46A: full Product Owner specification)
    01-responsibilities-and-decision-framework.md
    02-artifact-specification.md
    03-json-schema.md
    04-engineering-handoff.md
    05-customer-review-workflow.md
    06-buildersdb-recommendations.md
    07-sprint-46b-implementation-plan.md
```

## 6. Long-Term Roadmap

See [04-Roadmap/01-phased-migration-plan.md](04-Roadmap/01-phased-migration-plan.md) for the sprint-by-sprint plan. Directionally, this is a 2-3 quarter migration if done additively (as recommended), versus a much riskier "rewrite the workspace" path if the vision's Factory/Code/Preview restructuring were attempted before the underlying MVP data model exists.

## 7. Risks and Mitigation

Full list in [04-Roadmap/02-risks-and-alternatives.md](04-Roadmap/02-risks-and-alternatives.md). Headline risks: (R1) regenerating over user-edited files once generation is repeated across MVPs; (R2) WebContainer/preview state not surviving MVP-to-MVP upgrades; (R3) BuildersDB write-through being fire-and-forget today, which is fine for a single-pass system but becomes a data-integrity risk once MVP approval gates depend on read-after-write consistency.

## 8. Recommendation

**Adopt the MVP-first Software Factory vision as the official Builders architecture, with the five amendments in Section 2.** The direction is validated by the platform's own incident history, not just aspiration. The corrected sequencing (schema dimension → planning role → scope-aware generation → UI consolidation → preview hardening) lets each phase ship independently and keeps the recently-built manifest/dashboard/repair infrastructure as a foundation rather than a casualty.
