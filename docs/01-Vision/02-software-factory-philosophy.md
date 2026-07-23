# Software Factory Philosophy

## The Flow

```
Customer
  ↓
Business Analyst              (exists today — businessAnalystEngine.ts)
  ↓
Requirements Approval          (exists today — Project Definition approval workflow, Sprint 3faa8b5)
  ↓
┌─────────────────────────────────────────────────────┐
│ PRODUCT PLANNING PHASE                               │
│                                                       │
│  AI Product Owner   (NEW — see 02-Architecture/02)   │
│    ↓                                                  │
│  Product Vision      (NEW artifact type)              │
│    ↓                                                  │
│  MVP Planning         (NEW artifact type)             │
│    ↓                                                  │
│  Release Planning      (NEW artifact type)            │
│    ↓                                                  │
│  Feature Priorities                                   │
└─────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────┐
│ ENGINEERING PHASE (per MVP)                          │
│                                                       │
│  Solution Architect → Database Designer → UI/UX →     │
│  Backend Engineer → Frontend Engineer → QA Engineer   │
│  (exist today, re-scoped to the current MVP)          │
└─────────────────────────────────────────────────────┘
  ↓
Prototype Generation        (extends existing manifest/generation engine — see 02-Architecture/03)
  ↓
Preview                     (exists today — WebContainer, needs persistence hardening)
  ↓
Customer Review              (extends existing review/approval model to MVP granularity)
  ↓
Next MVP
```

## Two Phases, Not One Undifferentiated Pipeline

The distinction between **Product Planning** and **Engineering** is architectural, not cosmetic. The Product Owner is not "role #9 in the engineering pipeline" — it is the bridge between business planning and engineering, and it should be treated as its own phase for three reasons:

1. **Different consumer.** Product Planning artifacts (Product Vision, MVP Roadmap, Release Plan, Feature Priorities) are written for the *customer* to review and approve. Engineering artifacts (Architecture, Database, UI/UX, Backend, Frontend, QA) are written for *downstream AI roles and the generation engine* to consume. Conflating them into one undifferentiated 9-role list would blur who the artifact is actually for.
2. **Different approval default.** As established in [03-Development/01-human-approval-philosophy.md](../03-Development/01-human-approval-philosophy.md), Product Planning output requires explicit customer approval even in auto-engineering mode; Engineering artifacts (today) auto-approve in sequence. This is a phase-level behavior difference, not a per-role quirk.
3. **Different lifespan.** Product Vision and MVP Roadmap are project-level concepts that persist and get revised across the life of the whole product. Engineering artifacts (Architecture, Database, etc.) are scoped and versioned per MVP. See [02-Architecture/06-mvp-as-core-object.md](../02-Architecture/06-mvp-as-core-object.md) for how this maps onto BuildersDB.

**Implementation note (unchanged from the prior recommendation):** this phase distinction should be expressed as data — a `phase` field on the role catalog (`builders_ai_roles`: `product_planning` | `engineering`) and an artifact-category tag — not as a second orchestration engine. `ROLE_ARTIFACT_CHAIN` and `getNextAutoRole()` remain the single source of truth for sequencing; Product Owner is inserted into that same chain, distinguished by its `phase` tag, its artifact type, and its approval default — not by a parallel pipeline. Building a second orchestrator to honor this phase distinction would reintroduce exactly the risk flagged in the original review: two competing sources of truth for "what runs next."

## Why a Product Owner and Not Just "Smaller Prompts"

It would be tempting to solve the truncation/wait-time problem by simply chunking the existing full-product plan into smaller code-generation batches after the fact. That does not solve the actual problem: the *planning* is still done for the whole product, so Architecture, Database, and UI/UX still have to reason about every feature at once, and the customer still doesn't see anything until planning finishes. The Product Owner's job is to make the *scoping decision before* Architecture ever runs, so every downstream role — and every downstream artifact — is naturally smaller because it is planning less.

The Product Owner does not replace Solution Architect, Database Designer, or any engineering role. It decides:

- **What** gets built
- **When** (which MVP)
- **In what order** (dependencies)

Its outputs — Product Vision, MVP Roadmap, Release Plan, Sprint Backlog, Feature Priorities, Dependencies, Risks, Acceptance Criteria, Generation Manifest — are consumed as scoping context by every engineering role, the same way those roles already consume the Business Analyst's Requirements artifact today.

## Why Generation Must Become Incremental

Instead of one `Generate Application` action, the factory performs:

```
Generate MVP 1 → Customer Review → Generate MVP 2 → Customer Review → Generate MVP 3 → ...
```

Every MVP must compile and run independently. This is a harder constraint than it sounds, because it means the generation engine must be able to build on top of a previously generated, and possibly customer-edited, codebase rather than generating into an empty one each time. The existing manifest engine already tracks per-file status and checksums for exactly this reason (`app/lib/application-manifest/resumeOrchestrator.ts`); MVP-first generation is the natural next application of that same mechanism, extended to diff across MVP boundaries rather than only within a single evolving spec. See [02-Architecture/03-generation-engine-create-modify-preserve.md](../02-Architecture/03-generation-engine-create-modify-preserve.md).

## Human Approval as a First-Class Gate

No MVP proceeds to the next without customer review. This is not a UI nicety — it is the mechanism that keeps the factory model honest. A software company that ships without customer sign-off is not really following the "software company" analogy the vision is built on. See [03-Development/01-human-approval-philosophy.md](../03-Development/01-human-approval-philosophy.md).
