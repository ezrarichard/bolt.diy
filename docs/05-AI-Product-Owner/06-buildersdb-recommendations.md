# BuildersDB Recommendations: Additional MVP Fields

This evaluates every field candidate raised for `builders_mvps`, plus the one schema addition surfaced by [05-customer-review-workflow.md](05-customer-review-workflow.md). Recommendations only include fields with clear, durable value — several candidates are explicitly rejected below, with reasoning, per the sprint's instruction to recommend additions "only if they add long-term value."

## Adopt

### `target_release` (nullable text, e.g. `"v0.1"`, `"v1.0"`)

**Adopt.** This is not redundant with `sequence` (the MVP's internal roadmap position, 1/2/3/...). `sequence` is structural and dependency-driven; `target_release` is a customer-facing, marketing/release identity that doesn't have to move in lockstep with it — two MVPs might both roll into the same public "v1.0," or a roadmap might reorder MVPs internally without changing what's publicly called v1.0. This field is the bridge between Builders' internal incremental-delivery mechanics and how the customer talks about their product externally.

**Important constraint on how this field is set:** it should be **customer-editable, not AI-authoritative**. Versioning strategy (when something becomes "v1.0" instead of "v0.3") is often a business/marketing judgment call, not a technical-scope decision — the Product Owner may propose a default value when it writes the roadmap skeleton, but the customer must be able to override it without triggering any regeneration. This has no schema implication (it's just a normal nullable, updatable column) but is an important product-behavior note for Sprint 46B's UI/API design.

### `estimated_effort` (nullable enum: `small | medium | large`)

**Adopt — as a coarse enum, explicitly rejecting numeric alternatives (story points, engineering weeks).** Reasoning:

- An LLM-driven Product Owner estimating "engineering weeks" implies a level of calibrated precision that doesn't exist — there's no historical velocity baseline for a fresh AI-generated project, and presenting a fake-precise number risks the customer holding the system to a deadline it was never able to reliably predict.
- Story points require a team's historical estimation-accuracy record to be meaningful at all; Builders has no "team" in the human-sprint-planning sense, so adopting story points would import a vocabulary whose actual meaning (relative estimation calibrated against past sprints) doesn't apply here.
- A **Small/Medium/Large** T-shirt size is proportionate to the actual estimation confidence achievable, still gives the customer something useful for sequencing conversations ("MVP 2 is Large, expect it to take longer to review than MVP 1"), and doesn't invite false precision.

### `business_priority` (nullable enum: `critical | high | medium | low`)

**Adopt.** This is not redundant with `sequence`. Ordering can be dependency-driven (a low-priority-but-foundational MVP might legitimately need to come before a high-priority one), so `sequence` alone can't tell a customer "which of these MVPs matters most if we can only build some of them." This reuses the Critical/High/Medium/Low vocabulary already adopted for *risk severity* in [01-responsibilities-and-decision-framework.md](01-responsibilities-and-decision-framework.md) — appropriately, since this is the same kind of "how much does this matter" judgment, just applied to an MVP as a whole rather than a risk.

### `blocked_reason` (nullable text)

**Adopt.** Low cost, real operational value, and directly mirrors an existing pattern already in this codebase (`last_error` on `builders_application_manifest_files`, `manifest_persistence_error` on workspace state) for exactly this "why is this stuck" need. Pairs naturally with adding a `'blocked'` value to the existing `status` enum (an application-layer convention change, not a schema change, since `status` is already unconstrained free text).

## Reject

### `planned_start` / `planned_finish`

**Reject.** These imply calendar-driven, fixed-date project scheduling — a model that doesn't match how Builders actually delivers: an MVP's "start" is the moment Gate A scope approval happens (see [05-customer-review-workflow.md](05-customer-review-workflow.md)), which is customer-driven and unpredictable, not planned in advance. Adding fields that imply a committed schedule risks the same false-precision problem as numeric effort estimates — Builders should not represent a date commitment it has no mechanism to guarantee. If a real project-management/scheduling UI is ever built on top of Builders, this can be reconsidered then; it is not needed now (YAGNI).

### `actual_finish`

**Reject as a separate field — it already exists.** `builders_mvps.approved_at` (added Sprint 45) already records exactly this moment (when Gate B delivery approval happens). Adding `actual_finish` would duplicate `approved_at` under a different name, with the two fields inevitably drifting if one code path updates one and not the other. If "finish" is meant to capture something *different* from delivery approval (e.g. generation completion, before customer review), that's already tracked at the manifest level (`builders_application_manifests.completed_at`) and doesn't need duplicating onto the MVP row either — it can be read via the MVP's associated manifest.

### `customer_priority`

**Reject, for now.** This would capture the customer's own stated priority as a structured field, distinct from the Product Owner's `business_priority`. It's a reasonable idea in principle, but adopting it now would add a column with no consumer: there is no customer-facing roadmap-reordering UI in this sprint's scope (or any sprint's scope yet), and free-text customer feedback already has a home in `builders_mvp_approvals.notes`. Adding a structured column ahead of the UI that would populate and display it meaningfully is speculative schema investment — exactly the kind of "leave room for it" future-proofing the Product Owner itself is being designed to avoid (see [01-responsibilities-and-decision-framework.md](01-responsibilities-and-decision-framework.md), Section 6). Revisit if/when a real prioritization-adjustment UI is planned.

### `completion_percentage`

**Reject as a stored column — compute it instead.** This value is fully derivable from the MVP's associated generation manifest (`completed_files / total_files`, exactly what the existing Generation Dashboard already computes for a single manifest — see `app/lib/application-manifest/dashboardStats.ts`). Storing it as a separate persisted column on `builders_mvps` risks exactly the anti-pattern this codebase has already explicitly avoided elsewhere: `builders_application_manifest_files`'s `used_by` is deliberately computed at read time from `dependencies`, *not* stored as a second column that could drift out of sync with the source of truth (see `docs/` — Sprint 44.2 Phase 4's own migration comment on this exact point). The same reasoning applies here.

## Sprint 46C Addition: `builders_mvps.code`

Not one of the fields evaluated below (those were all Sprint 46A recommendations) — a new field this sprint's identity/traceability work required. `code` (e.g. `"MVP-001"`) is the MVP's permanent, human-readable identifier, distinct from the row's own surrogate `id` (uuid) and from `sequence` (the roadmap's current, revisable ordering). See [08-identity-and-traceability.md](08-identity-and-traceability.md) for the full design, including why a third field was needed rather than reusing either existing one. Migration: `supabase/migrations/20260722100000_mvp_feature_identity.sql` (staged, not yet applied).

## New Schema Addition Surfaced by This Sprint

### `builders_mvp_approvals.stage` (`'scope' | 'delivery'`)

Not one of the originally-listed candidates, but a genuine gap this sprint's design work surfaced: see [05-customer-review-workflow.md](05-customer-review-workflow.md)'s two-gate model. Without this field, Gate A and Gate B approvals are indistinguishable in the existing `builders_mvp_approvals` table. Recommended for Sprint 46B's migration, alongside the Product Owner role itself, since the two-gate model is meaningless without it.

## Summary Table

| Field | Table | Decision | One-line reason |
|---|---|---|---|
| `target_release` | `builders_mvps` | Adopt | Bridges internal sequencing to external release identity; customer-editable |
| `estimated_effort` | `builders_mvps` | Adopt | Coarse S/M/L only — avoids false-precision numeric estimates |
| `business_priority` | `builders_mvps` | Adopt | Not redundant with sequence; dependency order ≠ importance order |
| `blocked_reason` | `builders_mvps` | Adopt | Mirrors existing `last_error`-style pattern; real operational value |
| `planned_start` / `planned_finish` | `builders_mvps` | Reject | Implies a scheduling commitment Builders can't guarantee (YAGNI) |
| `actual_finish` | `builders_mvps` | Reject | Duplicates existing `approved_at` |
| `customer_priority` | `builders_mvps` | Reject (for now) | No consumer UI yet; speculative future-proofing |
| `completion_percentage` | `builders_mvps` | Reject | Derivable from manifest data; storing it risks drift |
| `stage` | `builders_mvp_approvals` | **New — Adopt** | Required to distinguish Gate A from Gate B approvals |
