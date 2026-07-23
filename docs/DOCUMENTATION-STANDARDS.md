# Builders Documentation Standards

**Status:** 🟢 Approved · **Version:** 1.0 · **Owner:** Documentation maintenance sprint ·
**Last Updated:** 2026-07-23

This document defines the standards every future Builders document should follow. It does
**not** retroactively rewrite existing documents — see "Adoption" at the bottom.

---

## Naming Convention

| Kind of document | Convention | Example |
|---|---|---|
| Numbered folder | `NN-Title-Case-With-Hyphens/` | `06-Requirements-Discovery/` |
| Document inside a numbered folder | `NN-kebab-case-title.md` (two-digit, sequential within the folder) | `02-sprint-55-interview-mode-architecture.md` |
| Folder index | `00-index.md` (not `README.md`) inside numbered folders that have 3+ documents | `06-Requirements-Discovery/00-index.md` |
| New/mostly-empty numbered folder | `README.md` (until it has enough documents to warrant a `00-index.md`) | `07-Business-Analysis/README.md` |
| Sprint-specific document | Include the sprint number literally in the filename, even if it duplicates the folder's own numbering | `02-sprint-55-interview-mode-architecture.md`, not `02-interview-mode-architecture.md` — this makes the file greppable by sprint number alone |
| Root-level standing document | `UPPER-KEBAB-CASE.md` | `DOCUMENTATION-STANDARDS.md`, `DOCUMENTATION-ROADMAP.md` |
| Architecture Decision Record | `NNNN-short-decision-title.md`, four-digit, sequential across all of `09-Decisions/` (not per-folder) | `0001-business-understanding-model-as-universal-contract.md` |

**Never reuse a number.** If a document is removed or merged, leave a gap rather than
renumbering everything after it — renumbering breaks every existing cross-reference and link.

## Folder Selection

Use this decision order when placing a new document:

1. **Does an existing numbered folder's stated scope cover it?** Check that folder's
   `00-index.md`/`README.md` first — most new documents belong in an existing folder.
2. **Is it about a brand-new system/domain with no existing folder?** Propose a new numbered
   folder (next available number) rather than overloading an existing one — see
   [DOCUMENTATION-ROADMAP.md](./DOCUMENTATION-ROADMAP.md) for domains already earmarked for
   their own future folder.
3. **Is it a single-decision record, not a full specification?** It belongs in
   [09-Decisions](./09-Decisions/), regardless of which domain the decision is about.
4. **Is it a template for authoring other documents?** It belongs in
   [11-Templates](./11-Templates/).
5. **When genuinely uncertain,** default to the folder whose *audience* matches most closely
   (e.g. a document a customer-facing salesperson would read → Operations; a document only an
   engineer implementing a sprint would read → the relevant domain folder) rather than the
   folder whose *topic keyword* matches most closely — audience match has proven the more
   durable signal across this codebase's existing docs.

## Writing Style

- **State the "why," not just the "what."** Every non-trivial recommendation should say why
  it was chosen and, ideally, what alternative was rejected and why — this is what makes a
  document useful to someone six months later who's tempted to redo the analysis from
  scratch.
- **Ground new design in what already exists.** Every design document should open with a
  section (or at least a paragraph) naming the existing code/data/components it will reuse,
  before describing anything new — see any of the `06-Requirements-Discovery/` documents for
  the pattern (their `§0` or opening "grounding" sections).
- **Prefer tables and diagrams over prose** for anything that is fundamentally a flow, a
  decision tree, a state machine, or a comparison — reserve prose for reasoning and rationale.
- **Never fabricate implementation status.** A design document must say plainly that it is
  a design document and that nothing has been implemented yet (see Status Values below); an
  implementation report must say what was actually verified (tests run, live checks
  performed) versus assumed.
- **Write for the next person cold**, not for whoever is already in the conversation that
  produced the document — avoid unexplained internal jargon, and spell out acronyms on first
  use per document.
- **Design docs vs. sprint reports get different opening conventions, and that's intentional.**
  A pure design/philosophy document (e.g. anything in `01-Vision/`, `02-Architecture/`,
  `03-Development/`) opens with just its `# Title` and gets straight into content. A
  sprint-report-style document (e.g. `05-AI-Product-Owner/07-12`, `06-Requirements-Discovery/01`)
  opens with a bolded `**Status: ...**` line immediately under the title, describing what was
  actually implemented/verified. Going forward, use the [standard header](./11-Templates/document-header.md)
  table for **both** kinds rather than the bolded status line — it carries the same
  information plus version/ownership/traceability fields the bolded-line convention couldn't
  express. This is a documented convention going forward, not a retroactive rewrite of the
  existing bolded-status documents (see Adoption, below).

## Version Numbering

