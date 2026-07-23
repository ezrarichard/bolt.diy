# Product Identity & Traceability Foundation (Sprint 46C)

This document covers the three identity/traceability decisions this sprint made, why each was implemented the way it was, and what's deliberately left unimplemented (Part 3 — traceability preparation, not traceability itself).

## Part 1 — MVP Identity

**Decision: `builders_mvps.code` (e.g. `"MVP-001"`), a new column, separate from both the surrogate `id` (uuid) and `sequence` (int, the roadmap's current ordering).**

Why a third field, not just reusing one of the other two:

- The surrogate `id` is a uuid — correct as a database key, useless as something a human or a future feature (release notes, customer feedback) would reference in conversation or in a URL.
- `sequence` is *not* permanent by definition — the whole point of a roadmap is that it can be reordered as priorities shift (see [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md)'s discussion of `business_priority` vs. `sequence`). Using `sequence` as the identity would mean reordering the roadmap silently breaks every existing reference to "MVP 2."

**How it's assigned:** `code` is computed once, at the moment the Product Owner's approved artifact creates a real `builders_mvps` row (Gate A — see [05-customer-review-workflow.md](05-customer-review-workflow.md)), from `currentMvp.id` in that artifact — which is itself computed deterministically from `sequence` at draft-parse time (`MVP-{sequence, zero-padded to 3 digits}`). Once written to the database row, `code` is **never recomputed**, even if a later Product Owner regeneration proposes a different `sequence` for what the artifact still calls the same MVP. If the caller omits `code` entirely (a legacy or defensive call site), `mvpRepository.createMvp` computes the same fallback formula itself — satisfying Part 7's "if IDs are missing, gracefully generate them" at the persistence layer, not just the artifact layer.

**Why deriving from `sequence` at draft-time isn't "using array position":** the Product Owner instructions for this sprint explicitly reject position/title-derived IDs. `sequence` is not the array index of an entry in the `roadmapSkeleton` JSON array — it's a semantically meaningful field the Product Owner itself assigns to express "this is the Nth MVP," independent of whatever order entries happen to appear in the array. Keying off that field's *value*, not the array's *position*, is a meaningful distinction: an AI reordering the JSON array on regeneration doesn't change any entry's `sequence` value, so it doesn't change any entry's `id` either.

## Part 2 — Feature Identity

**Decision: `FEAT-{3-digit counter}`, assigned by the application (never the AI), carried forward across regenerations by matching feature `name` against the previous draft — not derived from array position or from `name` itself.**

This is a materially harder problem than MVP identity, because features have no persisted database row to anchor to (they live entirely inside a Product Owner artifact's JSON `content`, which gets fully replaced on every regeneration) — see [02-artifact-specification.md](02-artifact-specification.md). Two naive approaches were explicitly ruled out by this sprint's own instructions:

- **Array position** — an AI regenerating the same MVP might reorder features in its output for stylistic reasons having nothing to do with meaning; using index as ID would silently reassign every downstream reference.
- **Feature title/name** — a legitimate rewording (the AI or a human polishing a feature's name) would look identical to "this feature was deleted and a new one was added," even though nothing about the feature's identity should have changed.

**What's actually implemented:** IDs are minted by the application in a post-processing pass over the AI's parsed output (`productOwnerEngine.ts`'s `assignFeatureIds`), never by the model — the JSON contract sent to the AI (`prompts/productOwner.ts`'s `JSON_SHAPE`) doesn't mention IDs at all, because an LLM has no reliable way to maintain a stable counter across independent generations (this is exactly the failure mode this whole sprint exists to prevent, and asking the AI to *also* invent IDs would just move the unreliability instead of removing it).

The assignment pass, given the newly-parsed feature list and (optionally) the previous draft's feature list:

1. For each new feature, look for a feature in the previous list whose `name` matches case-insensitively.
2. If matched, carry forward that feature's existing `id`.
3. If unmatched (a genuinely new feature, or a renamed one — see below), mint the next unused `FEAT-NNN` value.

**Deliberate, documented limitation: a rename is treated as "delete + add," not "same feature, new name."** Without a title-match signal, there is no other information available to decide "this is conceptually the same feature" — and the instructions for this sprint explicitly forbid using the title *as the ID itself*, not using it as a *matching heuristic* for carry-forward, which is a different (and here, unavoidable) use of the same field. This is called out explicitly rather than left as a silent gap: if a future sprint needs renames to preserve identity, the fix is a stronger matching signal (e.g., asking the AI to also emit a `previousName` hint when it renames something) — deliberately not implemented now, to avoid asking the model to track its own prior state, which is the exact fragility this design avoids everywhere else.

**Where the carry-forward state comes from, architecturally:** `parseDraft`'s shared, generic signature (used by all 8 other roles via `AutoEngineeringRole.parseDraft: (rawText: string) => ...` and `DraftPanelConfig.parseDraft`) only ever receives the raw AI text — no project or prior-draft context. Rather than changing that shared contract for one role's need, `productOwnerEngine.parseDraft` accepts an **optional second parameter** (`previousDraft?: ProductOwnerDraft`), and `ProductOwnerDraftPanel.tsx` — which already has access to the project's existing artifacts — wraps the exported function in a closure that supplies it, before handing that closure (not the bare exported function) to `useDraftPanel`. No shared hook changed; only this one component's own wiring did.

## Part 3.5 — File-Level Traceability (Sprint 49 Update)

Part 3 below described the pattern each future consumer should follow "when it's actually
built." Sprint 49 built the first of these: `ApplicationManifestFileDraft.featureIds:
string[]` (manifestTypes.ts), populated by `manifestBuilder.ts` from
`GenerationPlan.scope.inScopeFeatureIds` (itself sourced from `EngineeringHandoff.features[].id`,
via `useCodeGeneration.ts`'s `resolveMvpScope` — the same Feature ID values this document
describes, carried one layer further than Sprint 46C anticipated). See
[12-sprint-49-traceability-and-ownership.md](12-sprint-49-traceability-and-ownership.md) for
the full design, including the honestly-stated limitation this update doesn't remove: every
file in an MVP gets the WHOLE MVP's feature set (coarse), not a specific per-file subset
(fine) — the array-of-strings pattern this document anticipated for a `relatedFeatureIds`
field turned out to be exactly the right shape, but populating it with genuine per-file
precision (not MVP-wide breadth) remains future work, same caveat as Part 3's own "not
wired up" framing below, just one level more specific now that the shape exists in code.

## Part 3 — Traceability (Prepared, Not Implemented)

Per this sprint's own scope, only Architecture (Sprint 46B's `engineeringHandoff.features`) actually receives feature IDs today. The other consumers listed in this sprint's brief — Database, Backend, Frontend, QA, Activity, Reviews, Deployment, Analytics, Customer Feedback — are **not wired up**, by design. What follows is the prepared pattern each should use when it's actually built:

- **Database / Backend / Frontend / QA** (future engineering roles, Phase 3+): should receive `featureId` alongside whatever content they consume from the Product Owner or from each other, the same way Architecture now receives `EngineeringHandoff.features: { id, name, priority }[]` (see [04-engineering-handoff.md](04-engineering-handoff.md)) instead of a name-keyed record. Each of these roles' own draft artifacts can carry a `relatedFeatureIds: string[]` field once they need to cite specific features — no schema change required, since role output content is unstructured JSON already.
- **Activity / Reviews**: `builders_project_activity` and `builders_task_reviews` already support arbitrary `metadata`/`notes` — a `featureId`/`mvpId` key in that JSON is all that's needed once an activity entry or review is about a specific feature, not just a role or task. No migration required.
- **Deployment / Analytics / Customer Feedback**: these don't exist as concrete Builders concepts yet (Deployment is explicitly project-level per [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md); Analytics and Customer Feedback have no schema at all today). When they're designed, the same pattern applies: a nullable `feature_id text` / `mvp_id uuid references builders_mvps(id)` column, following exactly the FK-based-scoping precedent already established for `mvp_id` in [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md) — an MVP's surrogate `id` (not its human-readable `code`) is what any future foreign key should reference, since `code` is a display/citation identifier, not a join key.

**The one rule every future consumer should follow:** reference `mvp.id` (the uuid) for foreign keys, and `mvp.code`/`feature.id` (the human-readable strings) for display and for citing features from LLM-generated text — the same split BuildersDB already uses elsewhere (e.g., `builders_projects.id` is the free-text join key; nothing needed a separate "display code" for a project yet, but the moment something does, this is the pattern to reuse).

## Summary of Code Changes

| Field | Where it lives | Assigned by | Migration |
|---|---|---|---|
| `builders_mvps.code` | New DB column | Application (`mvpRepository.createMvp`, from the approved artifact's `currentMvp.id`, or a computed fallback) | `supabase/migrations/20260722100000_mvp_feature_identity.sql` (staged) |
| `ProductOwnerDraft.roadmapSkeleton[].id` / `currentMvp.id` | Inside the existing JSON artifact content | Application (`productOwnerEngine.ts`'s `formatMvpId`, from `sequence`) | None — inside existing `content` column |
| `ProductOwnerFeature.id` | Inside the existing JSON artifact content | Application (`assignFeatureIds`, carrying forward matches by name) | None — inside existing `content` column |
| `EngineeringHandoff.features[].id` | Inside the existing JSON artifact content | Application (derived from `currentMvp.features`, not parsed from the AI) | None — inside existing `content` column |
