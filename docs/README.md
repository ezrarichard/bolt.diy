# Builders Documentation

This is the knowledge base for **Builders** — the AI Software Factory this repository
implements. It covers product vision, architecture, design decisions, and process, for
everything **before and around** AI Engineering (the 8-role code-generation pipeline itself is
documented alongside its own code and, going forward, in
[08-AI-Engineering](./08-AI-Engineering/)).

> **Note:** `docs/docs/` is a separate, unrelated mkdocs sub-project (end-user/API-key setup
> help — `FAQ.md`, `CONTRIBUTING.md`) with its own `mkdocs.yml`/`pyproject.toml`. It is not
> part of the knowledge base described by this file.

---

## Purpose

- Give every future contributor (human or AI) a **durable, explainable record** of why
  Builders is built the way it is, not just what the code currently does.
- Separate **product intent** (what Builders must do, for whom) from **architecture**
  (how it's built) from **process** (how work moves through review and implementation) —
  each has its own home below, so a reader looking for one doesn't have to wade through the
  others.
- Make every design decision **traceable forward to the sprint that implemented it**, and
  every implemented sprint **traceable backward to the design it followed** — see
  [DOCUMENTATION-STANDARDS.md](./DOCUMENTATION-STANDARDS.md)'s Implementation Traceability
  section.

## Folder Structure

| Folder | Covers |
|---|---|
| [01-Vision](./01-Vision/) | Why Builders exists, the Software Factory philosophy, MVP-first development. |
| [02-Architecture](./02-Architecture/) | System architecture: current-state gap analysis, AI Product Owner architecture, the generation engine, BuildersDB's future schema, workspace migration, MVP as a core object. |
| [03-Development](./03-Development/) | Development process/philosophy: human approval philosophy, UI philosophy. |
| [04-Roadmap](./04-Roadmap/) | Phased migration plan, risks & alternatives, the implementation blueprint. |
| [05-AI-Product-Owner](./05-AI-Product-Owner/) | The AI Product Owner role, in full: responsibilities, artifact spec, JSON schema, engineering handoff, customer review workflow, and its own sprint-by-sprint implementation history (Sprints 46A–49). |
| [06-Requirements-Discovery](./06-Requirements-Discovery/) | The Requirements Discovery pipeline: durable foundation (Sprint 50, implemented) through Interview Mode architecture/UX and the Builders Discovery Experience master spec (Sprint 55+, approved design, not yet implemented). |
| [07-Business-Analysis](./07-Business-Analysis/) *(new, reserved)* | The Business Analyst role and `RequirementsDraft` synthesis — the step between Discovery and Product Planning. |
| [08-AI-Engineering](./08-AI-Engineering/) *(new, reserved)* | The 8-role AI engineering pipeline itself (Architecture → ... → DevOps), role by role. |
| [09-Decisions](./09-Decisions/) *(new, reserved)* | Architecture Decision Records — short, single-decision records, distinct from the longer specifications elsewhere. |
| [10-Operations](./10-Operations/) *(new, reserved)* | Deployment, environment, business operations (sales playbook, BuildersDB operational reference). |
| [11-Templates](./11-Templates/) | Reusable templates: the standard document header, a design-doc skeleton, an ADR skeleton. |
| [12-Reference](./12-Reference/) *(new, reserved)* | Cross-cutting reference material: glossary, integrations, environment variables. |

**Root-level documents** (not yet assigned to a folder — see each file's own recommendation
in [10-Operations](./10-Operations/README.md)/[12-Reference](./12-Reference/README.md) for why):
[00-EXECUTIVE-SUMMARY.md](./00-EXECUTIVE-SUMMARY.md) (read this first),
[00-PRODUCT-REQUIREMENTS.md](./00-PRODUCT-REQUIREMENTS.md),
[buildersdb.md](./buildersdb.md),
[builders-sales-business-development-playbook.md](./builders-sales-business-development-playbook.md).

**A note on folder numbering:** this structure was reviewed against a proposed
`01-Vision / 02-Product / 03-Discovery / 04-Business-Analysis / 05-AI-Engineering /
06-Requirements-Discovery / 07-Architecture / 08-Decisions / 09-Roadmap / 10-Operations /
11-Templates / 12-Reference` scheme. Per this sprint's "do not move existing files unless
absolutely necessary" instruction, the **existing** `02-Architecture`, `03-Development`,
`04-Roadmap`, and `05-AI-Product-Owner` folders were kept exactly as they are (moving/renaming
them would break every existing cross-reference and git history for those files) rather than
renumbered to match the proposal literally. The proposal's `02-Product`/`03-Discovery`/
`07-Architecture`/`09-Roadmap` concepts are considered **already covered** by the existing
`02-Architecture`, `04-Roadmap`, and `06-Requirements-Discovery` folders respectively, and were
deliberately not duplicated under a second number. The genuinely new categories from the
proposal (`04-Business-Analysis`, `05-AI-Engineering`, `08-Decisions`, `10-Operations`,
`11-Templates`, `12-Reference`) were added using the **next available numbers** (07–12) instead
of the proposal's literal numbers, for the same reason.

## Reading Order

**New to Builders?** Read in this order:
1. [00-EXECUTIVE-SUMMARY.md](./00-EXECUTIVE-SUMMARY.md) — the fastest path to "what is this
   and why."
2. [01-Vision](./01-Vision/01-builders-vision.md) — the fuller vision.
3. [00-PRODUCT-REQUIREMENTS.md](./00-PRODUCT-REQUIREMENTS.md) — what Builders must do, for
   whom.
4. [02-Architecture](./02-Architecture/01-current-state-gap-analysis.md) — how it's built
   today, and the gap between today and the vision.
5. Then follow whichever domain folder matches what you're actually working on
   (05-AI-Product-Owner, 06-Requirements-Discovery, etc.) — each has its own
   `00-index.md`/`README.md` with its own internal reading order.

**Working on Requirements Discovery / Interview Mode specifically?** Start at
[06-Requirements-Discovery/00-index.md](./06-Requirements-Discovery/00-index.md) — it has its
own complete reading order for that series.

## How New Documents Should Be Added

See [DOCUMENTATION-STANDARDS.md](./DOCUMENTATION-STANDARDS.md) for the full standard. In
short:
1. Check [DOCUMENTATION-ROADMAP.md](./DOCUMENTATION-ROADMAP.md) — the area you're about to
   document may already have a suggested folder.
2. Pick a folder per the Folder Selection rules in the standards doc.
3. Start from a template in [11-Templates](./11-Templates/) rather than a blank page.
4. Give it the [standard header](./11-Templates/document-header.md), set `Status` to
   🟡 Draft, and link it both ways to whatever it depends on/relates to.
5. Once reviewed, flip `Status` to 🟢 Approved. Once implemented and verified, flip it to
   🔵 Implemented and fill in `Implementation Status`.
6. If a folder's `00-index.md`/`README.md` exists, add the new document to its table.

## Document Lifecycle

```
🟡 Draft ──(review & agreement)──► 🟢 Approved ──(implementation ships & is verified)──► 🔵 Implemented
                                         │
                                         └──(a newer document replaces this one's decisions)──► 🟣 Superseded
```

A document can move from any state directly to 🟣 **Superseded** if a newer document replaces
it — always link both directions (`Supersedes` / superseded-by, in `Related Documents`) when
that happens. See [DOCUMENTATION-STANDARDS.md](./DOCUMENTATION-STANDARDS.md) for full detail
on each status and the review/approval process.

---

*Documentation structure last reviewed: 2026-07-23 (Documentation Foundation Sprint). See
[DOCUMENTATION-ROADMAP.md](./DOCUMENTATION-ROADMAP.md) for what's still missing.*
