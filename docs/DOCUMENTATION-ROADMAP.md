# Builders Documentation Roadmap

**Status:** 🟡 Draft · **Version:** 1.0 · **Owner:** Documentation maintenance sprint ·
**Last Updated:** 2026-07-23

This lists documentation areas that still need a formal specification, so future
documentation work has a backlog rather than starting from a blank page each time. An entry
here is a **placeholder for future work**, not a commitment to a specific sprint number.

---

## Near-term candidates (build on what already exists)

| Area | Suggested folder | Why it's needed | Builds on |
|---|---|---|---|
| **Business Analyst role specification** | [07-Business-Analysis](./07-Business-Analysis/) | `businessAnalystEngine.ts` and the `RequirementsDraft` schema are documented only in code today. | [06-Requirements-Discovery](./06-Requirements-Discovery/00-index.md) (Discovery hands off to this role) |
| **AI Engineering pipeline reference** | [08-AI-Engineering](./08-AI-Engineering/) | The 8-role engineering chain (Architecture → ... → DevOps) has no consolidated doc outside code comments. | [02-Architecture](./02-Architecture/) (generation engine architecture), [05-AI-Product-Owner](./05-AI-Product-Owner/) (handoff into this pipeline) |
| **Retroactive ADRs** | [09-Decisions](./09-Decisions/) | Several major decisions already exist in prose form across long documents but not as their own citable record — see [09-Decisions/README.md](./09-Decisions/README.md) for specific candidates already identified. | Existing design docs across the tree |

## Builders Workspace Experience (BWX)

The customer-facing project workspace (dashboard, chat, generation preview, task execution
plan, review queue) has grown through many sprints (Sprint 8 roadmap, Sprint 11 execution
plan, Sprint 12 review queue, Sprint 30.5 dashboard reorg, ...) without ever getting a single
unified UX specification the way Discovery just did (Sprint 55/55.1/BDE). Recommend a BWX
master spec, mirroring the BDE document's structure, once Discovery/Interview Mode
implementation (Sprints 56+) is far enough along that the workspace's relationship to it is
concrete rather than speculative.

## Builders AI Engineering Platform

A cross-cutting architecture document for the AI Engineering pipeline as a *platform*
(distinct from the "per-role reference" listed above) — covering generation profiles, context
assembly (`buildRoleContextBlock`), truncation recovery, resumability, and the manifest-driven
file generation engine as one coherent system, currently spread across
`02-Architecture/03-generation-engine-create-modify-preserve.md`,
`02-Architecture/05-workspace-migration.md`, and code-level comments.

## Builders Platform Services

A reference-level document (candidate home: [12-Reference](./12-Reference/)) cataloguing every
internal platform service (BuildersDB, Generation Profiles, Artifact system, Context Engine,
Execution Engine, Review Engine) with a one-paragraph purpose statement and a link to its
fuller doc/code, so a newcomer can see the full service inventory in one place rather than
discovering services one sprint-report at a time.

## Authentication

No dedicated spec exists (implementation exists per `02-Architecture` mentions of auth
foundation sprints, e.g. `20260710080000_auth_foundation.sql`) — candidate for
[10-Operations](./10-Operations/) or [12-Reference](./12-Reference/).

## Deployment

No dedicated spec exists yet for how a generated application actually gets deployed
end-to-end — candidate for [10-Operations](./10-Operations/).

## Template Engine

The "Start from Template" discovery method proposed in the Builders Discovery Experience
master spec ([06-Requirements-Discovery/04](./06-Requirements-Discovery/04-builders-discovery-experience-master-spec.md)
§1/§2/§15) will need its own specification once scheduled — how templates are authored,
versioned, and pre-populate a `BusinessUnderstandingModel`. Candidate home:
[06-Requirements-Discovery](./06-Requirements-Discovery/00-index.md), since it's a discovery
method, or a new dedicated folder if it grows large enough to warrant one.

## Marketplace

No specification exists yet. Flagged here as a known future area with no current owner or
folder assignment — needs a product decision before a folder/spec makes sense.

## Organization Management

No specification exists yet (multi-user/team support is mentioned as a future capability in
[06-Requirements-Discovery/02](./06-Requirements-Discovery/02-sprint-55-interview-mode-architecture.md)
§15's "multiple participants" extensibility discussion, but nothing broader than that).

## AI Providers

Provider integration (Anthropic, OpenAI, etc., per `app/lib/modules/llm/`) has no consolidated
reference doc — candidate for [12-Reference](./12-Reference/).

## GitHub Integration

Mentioned as a future Discovery source ("GitHub Analysis" in the BDE master spec §12) and
already partially implemented (`app/lib/hooks/useGitHubConnection.ts` etc.) but with no
dedicated spec — candidate for [12-Reference](./12-Reference/) or
[08-AI-Engineering](./08-AI-Engineering/), depending on whether it ends up scoped as a
Discovery input or an Engineering-time integration (or both).

## Supabase Integration

Two entirely separate Supabase integrations already exist in this codebase (BuildersDB's own
control-plane project, and the unrelated per-product Supabase connection a generated
application can use — see [buildersdb.md](./buildersdb.md)'s own explicit table
distinguishing them). A reference doc clarifying this distinction for new contributors is a
good candidate for [12-Reference](./12-Reference/).

## Browser Automation

No specification exists yet.

## MCP

No specification exists yet for how (or whether) Builders itself exposes or consumes MCP
(Model Context Protocol) servers.

## Observability

No specification exists yet for logging/monitoring/error-tracking conventions across the
platform — candidate for [10-Operations](./10-Operations/).

## Security

No specification exists yet — candidate for [10-Operations](./10-Operations/) or its own
folder if it grows large enough (security often benefits from being separated from general
operations content once nontrivial).

## Billing

No specification exists yet.

---

## How to use this roadmap

When starting new documentation work, check this list first — if the area is listed, use the
suggested folder unless there's a clear reason not to (and if you deviate, update this
roadmap's entry to reflect the actual choice, so the next reader isn't misled). When an area
listed here gets its first real specification, **remove its entry from this roadmap** and
replace it with a link from the relevant folder's index — this roadmap is a backlog, not a
permanent catalogue; a fulfilled entry belongs in the folder index, not here.
