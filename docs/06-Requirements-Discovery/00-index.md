# 06 — Requirements Discovery

Index for everything related to Builders' Requirements Discovery pipeline: the durable
foundation (Sprints 50–54.1, implemented and shipped) and the Interview Mode / Discovery
Experience design series (Sprint 55 onward, architecture and UX specifications — **not yet
implemented**).

## Implemented

| Doc | Sprint(s) | Status |
|---|---|---|
| [01 — Durable Foundation](./01-sprint-50-durable-foundation.md) | Sprint 50 | Implemented (foundation only) |

Sprints 51–54.1 (Requirements Form Integration, Traceability & Provenance, Business Assessment
Engine, Discovery Decision Engine, Discovery Intelligence UI) shipped directly to the codebase
without a corresponding written design doc — their behavior is documented in-code (see
`app/lib/projects/requirementsSession.ts`, `businessAssessmentEngine.ts`,
`discoveryDecisionEngine.ts`, and `app/components/sidebar/BusinessDiscoveryCard.tsx`) and in
their respective commit messages on `builders-v2`.

## Design & Architecture (approved, not yet implemented)

| Doc | Scope | Status |
|---|---|---|
| [02 — Sprint 55: Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) | Conversation lifecycle, question selection/types, memory, traceability, prompt strategy, edge cases, performance, and the Discovery Agent extensibility model for AI Business Interview Mode. | Approved (architecture only) |
| [03 — Sprint 55.1: Interview Mode UX Specification](./03-sprint-55.1-interview-mode-ux-specification.md) | Complete customer-facing UX for Interview Mode: page layout, chat experience, Business Discovery panel behavior, question UI, pause/resume, accessibility, responsive design, and implementation order. | Approved (UX/product design only) |
| [04 — Builders Discovery Experience (BDE): Master Product & UX Specification](./04-builders-discovery-experience-master-spec.md) | The full Discovery Layer across every method (Form, Interview, Document, Website, Template, Voice, Meeting, and future sources) — Discovery Home, unified pipeline, Discovery Dashboard, Discovery Agent, memory, intelligence, timeline, quality, report, handoff, future AI integrations, information architecture, user journeys, roadmap, competitive differentiation, and long-term vision. | Approved (master specification, encompasses and extends 02/03) |

## Reading order

For implementers picking this up: **01 → 02 → 03 → 04**. 01 is what already exists in the
codebase; 02 and 03 design Interview Mode specifically (conversation + UX); 04 is the
umbrella document that generalizes 02/03's ideas to every discovery method Builders will
eventually support, and is the source of truth for anything that isn't specific to
conversational interview (Discovery Home, Discovery Dashboard, Discovery Report, etc.).

None of the documents in the "Design & Architecture" table above have been implemented yet.
No code, migrations, or tests exist for Sprint 55 and later — implementation begins at
Sprint 56 per the roadmaps in docs 02 and 04.
