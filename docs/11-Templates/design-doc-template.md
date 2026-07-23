# <Feature/System Name> — <Architecture | UX | Product> Specification

*(Insert the [standard header](./document-header.md) here.)*

**See also:** *(links to the sibling/prerequisite/successor documents in this series)*

---

## 0. Grounding — What Already Exists

Before designing anything new, state plainly what the codebase already has that this design
must reuse, and why reusing it (rather than building parallel systems) is the right call. This
section is what keeps a design additive instead of a rewrite in disguise.

## 1+. <Numbered sections per the brief that requested this document>

Use tables and ASCII/mermaid diagrams liberally — prefer a diagram over a paragraph wherever
a flow, state machine, or hierarchy is being described. Every non-trivial recommendation
should say **why**, not just **what**.

## Risks & Recommendations Summary

A single table: risk → mitigation, each mitigation pointing back at the section that designed
it.

## Implementation Roadmap

A sequenced table of future sprints/milestones, each with a one-line scope and what it reuses
from prior work. Prefer many small, independently-demoable milestones over few large ones.

---

**Footer:** state plainly whether this document authorizes any code change (it should not,
unless it is itself an implementation-sprint report rather than a design document) and what
was/was not modified to produce it.
