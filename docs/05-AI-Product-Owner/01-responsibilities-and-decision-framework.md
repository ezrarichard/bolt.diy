# AI Product Owner: Responsibilities & Decision Framework

This is the core specification for the AI Product Owner. It defines what the role is accountable for, how it makes the MVP-boundary decision, which prioritization vocabulary Builders adopts, and how the role should "think." Nothing in this document contradicts [02-Architecture/02-ai-product-owner.md](../02-Architecture/02-ai-product-owner.md) or [01-Vision/02-software-factory-philosophy.md](../01-Vision/02-software-factory-philosophy.md) — it makes them concrete enough to implement in Sprint 46B.

## 1. Responsibilities

The Product Owner is accountable for turning approved Requirements into an executable, incremental roadmap. Its responsibilities, and — critically — the boundary of each one, are:

| Responsibility | What the Product Owner Owns | What It Does NOT Own |
|---|---|---|
| **Product Vision** | One-paragraph statement of what the product is and why it matters, derived from Requirements. Stable across MVPs; revised rarely. | Does not invent new business intent beyond what Requirements/the customer already approved. |
| **Product Goals** | 2-4 concrete, falsifiable outcomes the product should achieve (e.g. "a customer can sign up and see their own dashboard within 5 minutes of landing"). | Not a marketing tagline; must be testable against a running MVP. |
| **Business Objectives** | Why the business wants this (revenue, retention, internal efficiency) — carried forward from Requirements, not re-derived. | Does not perform business strategy the customer hasn't already stated. |
| **Product Scope** | The full feature surface implied by Requirements, split into in-scope (this product will eventually have it) and explicitly out-of-scope (this product will not). | Does not decide *when* — that's MVP Strategy, below. |
| **MVP Strategy** | The ordered decomposition of Product Scope into MVPs. See Section 2. | Does not decide *how* each MVP is technically built — that's Solution Architect's job, downstream. |
| **Release Strategy** | How MVPs map to release identity (`target_release`, e.g. v0.1 → v1.0) — see [06-buildersdb-recommendations.md](06-buildersdb-recommendations.md). | Does not set calendar dates — Builders' delivery cadence is review-gated, not date-driven (see that document's rejection of `planned_start`/`planned_finish`). |
| **Feature Prioritization** | MoSCoW classification of every known feature — see Section 3. | Does not resolve prioritization conflicts unilaterally against explicit customer instruction; customer review can override it. |
| **Feature Dependencies** | Which features require which other features to exist first — the hard constraint MVP Strategy must respect. | Does not resolve *technical* dependencies (e.g. "this API needs that database table") — that's Architecture's concern once scope is handed off. |
| **Technical Constraints** | Constraints already stated or implied by Requirements (must integrate with system X, must support N users, must use existing auth provider). | Does not invent new technical constraints or make architecture decisions — those constraints are captured, not authored. |
| **Business Constraints** | Budget, timeline pressure, regulatory requirements — as stated in Requirements. | Same boundary as above: captured, not invented. |
| **Customer Value** | An explicit one-line justification for every feature's priority ("why does this matter to the customer"). | This is the *reasoning artifact* behind prioritization decisions — it's what a customer reviews to sanity-check the Product Owner's judgment, not a separate deliverable. |
| **Acceptance Criteria** | Per-MVP, testable statements of "this MVP is done when...". | Does not write QA test scripts — that remains QA Engineer's job downstream; these are business-readable, not technical. |
| **Risks** | Known risks to delivering the roadmap (technical risk, scope ambiguity, dependency risk), rated Critical/High/Medium/Low. | Does not attempt to mitigate technical risk itself — flags it for Architecture/Engineering to address. |
| **Assumptions** | Anything the Product Owner had to assume because Requirements didn't say (e.g. "assumed the target users are desktop-first"). | Every assumption should be surfaced, never silently baked into scope — this is what makes the artifact reviewable. |
| **Open Questions** | Anything genuinely ambiguous that the customer should resolve before or during review. | Not a substitute for guessing — if something blocks planning, it's a question, not an assumption. |
| **Future Enhancements** | A lightweight, unordered list of things Requirements implies but no MVP yet covers. | **Deliberately kept lightweight** — see the critique in Section 5 on why this must not become full planning for unscheduled MVPs. |

## 2. MVP Planning: How the Boundary Decision Gets Made

The Product Owner decides what belongs in MVP 1, MVP 2, MVP 3, and beyond using a **sequential, dependency-first heuristic**, not a single weighted score. A single numeric formula (e.g. `value / effort`) invites false precision from an LLM that cannot reliably estimate effort in the first place (see the effort-estimation critique in [06-buildersdb-recommendations.md](06-buildersdb-recommendations.md)). Instead, the decision process is applied in this order:

1. **Identify foundational features.** Authentication, navigation shell, base layout, and the data layer a product's core loop depends on are foundational — they belong in MVP 1 *regardless of customer-value ranking*, because every later feature depends on them existing. This is not a prioritization decision; it's a structural precondition.
2. **Build the dependency graph.** No feature can be scheduled into an MVP before every feature it depends on has already been scheduled into an earlier or the same MVP. This is a hard constraint, not a preference — violating it produces an MVP that cannot actually run.
3. **Within dependency-respecting order, rank by value density.** Among features with no unresolved dependency, prefer the ones with the highest customer value relative to implementation complexity — not highest value in isolation. A feature that's very valuable but very complex may be correctly pushed to MVP 2 in favor of a simpler, still-valuable feature that gets something real in front of the customer sooner.
4. **De-risk early, but only what's load-bearing.** A foundational feature with high technical risk (e.g. "we're not sure this third-party integration will actually work") should move *earlier*, so the risk is discovered while the cost of being wrong is still low. A high-risk feature that is *not* foundational — nothing else depends on it — should move *later*, not earlier; there's no reason to gamble on it before the core product is proven.
5. **Bound MVP size by "smallest coherent slice that proves the core loop," not a fixed count.** There is no universal "MVP 1 should have exactly N features" rule — the right boundary is whatever set of features, taken together, lets the customer experience the product's core value proposition end-to-end (see [01-Vision/03-mvp-first-development.md](../01-Vision/03-mvp-first-development.md)'s example: landing page, auth, dashboard shell, navigation is a legitimate, complete MVP 1 for many products because it proves the foundation works, even with no business logic yet).

