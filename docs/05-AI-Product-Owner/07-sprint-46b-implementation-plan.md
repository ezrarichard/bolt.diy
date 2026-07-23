# Sprint 46B Implementation Plan

**Status: IMPLEMENTED (2026-07-21).** The plan below is preserved as originally written; see the "Sprint 46B — What Actually Shipped" section at the end for the final state, including three deliberate deviations from this plan (documented, not silent).

This is the implementation checklist for the AI Product Owner, derived directly from this specification set. It assumes Sprint 45's foundation (`builders_mvps`, `builders_mvp_approvals`, `app/lib/mvp/`) is already applied and available.

## Schema Changes (additive, same conventions as Sprint 45)

1. `builders_mvp_approvals.stage` (`'scope' | 'delivery'`, not null, no default — every future insert must specify it) — see [05-customer-review-workflow.md](05-customer-review-workflow.md).
2. `builders_mvps.target_release` (nullable text) — see [06-buildersdb-recommendations.md](06-buildersdb-recommendations.md).
3. `builders_mvps.estimated_effort` (nullable text, enum `small|medium|large` enforced at the application layer, consistent with this codebase's existing free-text-status convention).
4. `builders_mvps.business_priority` (nullable text, enum `critical|high|medium|low`).
5. `builders_mvps.blocked_reason` (nullable text).
6. Add `'blocked'` as a documented (not constrained) value for `builders_mvps.status`.

## Application Code

1. **New role engine:** `app/lib/projects/productOwnerEngine.ts`, following the exact `buildContext → buildPrompt → generate → parse → persist` shape of the 8 existing engines. Its artifact type is tagged `phase: 'product_planning'` in `builders_ai_roles` (column added in Sprint 45).
2. **New artifact type:** `MVP_SCOPE_DRAFT` (or similar), added to wherever `ARTIFACT_TYPES` is currently defined, following the JSON Schema in [03-json-schema.md](03-json-schema.md).
3. **Chain insertion:** extend `collaborationContext.ts`'s `ROLE_ARTIFACT_CHAIN` so Solution Architect (and everything downstream) is gated on the Product Owner's artifact being approved, in addition to its existing gate on Requirements. Extend `autoEngineeringEngine.ts::getNextAutoRole()` to insert the Product Owner between Requirements approval and Solution Architect. This is metadata added to the existing chain, per [02-Architecture/02-ai-product-owner.md](../02-Architecture/02-ai-product-owner.md) — not a second orchestrator.
4. **Approval default override:** unlike the other 8 roles (which auto-approve in sequence under `useAutoEngineeringPipeline.ts`), the Product Owner's artifact must NOT auto-approve — implement the Gate A check explicitly, per [05-customer-review-workflow.md](05-customer-review-workflow.md).
5. **Engineering handoff extraction:** Solution Architect's `buildArchitectContext()` (or equivalent) reads `currentMvp.engineeringHandoff` from the Product Owner's approved artifact, not the full artifact — per [04-engineering-handoff.md](04-engineering-handoff.md). This is the one place where a downstream role's context-building function changes in this sprint.
6. **MVP creation wiring:** when the Product Owner's artifact is generated, call `mvpRepository.createMvp()` (or update, if the MVP already exists from a prior planning pass) to persist the roadmap skeleton entries and the current MVP's row, including `target_release`/`estimated_effort`/`business_priority` if the Product Owner proposed values for them.
7. **Gate A wiring:** on customer approval of the Product Owner's artifact, call `mvpRepository.recordMvpApproval()` with `stage: 'scope'`. This is the trigger that unblocks `getNextAutoRole()` from proceeding to Solution Architect.
8. **Gate B wiring (not yet fully implementable):** Gate B fires after Prototype Generation and Preview, which depend on Phase 3 (scope-aware generation, [02-Architecture/03-generation-engine-create-modify-preserve.md](../02-Architecture/03-generation-engine-create-modify-preserve.md)) — not yet built. Sprint 46B should stub the `stage: 'delivery'` call site (e.g. a TODO wired to the existing MVP-approval UI pattern) but the real trigger point doesn't exist until Phase 3 ships. Do not force Gate B to fire against today's whole-product generation pipeline — that would misrepresent what's actually being reviewed.

## What Sprint 46B Should Explicitly NOT Do

- Should not modify `generationPipeline.ts`, `manifestBuilder.ts`, or `resumeOrchestrator.ts` — those belong to Phase 3, not the Product Owner's introduction.
- Should not make downstream engineering roles (Architecture onward) actually scope their *generation* to the current MVP yet — until Phase 3 ships, they can continue producing full-product-scope technical artifacts, just now informed by the Product Owner's handoff as additional context. The handoff's `outOfScopeFeatures` field existing is preparation for Phase 3, not a claim that generation already respects it.
- Should not skip Gate A's explicit-approval requirement, even in automatic-pipeline mode — this is the one deliberate non-auto-approving step in the chain.

## Suggested Sprint 46B Sequencing

1. Migration: the 6 schema additions above (one migration file, same idempotent conventions as Sprint 45's).
2. `productOwnerEngine.ts` + artifact type + JSON Schema validation, tested in isolation (unit tests against a fixed Requirements input, mirroring how other role engines are likely tested).
3. Chain/orchestration wiring (`ROLE_ARTIFACT_CHAIN`, `getNextAutoRole()`), with Gate A's non-auto-approval behavior.
4. `mvpRepository` wiring (create/update MVP rows and roadmap skeleton on artifact generation; `recordMvpApproval(stage: 'scope')` on customer approval).
5. Solution Architect's `engineeringHandoff` context extraction.
6. Backward-compatibility verification: `pnpm typecheck` + full `pnpm vitest run`, same bar as Sprint 45.

## Exit Criteria

A project can: have Requirements approved → Product Owner produces a roadmap skeleton + fully-elaborated MVP 1 → customer reviews and approves it (Gate A, recorded with `stage: 'scope'`) → Solution Architect (and the rest of the engineering chain) begins, informed by the `engineeringHandoff` block. Generation itself remains whole-product-scoped until Phase 3 — that's expected and correct for this sprint.

## Sprint 46B — What Actually Shipped

All schema and application-code items above were implemented as planned, with three deliberate deviations, none of which contradict the approved architecture:

1. **Bespoke parser, not an extension of the shared `parseStructuredDraft`.** The Product Owner's draft has real nested structure (feature/risk objects, a nested `engineeringHandoff` object, roadmap entries) that the shared parser's `text | list | decisions` field kinds can't express. Rather than extending that shared, 8-consumer parser with new kinds for one role's nested shape, `productOwnerEngine.ts` implements its own parser, reusing only the two genuinely generic pieces (`extractJsonPayload`, `looksTruncated`) from `draftParsing.ts`. Zero risk to the other 8 roles' parsing; fully covered by `productOwnerEngine.spec.ts`.
2. **`nextMvpSequence` is hardcoded to `1` in `ProductOwnerContext`.** MVP generation beyond MVP 1 is out of this sprint's explicit scope. Once cross-MVP planning exists (Phase 3+), this should be derived from the project's actual persisted MVP roadmap (`app/lib/mvp/mvpRepository.ts::listMvpsForProject`) instead of being a constant. Flagged in code with a comment at the point that needs to change.
3. **MVP 1 creation and the Gate A approval record are wired into `ProductOwnerDraftPanel.tsx`'s approve action, not into `useAutoEngineeringPipeline.ts`.** Since the Product Owner never auto-approves (Gate A is always a human decision — see below), the manual approve button is the *only* code path that ever transitions this artifact to `'approved'`, whether the draft itself was generated automatically or manually. Wiring the MVP-creation side effect there — rather than adding BuildersDB/async concerns to the otherwise-synchronous `productOwnerEngine.ts`, or to the auto-pipeline hook, which never actually reaches this point — keeps every engine file's existing "pure orchestration, no store access" contract intact.

**A backward-compatibility bug was found and fixed during implementation, not anticipated in this plan:** `autoEngineeringEngine.ts::isAutoEngineeringComplete` originally required every role in `AUTO_ENGINEERING_ROLES` — now including Product Owner — to have an approved artifact. Without a fix, every project that finished its 7-role engineering pipeline *before* Sprint 46B would regress from "complete" to "incomplete", since it will never produce a Product Owner artifact (`canGenerateProductOwner` correctly refuses to generate one for such projects). Fixed by exempting the Product Owner role from this check specifically for projects where `hasLegacyEngineeringProgress()` is true — mirroring the exact backward-compatibility pattern `isProjectDefinitionApproved` already used. Caught by the existing `autoEngineeringEngine.spec.ts` regression suite (one pre-existing test failed until this fix landed), not by new test-writing — a good sign the existing test coverage was doing its job.

**Not yet implemented in this sprint (explicitly out of scope, per the sprint's own exclusions):** Gate B (Delivery Approval) has no real trigger point yet, since Preview/Prototype Generation for a specific MVP doesn't exist until Phase 3. `builders_mvp_approvals.stage: 'delivery'` and `mvpRepository.recordMvpApproval` both already support it in code; nothing calls it yet.
