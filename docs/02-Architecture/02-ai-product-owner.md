# The AI Product Owner

**Full specification (Sprint 46A):** this document remains the architectural summary. The complete, implementation-ready specification — responsibilities, MVP planning decision framework, feature prioritization model, artifact structure, JSON Schema, engineering handoff design, two-gate customer review workflow, and BuildersDB field recommendations — lives in [docs/05-AI-Product-Owner/](../05-AI-Product-Owner/01-responsibilities-and-decision-framework.md). Read that folder before implementing (Sprint 46B).

## The Product Owner Is Not an Engineering Role

This distinction matters and should be preserved through implementation: the Product Owner belongs to the **Product Planning phase**, not the Engineering phase. It is the bridge between business planning (Business Analyst, Requirements Approval) and engineering (Solution Architect onward), not the ninth entry in an undifferentiated list of engineering roles. See [01-Vision/02-software-factory-philosophy.md](../01-Vision/02-software-factory-philosophy.md) for the phase-level flow and why the distinction is load-bearing (different consumer, different approval default, different lifespan).

Concretely, this is expressed as **data, not a second pipeline**: add a `phase` column to `builders_ai_roles` (`product_planning` | `engineering`), tag the Product Owner's row accordingly, and tag its artifact type (`MVP_SCOPE_DRAFT`) as project-level/planning-scoped rather than MVP-engineering-scoped in the artifact-type catalog. The mechanics below (insert into `ROLE_ARTIFACT_CHAIN`, reuse `getNextAutoRole()`) are unchanged — the phase tag is metadata on top of the same chain, not a fork of it.

## Role Definition

The Product Owner is stage zero of the engineering pipeline — it runs after Requirements is approved and before Solution Architect begins. It does not design the system; it decides what subset of the approved Requirements belongs in the current MVP.

Its artifact, **MVP Scope Definition**, contains:

- Product Vision (one paragraph, stable across MVPs)
- MVP Roadmap (ordered list of MVPs, each with a one-line theme)
- Release Plan for the *current* MVP only
- Sprint Backlog (features in scope for this MVP)
- Feature Priorities and Dependencies (why this ordering)
- Risks
- Acceptance Criteria
- Generation Manifest reference (the scope handed to Solution Architect onward)

## Implementation Approach: Extend, Don't Replace, the Existing Pipeline

The vision describes the Product Owner as an orchestrator that "every engineering role consumes." Read literally, this invites building a second orchestration system alongside `autoEngineeringEngine.ts`. That is unnecessary and risky — it would mean two competing sources of truth for "what should the engineering pipeline do next."

Instead:

1. Add `PRODUCT_OWNER` as a new entry in `ARTIFACT_TYPES`, producing an `MVP_SCOPE_DRAFT` artifact, following exactly the same `productOwnerEngine.ts` pattern as the other 8 engines (buildContext → buildPrompt → generate → parse → persist).
2. Extend `ROLE_ARTIFACT_CHAIN` in `collaborationContext.ts` so Solution Architect (and every role downstream) is gated on `MVP_SCOPE_DRAFT` approved, in addition to its existing gates.
3. Every downstream role's `buildXContext()` function gains one more context source: the current MVP's scope definition, the same way it already pulls the Requirements draft. This is additive to `buildersDbContextProvider.ts`, not a rewrite of it.
4. `getNextAutoRole()` needs one addition: after Requirements approval, insert Product Owner into the sequence before Solution Architect. This is a small, local change to `autoEngineeringEngine.ts`, not a new state machine.

This reuses ~90% of the existing pipeline machinery. The Product Owner is a role like the other 8, distinguished only by what it produces (scope, not a technical artifact) and where it sits in the chain (first, not last).

## What Changes for the Other 8 Roles

Nothing about their internal logic changes. What changes is their **input scope**: Solution Architect today reasons about "the whole product's architecture." Under MVP-first, it reasons about "the architecture needed for MVP N's scope, informed by what architecture already exists from MVP N-1." This means:

- Role prompts need to distinguish "design fresh" (MVP 1) from "extend existing" (MVP 2+). This is a prompt-engineering change per role, not a structural one.
- Role outputs need MVP scoping in BuildersDB (see [04-buildersdb-future-schema.md](04-buildersdb-future-schema.md)) so that MVP 2's Architecture artifact is understood as extending MVP 1's, not replacing it.

## Why This Role Must Not Auto-Approve Itself

Every other role in the current pipeline auto-approves after generation (per the existing sequential-loop model — see [01-current-state-gap-analysis.md](01-current-state-gap-analysis.md)). The Product Owner's output is different in kind: it is a scoping and prioritization decision with direct business consequence (what does the customer see first, what do they wait for). This is the one stage in the pipeline that should default to requiring explicit customer approval before Solution Architect proceeds, even in "auto-engineering" mode. See [03-Development/01-human-approval-philosophy.md](../03-Development/01-human-approval-philosophy.md) for why this is a deliberate exception, not an inconsistency.

## Risk: Product Owner Quality Is the New Single Point of Failure

Everything downstream now depends on the Product Owner drawing sensible MVP boundaries. A bad scope decision (e.g., splitting authentication from the feature that requires it) produces an MVP that technically "runs" but is not meaningfully reviewable. Mitigate by:

- Giving the Product Owner explicit dependency-analysis instructions grounded in the approved Requirements artifact, not free-form judgment.
- Always surfacing the MVP Roadmap (all future MVPs, not just the current one) to the customer for approval, so scoping mistakes are caught before generation, not after.
