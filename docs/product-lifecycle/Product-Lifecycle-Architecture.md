# Product Lifecycle Architecture (Sprint 77)

**Status: architecture only — no code changes in this sprint. Revised per review feedback.** This
document is the canonical engineering lifecycle model for Builders going forward. It defines how a
product evolves from MVP1 through continuous versioning, and — per this sprint's explicit
constraint — does so entirely by **extending existing mechanisms**, never by inventing a parallel
versioning, manifest, or artifact system.

## Revision note

Two refinements were requested after the first draft, both incorporated throughout this version:

1. **No separate `Release` entity.** The first draft introduced a standalone `Release` record with
   its own status machine layered next to `Mvp.status`. That created two state machines that had to
   be kept in sync. This revision removes `Release` entirely — deployment states are now simply
   further values of the *same* `MvpStatus` field. There is exactly one stateful node in the whole
   model: **`Mvp`**.
2. **Features are now a first-class, MVP-owned model**, not a scope-list. The first draft reused
   `GenerationPlanScope.inScopeFeatureIds` (a flat, derived array of IDs copied onto the generation
   plan) as the thing engineering roles filtered against. This revision promotes `Feature` to its own
   entity — the same promotion `Mvp` itself received in Sprint 45 — so Backend, Frontend, Database,
   QA, Deployment, and future reporting all trace back to real Feature rows, not a copied list.

The single source of truth is now exactly the chain the review asked for:

```
Product → MVP → Features → Engineering → Deployment
```

One entity (`Project`) → one entity (`Mvp`, one status field spanning planning through deployment) →
one entity (`Feature`, owned by its `Mvp`) → existing per-role artifacts/Manifest, all tagged by
`featureId` → deployment, which is just the terminal `MvpStatus` values on the same row.

---

## Executive summary

| Concern | Already exists | Gap this document closes |
|---|---|---|
| Multiple MVPs per project | `Mvp` rows (`app/lib/mvp/mvpTypes.ts`), roadmap skeleton | No "advance to next MVP" action; only one MVP is ever active |
| MVP-scoped generation artifacts | `ApplicationManifest.mvpId`, cross-MVP resume (`resumeOrchestrator.ts`) | Never named as a lifecycle; `mvpId` doesn't reach `ProjectArtifact` |
| Category-level incremental regeneration | `resolveCarryForwardPlan`, `ResumeHooks.getReusableContent` | Never formalized as "the incremental engineering strategy" |
| Append-only historical versioning | Blueprint Resolution (`blueprintResolutionService.ts`) | Product Package still overwrites (delete+reinsert) — no history |
| Deterministic SQL generation | `sqlGenerator.ts`, `schemaValidator.ts` | No schema-diff engine — only ever emits one full "Migration 0001" |
| Per-MVP feature list | `CurrentMvpPlan.features` (`ProductOwnerFeature[]`), stable `FEAT-NNN` ids | Not first-class/queryable — buried in a JSON draft blob; engineering roles filter via a copied `inScopeFeatureIds` array instead of the features themselves |
| Deployment status | Nothing today | Modeled as **more values of `MvpStatus`**, not a new entity |
| Free-text, gracefully-degrading activity types | `ACTIVITY_ICON` map | No MVP-lifecycle events defined yet |

---

## 1. Product lifecycle

```
Product
  │
  ├── MVP1 ──► (status progresses through the same field, planning → deployed)
  ├── MVP2 ──► same
  ├── MVP3 ──► same
  └── ... continuous evolution — every subsequent MVP follows the exact same loop, on the
             exact same status field, forever. No new entity is ever introduced for
             "the next stage."
```

A **Product** is a `Project` (unchanged). A product's lifecycle is the ordered sequence of its `Mvp`
rows. There is no "Release" entity and no "Version" entity — "Version 1," "Version 2" are just
`Mvp.targetRelease` (already exists: *"customer-editable... e.g. 'v0.1', 'v1.0'"*,
`mvpTypes.ts:64`), read off whichever MVP is currently the product's live state.

## 2. MVP lifecycle — the single state machine

`MvpStatus` (`app/lib/mvp/mvpTypes.ts:19-26`) is **extended**, not replaced, with the deployment
states the sprint brief asked for. This is the only status field in the entire model:

