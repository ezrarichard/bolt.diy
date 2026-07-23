# Phased Migration Plan

Each phase is independently shippable and backward compatible with the phase before it. No phase requires the next one to exist to deliver value or to avoid regressions.

## Phase 0 — Documentation (this sprint, complete)
Architecture and vision documents only. No code, migrations, or UI changes. Deliverable: this `docs/` tree.

## Phase 1 — Schema Foundation — IMPLEMENTED (Sprint 45)

**Status:** code and migration script complete; migration SQL is staged for manual execution in the Supabase SQL Editor, not yet applied. The application code does not assume the tables/columns exist until that happens — every function touching them is defensive (guarded, try/catch, safe fallback), matching this codebase's existing repository conventions.

- `builders_mvps` and `builders_mvp_approvals` tables added — see `supabase/migrations/20260720100000_mvp_foundation.sql`.
- Nullable `mvp_id` columns added to `builders_role_outputs`, `builders_application_manifests`, `builders_project_activity`.
- `phase` column added to `builders_ai_roles` (defaults existing 8 roles to `'engineering'`).
- New module `app/lib/mvp/` (`mvpTypes.ts`, `mvpRepository.ts`, `mvpRepository.spec.ts`) — CRUD for MVPs and MVP approvals, following the exact repository pattern of `applicationManifestRepository.ts`. Nothing calls this module from any user-facing flow yet.
- `buildersDbRepository.ts::createOrUpdateRoleOutput` and `addProjectActivity` gained an optional `mvpId` parameter/field (default `null`), following the plan's own recommendation. Existing call sites are unchanged and untouched.
- **Implementation refinement (differs from the original doc, noted per the sprint's "don't silently change the design" instruction):** `mvp_id` threading was scoped to the BuildersDB persistence layer only (`buildersDbRepository.ts`, `buildersDbTypes.ts`) — it was deliberately **not** threaded into `applicationManifestRepository.ts` or `manifestTypes.ts` this sprint, even though the `builders_application_manifests.mvp_id` column exists. Those modules sit inside the generation engine's boundary, which Sprint 45's instructions explicitly excluded ("Do NOT modify the generation engine"). Wiring the manifest repository's `mvp_id` parameter is deferred to the Phase 3 work itself, alongside the rest of scope-aware generation.
- **Exit criteria met:** migration script generated and reviewed (awaiting manual execution — see the SQL in Sprint 45's implementation report); repository methods accept an optional `mvpId` parameter without changing existing call sites; `pnpm typecheck` and the full `pnpm vitest run` suite (368 tests) pass unchanged.

## Phase 2 — Product Owner Role — IMPLEMENTED (Sprint 46B), extended (Sprint 46C)

**Status:** the Product Owner role, its two-tier artifact, the engineering handoff, Gate A (Scope Approval), and MVP 1 auto-creation are all live in code. The Sprint 46B migration (`supabase/migrations/20260721100000_product_owner_mvp_fields.sql`) is staged for manual execution, not yet applied — see Sprint 46B's implementation report for the full deviation list (bespoke parser, hardcoded `nextMvpSequence`, and where the MVP-creation side effect is wired) and a real backward-compatibility bug this sprint found and fixed (`isAutoEngineeringComplete`'s legacy-project exemption).

**Sprint 46C (Product Identity & Traceability Foundation)** added permanent `MVP-NNN`/`FEAT-NNN` identifiers to the artifact and the `builders_mvps.code` column (staged migration: `supabase/migrations/20260722100000_mvp_feature_identity.sql`), and replaced the Engineering Handoff's name-keyed `featurePriority` with an `id`-carrying `features[]` array. See [05-AI-Product-Owner/08-identity-and-traceability.md](../05-AI-Product-Owner/08-identity-and-traceability.md).

**Full specification complete (Sprint 46A):** see [docs/05-AI-Product-Owner/](../05-AI-Product-Owner/01-responsibilities-and-decision-framework.md) for the complete, implementation-ready design — responsibilities, MVP decision framework, MoSCoW prioritization, artifact structure + JSON Schema, engineering handoff, two-gate approval model, and finalized BuildersDB field additions. [07-sprint-46b-implementation-plan.md](../05-AI-Product-Owner/07-sprint-46b-implementation-plan.md) supersedes the bullet list below with a more detailed, sequenced checklist — treat this section as the high-level summary and that document as authoritative for implementation order.

- Add `productOwnerEngine.ts` following the existing 8-role pattern; tag its `builders_ai_roles` row `phase = product_planning`.
- Add `MVP_SCOPE_DRAFT` artifact type, tagged as project-level/planning-scoped (no `mvp_id`, same as Requirements).
- Extend `ROLE_ARTIFACT_CHAIN` and `getNextAutoRole()` to insert Product Owner between Requirements approval and Solution Architect. This is metadata added to the existing chain, not a second orchestrator — see [02-Architecture/02-ai-product-owner.md](../02-Architecture/02-ai-product-owner.md).
- Product Owner output requires explicit approval (does not auto-approve, unlike other roles — see [03-Development/01-human-approval-philosophy.md](../03-Development/01-human-approval-philosophy.md)).
- Downstream roles (Architecture onward) gain the MVP scope as additional prompt context but **still generate full-scope artifacts** at this phase — i.e., this phase adds the planning role without yet changing generation behavior.
- **`mvp_id` becomes NOT NULL from this phase onward for any newly created Architecture-or-later role output row** (see [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md)) — enforced at the write path, not just recommended.
- **Exit criteria:** a project can produce an approved MVP Roadmap and MVP 1 Scope Definition; no change yet to what code gets generated.

## Phase 3 — Scope-Aware Generation — MOSTLY IMPLEMENTED (Sprints 47-49)

**Status:** Sprint 47 delivered the engineering-role side. Sprint 48 delivered MVP identity through the generation engine (`GenerationPlan.scope`, MVP-staleness enforcement). Sprint 49 delivered file-level Feature ID tagging (`ApplicationManifestFileDraft.featureIds`) and customer-edit protection (the `ownership` model — `builders_generated | user_modified | user_owned | protected | unknown_legacy`, edit detection via live-content checksum comparison, and a safe-overwrite policy enforced in `useCodeGeneration.ts`). See [05-AI-Product-Owner/10-sprint-47-mvp-scoped-engineering.md](../05-AI-Product-Owner/10-sprint-47-mvp-scoped-engineering.md), [05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md](../05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md), and [05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md](../05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md).

**Not yet done (remaining Phase 3 work):**
- Per-page/per-entity Feature ID PRECISION — every file in an MVP-scoped run gets the whole MVP's Feature ID set (Sprint 49), not a specific per-file subset. Closing this needs a draft-schema change (tagging pages/entities/endpoints with the Feature ID that produced them, upstream in the Frontend/Database/Backend drafts), deliberately deferred rather than squeezed into "extend, don't redesign."
- A review UI for `FileConflict`s and for assigning `protected`/`user_owned` ownership — Sprint 49 built the data model and enforcement; nothing in the product surfaces either to a user yet. Flagged as the top Sprint 50 recommendation.
- Customer edits cannot survive a full WebContainer reboot — edit detection (Sprint 49) only works within a live session; recovering an unpersisted browser-only edit across a page reload remains Phase 5's (Preview Persistence) problem, not solved here.
- Rename "Generate Application" to "Generate MVP N" in `ProductPackagePanel.tsx`.
- `builders_application_manifests.mvp_id` remains nullable (not yet made NOT NULL) — populated when an active MVP exists but not enforced as mandatory.
- **Exit criteria (mostly met):** a project can generate MVP 1, be approved, then generate MVP 2 which structurally extends MVP 1's manifest without regenerating unaffected files AND without silently overwriting a file the customer manually edited within that live session (verified by test) — the remaining gap is UI to act on a detected conflict, and edit-survival across a full container reboot.

## Phase 4 — UI Consolidation
- Add MVP Roadmap panel.
- Fold `GenerationDashboard.tsx` and `ProjectHistoryPanel.tsx` views into MVP-scoped tabs under the roadmap, filtered by `mvp_id`.
- Relabel Package tab to Release Plan, grouped by MVP.
- **Exit criteria:** a customer can complete a full MVP 1 → review → MVP 2 cycle without leaving one workspace view; the standalone Project Dashboard entry point is deprecated but not yet removed.

## Phase 5 — Preview Persistence Hardening
- Solve WebContainer resume/upgrade across MVP boundaries so "Generate MVP N+1" does not pay a full reinstall/reboot cost.
- Directly informed by the Sprint 44.1 install-hang incident (duplicate installer triggered by replayed restore artifact) — this phase should start from that root cause, not from a fresh design.
- **Exit criteria:** measured time-to-preview for MVP 2+ is materially lower than a from-scratch generation of equivalent scope.

## Phase 6 — Sunset Legacy Full-Product Path
- Only after Phases 1-5 have shipped and been used across multiple real projects: remove the standalone Project Dashboard entry point and the "generate full product in one pass" code path.
- Quick Build is explicitly untouched by this phase — it remains a separate, frozen product line.

## Sequencing Rationale

This order deliberately does the highest-uncertainty, highest-value item (Phase 1-3, the MVP data model and scope-aware generation) before the highest-visibility item (Phase 4, UI). This is the reverse of how the vision document is organized (which leads with UI/workspace concepts) — see [00-EXECUTIVE-SUMMARY.md](../00-EXECUTIVE-SUMMARY.md) Section 2 for why.
