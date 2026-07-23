# Builders Product Requirements Document

This document describes Builders as a product — what it is, who it's for, and how it should behave from a customer's and an internal team's point of view. It is intentionally separate from the architecture documents (`01-Vision/`, `02-Architecture/`): those describe *how* the system is built; this describes *what it must do and for whom*. Where the two overlap, this document is the source of truth for product intent, and the architecture documents are the source of truth for implementation.

## What Builders Is

Builders is an AI Software Factory. A business user brings an idea; Builders behaves like hiring a small, disciplined software company — one that plans before it builds, delivers working software in increments, and asks for review at every increment — rather than a chat-based coding assistant that produces code on demand.

Builders is explicitly **not** trying to be the best version of a Bolt-style "describe an app, get a codebase" tool. That product (Quick Build) exists inside Builders today, is frozen, and remains available for users who want disposable, single-shot prototyping. It is not where the product is investing, and this PRD does not cover it further.

## Target Customers

- **Non-technical or semi-technical business owners/founders** who have a product idea and need a working application but don't have (or don't want to spend) engineering resources to plan and build it themselves.
- **Product-minded operators inside a company** who need an internal tool or customer-facing MVP built fast, without waiting on an engineering team's backlog.
- **Not** professional engineers looking for a code-completion or scaffolding tool — that need is served by Quick Build, not the Factory.

## Product Philosophy

1. **Plan before you build.** A business idea is expanded into requirements, reviewed, and only then handed to an AI Product Owner who decides what to build first. Building without a plan is the single biggest source of wasted generation, wasted customer wait time, and unusable output — this is not a process nicety, it is the fix for problems this platform has already experienced in production (oversized generation runs, response truncation, long waits with nothing to show).
2. **Software grows, it doesn't appear.** Every MVP is real, running software — never a mockup, never a placeholder. The customer should always have something to look at and react to, starting from the first delivery.
3. **The customer is always in the loop.** No MVP proceeds to the next without explicit customer review and approval. Builders does not optimize for "finish fast" at the expense of "finish right, one increment at a time."
4. **Don't rebuild what already works.** Builders' engineering pipeline, generation engine, and BuildersDB control plane are treated as a foundation to extend, not scaffolding to discard. Product decisions about *what* to build should not force unnecessary rewrites of *how* it's built.

## The Software Factory Vision

```
Customer → Business Analyst → Requirements Approval →
  [Product Planning: AI Product Owner → Product Vision → MVP Planning → Release Planning → Feature Priorities] →
  [Engineering (per MVP): Architecture → Database → UI/UX → Backend → Frontend → QA] →
  Prototype Generation → Preview → Customer Review → Next MVP
```

See [01-Vision/02-software-factory-philosophy.md](01-Vision/02-software-factory-philosophy.md) for the full architectural treatment of why Product Planning and Engineering are distinct phases.

## Complete User Journey

1. Customer describes a business idea in plain language.
2. Business Analyst expands it into structured Requirements. Customer reviews and approves.
3. AI Product Owner produces a Product Vision, an MVP Roadmap (the full sequence of planned increments, not just the first), a Release Plan for MVP 1, and Feature Priorities. Customer reviews and explicitly approves this plan — this is the one planning step that never auto-approves, because it is a business decision, not a technical execution of already-approved intent.
4. The Engineering phase runs for MVP 1's scope only: Solution Architect, Database Designer, UI/UX Designer, Backend Engineer, Frontend Engineer, QA Engineer each produce artifacts scoped to MVP 1.
5. Builders generates MVP 1 as a real, running application (landing page, auth, dashboard shell, navigation, mock data where real data isn't yet scoped — genuinely small, genuinely real).
6. Customer previews the running MVP 1 inside the Workbench, reviews it, and approves or requests changes.
7. On approval, MVP 2 unlocks. The Engineering phase runs again, scoped to MVP 2, building on — not replacing — MVP 1's codebase. Customer edits made in the Workbench between MVP 1 and MVP 2 are preserved, not silently overwritten.
8. This repeats until the roadmap's MVPs are delivered, at which point Deployment (a project-level concern, not tied to any single MVP) becomes available.

## Internal Team Workflow

For the Builders engineering team building this platform, the practical implication is: every future feature request should be evaluated against the question "does this belong to Product Planning (business/customer-facing) or Engineering (technical/generation-facing)?" This distinction, once the Product Owner ships, should shape where new capabilities are added — new business-facing planning capability extends the Product Owner's artifact set; new technical capability extends the 8 engineering roles or the generation engine. Mixing the two back together (e.g., letting engineering roles make scope decisions, or letting the Product Owner author technical specs) reintroduces the exact planning/engineering conflation this initiative is meant to resolve.

## AI Engineering Team (Reference)

Unchanged from the existing platform: Business Analyst, Solution Architect, Database Designer, UI/UX Designer, Backend Engineer, Frontend Engineer, QA Engineer, DevOps Engineer. Full technical description in [02-Architecture/01-current-state-gap-analysis.md](02-Architecture/01-current-state-gap-analysis.md).

## AI Product Owner (Reference)

New role, belonging to Product Planning rather than Engineering. Full technical description in [02-Architecture/02-ai-product-owner.md](02-Architecture/02-ai-product-owner.md).

## Long-Term UI Vision

A single workspace — Factory, Code, Preview — replacing today's separate Dashboard, Package, and Workbench experiences, arrived at additively and only after the MVP-first data model and generation engine are operational (not before; see [02-Architecture/05-workspace-migration.md](02-Architecture/05-workspace-migration.md)). The customer should never need to leave one screen to move from "review the plan" to "see the running app" to "approve the next increment."

## Success Metrics

- **Time to first working preview**, measured from Requirements approval to MVP 1 running in the Workbench. This is the primary metric MVP-first exists to improve, and it should be tracked explicitly, not assumed to improve.
- **Generation failure/truncation rate per MVP**, expected to drop materially once role and generation scope is bounded per MVP rather than per whole product.
- **Time to preview for MVP 2+** relative to MVP 1, which should be small if preview persistence (Phase 5) succeeds and large (a regression) if it does not — this is the metric that will reveal whether Risk R2 ([04-Roadmap/02-risks-and-alternatives.md](04-Roadmap/02-risks-and-alternatives.md)) has actually been mitigated.
- **Customer-edit loss incidents**, target zero — the metric that validates Risk R1's mitigation (user-edit protection) is working.
- **MVP approval cycle time**, how long a customer takes to review and approve/reject an MVP, as a proxy for whether MVP scope sizing (the Product Owner's core judgment call) is actually reviewable in one sitting.

## Future Roadmap (Product-Level, Not Technical)

- Multiple MVPs feeding into a single coherent Deployment target, with the customer able to see deployment status as a project-level concern independent of which MVP is currently in progress.
- Team workspaces (multiple humans reviewing/approving the same project) — currently a structural placeholder in BuildersDB (`builders_project_members`), unimplemented.
- Possible future "Builders Studio" fork for vibe-coding-style use cases, explicitly out of scope for the Factory product and not covered by this PRD.