```
planned → scoped → generating → ready_for_review → approved
   → provisioned → generated → qa_passed → ready_for_deployment → released
   → superseded                                    (blocked ⇄ any pre-released state)
```

| State | Meaning | Backed by |
|---|---|---|
| `planned` | Exists only in the Product Owner's `roadmapSkeleton`, not yet an `Mvp` row | unchanged |
| `scoped` → `approved` | Gate A / Gate B, exactly as today | unchanged (`MvpApproval.stage`) |
| `provisioned` | This MVP's database delta (§7) has been successfully provisioned | `Project.databaseActivation` filtered to this `mvpId` |
| `generated` | This MVP's `ApplicationManifest` has every planned file at status `complete` | unchanged Manifest data, just read |
| `qa_passed` | This MVP's Features have all reached `Feature.status = 'qa_passed'` (§3) | new Feature status, read |
| `ready_for_deployment` | `provisioned ∧ generated ∧ qa_passed` all true | derived, not stored twice |
| `released` | This MVP is now the product's live, customer-facing state | new terminal value |
| `superseded` | A *later* MVP has itself reached `released` | existing value, existing meaning, now triggered by a precise rule (below) |
| `blocked` | Unchanged — can interrupt any pre-`released` state | unchanged |

**Auto-supersede rule** (the entire "advance to next MVP" bookkeeping, in one sentence): the moment
MVP N+1 reaches `released`, MVP N transitions to `superseded`. Not at MVP N+1's Gate A — MVP N is
still the live product while MVP N+1 is merely being engineered, so it stays `released` until its
successor actually ships. This keeps "which MVP is currently live" always answerable by "the one
`Mvp` row with `status = 'released'`" (there is exactly one, or zero before MVP1 ships) — no
separate pointer, no second table.

`resolveActiveMvpId` (`mvpRepository.ts:213`) keeps its existing contract — "the highest-`sequence`
MVP that has passed Gate A and isn't `superseded`" — and now naturally spans the whole
engineering-through-deployment range, since all of those are pre-`superseded` states on the same
row. Concurrent active engineering across multiple MVPs remains explicitly out of scope, matching
the existing documented design decision.

## 3. Feature model (new — the second core entity)

```
Mvp
  └── Feature[]   (owned by exactly one Mvp; the unit everything downstream traces to)
```

Promoted to first-class, mirroring exactly how `Mvp` itself was promoted out of a Product Owner
draft blob in Sprint 45:

```ts
interface Feature {
  id: string;
  code: string;            // "FEAT-001" — the SAME stable id ProductOwnerFeature already mints
  projectId: string;
  mvpId: string;            // owning MVP — a Feature belongs to exactly one MVP, never floats free
  title: string;
  description: string;
  priority: 'must' | 'should' | 'could' | 'wont';  // reuses the existing MoSCoW vocabulary
  dependsOn?: string[];      // other Feature ids — same shape as today's ProductOwnerFeature.dependsOn
  customerValue?: string;
  status: 'planned' | 'in_progress' | 'generated' | 'qa_passed' | 'deployed';
  createdAt: string;
  updatedAt: string;
}
```

**Sourced by commit-on-approval**, the same pattern `Mvp.scopeArtifactId` already establishes: the
moment an MVP's Gate A is approved, its `CurrentMvpPlan.features` (`ProductOwnerFeature[]`,
`app/lib/projects/prompts/productOwner.ts:114-133`) are copied into real `Feature` rows, owned by
that `Mvp`. The `FEAT-NNN` ids are **not re-minted** — `ProductOwnerFeature.id` already exists and is
already stable across Product Owner regenerations (`productOwner.ts:52-59`); `Feature.code` is
exactly that same string. `EngineeringHandoff.features`/`HandoffFeatureRef` (the narrative handoff
blob every downstream role already reads) is unchanged — it still carries the same ids; what changes
is that those ids now resolve to a real, queryable row instead of only existing inside one JSON
artifact.

**This replaces `GenerationPlanScope.inScopeFeatureIds` entirely.** Today, "in scope for this MVP" is
a flat array of ID strings copied onto the generation plan
(`codeGenerationTypes.ts:159-164`) — a derived, disconnected snapshot. After this change, "in scope
for this MVP" is simply **every `Feature` row where `mvpId` = the active MVP's id**, resolved live at
generation time. Nothing is copied or denormalized; there is one place a feature's existence and
status live, and every role reads it from there.

