# Human Approval Philosophy

## Principle

No stage of the factory proceeds past a decision point without the customer being able to see and approve what's about to happen next. This already exists in the current pipeline in a narrower form — every role's artifact requires approval before the next role runs (`ROLE_ARTIFACT_CHAIN` gating, `applyReviewDecision` in `projectsStore.ts`). MVP-first extends the *granularity* of this principle; it does not introduce it.

**Finalized as a two-gate model (Sprint 46A):** the per-artifact vs. per-MVP distinction below is now formalized as Gate A (Scope Approval, before Engineering begins) and Gate B (Delivery Approval, after Preview) — see [05-AI-Product-Owner/05-customer-review-workflow.md](../05-AI-Product-Owner/05-customer-review-workflow.md) for the full reasoning and the `builders_mvp_approvals.stage` field this introduces.

## Two Levels of Approval, Not One

The current system has one approval granularity: per-artifact (Requirements approved, Architecture approved, and so on). MVP-first needs a second, coarser granularity: per-MVP. These are not redundant:

- **Per-artifact approval** (existing) governs whether an individual role's output is good enough for the *next role* to build on it. This still matters within a single MVP's engineering process — a bad Database Design artifact shouldn't silently flow into Backend Engineering just because MVP-level review hasn't happened yet.
- **Per-MVP approval** (new, `builders_mvp_approvals` — see [02-Architecture/04-buildersdb-future-schema.md](../02-Architecture/04-buildersdb-future-schema.md)) governs whether the *customer* accepts the running application produced for this MVP, and therefore whether the next MVP is unlocked.

## The One Deliberate Exception: Product Owner Output Requires Explicit Approval

Every other role in today's auto-engineering pipeline auto-approves after generation, on the theory that the customer already approved the input (Requirements) and downstream technical roles are executing that intent, not making new judgment calls. The Product Owner is different in kind: its output is a business decision (what ships first, what the customer waits for) with direct product consequence, not a technical execution of already-approved intent.

**Recommendation:** the Product Owner's MVP Scope Definition should not auto-approve, even in "auto-engineering" mode, and should always surface the full MVP Roadmap (not just the current MVP) so the customer can catch bad sequencing decisions before any engineering work — let alone generation — begins.

## Why Approval Gates, Not Just Notifications

A weaker version of this principle would be "notify the customer when an MVP is ready, but let generation continue automatically." This is explicitly rejected: the vision's flow (`Generate MVP → Preview → Customer Review → Next MVP`) is sequential and blocking by design. The entire point of MVP-first is that the customer's feedback on MVP N can and should change what MVP N+1 needs to contain — proceeding automatically defeats that.

## Practical Implementation Note

This reuses the existing review UI pattern (`TaskDetailsDialog.tsx`, `ReviewComponents.tsx`) rather than inventing a new approval UI — the same approve/reject/notes interaction, applied at MVP granularity instead of task granularity. No new interaction pattern needs to be designed; it needs to be applied at one more level.

## A Third, File-Grained Decision Point (Sprint 49)

Sprint 49 introduces a decision point below per-artifact and per-MVP approval: whether Builders may overwrite a SPECIFIC FILE it previously generated. This is not a new approval gate in the Gate A/Gate B sense above — it's automatic by default (`builders_generated` files regenerate freely; see [05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md](../05-AI-Product-Owner/12-sprint-49-traceability-and-ownership.md)) and only becomes a human decision when Builders detects it CAN'T safely decide on its own: a file whose live content no longer matches what Builders last generated (`user_modified`), or one explicitly marked as customer-owned or protected. Consistent with this document's core principle — no stage proceeds past a point where destroying the customer's own work would be silent and irreversible — but deliberately NOT implemented as a blocking approval gate the way Gate A/B are: a single conflicting file is preserved and reported (`FileConflict`), not held up for a synchronous decision before the rest of that MVP's generation can proceed. The customer sees what was preserved and why; nothing is silently overwritten, but nothing blocks on it either. The review UI for actually resolving one of these conflicts (replace / keep / view diff) is explicitly NOT built yet — Sprint 49 built the data (`CodeGenerationState.conflicts`) a future UI reads, per its own "minimum necessary" instruction.
