# Evaluation: Should the MVP Become the Core Object?

## The Proposal

Instead of everything hanging off Project directly:

```
Project
  ↓
Requirements → Engineering → Generation
```

Restructure so Engineering, Generation, Reviews, Preview, History, Activity, Approvals, and Versions all become children of an MVP:

```
Project
├── Requirements
├── Product Vision
├── MVP 1
│     ├── Architecture
│     ├── Database
│     ├── UI
│     ├── Backend
│     ├── Frontend
│     ├── QA
│     ├── Generated Prototype
│     ├── Customer Review
│     └── Approval
├── MVP 2
├── MVP 3
└── Deployment
```

## Verdict: Adopt the Conceptual Model, Reject the Literal Re-Parenting

The tree is the right way to *think about* the data, and it should become the primary framing in documentation, UI, and query design going forward. It should **not** be implemented as literally re-parenting existing tables so that Architecture/Database/UI/Backend/Frontend/QA rows live "inside" an MVP entity instead of being scoped to a Project with an MVP tag. Those are functionally equivalent in a relational database, but they carry very different migration risk, and the difference matters here.

### Why the conceptual tree is correct

- It matches how the resume/generation engine already needs to reason: "what does MVP 2 need, given what MVP 1 already built" is a parent-child relationship, and `resumeOrchestrator.ts`'s cross-MVP diffing (see [03-generation-engine-create-modify-preserve.md](03-generation-engine-create-modify-preserve.md)) is naturally a tree traversal, not a project-wide checksum comparison.
- It gives customers and the future unified workspace ([05-workspace-migration.md](05-workspace-migration.md)) a legible unit of review: "show me everything about MVP 2" should be one query, not a project-wide fetch filtered client-side.
- It correctly separates **project-level, stable-across-MVPs** concepts (Requirements, Product Vision, and — per the proposal's own diagram — Deployment) from **MVP-scoped, per-increment** concepts (Architecture through QA, Generated Prototype, Review, Approval). This is worth confirming explicitly: not everything moves under MVP. Requirements, Product Vision, and Deployment remain project-level, because they describe things that span the product's whole life, not one increment of it.

### Why literal re-parenting is the wrong implementation

Every engineering artifact table today (`builders_role_outputs`, and by extension the generation tables) is keyed by `project_id`. If MVP becomes the *physical* parent — i.e., these rows are keyed by `mvp_id` and reach `project_id` only transitively through the MVP — then every existing read path that currently asks "what is this project's latest Architecture artifact" (`collaborationContext.ts`, `buildersDbContextProvider.ts`, the repair engine, the Product Package assembler) must be rewritten to first resolve "which MVP," then descend. That is a foundational rewrite of the read/write surface of the entire engineering pipeline, not an additive migration — and it is exactly the kind of large-blast-radius change the original review recommended avoiding.

**The equivalent, lower-risk implementation:** keep `project_id` as the primary, always-present key on every table (nothing today changes ownership), and add `mvp_id` as a **second, eventually-mandatory** key alongside it — not nested beneath it. Concretely:

- `builders_role_outputs.mvp_id`: nullable through Phase 1 (schema exists, unused), becomes **NOT NULL** for any row whose artifact type is Architecture-or-later (Engineering-phase artifacts) once Phase 2/3 ship. Remains nullable/absent for Requirements and Product Vision rows, which are project-level by design.
- `builders_application_manifests.mvp_id`, `builders_generated_application_files` (via manifest), `builders_project_activity.mvp_id`, `builders_task_reviews`/new `builders_mvp_approvals`: same pattern — mandatory once Phase 2/3 ship, because these are inherently per-increment concepts with no project-level equivalent.
- `builders_projects` gains no new required relationship to MVP at all — a project can exist with zero MVPs (still in Requirements/Product Planning), which the literal re-parenting model would represent awkwardly.

This produces exactly the tree the proposal wants, queryable that way (`WHERE mvp_id = X` gives you the whole subtree), without ever changing which table is authoritative for which row, and without invalidating any existing repository method's contract — they gain a parameter, not a new call shape.

## What Should Change From the Original Recommendation

The original architecture docs described `mvp_id` as staying nullable indefinitely, added defensively. That should be corrected: **for Engineering-phase and Generation-phase tables, `mvp_id` should become mandatory (NOT NULL) as soon as the Product Owner role exists and produces a scope for MVP 1** — not left permanently optional. Leaving it permanently nullable would let engineering artifacts silently exist outside any MVP, which is precisely the "planning-not-bounded-to-an-increment" problem this whole initiative exists to close. This is a meaningful strengthening of Phase 2/3's exit criteria in [04-Roadmap/01-phased-migration-plan.md](../04-Roadmap/01-phased-migration-plan.md), and that document has been updated accordingly.

## Complexity and Debt Assessment

| Approach | Migration Risk | Query Complexity | Read-Path Rewrite Required |
|---|---|---|---|
| Literal re-parenting (tables owned by MVP) | High — every FK direction changes | Lower once done | Yes, extensive |
| FK-based scoping (recommended) | Low — additive columns, enforced later | Marginally higher (join or filter by `mvp_id`) | No — existing methods gain a parameter |

The FK-based approach is recommended without reservation. It delivers the same conceptual tree, the same query ergonomics for the future unified workspace, and the same enforcement guarantee (mandatory `mvp_id` post-Phase 2) — at a fraction of the migration risk.
