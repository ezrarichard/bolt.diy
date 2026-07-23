# BuildersDB Future Architecture

**This document is a design recommendation. No migrations are created by this document.**

## Principle: Add a Dimension, Don't Rebuild

The vision lists a set of desired concepts: Projects, Requirements, Product Vision, Product Owner Plan, MVP Releases, Release Reviews, Snapshots, Generation Runs, Release History, Approvals, Generation Manifest. Reviewed against the current schema (`docs/buildersdb.md`, migrations in `supabase/migrations/`), nearly every one of these already has a direct structural cousin:

| Vision Concept | Existing Table | Gap |
|---|---|---|
| Projects | `builders_projects` | None |
| Requirements | `builders_role_outputs` (Business Analyst role) | None |
| Product Vision / Product Owner Plan | — | New artifact type on `builders_role_outputs`, once Product Owner role exists |
| MVP Releases | — | **New table**: `builders_mvps` |
| Release Reviews / Approvals | `builders_task_reviews` (task-level only) | Needs MVP-level equivalent: `builders_mvp_approvals` |
| Snapshots | `builders_role_outputs` versioning, `builders_generated_application_files` versioning | Already versioned; needs `mvp_id` scoping |
| Generation Runs | `builders_application_manifests` | Needs `mvp_id` FK |
| Generation Manifest | `builders_application_manifests` / `builders_application_manifest_files` | Needs `mvp_id` FK |
| Release History | `builders_project_activity` | Already logs generation/review events; needs MVP tagging on entries |

The honest conclusion: **the schema was already built by a team anticipating versioned, incremental work** (Sprint 36's version threading and context traces are evidence of this), even though the MVP concept itself wasn't yet named. This significantly de-risks the migration.

## Recommended New Tables

### `builders_mvps`
One row per MVP within a project. Fields: `id`, `project_id`, `sequence` (1, 2, 3...), `theme` (short label), `status` (planned | scoped | generating | ready_for_review | approved | superseded), `scope_artifact_id` (FK to the Product Owner's `builders_role_outputs` row for this MVP), `created_at`, `approved_at`.

### `builders_mvp_approvals`
One row per customer review decision at the MVP level. Fields: `id`, `mvp_id`, `decision` (approved | changes_requested), `notes`, `decided_at`. This is the MVP-granularity equivalent of the existing `builders_task_reviews`, not a replacement for it — task-level review still matters within an MVP's engineering process.

**Sprint 46A refinement:** add a `stage` field (`'scope' | 'delivery'`) to this table — the Product Owner specification work surfaced that "MVP approval" is actually two distinct events (approving the scope before Engineering starts, approving the delivered app before the next MVP unlocks), and both need to be distinguishable in the same table. See [05-AI-Product-Owner/05-customer-review-workflow.md](../05-AI-Product-Owner/05-customer-review-workflow.md).

**Sprint 46A field additions to `builders_mvps`:** `target_release` (nullable text, customer-editable release label), `estimated_effort` (nullable enum `small|medium|large` — deliberately not numeric), `business_priority` (nullable enum `critical|high|medium|low`), `blocked_reason` (nullable text). Full reasoning, plus a set of explicitly rejected fields (`planned_start`/`planned_finish`/`actual_finish`/`customer_priority`/`completion_percentage`), in [05-AI-Product-Owner/06-buildersdb-recommendations.md](../05-AI-Product-Owner/06-buildersdb-recommendations.md).

**Sprint 46C field addition:** `builders_mvps.code` (nullable text, unique per project) — the MVP's permanent, human-readable identifier (`"MVP-001"`), separate from the row's own surrogate `id` and from the revisable `sequence`. See [05-AI-Product-Owner/08-identity-and-traceability.md](../05-AI-Product-Owner/08-identity-and-traceability.md). Feature-level identity (`FEAT-001`) required no schema change at all — features live inside the existing JSON artifact `content`, not their own column.

## Recommended Additive Columns

**Correction from the initial recommendation:** these columns are added nullable in Phase 1 for migration safety, but should become **mandatory (NOT NULL)** for Engineering-phase and Generation-phase rows as soon as the Product Owner role and MVP planning ship (Phase 2/3) — not left permanently optional. Permanently-nullable `mvp_id` would let engineering artifacts exist outside any MVP boundary indefinitely, which undermines the entire premise of MVP-first. Project-level artifact types (Requirements, Product Vision) are the sole permanent exception — they intentionally have no `mvp_id`. See [06-mvp-as-core-object.md](06-mvp-as-core-object.md) for the full reasoning.

- `builders_role_outputs.mvp_id` — nullable at Phase 1; **NOT NULL from Phase 2 onward for any artifact type of Architecture-or-later** (Engineering phase). Remains permanently nullable/absent only for Requirements and Product Vision rows, which are project-level by design, not MVP-scoped.
- `builders_application_manifests.mvp_id` — nullable at Phase 1; **NOT NULL from Phase 3 onward** — every generation manifest belongs to exactly one MVP once scope-aware generation ships.
- `builders_generated_application_files` — inherits MVP scoping via its manifest FK; additionally needs the `user_modified` flag discussed in [03-generation-engine-create-modify-preserve.md](03-generation-engine-create-modify-preserve.md).
- `builders_project_activity.mvp_id` (nullable, permanently — activity includes project-level events like Requirements approval that have no MVP) — lets the activity timeline filter/group by MVP without a schema rewrite.
- `builders_ai_roles.phase` (`product_planning` | `engineering`) — new column distinguishing the Product Owner from the 8 engineering roles at the data layer, per [02-ai-product-owner.md](02-ai-product-owner.md). Existing 8 roles default to `engineering`; Product Owner is the first (and likely only, for now) `product_planning` row.

## What This Avoids

- No existing table needs to be dropped or restructured.
- No existing repository method (`buildersDbRepository.ts`) needs to change signature — they gain an optional `mvpId` parameter, following the same pattern already used for `projectId` scoping throughout that file.
- The repository-pattern abstraction already in place (local vs. Supabase provider) means these migrations can be developed and tested against the local provider before touching the production Supabase schema.

## Migration Ordering

Add tables and nullable columns first (no behavior change, fully backward compatible with the current single-scope pipeline). Only after the Product Owner role and scope-aware generation exist (Phases 2-3 in the roadmap) do these columns become non-nullable / load-bearing. This means the schema work can ship and be validated well before any user-facing MVP-first behavior exists — a low-risk, independently shippable first phase.