## 3. Feature Prioritization Framework: MoSCoW, Not Severity Scale

**Builders adopts MoSCoW (Must Have / Should Have / Could Have / Won't Have)** for feature prioritization, not a Critical/High/Medium/Low severity scale. Reasoning:

- MoSCoW's vocabulary maps directly onto MVP-scoping decisions: **Must Have** = belongs in the current MVP; **Should Have** = strong candidate for the next MVP; **Could Have** = later roadmap, revisit once nearer; **Won't Have (this release)** = explicitly, visibly deferred — this is what prevents "did we forget this?" conversations later, because the artifact records a deliberate decision, not an omission.
- Severity scales (Critical/High/Medium/Low) are the right vocabulary for **risk** (see Section 1's Risks row), where the question is "how bad is it if this goes wrong" — a different question from "how soon should this ship." Using the same four-word scale for both would make a reviewer unable to tell, at a glance, whether "Critical" describes a feature's importance or a risk's severity. Builders deliberately uses **both** frameworks, each scoped to the field where its semantics are actually correct: MoSCoW for `priority` on features, Critical/High/Medium/Low for `severity` on risks and (per [06-buildersdb-recommendations.md](06-buildersdb-recommendations.md)) `business_priority` on an MVP as a whole.

## 4. Product Owner Decision Framework (Summary)

At every decision point, the Product Owner should be able to answer, in order:

1. **Is this foundational?** If yes, it's in the earliest MVP whose dependencies allow it, regardless of value ranking.
2. **What does this depend on, and what depends on it?** This determines the earliest *possible* MVP, before value is even considered.
3. **Among equally-schedulable features, which has the best value-to-complexity ratio?** This determines ordering within an MVP boundary.
4. **Does this feature prove something the customer needs to see to trust the roadmap, or can it wait?** This is the tie-breaker between "Must Have" and "Should Have" when 1-3 don't fully resolve it.
5. **Have I assumed something Requirements didn't actually say?** If yes, it goes in Assumptions, not silently into scope.

## 5. Architectural Critique: Don't Let "Complete Responsibilities" Become "Complete Upfront Planning"

The requested responsibility list (Vision, Goals, Objectives, Scope, MVP Strategy, Release Strategy, Prioritization, Dependencies, Constraints, Value, Acceptance Criteria, Risks, Assumptions, Open Questions, Future Enhancements) is the right list — but if the Product Owner tries to fully elaborate **every** field, for **every** future MVP, in one pass, this initiative reintroduces the exact failure mode it exists to fix: full-product planning, just moved one phase earlier.

**The fix, which shapes the artifact structure in [02-artifact-specification.md](02-artifact-specification.md): most of these fields exist at two levels of detail.**

- **Product-wide, written once, revised rarely:** Product Vision, Business Objectives, Product Scope (the full in/out-of-scope feature surface), and a **roadmap skeleton** — an ordered list of future MVPs with only a `sequence`, a one-line `theme`, and a rough `target_release`, nothing more.
- **Per-MVP, elaborated just-in-time:** Feature list with MoSCoW priority, Dependencies, Acceptance Criteria, Risks, Assumptions, Open Questions — fully written for the **current** MVP only. Future MVPs get their detailed elaboration only once the current MVP is approved and delivered, not upfront.

This is the MVP-first philosophy applied recursively to the planning process itself: plan the next increment in detail, sketch the rest, elaborate later. Skipping this distinction is the single most likely way Sprint 46B could accidentally recreate the original problem under a new name.

## 6. AI Prompt Philosophy (Not the Prompt Itself)

The actual system prompt is Sprint 46B's job. What it must encode, philosophically:

- **Default to the smallest viable slice, not the most complete one.** When in doubt between including a feature in the current MVP or deferring it, defer it — the cost of a missing feature is a fast follow-up MVP; the cost of an oversized MVP is the exact wait-time problem this whole initiative exists to eliminate.
- **Dependency-first, then value-first, never value-only.** A high-value feature that depends on something not yet built cannot be scheduled ahead of its dependency, full stop — no prioritization framework overrides that.
- **Resist speculative future-proofing.** Do not design MVP 1 to "leave room for" features that are only vaguely implied by Requirements. Vague implications belong in Future Enhancements or Open Questions, not in architecture-shaping decisions made this early.
- **Every prioritization judgment must carry an explicit, one-line "why."** This is the Customer Value field's actual job — not decoration, the load-bearing justification a human reviewer checks first when they disagree with a prioritization call.
- **Never invent constraints or requirements not grounded in the approved Requirements artifact.** The Product Owner sequences and scopes; it does not re-litigate or silently expand what the customer already approved upstream. Anything that feels like new business intent belongs in Open Questions, addressed back to the customer, not decided unilaterally.
- **Prefer naming an assumption over guessing silently.** An artifact full of unstated assumptions is unreviewable; a customer can correct a stated assumption in seconds but can't correct one they never saw.
