# Risks, Mitigations, and Alternatives Considered

## R1 — Regenerating Over Customer-Edited Files (High Severity, High Likelihood)

**Scenario:** Customer hand-edits a file in the Workbench after MVP 1 review. MVP 2 generation runs, the file falls within a category the resume orchestrator decides needs regeneration, and the customer's edits are silently overwritten.

**Why this is real, not hypothetical:** Today's generation model never intentionally regenerates a file with customer-relevant content already in it — every existing regeneration path is either a resume of an *incomplete* run or a repair of *broken* code, not an edit to *working, customer-modified* code. MVP-first is what turns this into a live scenario for the first time.

**Mitigation:** Track a `user_modified` signal per generated file (checksum mismatch against last AI-generated version, or an explicit edit-tracking hook in the Workbench save path). Default to Preserve for any file so marked; require explicit customer opt-in to regenerate it. See [02-Architecture/03-generation-engine-create-modify-preserve.md](../02-Architecture/03-generation-engine-create-modify-preserve.md).

**Alternative considered and rejected:** Locking files as read-only once customer-edited. Rejected because it prevents legitimate AI-assisted extension of a file (e.g., adding a new prop to a component the customer styled) — Preserve-by-default-with-opt-in is more useful than a hard lock.

## R2 — Preview/Container State Not Surviving MVP-to-MVP Upgrades (High Severity, Medium Likelihood)

**Scenario:** Each "Generate MVP N" pays a full reinstall/reboot cost because the WebContainer lifecycle assumes a fresh container per generation, reintroducing the wait-time problem MVP-first exists to solve.

**Why this is real, not hypothetical:** Sprint 44.1 already produced a production incident here — a workspace-resume install hang traced to a duplicate installer triggered by a replayed restore `boltArtifact`, not a network or npm issue. Container resume is known-fragile, not merely untested.

**Mitigation:** Dedicated Phase 5 workstream (see [01-phased-migration-plan.md](01-phased-migration-plan.md)) starting from the Sprint 44.1 root cause analysis, with resume/upgrade behavior measured explicitly (time-to-preview for MVP 2+ vs. MVP 1) rather than assumed to be fast because MVP 2's scope is smaller.

**Alternative considered and rejected:** Accepting a full reinstall per MVP as a tolerable cost given smaller scope per MVP. Rejected because it undermines the core value proposition (fast, incremental delivery) even if each individual MVP's *generation* is faster — the customer-visible latency between "I approved MVP 1" and "I can see MVP 2" would still include a full container bootstrap.

## R3 — Fire-and-Forget BuildersDB Writes Becoming a Data-Integrity Risk (Medium Severity, Medium Likelihood)

**Scenario:** An MVP approval is recorded locally and the UI proceeds to unlock MVP N+1, but the corresponding `builders_mvp_approvals` write to Supabase fails silently (today's `mirrorToBuildersDb()` pattern never awaits and has no retry/alerting). A refresh or a different session reading BuildersDB directly sees the MVP as unapproved, creating an inconsistent view of release state.

**Why this is real, not hypothetical:** The current fire-and-forget pattern is a deliberate, reasonable choice for a system where BuildersDB is a best-effort mirror behind authoritative local state. MVP approval gates are the first feature where BuildersDB read-after-write consistency plausibly matters (e.g., if approval state needs to be read by a different surface, a teammate's session, or a future notification system).

**Mitigation:** MVP approval writes specifically (not all BuildersDB writes) should be awaited and surfaced to the UI on failure, rather than changing the fire-and-forget pattern globally. This is a narrow, low-risk carve-out rather than a systemic rewrite of the persistence model.

**Alternative considered and rejected:** Making all BuildersDB writes synchronous/awaited. Rejected as unnecessary blast radius — most existing writes (activity logging, context traces) have no correctness requirement that justifies blocking the UI on them.

## R4 — Product Owner Scope Quality (Medium Severity, Medium Likelihood)

Covered in [02-Architecture/02-ai-product-owner.md](../02-Architecture/02-ai-product-owner.md). Mitigated by mandatory explicit approval of the full MVP Roadmap (not just the current MVP) before any downstream engineering role runs.

## R5 — Migration Fatigue / Scope Creep on the UI Consolidation (Low-Medium Severity)

**Scenario:** Phase 4 (UI consolidation) is tempting to start early because it's the most visible part of the vision, but doing so before Phases 1-3 exist produces a relabeled UI with no new underlying capability — wasted effort that also risks destabilizing the recently-shipped Generation Dashboard for no customer benefit.

**Mitigation:** Enforced sequencing in the roadmap (Phase 4 explicitly follows Phase 3). This is the single most important process discipline this document set asks for.

## Overall Risk Posture

None of these risks argue against adopting the vision. They argue for the specific phase ordering and the two named engineering workstreams (edit-protection, preview persistence) that the vision itself does not call out but that this codebase's own incident history shows are necessary before MVP-first can be trusted with real customer work across more than one MVP cycle.
