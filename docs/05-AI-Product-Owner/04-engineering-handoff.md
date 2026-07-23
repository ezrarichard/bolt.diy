# Engineering Handoff Specification

**Sprint 46C update:** every feature in this handoff now carries a permanent `id` (`FEAT-001`, ...) — see [08-identity-and-traceability.md](08-identity-and-traceability.md). This is the first real consumer of the identity work: Architecture's own output can now cite a feature unambiguously by ID instead of by (unreliable) name.

**Sprint 47 update:** the handoff is no longer Architecture-only. Database, UI/UX, Backend, Frontend, and QA now all receive it too — see [10-sprint-47-mvp-scoped-engineering.md](10-sprint-47-mvp-scoped-engineering.md). Scope/out-of-scope enforcement remains prompt-level (each role is instructed to respect the boundary), not a structural runtime validator — read that document before assuming otherwise.

## The Problem With Handing Over "Requirements"

If the Product Owner simply hands Solution Architect the same Requirements artifact the Business Analyst produced, nothing has actually changed — Architecture would still be reasoning about the whole product's scope, just with an extra document appended. The entire point of inserting the Product Owner is that Architecture (and every role after it) should receive a **bounded, structured, MVP-scoped** handoff — not the full narrative artifact described in [02-artifact-specification.md](02-artifact-specification.md).

## What Solution Architect Actually Receives

Solution Architect's context, from Sprint 46B onward, is built from `currentMvp.engineeringHandoff` (see the JSON Schema in [03-json-schema.md](03-json-schema.md)) — not the Product Owner artifact's customer-facing sections (Product Vision, Business Objectives, Future Enhancements). Those remain available for context if a downstream role's prompt genuinely needs them, but the handoff block is the **default, minimal** input, following the same discipline as every other role in the pipeline (each role today already gets a scoped slice of prior context, not the entire project history).

| Field | Purpose | Source |
|---|---|---|
| `scope` | The feature list for this MVP, restated as plain scope statements (not the full feature objects with priority/dependencies — Architecture needs "what to build," not "how the Product Owner ranked it"). | Derived from `currentMvp.features[]` where `priority` is not `"Won't Have"`. |
| `constraints` | Technical + business constraints merged into one list — Architecture needs to know the limits it's designing within. | `currentMvp.technicalConstraints[]` + `currentMvp.businessConstraints[]`. |
| `architectureGoals` | What "good architecture" means for this MVP specifically (e.g. "must support adding MVP 2's payment feature without a rewrite" — an explicit forward-compatibility instruction, not a full future spec). | Authored by the Product Owner, informed by `roadmapSkeleton`'s next 1-2 entries, without leaking their full detail. |
| `successCriteria` | High-level, business-readable definition of "the architecture succeeded" — distinct from acceptance criteria (below), which are feature-level. | Authored by the Product Owner. |
| `acceptanceCriteria` | Copied directly from `currentMvp.acceptanceCriteria[]` — Architecture and every downstream role should see the same acceptance bar the customer will review against. | `currentMvp.acceptanceCriteria[]`. |
| `features` | Array of `{ id, name, priority }` — Sprint 46C replaced the original name-keyed `featurePriority` lookup with this, so Architecture (and Backend/Frontend/QA after it) can cite a feature unambiguously by its permanent `id` instead of by name, which is exactly the "titles are not reliable" problem the identity work fixes. See [08-identity-and-traceability.md](08-identity-and-traceability.md). | Derived from `currentMvp.features[]`, which already carries the id assigned by `assignFeatureIds`. |
| `outOfScopeFeatures` | Explicit list of what NOT to build for this MVP, even if Requirements mentions it. This is the single most important field for preventing scope creep back into full-product generation — every downstream role should treat this as a hard boundary, not a suggestion. | `productScope.inScope` minus `currentMvp.features[].name`, plus anything explicitly marked `"Won't Have"`. |

## Why "Out of Scope" Is a First-Class, Required Field

This deserves its own emphasis: `outOfScopeFeatures` is not a nice-to-have. Every engineering role downstream of the Product Owner (Architecture, Database, UI/UX, Backend, Frontend, QA) currently has no concept of "don't build this yet" — today, absence of a feature from a prompt is the only signal that it's out of scope, which is fragile (an LLM can still infer and add functionality it thinks belongs in a "complete" system). Making this an explicit, required, review-visible field turns "don't build the payments feature yet" from an implicit hope into an explicit constraint every role's prompt can quote directly.

## What This Does Not Change

Solution Architect's own internal logic (`solutionArchitectEngine.ts`) is unchanged by this handoff design — it still runs the same `buildContext → buildPrompt → generate → parse → persist` sequence as every other role. The only change is *what feeds `buildContext`*: today it's the whole-product Requirements draft; from Sprint 46B onward, it's this handoff block plus Requirements. This is consistent with the "extend, don't replace" principle from [02-Architecture/01-current-state-gap-analysis.md](../02-Architecture/01-current-state-gap-analysis.md).