Every engineering role and Deployment updates `Feature.status` as it processes that feature —
Database Engineer flips it to `in_progress` when modeling schema for it, code generation flips it to
`generated`, QA flips it to `qa_passed`, Deployment flips it to `deployed`. This gives genuine
per-feature traceability, which the old many-files-tagged-with-`featureIds[]` model only gave in
aggregate.

---

# Part 4 — Incremental engineering strategy

## Database Engineer

```
Current Schema (previous MVP's approved DATABASE_SCHEMA)
        ↓
New Schema (this MVP's approved DATABASE_SCHEMA, scoped to this MVP's Feature rows —
            additive: existing tables/columns never removed or redefined by a later MVP
            without an explicit, human-reviewed migration step)
        ↓
Migration SQL (ALTER-based delta, not a fresh CREATE TABLE per Sprint 75's Migration 0001 model)
```

Reuses `schemaTypes.ts`'s `StructuredDatabaseSchema` and `sqlGenerator.ts`'s deterministic,
provider-agnostic generation approach unchanged. **What's genuinely new** (flagged for Sprint 78): a
**Schema Diff** step — `diffStructuredSchemas(previous, next): SchemaDelta` (new tables/columns/
indexes/enums only — deletions/renames excluded, carrying forward Sprint 75/76's "never execute
destructive SQL automatically" rule) feeding `generateMigrationSql(delta): { sql }`, a new sibling to
today's `generateSchemaSql` in the same module. MVP1 still uses full `generateSchemaSql`; MVP2+ uses
the diff-based generator, selected by "does this project already have an MVP with
`status ≥ 'provisioned'`" — not a manual toggle. Provisioning (`SupabaseProvisioner`) and
verification are reused completely unchanged.

## Backend Engineer

Produces **only the APIs required for the active MVP's `Feature` rows** — resolved directly from the
Feature model (§3), not from a copied scope list. The existing carry-forward mechanism
(`resolveCarryForwardPlan`, `resumeOrchestrator.ts:81-132`) handles everything else automatically,
since it already knows how to say "this category is unaffected, reuse it." No new regeneration
engine — this activates an existing, already-designed-for-this mechanism against a better-sourced
input.

## Frontend Engineer

Same mechanism as Backend: generate manifest entries only for pages/components tied to the active
MVP's Features; everything else carries forward via the same category-invalidation logic used for
same-MVP replans. `resumeOrchestrator.ts`'s `crossMvpTransition`/`previousMvpId` (`:143-151`) already
exists specifically to distinguish "this is MVP2 extending MVP1" from "this is a same-MVP re-plan" —
Sprint 78 wires this flag to log `backend_delta_generated`/`frontend_delta_generated` (§Part 10)
instead of the generic `generation_stage_completed`.

## QA Engineer

Distinguishes, in its draft's own shape (extension of `QADraft`, not a new artifact type):

- **Regression tests**: tests tied to `Feature` rows owned by any MVP *before* the active one.
- **New feature tests**: tests tied to `Feature` rows owned by the active MVP.

Both classifications are a direct query against the Feature model — no separate ID scheme, no
copied scope list.

## Deployment

Deploys only Manifest files whose status is `generated` (new) or `superseded`-then-`generated`
(changed) since the previously-`released` MVP. There is no separate "last Release" pointer to
consult — "the previously released MVP" is just the `Mvp` row this one is about to supersede
(§2). Deployment completing successfully is what moves `Mvp.status` from `ready_for_deployment` to
`released` — a status transition, not a new record.

---

# Part 5 — Deployment lifecycle (folded into MVP status)

Restated as a straight-line diagram, since it is no longer a second state machine:

```
planned → scoped → generating → ready_for_review → approved
   → provisioned → generated → qa_passed → ready_for_deployment → released → superseded
```

`provisioned` and `generated` can complete in either order (database provisioning and code
generation are independent today, per Sprint 75/76's own design) but both — plus `qa_passed` — must
be true before `ready_for_deployment` is reached; that transition is computed, not separately set.
`released` fires when deployment finishes. `superseded` fires per §2's rule when the *next* MVP
reaches `released`. If a customer-facing "deployment summary" view is ever needed, it is a read
query over `Mvp` + `Feature` + `ApplicationManifest` + `DATABASE_SCHEMA` + Product Package filtered
by `mvpId` — never a stored, separately-maintained snapshot.

---

# Part 6 — Version evolution

```
Current Product (the Mvp row with status = 'released' — there is at most one)
        ↓
Next MVP (Product Owner elaborates the next `roadmapSkeleton` entry into a new `currentMvp`;
          Gate A approval commits its Feature rows, §3)
        ↓
Diff (Schema Diff §Part 4 + Manifest carry-forward invalidation — both reused, never a third
      diffing system)
        ↓
Engineering Tasks (existing `executionEngine.ts`, scoped to the new MVP's Feature rows)
        ↓
Deployment (§Part 5 — status progression on the same Mvp row)
```

Two comparison primitives, both real, no others:

1. **Manifest-level diff** (files): `ApplicationManifest.planChecksum`/`sourceContentChecksum`
   (`manifestBuilder.ts:357-380`) + `resolveCarryForwardPlan`'s category invalidation. Reused as-is.
2. **Schema-level diff** (database): the new `diffStructuredSchemas` (§Part 4) — the one genuinely
   new comparison primitive this document introduces.

"Version 1," "Version 2" remain customer-facing labels (`Mvp.targetRelease`) over already-versioned
Manifest/Feature/Schema data — never a new source of truth.

---

# Part 7 — Database evolution

```
DATABASE_SCHEMA (this MVP's approved structured schema, tagged with mvpId — see Sprint 78
                  recommendation #1)
        ↓
Schema Diff (new — compares this MVP's schema against the previously-released MVP's schema)
        ↓
Migration SQL (new sibling generator in sqlGenerator.ts — ALTER-based, not CREATE-based)
        ↓
Provision (Sprint 76's SupabaseProvisioner.provision() — completely unchanged)
        ↓
Verification (Sprint 76's verifyConnection() — completely unchanged; its existing
              "expected tables vs. found tables" check extends naturally to a delta's
              expected NEW tables/columns)
        ↓
Mvp.status → 'provisioned'
```

**Never recreate a customer database after MVP1**, enforced by construction: `generateSchemaSql`
(full CREATE) only ever runs for a project's first approved `DATABASE_SCHEMA`; every subsequent
MVP's schema generation uses `generateMigrationSql` instead, gated on "does this project have any
prior MVP with `status ≥ 'provisioned'`."

---

# Part 8 — Backend & frontend evolution

```
Backend (only endpoints for the active MVP's Feature rows)
        ↓
Frontend (only pages/components for the active MVP's Feature rows)
        ↓
QA (regression + new-feature tests, §Part 4)
        ↓
Deployment (delta only, §Part 5 — a status transition on the same Mvp row)
```

Builders' understanding of "what to generate" is now:

```
Current Product (the previously-released MVP's Manifest — carried forward, mostly unaffected)
        +
Selected MVP's Features (queried directly from the Feature model, §3 — not a copied scope list)
        =
Engineering Delta (the subset of the Manifest actually regenerated this run)
```

**Never regenerate the whole application**: enforced by the carry-forward default — a category is
only regenerated when its content/plan checksum changed OR when it's genuinely new for this MVP's
Features, never "because a new MVP started."

---

# Part 9 — Product Package evolution

**This is the one place today's implementation actively works against the lifecycle model**:
`assemblyRepository.ts`'s `saveProductPackage` deletes and re-inserts
(`assemblyRepository.ts:118-122`) — one Product Package row per project, ever — instead of
Blueprint Resolution's already-correct append-only pattern
(`blueprintResolutionService.ts:24-26`).

**Extension, not replacement**: change `saveProductPackage` to insert a new historical row (same
`ProductPackage` shape, `assemblyTypes.ts` unchanged) tagged with `mvpId` and an incrementing
`packageVersion`, mirroring Blueprint Resolution exactly. `getProductPackage(projectId)` keeps its
current "give me the latest" contract; a new `getProductPackageHistory(projectId)` becomes possible.

Per-MVP package contents, all pointers into already-existing data:

- **Release Notes**: new, rule-based (no AI call — same pattern as today's
  `buildProductSummaryMarkdown`), generated from the diff between this MVP's and the previously-
  released MVP's `Feature` rows.
- **Feature List**: the active MVP's `Feature` rows (§3) — already exists as of this revision.
- **Migration Summary**: the Schema Diff's `SchemaDelta` (§Part 7), rendered as markdown.
- **Deployment Notes**: the Manifest's delta file list (§Part 5).
- **Version**: `Mvp.targetRelease` — no separate `Release.versionLabel`.
- **Generated Artifacts**: the Manifest, already fully enumerable.
- **Database Version**: the `DATABASE_SCHEMA` artifact's `version` (+ `mvpId`).
- **Blueprint**: unchanged — Blueprint Resolution is already project-scoped and historical, reused
  as-is.
- **Package**: unchanged — Package Intelligence (Sprint 73) profile selection, reused as-is.

Complete traceability falls out for free: every field is a pointer to already-versioned/historical
data — nothing is copied, nothing can drift out of sync with its source.

---

# Part 10 — Activity history (architecture only — no implementation yet)

Renamed to consistently reflect "these are all `Mvp` status transitions or Feature-level events,"
since there is no longer a separate Release entity to name events after. Confirmed no collisions with
any of the ~50 existing activity types currently logged across the codebase.

| Activity type | Fires when |
|---|---|
| `mvp_started` | An MVP's Gate A is approved (its `Feature` rows are committed, §3) and it becomes the active MVP |
| `mvp_provisioned` | `Mvp.status` → `provisioned` |
| `mvp_generated` | `Mvp.status` → `generated` |
| `mvp_qa_passed` | `Mvp.status` → `qa_passed` |
| `mvp_ready_for_deployment` | `Mvp.status` → `ready_for_deployment` |
| `mvp_released` | `Mvp.status` → `released` |
| `mvp_superseded` | `Mvp.status` → `superseded` (per §2's auto-supersede rule) |
| `feature_completed` | A `Feature.status` reaches `deployed` |
| `migration_generated` | `generateMigrationSql` produces a new delta migration |
| `schema_upgraded` | A migration is successfully provisioned (coincides with `mvp_provisioned`; this is the finer-grained schema-level narration of the same underlying event) |
| `backend_delta_generated` | Backend manifest entries generated for an MVP2+ run |
| `frontend_delta_generated` | Same, frontend |
| `qa_regression_completed` | The regression subset of an MVP's QA run passes |

All follow the existing convention: free-text `activityType` string, `ProjectHistoryPanel.tsx`'s
`ACTIVITY_ICON` map gets one new entry per type, falling back gracefully to `DEFAULT_ACTIVITY_ICON`
for anything unmapped.

---

# Part 11 — Verification example: Dental Clinic

```
Product: "BrightSmile Dental" (one Project)

MVP1 (Appointments) — sequence 1, targetRelease "v1.0"
  Gate A approved → mvp_started. Features committed: FEAT-001..FEAT-006 (booking, provider
  schedules), each Feature.status = 'planned'.
  Database:   generateSchemaSql (full CREATE, no prior provisioned MVP) → patients,
              appointments, providers tables. Mvp.status → provisioned.
  Backend:    endpoints for FEAT-001..006. Frontend: booking calendar, provider list, intake
              pages. Each Feature.status → 'generated'. Mvp.status → generated.
  QA:         100% new-feature tests (no prior MVP to regress against). Features → 'qa_passed'.
              Mvp.status → qa_passed → ready_for_deployment.
  Deployment: full deploy (first MVP, nothing to carry forward). Features → 'deployed'.
              Mvp.status → released. mvp_released logged.

MVP2 (Billing) — sequence 2, targetRelease "v1.1"
  Gate A approved → mvp_started. Features committed: FEAT-007..FEAT-010 (billing).
  MVP1 stays 'released' (still the live product) — it does NOT flip to superseded yet.
  Database:   diffStructuredSchemas(MVP1's schema, MVP2's schema) → new invoices, payments
              tables, new fk from appointments.invoice_id. generateMigrationSql → ALTER-based
              delta. Patients/appointments/providers tables: untouched. Mvp.status → provisioned.
  Backend:    only billing endpoints generated for FEAT-007..010; booking endpoints carried
              forward via resolveCarryForwardPlan (category unaffected, checksum unchanged).
  Frontend:   only billing/invoice pages generated; booking UI carried forward unchanged.
  QA:         regression tests re-run against FEAT-001..006 (booking still works); new tests for
              FEAT-007..010. qa_regression_completed logged alongside mvp_qa_passed.
  Deployment: delta-only — ships only the new billing pages/endpoints/migration; booking code is
              never re-deployed because it was never regenerated. Mvp.status → released.
              MVP1.status → superseded (§2's auto-supersede rule fires now, at MVP2's release,
              not at its Gate A). Product Package: new historical row, packageVersion 2, Release
              Notes generated from the MVP1→MVP2 Feature diff.

MVP3 (Inventory) — sequence 3, targetRelease "v1.2"
  Same loop: schema diff adds inventory/suppliers tables only; backend/frontend delta only for
  FEAT-011+ (inventory); QA regresses booking AND billing, tests only inventory as new;
  deployment ships only the inventory delta. On release, MVP2 → superseded.

Complete Product = whichever Mvp row currently has status = 'released' — at every point in this
history, "what is the product right now" is answerable by one query (Mvp WHERE status =
'released', joined to its Feature rows), never by replaying every MVP's full output from scratch.
```

---

# Recommendations for Sprint 78 (Backend Code Generation)

In priority order — each additive to existing code, none require a redesign:

1. **Add `mvpId?: string` to `ProjectArtifact`** (`app/lib/projects/artifacts.ts`) — connects
   role-output versioning to MVP identity, matching `ApplicationManifestDraft.mvpId`.
2. **Promote `Feature` to a first-class entity** (`app/lib/features/featureTypes.ts` +
   `featureRepository.ts`, mirroring Sprint 45's `Mvp` promotion exactly) — commit-on-Gate-A-approval
   from `CurrentMvpPlan.features`, reusing the existing `FEAT-NNN` ids unchanged.
   - **Must be idempotent.** Gate A approval can be re-triggered (resume after interruption, or a
     genuine re-approval after "changes requested" — see `MvpApproval`, one row per decision, not
     upsert). Promotion must key on `(mvpId, code)` — a `Feature` with that `code` already existing
     under that `mvpId` means "update in place if the source draft's content changed, never insert a
     duplicate row." No new sequence/version concept is needed for this — it's the same
     "upsert-by-natural-key" discipline `createOrUpdateRoleOutput` already applies to artifacts.
   - **Enforce valid parent-MVP linkage.** A `Feature` may only be created against an `Mvp` whose
     Gate A has actually been approved (mirrors `resolveActiveMvpId`'s re-resolution check in
     `resumeOrchestrator.ts:205` — never trust a caller-supplied `mvpId` without re-verifying it
     server-side at the moment of write) and a `Feature.mvpId` is immutable once set — a feature is
     never re-parented to a different MVP.
3. **Remove `GenerationPlanScope.inScopeFeatureIds`**; resolve "features in scope" via the Feature
   repository (`WHERE mvpId = activeMvpId`) at generation time instead.
4. **Extend `MvpStatus`** with `provisioned | generated | qa_passed | ready_for_deployment |
   released`, and implement the auto-supersede rule (previous MVP → `superseded` when the next
   reaches `released`). No new table.
   - **Enforce valid status transitions on both `Mvp` and `Feature`** — a small allowed-transitions
     table (e.g. `released` can only be reached from `ready_for_deployment`; `superseded` only from
     `released` or an earlier non-terminal state; never backwards, never skipping the
     provisioned/generated/qa_passed gate) checked in one place before any status write, the same
     way `classifyResumeAction` (`resumeOrchestrator.ts:55-70`) centralizes status-based branching
     today rather than leaving it to be reimplemented at each call site. Same discipline applies to
     `Feature.status` (`planned → in_progress → generated → qa_passed → deployed`, no skipping,
     no regressing except via an explicit, logged correction).
5. **Make Product Package append-only, mirroring Blueprint Resolution** — change
   `assemblyRepository.saveProductPackage` from delete+reinsert to insert-new-row +
   `getProductPackageHistory`.
6. **Build the Schema Diff engine** — `diffStructuredSchemas`/`generateMigrationSql` in
   `app/lib/database-activation/`, additive to `sqlGenerator.ts`. The one place genuinely new logic
   (not just new wiring) is required.
7. **Wire the thirteen new activity types** (§Part 10) at their respective call sites, plus icons.

Do not begin Backend Generation until this architecture has been reviewed and approved.
