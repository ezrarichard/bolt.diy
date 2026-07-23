# Customer Review Workflow

## The Flow You Sketched, Made Precise

```
Requirements Approved
  ↓
AI Product Owner creates MVP Roadmap + current MVP's detailed scope
  ↓
Customer reviews (roadmap skeleton + current MVP's scope)
  ↓
Customer approves
  ↓
Engineering begins
```

This is correct, but reading the earlier architecture documents closely reveals it actually describes **two separate approval moments** that the single-arrow diagram conflates: approving the **scope** (before any engineering work happens) and approving the **delivered MVP** (after generation and preview, before the next MVP unlocks). [03-Development/01-human-approval-philosophy.md](../03-Development/01-human-approval-philosophy.md) already establishes both — this document makes the distinction explicit and gives it a name, because Sprint 46B needs one to implement against.

## Two Gates, Not One

```
Requirements Approved
  ↓
AI Product Owner produces roadmap skeleton + current MVP's full scope
  ↓
┌─────────────────────────────────────────────┐
│ GATE A — Scope Approval                      │
│ Customer reviews the roadmap position AND    │
│ this MVP's specific scope/handoff.           │
│ Decision: approved | changes_requested        │
└─────────────────────────────────────────────┘
  ↓ (only on approved)
Engineering phase runs (Architecture → ... → QA), scoped to this MVP
  ↓
Prototype Generation
  ↓
Preview
  ↓
┌─────────────────────────────────────────────┐
│ GATE B — Delivery Approval                   │
│ Customer reviews the RUNNING application.    │
│ Decision: approved | changes_requested        │
└─────────────────────────────────────────────┘
  ↓ (only on approved)
Next MVP's scope elaboration begins
```

**Should there be an approval gate? Yes, at both points, and they are not redundant:**

- **Gate A (Scope Approval)** exists because it is far cheaper to catch a wrong scope decision *before* the engineering pipeline and generation engine spend real work on it, than after. This is the direct analog of a real product team's sprint-planning review.
- **Gate B (Delivery Approval)** exists because a scope can be approved correctly and the *implementation* can still miss the mark, or the customer's understanding of what they wanted can shift once they see it running (this happens constantly with real software, AI-generated or not). Skipping Gate B and auto-unlocking the next MVP the moment generation completes would undermine the entire "customer is always in the loop" principle from the Product Requirements Document.

**Should MVP planning require customer confirmation? Yes — and specifically at Gate A, not later.** Requiring confirmation only at Gate B (i.e., letting the customer discover the scope was wrong only once they see the finished MVP) would be strictly worse: it wastes a full generation cycle discovering a planning mistake that a five-minute scope review would have caught.

## Pros and Cons Considered

| Model | Pros | Cons | Verdict |
|---|---|---|---|
| Single gate, only after generation (skip Gate A) | Fewer review interruptions | Wastes generation cycles on wrong scope; contradicts "catch mistakes before they're expensive" | Rejected |
| Single gate, only before generation (skip Gate B) | Fewer review interruptions | Lets a badly-executed MVP silently unlock the next one; contradicts "customer always in the loop" for delivered software specifically | Rejected |
| **Two gates (adopted)** | Catches planning mistakes cheaply (Gate A) and execution mistakes before compounding (Gate B); matches how real product teams actually work (plan review, then demo review) | One more review touchpoint per MVP than the single-arrow diagram implied | **Adopted** — the added touchpoint is Gate A, which should be fast (reviewing a bounded, single-MVP scope, not the whole product) precisely because of the two-tier artifact design in [02-artifact-specification.md](02-artifact-specification.md) |

## Full-Roadmap Approval vs. Per-MVP Scope Approval

A related, distinct question: should the customer approve the **entire future roadmap** once, up front, or reconfirm it before every MVP? Recommendation: **approve the roadmap skeleton lightly, once, at the start; require a fresh Gate A scope approval before every individual MVP's engineering phase begins** — because the skeleton is intentionally low-detail (per the two-tier artifact design) and is expected to shift slightly as earlier MVPs surface new information. Re-approving a whole multi-MVP roadmap from scratch every time would be unnecessary friction; skipping fresh scope approval before each MVP's actual engineering work would undermine Gate A's entire purpose.

## Mapping Onto BuildersDB

`builders_mvps.status` (added Sprint 45) already has the right lifecycle values for this (`planned → scoped → generating → ready_for_review → approved → superseded`), but `builders_mvp_approvals` (also Sprint 45) currently only records a bare `decision`, with no way to distinguish "this was a Gate A scope approval" from "this was a Gate B delivery approval." **Recommendation for Sprint 46B:** add a `stage` field (`'scope' | 'delivery'`) to `builders_mvp_approvals`, so both gates share the same table and the same review UI pattern, distinguished by this one field — not two separate tables. This is a small, additive schema change consistent with [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md)'s FK-based-scoping philosophy: extend the existing table with a discriminator column rather than inventing a parallel structure.
