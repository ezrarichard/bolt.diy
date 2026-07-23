# 09 — Decisions

**Status:** 🟡 Reserved (no documents yet)

Home for **Architecture Decision Records (ADRs)** — short, immutable records of a single
significant decision, why it was made, what alternatives were considered, and why they were
rejected. Unlike the longer design documents elsewhere in `docs/` (which describe a whole
system or feature), an ADR is deliberately small: one decision, one page.

Good candidates for retroactive ADRs, based on decisions already made and documented at
length elsewhere in this tree:
- "Why `BusinessUnderstandingModelPatch` is the universal discovery-method contract" (see
  [06-Requirements-Discovery/04-builders-discovery-experience-master-spec.md](../06-Requirements-Discovery/04-builders-discovery-experience-master-spec.md) §3)
- "Why Discovery Decision is deterministic, never AI-based" (see
  [06-Requirements-Discovery/02-sprint-55-interview-mode-architecture.md](../06-Requirements-Discovery/02-sprint-55-interview-mode-architecture.md) §2, §11)
- "Why MVP is adopted conceptually but not as a re-parenting schema change" (see
  [00-EXECUTIVE-SUMMARY.md](../00-EXECUTIVE-SUMMARY.md))

**Suggested naming convention once this folder is used:** `NNNN-short-decision-title.md`
(zero-padded, sequential, e.g. `0001-business-understanding-model-as-universal-contract.md`)
— see [../DOCUMENTATION-STANDARDS.md](../DOCUMENTATION-STANDARDS.md) for the full naming
convention and required sections (Context, Decision, Consequences, Alternatives Considered).
