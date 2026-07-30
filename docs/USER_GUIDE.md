# Builders User Guide

**Early Access Edition**

Welcome to Builders. This guide takes you from your first sign-in through to a generated,
running application. It is written for people who have never used Builders before — business
analysts, developers, and testers alike.

> [!NOTE]
> Builders is in **Early Access**. Everything described here is implemented today, but the
> product is still changing. Where behaviour is known to be incomplete or rough, this guide
> says so rather than glossing over it. See [Known Limitations](#14-known-limitations).

---

## Contents

| Section | What it covers |
|---|---|
| [1. Introduction](#1-introduction) | What Builders is and the problem it solves |
| [2. Getting Started](#2-getting-started) | Signing in, the home screen, creating a project |
| [3. Project Dashboard](#3-project-dashboard) | The eight tabs and the workflow bar |
| [4. Business Discovery](#4-business-discovery) | Telling Builders about your business |
| [5. Knowledge Ledger](#5-knowledge-ledger) | Where your answers are stored and reused |
| [6. Requirement Document](#6-requirement-document) | Reviewing and approving requirements |
| [7. Product Package](#7-product-package) | Features, modules, rules, entities |
| [8. Technical Architecture Specification](#8-technical-architecture-specification-tas) | The contract that governs generation |
| [9. Application Generation](#9-application-generation) | Building the actual application |
| [10. Generated Artifacts](#10-generated-artifacts) | Every document Builders produces |
| [11. Reviews](#11-reviews) | Approving, discarding, regenerating |
| [12. Activity History](#12-activity-history) | The project timeline |
| [13. Best Practices](#13-best-practices) | How to get good output |
| [14. Known Limitations](#14-known-limitations) | What to expect in Early Access |
| [15. Frequently Asked Questions](#15-frequently-asked-questions) | Quick answers |
| [16. Troubleshooting](#16-troubleshooting) | When something goes wrong |
| [17. Tester Guidelines](#17-tester-guidelines) | How to evaluate and report |

---

## 1. Introduction

### What is Builders?

Builders is an **AI Software Factory**. You describe a business problem in plain language, and
a team of specialised AI engineering roles turns that description into requirements, a plan, an
architecture, and finally a working application you can preview and deploy.

The important distinction: Builders is not a single chat box that writes code. It is structured
like a software engineering organisation. Each concern — business analysis, product ownership,
architecture, database design, UX, backend, frontend, QA, DevOps — is handled by its own role,
produces its own reviewable document, and hands off to the next role in a fixed order.

### Vision

> **Build the platform once. Build unlimited products.**

Builders exists so that the repeatable engineering work of turning business intent into software
happens the same disciplined way every time, regardless of who is driving it or what is being
built.

### What problems it solves

| Problem | How Builders addresses it |
|---|---|
| Requirements live in people's heads, or in documents nobody updates | Business Discovery captures them once, in a structured model that every later step reads from |
| AI coding tools produce code before the product is understood | Nothing is generated until requirements and scope are explicitly approved |
| One big AI pass drifts across unrelated concerns | Each role owns one artifact, with a defined input and a defined handoff |
| "The AI built something, but is it what we asked for?" | Every artifact is reviewable and versioned, and generation is measured against the approved architecture |
| Scope creep — the AI builds far more than the MVP needed | Scope is fixed at an approval gate, and the architecture explicitly records what must **not** be built |

### The Software Factory workflow

At the top of every project you will see a five-stage workflow bar. This is your map:

```text
Business  →  Blueprint  →  MVP  →  Engineering  →  Application
```

| Stage | What happens | Who drives it |
|---|---|---|
| **Business** | You describe your business, users, and goals. Builders produces a Requirement Document. | You |
| **Blueprint** | You confirm the starting shape of the product (e.g. business website, local shop). | You |
| **MVP** | Builders proposes scope and a roadmap. You approve what the first release contains. | You approve |
| **Engineering** | Eight AI roles design the system, in order, each building on the last. | Builders (automatic) |
| **Application** | Builders generates, validates, previews, packages, and deploys the code. | Builders, you review |

A node turns green when that stage is genuinely complete — the bar reflects real progress, not
which tab you happen to be looking at.

---

## 2. Getting Started

### Logging in

Builders is an internal, invitation-only tool during Early Access. There is no self-service
signup.

1. Open the Builders URL you were given.
2. Enter the **email** and **password** issued to you.
3. Select **Sign In**.

Your session is restored automatically on your next visit, so you will not normally sign in more
than once per browser.

> [!TIP]
> If the sign-in screen shows *"Authentication is not configured on this deployment"*, the
> environment is missing its Supabase settings. This is an environment problem, not a password
> problem — report it rather than retrying. See [Troubleshooting](#16-troubleshooting).

### The home screen

After signing in you land on the Builders home screen.

- **Left sidebar** — your projects. Contains the **New Project** button, a project search box,
  and the list of every project you have created, newest activity first.
- **Main area** — the Builders Software Factory landing panel, with a **Start a Project** action
  and the roster of AI roles that will work on your product.
- **Bottom of the sidebar** — help, settings, and the light/dark theme toggle.

Settings is where AI provider keys, Git connections, and Supabase configuration live. In most
Early Access deployments these are already configured for you; you should not need to change
them to complete a normal run.

### Creating a new project

Select **New Project** in the sidebar. The dialog has five things to fill in.

| Field | Required | What to enter |
|---|---|---|
| **Project Name** | Yes | A short, specific name for the product. This appears everywhere. |
| **Description** | Recommended | One line on what the project is for. Feeds the AI's first impression of the product. |
| **Generation Profile** | Defaults to *Balanced* | Which AI models are used for each role. See below. |
| **Blueprint** | Defaults to *Blank Project* | The starting shape of the product. See below. |
| **Appearance** | Optional | An icon and accent colour, so the project is easy to spot in the sidebar. |

#### Generation Profile

| Profile | Use it when |
|---|---|
| **Fast Prototype** | You are testing Builders itself, or exploring an idea you will throw away. Cheapest and fastest. |
| **Balanced** | The normal default. A practical mix of speed and quality — use this unless you have a reason not to. |
| **Production** | Final builds. Uses the strongest available model for every role. Slowest and most expensive. |

#### Blueprint

A Blueprint gives Builders industry-aware starting knowledge — typical pages, typical user roles,
typical integrations, and what is usually standard versus optional for that kind of product.
Choosing a matching Blueprint noticeably improves the quality of the first draft.

- **Blank Project** — no assumptions. Use when nothing else fits.
- **Business Website**, **LocalShop India**, and other packaged blueprints — pick the closest
  match to what you are building.
- Blueprints marked *Coming soon* cannot be selected yet.

> [!NOTE]
> A Blueprint is guidance, not a template. If Blueprint guidance ever conflicts with your
> approved requirements, your requirements win — Builders raises the conflict as an open question
> instead of silently choosing.

#### Naming recommendations

Project names show up in the sidebar, in every generated document, and in the generated
application's own metadata. A few minutes of thought here pays off.

**Do:**

- Use the product's real or intended name — `Sunrise Dental Booking`, `LocalShop India`.
- Include the audience or region when it disambiguates — `Fleet Portal (Kenya)`.
- Keep it under roughly 40 characters.

**Avoid:**

- Test-run names in real projects — `test`, `test1`, `asdf`. They are impossible to find later.
- Dates and version numbers in the name — Builders already versions everything for you.
- Naming the technology instead of the product — `React App`, `Supabase Thing`.

Select **Create Project**. The project appears in the sidebar immediately.

---

## 3. Project Dashboard

### Opening a project

Select any project in the sidebar. The project dashboard opens on the tab you were last using,
so you can leave and come back without losing your place.

### The project list

Each row in the sidebar shows the project's icon, its name, and the date of its last activity.
Use the search box to filter by name. Hovering a row reveals a delete control, which always asks
for confirmation before removing anything.

### Navigation: the eight tabs

The workflow bar across the top covers the five journey stages. Beneath it are eight tabs — the
five stages plus three supporting views.

| Tab | Purpose |
|---|---|
| **Business** | Business Discovery and the Requirement Document. Where every project starts. |
| **Blueprint** | The selected Blueprint, plus Builders' own recommendation of the best match. |
| **Plan** | Business Analysis, the proposed MVP, the roadmap, and the scope approval gate. |
| **Product** | The product's long-term lifecycle across releases (MVP1 → MVP2 → MVP3). Separate from the current build. |
| **Engineering** | The AI Engineering Team panel — the eight roles and their draft documents. |
| **Application** | Generate the application, watch progress, review output, assemble the package, deploy. |
| **Workspace** | Connections and configuration: GitHub, Supabase, deployment target, environment. |
| **History** | The full activity timeline for this project. |

> [!TIP]
> The **Product** tab and the workflow bar answer two different questions. The workflow bar is
> "how far along is the release I am building right now?" The Product tab is "what does this
> product look like across all its releases?" Don't expect them to agree.

### Project status

Status is always derived from real work completed, never set by hand. You will see it in three
places:

- **The workflow bar** — a stage is *pending* (grey), *active* (highlighted and pulsing), or
  *complete* (green check).
- **Stage counter** — "Stage 2 of 5", above the bar.
- **Per-artifact badges** — each role's document shows whether it is a draft, approved, or
  discarded, and which version you are looking at.

---

## 4. Business Discovery

### Purpose

Business Discovery is the single most important step in Builders, and the one most often rushed.

Everything downstream — requirements, scope, architecture, database design, and ultimately the
generated code — is derived from what you provide here. Builders is deliberately built not to
invent business intent. If you do not tell it something, it will either ask, or record an
assumption, rather than quietly guessing.

**Vague input here produces a vague product. There is no later step that fixes it.**

### Three ways to provide information

Open the **Business** tab. You can use any combination of these — they all feed the same place.

| Mode | Best for |
|---|---|
| **Requirements form** | You already know the answers and want to type them in directly, field by field. |
| **AI interview** | You want to be asked. Builders leads a conversation and asks follow-ups where your answers are thin. |
| **Document import** | You already have a brief, spec, or proposal. Import it and let Builders extract the facts. |

Most first-time users get the best result from the **AI interview**, then reopen the form to fill
any gaps it left.

### The AI interview

The interview is a chat. Builders asks about your business, you answer in plain language, and it
follows up where an answer leaves something unresolved.

How to get the most out of it:

- **Answer in full sentences, not keywords.** "Salon owners in tier-2 Indian cities who
  currently take bookings over WhatsApp" is worth ten times more than "salons".
- **Say who the users are and what each of them needs to do.** Roles drive the whole
  permission and navigation model later.
- **Name the constraints.** Budget, timeline, regulation, an existing system you must integrate
  with, a language you must support.
- **Say what is out of scope.** This is as valuable as saying what is in scope, and it is the main
  defence against Builders building more than you wanted.
- **Say "I don't know" when you don't know.** Builders records it as an open question. A guess
  from you becomes a fact it builds on.

### The ten discovery dimensions

Builders tracks your coverage across ten dimensions and shows you where it is thin:

| Dimension | The question it answers |
|---|---|
| Business Vision | What is this product for, in business terms? |
| Target Users | Who uses it, and what do they need? |
| Core Features | What must it actually do? |
| Industry | What sector are you in? |
| Business Assessment | What is the commercial context and maturity? |
| Project Type | What kind of software is this? |
| Business Constraints | Budget, timeline, regulation, non-negotiables. |
| Current Systems | What exists today that this must live alongside or replace? |
| Integrations | What must it talk to? |
| Technical Preferences | Any technology you require or forbid. |

### Completing discovery

As you provide information, Builders continuously reassesses and shows you a readiness state:

| State | Meaning | What to do |
|---|---|---|
| 🔴 **Insufficient Information** | Not enough to draft anything useful. | Keep going. Focus on Business Vision, Target Users, Core Features. |
| 🟡 **Needs More Information** | A draft is possible, but weak in named areas. | Builders lists the missing and partial dimensions. Fill those in. |
| 🟢 **Ready** | Enough to produce a solid Requirement Document. | Proceed. |

You will also see an **overall confidence** rating (Low / Medium / High) and a plain
**Ready for requirements draft: Yes/No**.

> [!WARNING]
> You *can* proceed while the state is amber. Builders will not stop you. But the requirements
> it produces will contain more assumptions and open questions, and every later role inherits
> them. If you are testing output quality, always reach **Ready** first — otherwise you are
> testing the effect of thin input, not the quality of the AI.

---

## 5. Knowledge Ledger

### What it is

As you go through Business Discovery, Builders does not simply keep a transcript. It maintains a
single structured record of everything it currently believes about your business — the
**Business Understanding Model**, referred to in this guide as the **Knowledge Ledger**.

> [!NOTE]
> "Knowledge Ledger" is the concept, not a tab label. You interact with it through the Business
> tab's discovery cards and the requirements form; you never edit it as a raw document.

It holds, in one place:

- Your business vision, goals, and commercial model
- Users, roles, and personas
- Features, flows, and pages
- Constraints, compliance needs, and integrations
- Existing systems and technical preferences
- **Assumptions** Builders has made
- **Open questions** it could not resolve

It is a *current-state* record, not an append-only log. Answer a question differently and the
ledger is recomputed, not patched — so it never holds two contradictory versions of the same
fact.

### Why it exists

Three reasons, all of which you will feel directly:

1. **One source of truth.** Eight AI roles need the same business context. If each one
   re-derived it from a chat transcript, they would each derive something slightly different, and
   the product would be internally inconsistent.
2. **Nothing is invented.** Because the ledger explicitly separates confirmed facts from
   assumptions and open questions, every role knows which is which. An assumption stays labelled
   as an assumption all the way to the generated application.
3. **You can add information at any time.** Come back a week later with new detail; the ledger
   absorbs it and readiness is recalculated.

### How Builders uses it

Every AI role receives context built from the ledger rather than the raw conversation. The
Requirement Document is generated from it. The MVP scope is drawn from it. The architecture is
constrained by it. When a role has to make a judgement call, the decision is recorded so you can
trace back from a line of generated code to the business fact behind it.

---

## 6. Requirement Document

Once discovery reads **Ready**, Builders generates the Requirement Document — the first real
artifact, and the foundation for everything after it.

### Generated sections

The document is structured, not prose. Expect these sections, populated where your discovery
covered them:

| Group | Sections |
|---|---|
| **Business** | Business Vision, Business Goals, Target Audience, Business Model, Personas |
| **Functional** | Core Features, Pages, User Flows, User Roles, Business Rules, Functional Requirements |
| **Quality** | Non-Functional Requirements, Acceptance Criteria, Success Metrics |
| **Boundaries** | Out of Scope, Technical Constraints, Assumptions, Risks |
| **Domain-specific** | Compliance, Payments, Shipping, Languages — populated only when relevant |
| **Forward-looking** | Future Enhancements, Technology Recommendations, Open Questions |
| **Handoff** | Engineering Notes and a log of the AI's own decisions, carried forward to later roles |

### Reviewing requirements

Read the whole document once, top to bottom, before changing anything. Then review specifically
for these four things, in this order:

1. **Assumptions** — the highest-value section in the document. Each one is something Builders
   had to decide because you did not say. Confirm or correct every single one.
2. **Open Questions** — anything Builders could not resolve. Answer them.
3. **Out of Scope** — check that nothing you actually need is listed here, and that things you
   do not want *are*.
4. **Business Rules and Acceptance Criteria** — these become testable behaviour in the generated
   application. Wrong rules produce a working application that does the wrong thing, which is
   much harder to spot than a broken one.

### Making corrections

You have two routes, and choosing the right one matters:

| If the problem is… | Do this |
|---|---|
| Wrong or missing **business information** | Go back to the Business tab, correct the discovery input, and regenerate the document. The ledger is the source — fixing the output while leaving the input wrong means the error returns at the next regeneration. |
| A **local wording or detail** issue in an otherwise correct document | Edit the document directly. |

Regenerating creates a **new version**. The previous version is retained, not overwritten, so you
can always compare or go back.

### Approval

When the document reflects your intent, **approve** it. Approval is a real gate: the Product
Owner role will not run until the Requirement Document is approved, and the same pattern holds
all the way down the chain.

> [!TIP]
> Approving is not a commitment for all time. You can return, revise, and regenerate later.
> Approve when the document is *right enough to build on*, not when it is perfect.

---

## 7. Product Package

The **Product Package** is the assembled, human-readable bundle of every approved role output for
this MVP — the complete specification of what is being built, in one place.

Assemble it from the **Application** tab using **Assemble Product Package**. Run it again at any
time with **Re-Assemble Product Package** to pick up newer approved versions.

### What it contains

| Element | What it tells you |
|---|---|
| **Features** | Every capability in this MVP, each with a MoSCoW priority (Must / Should / Could / Won't Have), its dependencies, and a one-line justification of its customer value. |
| **Modules** | How features are grouped into coherent parts of the system. Module boundaries become real directory boundaries in the generated code. |
| **Business Rules** | The constraints and logic the application must enforce, traced back to the Requirement Document. |
| **Entities** | The data model — the things the system stores, their fields, and how they relate. This becomes the database schema. |
| **Architecture summary** | The chosen shape of the system: runtime, framework, topology, and the key decisions with their rationale. |
| **Missing sections** | Any role output that has not been produced or approved yet. Read this first — it tells you the package is incomplete before you rely on it. |

### Why it matters

The Product Package is your last chance to catch a scope or design problem cheaply. Reading it
takes minutes; discovering the same problem in generated code takes hours.

Two checks are worth doing every time:

- **At least one feature must be *Must Have*.** An MVP with nothing mandatory is not an MVP.
- **The entity list should look like your business.** If an entity you expect is missing, or a
  strange one has appeared, the data model is wrong, and everything built on it will be too.

---

## 8. Technical Architecture Specification (TAS)

### Purpose

The Solution Architect produces two things from a single pass: a narrative architecture document
for humans, and the **Technical Architecture Specification (TAS)** — the same architecture in a
strict machine-readable form.

The TAS exists so the code generator never has to interpret prose. Generation reads the TAS
directly and deterministically. This is the mechanism that keeps the generated application
faithful to the approved architecture instead of a plausible reinterpretation of it.

### Major sections

| Section | What it specifies |
|---|---|
| **System Overview** | Product type, topology, modules, and system boundaries |
| **Decisions** | Each architectural decision with its rationale |
| **Capabilities** | What the system can do, at architectural granularity |
| **Runtime** | Target platform, framework, language, build output, boot settings |
| **Configuration** | Settings, environment variables, secrets, configuration screens |
| **Security** | Authentication (method, sessions, expiry, revocation, credential storage, rate limiting) and authorisation (model, roles, enforcement point, server-side enforcement) |
| **Tenancy** | Single- or multi-tenant, and how tenants are isolated |
| **Cross-Cutting** | Logging, error handling, validation, and other system-wide concerns |
| **Deployment** | How and where the application is deployed |
| **Evolution** | How the architecture is expected to change across later releases |
| **Non-Goals** | What this architecture deliberately does not attempt |
| **Do Not Build** | Explicit prohibitions for the generator |
| **Directives** | Direct, binding instructions to the code generator |

### Why it matters: lifecycle tagging

The TAS is also Builders' main defence against over-building. Architectural elements carry a
**lifecycle** tag:

| Lifecycle | Meaning | What the generator does |
|---|---|---|
| `current` | In this MVP | **Builds it** |
| `future` | Planned for a named later release | **Does not build it.** Honours its invariants only, so adding it later stays cheap. |
| `deferred` | Acknowledged, not planned | **Does not build it.** No obligations owed. |

An **invariant** is a promise about what version 1 must never do, so that a future capability
remains inexpensive to add. It is a seam, not a structure — the generator will not build
scaffolding for something you have not asked for yet.

### How Builders uses the TAS during generation

1. The generator reads the TAS to decide which files exist and what each must contain.
2. **Do Not Build** entries and **Non-Goals** act as hard boundaries. A `future` capability is
   never generated, even if the requirements mention it.
3. **Directives** are applied as binding constraints on generated code.
4. After a successful run, Builders compares what was actually generated against the approved
   TAS and produces an **Architecture Conformance Report**.

> [!NOTE]
> The Conformance Report is **advisory**. It measures fidelity and lists violations; it never
> blocks or fails a run. A generation with recorded violations still completes — you decide
> whether the violations matter.

---

## 9. Application Generation

### Before you start

Generation is the most expensive and slowest step in Builders. Check three things first:

- The Requirement Document is approved and correct.
- MVP scope has been approved at the **Plan** tab's gate.
- Every engineering role in the **Engineering** tab has an approved output — no gaps.

### Starting generation

Open the **Application** tab and start generation. Builders then works through the manifest of
files it plans to produce, in six phases:

| Phase | Name | What it produces |
|---|---|---|
| 1 | **Preview Foundation** | Entry points, configuration, styles, shared components — the shell that must exist before anything renders |
| 2 | **Public Journey** | The customer-facing pages, plus the shared types and services they depend on |
| 3 | **Backend** | Backend modules and APIs |
| 4 | **Payments** | Payment, checkout, billing, and subscription modules |
| 5 | **Admin** | Admin pages and back-office modules |
| 6 | **Integration** | Documentation and the remaining wiring |

Phases run in order, and a completed phase is never re-entered. A phase with no work — a product
with no payments, for example — is marked **Skipped** and passed over.

> [!TIP]
> An early preview usually becomes available once Phase 1 completes, well before the whole run
> finishes. You do not have to wait for the end to start looking at something.

### Tracking progress

The generation dashboard shows you:

- **Overall progress** and the count of completed phases
- **Per-phase status** — Complete, Generating, Queued, Failed, or Skipped — with a completed/total
  file count for each
- **Current activity** — the file being worked on right now
- **Files grouped by status**, and a per-file list you can drill into

File statuses you will see:

| Status | Meaning |
|---|---|
| ○ Pending / ⏳ Queued | Planned, not started |
| ⚡ Generating | Being written now |
| ● Generated | Written, awaiting validation |
| ⋯ Validating | Being checked |
| ✓ Validated / ✓ Complete | Finished and correct |
| 🛠 Repairing | Validation failed; Builders is fixing it automatically |
| ✗ Failed | Could not be produced or repaired |
| ⊘ Skipped | Intentionally not generated |
| ⊙ Superseded | Belongs to an older version of the manifest |

**Repairing** is normal, not an error. When a generated file fails validation, Builders attempts
a bounded number of automatic repairs before giving up and marking it Failed. The repair attempts
are logged in Activity History.

### How long it takes

Generation time depends on the size of your MVP, the generation profile, and AI provider
responsiveness. A small MVP on *Balanced* typically completes in minutes; a large MVP on
*Production* takes considerably longer. Individual role documents are much quicker — around
twenty seconds each.

You can **stop** a run at any time. Already-generated files are kept, and the run is recorded as
cancelled rather than failed.

### Reviewing the generated application

Work through it in this order:

1. **Does the preview run?** Open it and click through the main journey.
2. **Are the features the ones you approved?** Compare against the Product Package.
3. **Is anything Failed?** Look at what, and whether it matters.
4. **What does the Conformance Report say?** It tells you where the code drifted from the
   approved architecture.
5. **Does the data model match your entities?** Check the schema against the Product Package.

### Regenerating

Regeneration is safe and incremental by design:

- Files that are already Generated, Validated, or Complete are **reused** without another AI call.
- Only the unfinished files in the active phase are regenerated.
- A completed phase is never re-entered, so approved work is not silently rebuilt.

If you change an upstream artifact — the requirements, the MVP scope, the architecture —
regenerate from that point onward, not just the final step. Changing the requirements and
regenerating only the code leaves the plan and the code disagreeing.

---

## 10. Generated Artifacts

Every AI role produces a versioned artifact. Each has a status — `draft`, `approved`,
`discarded`, or `final` — and a version number that increases each time you regenerate.

| Artifact | Produced by | Why it matters |
|---|---|---|
| **Requirements Draft** | Business Analyst | The foundation. Everything else is derived from it. |
| **Product Owner Draft** | Product Owner | Product vision, objectives, in/out of scope, roadmap skeleton, and the fully elaborated current MVP. Only this artifact requires an explicit human approval. |
| **Architecture Draft** | Solution Architect | The narrative architecture, written for humans. |
| **Technical Architecture Specification** | Solution Architect | The machine-readable architecture the generator actually reads. Produced by the same pass as the draft above and always at the same version. |
| **Database Draft** | Database Engineer | The data model explained in prose. |
| **Database Schema** | Database Engineer | The structured schema used for SQL generation, validation, and provisioning. Paired with the draft above. |
| **UI/UX Draft** | UI/UX Engineer | Screens, navigation, and interaction design. |
| **Backend Draft** | Backend Engineer | Modules, APIs, and server-side behaviour. |
| **Frontend Draft** | Frontend Engineer | Component structure and client-side behaviour. |
| **QA Draft** | QA Engineer | Test strategy and the coverage expected for approved features. |
| **DevOps Draft** | DevOps Engineer | Build, environment, and deployment concerns. |
| **Product Review Analysis** | Business Analyst | A review of the product as planned, against the business intent. |
| **Roadmap Review Analysis** | Product Owner | A review of release sequencing and scope across MVPs. |
| **Architecture Conformance Report** | Builders (measured, not generated) | Compares generated files against the approved TAS. Advisory — never blocks a run. |
| **Product Package** | Assembly | Every approved output above, collected into one reviewable bundle. |

Two artifact pairs are always kept in lockstep — Architecture Draft with TAS, and Database Draft
with Database Schema. They share a version number and are approved or discarded together, never
independently.

> [!NOTE]
> Older projects may be missing the newest artifacts (the TAS and the Conformance Report are
> recent additions). This is expected and harmless — those projects continue to work exactly as
> they did.

---

## 11. Reviews

### The engineering chain

After the Requirement Document is approved, eight roles run in this fixed order. Each role's
input is the previous role's approved output.

```text
Product Owner
  ↓
Solution Architect
  ↓
Database Engineer
  ↓
UI/UX Engineer
  ↓
Backend Engineer
  ↓
Frontend Engineer
  ↓
QA Engineer
  ↓
DevOps Engineer
```

The chain runs automatically. Watch it from the **Engineering** tab, which shows the current
role, its progress, and its output as it lands.

### The one gate that stops for you

Seven of these roles auto-approve and continue. **The Product Owner does not.**

Scope approval — which features are in the first MVP, and which are deferred — is deliberately an
explicit human decision. Builders will pause and wait for you. This is the single most important
review in the whole flow, because it fixes what gets built.

When you reach it, check:

- Every **Must Have** feature is genuinely mandatory for a first release.
- Nothing critical has been deferred to a later MVP.
- Nothing you never asked for has appeared. If it has, it should be a *future enhancement*, not
  a current feature.
- The out-of-scope list is a boundary you are happy to enforce.

### Reviewing any artifact

For each role output you can:

| Action | Effect |
|---|---|
| **View** | Read it as a formatted document, or inspect the underlying structured data |
| **Approve** | Marks it as the accepted version and unblocks the next role |
| **Discard** | Rejects this version |
| **Regenerate** | Produces a new version. The old one is retained. |
| **Compare versions** | Every version is kept, so you can see exactly what changed |

Two things are worth reading in every artifact, and they are easy to skip:

- **Engineering Notes** — what this role wants the next role to know.
- **AI Decisions** — the judgement calls this role made, and why. This is where you find
  out that something was decided rather than specified.

> [!WARNING]
> Regenerating an artifact does not automatically regenerate the ones after it. If you change the
> architecture, the database design that was based on the previous version is now stale.
> Regenerate forward through the chain.

---

## 12. Activity History

The **History** tab is the complete, timestamped record of everything that has happened to the
project. It is the first place to look when you are asking "why is it in this state?" or writing
a bug report.

### What gets recorded

| Category | Events |
|---|---|
| **Role outputs** | Output saved, new version created, an expected output missing |
| **Generation** | Started, phase completed, failed, cancelled |
| **Files** | Written to the filesystem, preview started |
| **Repair** | Repair attempt started, patch applied, repair failed, manual attention required |
| **Code review** | Review started |
| **Product package** | Assembled, file created, file updated |
| **Database** | Connected, disconnected, schema generated, validation passed or failed, provisioning started/finished/failed, connection verified |
| **Product review** | Started, analysis running, analysis completed, approved |
| **Roadmap review** | Started, planning running, planning completed, approved |
| **AI context** | Context trace stored — what the AI was actually given |

### Tracking changes and project evolution

Read the timeline as the project's biography. It answers the questions that are otherwise
guesswork:

- When did this artifact change, and which version replaced which?
- Did generation fail, or did someone stop it? (These are recorded distinctly — a stop is
  neutral history, not a failure.)
- How many repair attempts were needed, and did they succeed?
- Was the database ever actually provisioned, or only designed?
- What context did the AI have when it made a given decision?

> [!TIP]
> When reporting a bug, note the relevant history entries and their timestamps. It is the single
> most useful thing you can include.

---

## 13. Best Practices

**Give complete business requirements.** Builders will not invent business intent. Whatever you
leave out becomes an assumption or an open question, and both propagate all the way to the code.

**Be specific.** "A booking system" produces a generic booking system. "A booking system for
single-chair salons in tier-2 Indian cities, where customers currently book over WhatsApp and the
owner has no computer" produces something that fits.

**Do not skip Business Discovery.** It is tempting to click past it to see the interesting parts.
Every minute saved here costs more later, and any output-quality problem you find afterwards will
be indistinguishable from the effect of thin input.

**Reach "Ready" before generating requirements.** Amber is a warning, not a suggestion.

**Review every generated document, in order.** Read the Requirement Document properly. Read the
MVP scope properly. A wrong business rule produces an application that works and is wrong — far
harder to catch than one that crashes.

**Always read the Assumptions and Open Questions sections.** They are the highest-value part of
any artifact, and the most commonly ignored.

**Approve deliberately at the scope gate.** It is the one place Builders genuinely waits for you.

**Say what is out of scope.** It is your only real control over over-building.

**Keep project names meaningful.** `test1` is unfindable in a week.

**Regenerate forward, not sideways.** Change something upstream and regenerate everything after
it, or your plan and your code will disagree.

**Match the generation profile to the purpose.** *Fast Prototype* for exploring Builders,
*Balanced* for real work, *Production* for a final build.

**Pick a matching Blueprint.** Industry-aware starting knowledge measurably improves the first
draft.

---

## 14. Known Limitations

> [!IMPORTANT]
> Builders is an **Early Access** platform. It is under active development, it has bugs, and some
> features are incomplete. Do not use it as the sole tool for production-critical work without
> independent review of its output.

What to expect:

- **AI output quality varies.** Different runs on the same input can produce meaningfully
  different documents. If output looks wrong, regenerating is a reasonable first response.
- **Long-running generation can be interrupted.** Network problems, AI provider rate limits, and
  timeouts all happen. Generation resumes rather than restarting, but it is not seamless.
- **Some files fail to generate.** Automatic repair handles many failures, but not all. A run can
  complete with individual files marked Failed.
- **The Architecture Conformance Report is advisory only.** It reports drift from the approved
  architecture; it does not prevent it.
- **Generated applications are prototypes.** They are real, runnable code, but they have not been
  security-reviewed, performance-tested, or hardened for production.
- **Some blueprints are not available yet.** Anything marked *Coming soon* cannot be selected.
- **Concurrent editing of a single project is not supported.** See the FAQ.
- **Older projects may lack newer artifacts.** Projects created before the TAS and Conformance
  Report existed will not have them, and will not be backfilled.
- **UI rough edges remain**, particularly on narrow screens and during long-running operations.

---

## 15. Frequently Asked Questions

**Can I edit generated requirements?**
Yes. You can edit the document directly, or — better for anything factual — correct your
discovery input and regenerate. Editing the output while leaving the input wrong means the error
comes back at the next regeneration.

**Can I regenerate documents?**
Yes, any artifact, as many times as you like. Each regeneration creates a new version and the
previous one is kept. Remember that regenerating one artifact does not regenerate the ones after
it in the chain.

**Can I delete projects?**
Yes. Hover a project in the sidebar and use its delete control. You will be asked to confirm.
Deletion is not reversible from the UI, so be sure.

**Can multiple users work simultaneously?**
Each tester signs in with their own account and has their own project list, and work is persisted
centrally. However, **two people working on the same project at the same time is not supported or
tested in Early Access** — expect conflicts and unpredictable state. Coordinate so that one
person drives a given project at a time.

**What happens if generation fails?**
Everything already generated is kept. Failed files are marked Failed and, where possible,
Builders attempts automatic repair first. You can restart generation — it resumes from the active
phase and reuses completed work rather than starting over. Check Activity History for what
actually failed.

**How long does generation take?**
Minutes for a small MVP on *Balanced*; considerably longer for a large MVP on *Production*.
Individual role documents take roughly twenty seconds each. An early preview usually appears once
Phase 1 completes, before the full run finishes.

**Do I have to approve every role's output?**
No. Only the Product Owner's MVP scope requires explicit approval. The other seven roles
auto-approve and continue — though you can review, discard, and regenerate any of them.

**Can I change the Blueprint after creating a project?**
The Blueprint tab shows your selection and Builders' own recommendation. Blueprint guidance
mainly shapes the earliest drafts, so changing course late has limited effect — regenerate from
the requirements onward if you need it to take.

**Where does my data go?**
Projects, artifacts, and activity are persisted to the deployment's configured Supabase-backed
BuildersDB. AI calls go to the configured provider for your generation profile.

**Can I export what Builders produces?**
Yes. The Product Package assembles the approved documents into a bundle, and the Workspace tab
handles GitHub and deployment connections for the generated code.

---

## 16. Troubleshooting

### Login problems

| Symptom | Likely cause and fix |
|---|---|
| *"Authentication is not configured on this deployment"* | The environment is missing its Supabase settings. This is not fixable from the UI — report it. |
| Credentials rejected | Confirm the exact email you were issued. There is no self-service signup or password reset in Early Access; ask for a reset. |
| Signed out unexpectedly | Your session expired or was invalidated. Sign in again — no work is lost. |
| Stuck on a loading spinner | Session restore is failing. Reload the page; if it persists, report it with your browser console output. |

### AI generation issues

| Symptom | What to do |
|---|---|
| A role produces empty or nonsensical output | Regenerate. If it recurs, the input context is probably too thin — go back to discovery. |
| Output ignores something you clearly stated | Check whether it reached the Knowledge Ledger: is it in the Requirement Document? If not, the problem is upstream at discovery. Report it either way. |
| Generation stops partway | Check Activity History for `generation_failed` versus `generation_cancelled`. Restart generation; it resumes and reuses completed work. |
| Files stuck **Repairing** | Automatic repair is bounded — it will resolve to Complete or Failed. If it never does, capture the file path and report it. |
| Files marked **Failed** | Note which, and check History for the repair attempts. Restarting generation retries the active phase's unfinished files. |
| *"Manual attention required"* in History | Builders has given up on automatic repair. This one always deserves a bug report. |

### Missing artifacts

| Symptom | What to do |
|---|---|
| A role's output never appears | Its gate is not satisfied — the previous role's output is not approved. Work backwards through the chain to find the first unapproved artifact. |
| Product Package lists **missing sections** | Exactly what it says: those roles have no approved output yet. Complete them and re-assemble. |
| No TAS or Conformance Report | Expected on projects created before those artifacts existed. Not a bug. |
| History is empty or shows an explanatory message | BuildersDB is unreachable. The dashboard still works, but activity cannot be read back. Report it. |

### Slow generation

- Check the generation profile. *Production* is deliberately much slower than *Balanced*.
- Large MVPs generate more files. Narrow the scope at the approval gate if you want faster
  iterations.
- The dashboard shows current activity — if it is advancing, it is working, just slowly.
- If nothing has advanced for several minutes, note the last History entry and report it.

### Session timeout

If your session expires mid-run, sign in again and reopen the project. Generation state is
persisted, so restart generation — it resumes from the active phase and reuses completed files
rather than regenerating them.

### Before reporting anything

Collect these first — they make the difference between a reportable bug and an unactionable one:

1. Project name, and which tab you were on
2. The relevant Activity History entries, with timestamps
3. Browser console errors (open developer tools)
4. Your generation profile and the selected Blueprint
5. Whether it reproduces on a fresh project

---

## 17. Tester Guidelines

Thank you for testing Builders. You are the first people outside the team to use it, and what you
report directly shapes what gets fixed.

### What to evaluate

**Correctness**

- Does the generated application do what the approved requirements said?
- Do the business rules actually hold in the running application?
- Does the data model match the entities in the Product Package?
- Is each artifact consistent with the one it was derived from?
- Does the generated code respect the TAS — and does the Conformance Report agree with what you
  observe?

**Missing features**

- Was anything you approved as *Must Have* never built?
- Is there something Builders should obviously support and does not?
- Is any part of the workflow impossible to complete from the UI alone?

**UI issues**

- Anything visually broken, clipped, overlapping, or unreadable — note the screen width.
- Confusing labels, unclear next steps, dead ends.
- Missing feedback during long operations: did you ever not know whether Builders was working?
- Light and dark theme, and narrow windows.

**AI quality**

- Is the output specific to *your* business, or generic filler?
- Are assumptions reasonable and clearly labelled as assumptions?
- Are open questions the right questions?
- Did the AI invent requirements you never gave it? **Always report this — it is a serious bug.**
- Did it build something scoped as `future` or `deferred`? Also always report.
- Is quality consistent across repeated runs on the same input?

**Generated application quality**

- Does it run? Does the preview load?
- Can you complete the main user journey end to end?
- Does it look like a real product or an obvious skeleton?
- Are there console errors, broken navigation, or non-functional forms?
- Does data actually persist?

**Usability**

- Could you complete a full run without asking anyone for help?
- Where did you get stuck, and what did you expect to happen instead?
- Which step felt slowest or most frustrating?

### How to report a bug

Please include all five of these. Reports missing steps to reproduce usually cannot be acted on.

| Field | What to write |
|---|---|
| **Title** | One specific line. "Generation fails at Phase 3 on payment modules", not "generation broken". |
| **Steps to reproduce** | Numbered, from a fresh project where possible. Include the project name, Blueprint, and generation profile. |
| **Expected result** | What you thought would happen. |
| **Actual result** | What did happen, including exact error text and relevant Activity History entries. |
| **Severity** | See the table below. |
| **Screenshots** | Optional but valuable, especially for UI issues. Note your window width. |

### Severity guide

| Severity | Meaning | Examples |
|---|---|---|
| **Critical** | Blocks all work, or produces silently wrong output | Cannot sign in; generation never completes; the AI invented requirements and built them |
| **High** | A major feature is unusable, with no workaround | Scope approval gate cannot be completed; Product Package never assembles |
| **Medium** | A feature is broken but has a workaround | A role output needs regenerating every time; a tab renders incorrectly but is usable |
| **Low** | Cosmetic or minor | Label typo; misaligned spacing; unclear wording |

### Especially valuable to report

- **AI output that contradicts your approved input.** This is the highest-priority class of bug
  in Builders.
- **Anything built that was scoped out**, deferred, or listed under Do Not Build.
- **Silent failures** — where Builders reports success but the result is wrong.
- **Points where you did not know what to do next.** A confusing step is a real defect, not a
  user error.

> [!TIP]
> When something goes wrong, resist the urge to immediately retry. Capture the Activity History
> entries and any console errors first — the retry may well succeed and take the evidence with it.

---

*Builders — Early Access Edition. Build the platform once. Build unlimited products.*