- Design/architecture/product documents use **semantic-ish major.minor** (`1.0`, `1.1`,
  `2.0`): bump the **minor** version for clarifying edits/typo fixes/added cross-references
  that don't change a recommendation; bump the **major** version when a recommendation
  actually changes (and consider whether the old version should instead become 🟣 Superseded
  by a new document rather than an in-place major bump — see Status Values).
- Sprint implementation reports (e.g. `01-sprint-50-durable-foundation.md`) don't need version
  bumps — they describe a fixed point in time and are effectively immutable once the sprint
  ships; corrections belong in a dated addendum section, not a version bump.
- ADRs stay at `1.0` permanently; a reversed ADR gets superseded by a *new* ADR, never edited
  in place (see [09-Decisions/README.md](./09-Decisions/README.md)).

## Cross References

- Every design/architecture document should link to: (a) whatever it directly builds on
  (`Depends On` in the header), and (b) whatever came before/after it in the same series
  (`Related Documents`).
- **Links should work in both directions.** If Document A's header lists Document B under
  `Related Documents`, edit Document B's header to list Document A back — a one-directional
  reference is treated as a documentation bug (see Task 9 of the sprint that introduced this
  standard, and the quality-review recommendations at the bottom of
  [DOCUMENTATION-ROADMAP.md](./DOCUMENTATION-ROADMAP.md) for any currently-known gaps).
- Use relative markdown links (`[text](../folder/file.md)`), never absolute paths or bare
  filenames — relative links are what makes the docs tree portable and checkable.
- When referencing a specific code symbol/file rather than another doc, use the same
  `path/to/file.ts` inline-code convention already used throughout the existing
  `06-Requirements-Discovery/` documents.

## Status Values

Every design/architecture/decision document's header must carry exactly one of these:

| Status | Meaning |
|---|---|
| 🟡 **Draft** | Under active discussion; not yet approved as a basis for implementation. |
| 🟢 **Approved** | Approved as a design/specification. Implementation may not have started yet — approval means "this is the plan," not "this is built." |
| 🔵 **Implemented** | The design has been built, and the document describes what actually shipped (or has been updated to reconcile any deviations from the original approved design). |
| 🟣 **Superseded** | No longer the current design — a newer document replaces it. Always set `Related Documents` to point at the superseding document, and the superseding document's header should set `Supersedes` to point back. |

A document never skips straight to 🔵 **Implemented** without having been 🟢 **Approved**
first, and a 🟢 **Approved** design document should not silently start describing shipped
behavior as if it were still a proposal — if implementation reveals the design needs to
change, either update the document (bump version) or supersede it with a new one, per Version
Numbering above.

## Review Process

1. A new design document is authored and shared as 🟡 **Draft**.
2. Reviewers (whoever has architectural/product authority for that domain) comment/discuss.
3. Once discussion converges, the author updates the `Status` to 🟢 **Approved** and records
   the approval (informally, in the header's `Last Updated`/commit history is sufficient —
   this codebase does not require a separate formal sign-off document).
4. Only 🟢 **Approved** (or later) documents should be cited as the basis for an
   implementation sprint's scope.

## Approval Process

Approval for a Builders documentation change follows the same bar as approval for code: the
person/role with authority over that domain (architecture, product, or business, matching the
folder per Folder Selection above) must explicitly approve before status moves to 🟢. For
sprint-numbered design documents specifically (the `NN-sprint-NN-*.md` pattern), approval is
typically the same moment the corresponding sprint brief is accepted by whoever requested it —
no separate documentation sign-off step is required on top of that.

## Implementation Traceability

Every document whose `Status` reaches 🔵 **Implemented** should have its `Implementation
Status` header field name the actual commit(s)/PR or, at minimum, the sprint number under
which it shipped, and should link forward to any sprint report that verifies it (tests run,
live verification performed) — mirroring the pattern
[06-Requirements-Discovery/01-sprint-50-durable-foundation.md](./06-Requirements-Discovery/01-sprint-50-durable-foundation.md)
already establishes ("Status: IMPLEMENTED (foundation only), pending manual Supabase migration
execution"). Conversely, a design document that is only 🟢 **Approved** should make explicit,
plainly, that no code/migrations/tests exist yet for it — every document in this sprint's
`06-Requirements-Discovery/02-04` series already does this in its own closing line, and that
convention should continue.

---

## Adoption

This standard applies to **all new documents going forward**. Existing documents are **not**
retroactively rewritten to match it — see each document's own history for its original
authoring context. A future, deliberate documentation-maintenance pass may choose to apply the
standard header (see [11-Templates/document-header.md](./11-Templates/document-header.md))
to existing high-traffic documents (starting candidates: `00-EXECUTIVE-SUMMARY.md`,
`00-PRODUCT-REQUIREMENTS.md`), but that is out of scope for the sprint that introduced this
standard.
