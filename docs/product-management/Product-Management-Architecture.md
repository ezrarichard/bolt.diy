# Product Roadmap & Continuous Product Evolution Architecture (Sprint 80)

**Status: architecture only — no code changes in this sprint.** This document defines how a
Builders product evolves after MVP1 ships. It extends Sprint 77's Product Lifecycle Architecture
and Sprint 78/79's Backend Generation Foundation — it does not replace or redesign either.

**Revision note (four lifecycle corrections, post-review).** The first draft recorded the Roadmap
Review approval BEFORE any `Mvp` row existed for the target MVP — structurally inconsistent, since
`MvpApproval.mvpId` is required. It also proposed `highestCommitted + 1` as the next-sequence
resolver, which is not retry-safe (re-running Roadmap Review after an MVP2 planned row already
exists would incorrectly resolve MVP3). It used `resolveActiveMvpId` — a mid-engineering concept —
to decide which MVP a Product Review is ABOUT, conflating "what's currently being engineered" with
"what was just released." And it claimed Feature codes are stable/comparable across MVPs when the
only enforced constraint is `(mvp_id, code)` uniqueness, not project-wide. All four are corrected
below; every other part of the original design (Parts 6, 7, 9, and the overall reuse posture) is
unchanged. Sections revised: **Part 1** (new Cross-MVP Feature Identity subsection), **Part 2**
(corrected outer-loop diagram), **Part 3** (source/target MVP fields, corrected gate), **Part 4**
(replaces the `nextMvpSequence` fix with `resolveNextRoadmapTarget`), **Part 5** (corrected
sequencing — planned row exists before Roadmap Review), **Part 8** (Product Package
implementation-time verification list), **Parts 10–14** (data model / repository / BuildersDB /
migration / roadmap updates reflecting all of the above).

**Second revision note (three further corrections, final review round).** (A) The first correction
round's `resolveNextRoadmapTarget` still only reused an existing target when its status was exactly
`'planned'` — wrong the moment Gate A fires (a `scoped`/`generating`/etc. target would have caused
the resolver to attempt creating a duplicate row at the same sequence). Fixed by keying reuse on
**sequence**, not status: any row at `previousReleasedMvp.sequence + 1` whose status isn't
`released`/`superseded` is the target, for its ENTIRE pre-release lifetime. (B) The migration
strategy claimed renaming a colliding Feature's `code` plus an activity log entry was a sufficient
repair — wrong, since a bare code is persisted in far more places than the row itself
(`dependsOn`, Product Owner/Roadmap Analysis artifact JSON, `ApplicationManifestFile.featureIds`,
engineering handoff references). Replaced with a stop-and-report policy: a collision-free project
migrates automatically; any project WITH a collision is excluded from automatic migration and
requires an explicit, transactional, project-specific repair covering every persisted reference
before its own index swap runs. (C) Part 1 still said a committed `Mvp` row is created "at Gate A,"
contradicting Part 2/4/5's own corrected sequencing — rewritten into an explicit three-state model
(skeleton-only → planned review target → Gate-A-approved engineering MVP) that states plainly WHEN
each state's row is created and that Gate A remains the only state-3 transition. Sections revised
this round: **Part 1** (three-state rewrite), **Part 4** (`resolveNextRoadmapTarget` final
sequence-keyed algorithm + idempotency guarantee + required test-case table), **Part 2** (diagram
comment updated to match), **Part 13/14** (migration strategy and roadmap updated to the
stop-and-report policy and the corrected resolver's test requirements).

## Thesis: this is where Builders becomes an AI Product Management capability

Every prior sprint added an AI *role*: Business Analyst, Product Owner, Architects, Engineers, QA.
Each one, so far, has operated on a single generation. Sprint 80 is not "MVP2 planning" — it is the
sprint where Builders stops being a per-generation code factory and starts being **the custodian of
a product across its entire lifecycle**: one vision, realized as a sequence of releases, informed by
real customer feedback, forever. Concretely, that means:

- The Product Owner's `roadmapSkeleton` (Sprint 46B) stops being a static plan written once and
  never revisited — it becomes a living roadmap the Product Owner re-evaluates after every release.
- The Business Analyst's job doesn't end at Requirements — it resumes after every release, in a
  different mode (listening, not deciding).
- "What ships next" becomes an explicit, reasoned, customer-approved decision — never silently
  re-derived, never skipped.

This is the same posture a real product organization has: Engineering builds what Product
approved; Product decides what's next based on what Business heard from customers; nothing skips
a gate. The rest of this document is the concrete architecture for that loop, built entirely out
of mechanisms Sprints 44–79 already established.

---

## Part 0 — Research: what already exists, what's actually missing

This section is load-bearing — every later section either reuses one of these mechanisms or
explicitly says why it can't.

| Concern | Already exists | Gap this sprint closes |
|---|---|---|
| Roadmap of future MVPs | `ProductOwnerDraft.roadmapSkeleton` (`RoadmapSkeletonEntry[]`, `app/lib/projects/prompts/productOwner.ts:42-49`) — id/sequence/theme/targetRelease/estimatedEffort, written once during initial planning | Nothing ever reads/elaborates a skeleton entry into a new `currentMvp` — see below, this is the single largest gap |
| "Plan the next MVP" | Nothing. `ProductOwnerContext.nextMvpSequence` is **hardcoded to `1`** (`productOwnerEngine.ts:82-87,174`) with a comment explicitly deferring this: *"Once cross-MVP planning exists (Sprint 47+), this should be derived from the project's actual persisted MVP roadmap"* | This sprint designs exactly that derivation — from the roadmap, not from scratch |
| MVP status lifecycle | `MvpStatus` (`app/lib/mvp/mvpTypes.ts:30-38`) already extended in Sprint 78 corrective work with `released`/`superseded` and `isValidMvpStatusTransition` (`lifecycleTransitions.ts`); Product Lifecycle Architecture (Sprint 77) additionally specified `provisioned/generated/qa_passed/ready_for_deployment` as **derived, not stored** values | The "outer loop" (Customer Feedback → Roadmap Review → Next MVP) needs modeling — Part 2 below shows it is NOT new `Mvp` states, it's two new **events/artifacts** between `released` and the next MVP's `scoped` |
| Feature model | `Feature`/`featureRepository` (Sprint 78), `moduleSlug` (Sprint 78 corrective + Sprint 79) | Feature codes are today unique only WITHIN an MVP (`builders_features`'s enforced constraint is `(mvp_id, code)`, not project-wide) — cross-MVP Feature identity is not yet project-wide, and `assignFeatureIds` (`productOwnerEngine.ts`) currently seeds its counter/carry-forward from the current MVP's own previous draft, never from the project's committed Feature history. Sprint 80 resolves this by making Feature codes unique at project scope (Part 1's Cross-MVP Feature Identity correction) and sourcing `assignFeatureIds` from every Feature already committed project-wide. |
| Manifest / Resume / Carry-forward | `ApplicationManifest`, `resumeOrchestrator.ts`, `resolveFileCarryForwardPlan` (per-file `featureIds` ownership, Sprint 78 corrective), Backend Module vertical slices (Sprint 79) | None — Part 6 (Incremental Engineering) is a direct, unmodified reuse |
| Product Package | `ProductPackage`/`assemblyRepository.saveProductPackage` — confirmed **still delete + reinsert**, one row per project ever (`assemblyRepository.ts:118-165`); Sprint 77 recommendation #5 ("make it append-only, mirroring Blueprint Resolution") is still unimplemented | Release History (Part 9) needs history; this sprint reuses that already-approved-but-unbuilt recommendation rather than inventing a second one |
| ProjectArtifact | `status: draft/approved/discarded/final/placeholder`, `version`, `mvpId` (Sprint 78 corrective), `getResumableArtifact`/`getApprovedArtifactContent` (`app/lib/projects/artifacts.ts`) | None — the Product Feedback Report and Roadmap Analysis (Parts 3–4) are just two more `ARTIFACT_TYPES` entries flowing through this exact same machinery |
| Per-version diffing | `versionHistory.ts`'s `summarizeVersionChange`/`getRoleChangeLog` (Sprint 36) — added/removed/changed fields between two `ProjectArtifact` versions of the **same role** | This is field-level diffing of one artifact's regenerations, not release-level "what shipped." Release History (Part 9) reuses its `diffListField` primitive but is a different, MVP-scoped concept — not a duplicate |
| Activity History | `ACTIVITY_ICON`/`DEFAULT_ACTIVITY_ICON` (`ProjectHistoryPanel.tsx:28-70`) — free-text `activityType`, gracefully degrades to a default icon for anything unmapped | Confirmed: **none** of Sprint 77 Part 10's thirteen `mvp_*`/`feature_*` activity types have been wired in yet. This sprint's new events reuse that same free-text convention |
| BuildersDB schema | `builders_mvps`, `builders_mvp_approvals` (stage: `'scope' \| 'delivery'`), `builders_features`, `builders_role_outputs`, `builders_product_packages`/`_files`, `builders_application_manifests`/`_files`, `builders_project_activity` | Part 11/12 below is additive only |

**The single most important finding**: the mechanism to plan MVP2 already exists in the prompt
layer — the Product Owner's own system prompt already says *"This is MVP {N}... Prior MVPs already
exist — do not re-plan or contradict what was already approved and delivered; extend it"*
(`prompts/productOwner.ts:236`) — but the **application layer never calls it with N > 1**. Nothing
in this sprint needs to touch that prompt. What's missing is entirely the orchestration around it:
resolving the real next sequence, feeding it the right feedback-informed context, and gating its
output behind a new approval stage before Engineering may act on it.

---

## Part 1 — Product Roadmap (data model)

**Extend, do not replace.** A "Product Roadmap" is not a new entity — it is the existing
`roadmapSkeleton` + the set of `Mvp` rows for a project, read together. Concretely:

```
Product (Project)
  Vision           — ProductOwnerDraft.productVision (unchanged, product-wide, written once)
  Roadmap          — ProductOwnerDraft.roadmapSkeleton (unchanged shape) ⋈ builders_mvps rows
    MVP1 ──┐
    MVP2   ├── one RoadmapSkeletonEntry ⋈ (0 or 1) Mvp row, joined by `sequence`
    MVP3   │
    MVP4 ──┘
```

A roadmap entry has **three possible states** (revised — the original draft's "two states, committed
at Gate A" was wrong for MVP2+; see Part 2's corrected lifecycle and Correction 1 in the prior
review round):

1. **Skeleton-only** — a `RoadmapSkeletonEntry` exists in the latest approved `ProductOwnerDraft`;
   no `Mvp` row exists at all. Matches today's "lightweight, unelaborated future MVP" exactly as
   before.
2. **Planned review target** — an `Mvp` row exists at `status: 'planned'`, created by
   `resolveNextRoadmapTarget` (Part 4) BEFORE the Business Analyst's Product Review or the Product
   Owner's Roadmap Analysis ever run. This row exists specifically so those two artifacts, and the
   Roadmap Review approval that follows them, have something real to attach `mvpId`/`MvpApproval.mvpId`
   to, are resumable across retries, and are addressable in the UI (Part 2's five reasons, restated
   from the prior correction round). **Engineering is explicitly not authorized by this state** —
   nothing about a `planned` row changes what `resolveActiveMvpId` or any engineering role's
   `canGenerate*` gate treats as "active."
3. **Gate-A-approved engineering MVP** — Gate A (`gateAApproval.ts`, completely unchanged) finds
   the SAME row created in state 2 (its existing sequence-lookup-or-create logic already tolerates
   a pre-existing `planned` row — no change was ever needed there), records the `'scope'` approval,
   promotes `Feature` rows via `promoteFeaturesForMvp`, and transitions `planned → scoped`. This is
   the ONLY state transition that unlocks engineering, exactly as MVP1 already works today.

For MVP1, states 1 and 2 both collapse into "the project's very first Gate A" (there is no roadmap
review loop before the first MVP ever ships — Part 3's `canGenerateProductReview` gate itself
requires a released MVP to exist first) — MVP1's `Mvp` row is still created at its own Gate A,
unchanged. **The correction applies to MVP2 and beyond**: for those, state 2's row creation happens
strictly BEFORE Product Review/Roadmap Review, not at Gate A — Gate A only ever performs state 2 → 3
(Feature promotion, `planned → scoped`), never the row's initial creation. No new `MvpStatus` value
and no new table are required for any of this — `'planned'` already exists (Sprint 45) and already
means exactly state 2's description; this correction is entirely about WHEN the existing status
value's row is minted, never about inventing a new one. This mirrors precisely how `Feature` was
promoted out of a draft blob into a first-class row in Sprint 78 — `RoadmapSkeletonEntry` stays the
*proposal* (state 1), `Mvp` is the *review target* the moment it's committed (state 2), and Gate A
remains the sole *engineering-authorizing* transition (state 2 → 3), unchanged.

### Required per-MVP fields, mapped against what already exists

| Sprint 80 asks for | Existing field | Verdict |
|---|---|---|
| objective | `RoadmapSkeletonEntry.theme` / `Mvp.theme` (`mvpTypes.ts:66`) | **Reuse `theme` as the objective.** They are the same concept — a one-line MVP purpose. Do not add a second field that would immediately drift from `theme`. |
| planned Features | `Feature` rows where `mvpId` = this MVP (Sprint 78) | **Reuse as-is.** Already the canonical, queryable source (Sprint 77 §3's own "replaces `GenerationPlanScope.inScopeFeatureIds` entirely" reasoning applies identically here). |
| planned Modules | `Feature.moduleSlug`, grouped (Sprint 78 corrective + Sprint 79's `deriveBackendModulePlans`) | **Reuse as-is, computed, never stored.** A "planned Modules" list for an MVP is simply `distinct(Feature.moduleSlug WHERE mvpId = X)` — exactly the same derivation `BackendModulePlan` already performs. Storing it separately would be the exact "duplicate model" this sprint is told to avoid. |
| dependencies | `ProductOwnerFeature.dependsOn` (Feature-to-Feature, existing) + `EngineeringHandoff.dependencies` (free text, existing) | **Reuse as-is.** Cross-MVP dependency ("MVP3's Feature X depends on MVP2's Feature Y") is already representable: `dependsOn` holds Feature *codes*, which are stable across MVPs (Sprint 78's `(mvpId, code)` promotion never re-mints them). No new field needed — a dependency simply resolves to a Feature owned by an earlier `sequence`. |
| business value | `Mvp.businessPriority` (`mvpTypes.ts:47`, already exists, Sprint 46B) at the MVP level; `ProductOwnerFeature.customerValue` at the Feature level | **Reuse both, unchanged.** |
| estimated effort | `Mvp.estimatedEffort` (`mvpTypes.ts:44,77`, already exists) | **Reuse as-is.** |
| status | `Mvp.status` (`MvpStatus`) | **Reuse as-is — see Part 2.** |

**Net new fields: zero.** Every field Sprint 80 asks for either already exists on `Mvp`/`Feature`
or is a computed projection over data that already exists. This is the single strongest piece of
evidence that Sprint 45–78 built the right primitives — the Roadmap is a **read model**, not a new
write model.

One genuinely new, small addition is warranted: `RoadmapSkeletonEntry` currently has no explicit
link back to a committed `Mvp` row for UI purposes (today it's an implicit join on `sequence`,
which is unique per project and already suffices programmatically — see `mvpRepository.createMvp`'s
own uniqueness contract). No schema change is required for this; it's called out only so the Roadmap
UI (Part 7) doesn't need to invent its own join logic — `sequence` is already unique and sufficient.

### Cross-MVP Feature Identity (correction)

The original draft's dependency row above claimed *"Feature codes are stable across MVPs... no new
field needed."* That is wrong as stated. The only constraint `builders_features` actually enforces
(`supabase/migrations/20260801100000_feature_foundation.sql`) is:

```sql
create unique index if not exists builders_features_mvp_code_unique on builders_features (mvp_id, code);
```

`(mvp_id, code)` uniqueness means `FEAT-001` is unique **within one MVP**, not project-wide. Two
different MVPs in the same project can each mint their own `FEAT-001` today with nothing stopping
it — because `assignFeatureIds` (`productOwnerEngine.ts:245-265`) seeds its `nextCounter` and its
carry-forward name-match only from `previousDraft?.currentMvp?.features` — the CURRENT MVP's own
prior regeneration, never the whole project's committed Feature history. A cross-MVP `dependsOn`
reference (`"FEAT-001"` written by MVP3, meaning "the FEAT-001 that belongs to MVP1") is therefore
**ambiguous today**, not merely undocumented — it could just as easily resolve to MVP2's own
unrelated `FEAT-001`.

**Decision: make Feature codes unique at project scope.** Preferred over the qualified-reference
alternative because it requires zero change to every place a Feature code already flows as a bare
string today — `dependsOn: string[]`, `HandoffFeatureRef.id`, `ApplicationManifestFileDraft.featureIds`,
`RoadmapRecommendation.featureRef` (Part 4) — none of them need to become `{ mvpSequence, code }`
pairs or switch to Feature UUIDs. A bare `"FEAT-001"` becomes unambiguous everywhere it already
appears, with no call-site changes beyond the constraint itself and the ID-assignment fix below.

```sql
-- Replaces builders_features_mvp_code_unique:
drop index if exists builders_features_mvp_code_unique;
create unique index if not exists builders_features_project_code_unique on builders_features (project_id, code);
```

**Required application-layer companion change** (not optional — the constraint alone doesn't fix
the root cause): `assignFeatureIds` must seed `nextCounter` and its name-match carry-forward from
**every Feature already committed for this project** (a new `featureRepository.listFeaturesForProject(projectId)`,
trivial addition — same shape as `listFeaturesForMvp`, filtered by `project_id` instead of `mvp_id`),
not just the current MVP's own previous draft. Concretely: `roadmapAnalysisEngine.ts` (Part 4) calls
`listFeaturesForProject` once, and passes it as `assignFeatureIds`'s carry-forward source. This is
the only way a NEW MVP's freshly-generated features reliably start their counter after
`FEAT-{highest across the whole project}`, not after `FEAT-{highest in this MVP's own prior draft}`
(which, for a brand-new MVP with no prior draft, is empty — an unmodified `assignFeatureIds` would
restart at `FEAT-001` for every new MVP today).

**Migration and backward-compatibility impact.** This is the one schema change in this document
with real risk, so it is called out explicitly rather than folded silently into Part 12.

**Revised policy (Correction B) — renaming the row alone is NOT a sufficient repair.** The prior
round of this document said a colliding row could simply be renamed and the rename logged as
activity. That is wrong: `builders_features.code` is not the only place a Feature code is
persisted. A rename that touches only the row itself silently breaks every OTHER already-persisted
reference to the old code, including at minimum:

- `Feature.dependsOn` / `ProductOwnerFeature.dependsOn` — on sibling Feature rows and inside every
  historical `PRODUCT_OWNER_DRAFT` artifact version that mentioned the old code.
- Every `PRODUCT_OWNER_DRAFT` artifact's `currentMvp.features`/`engineeringHandoff.features` JSON
  content (`HandoffFeatureRef.id`) — historical, immutable-by-convention artifact versions that
  still say the old code.
- Every `ROADMAP_ANALYSIS` artifact's `RoadmapRecommendation.featureRef` (Part 4).
- `ApplicationManifestFile.featureIds` — on every manifest version, past and active, that tagged a
  file with the old code (Sprint 49/78/79).
- `EngineeringHandoff`/backend-generation references derived from any of the above (Sprint 79's
  `BackendModulePlan.featureIds`, computed at generation time from Feature rows, would itself be
  correct once the SOURCE Feature row is fixed — but only if nothing else upstream still points at
  the stale code).
- Any other persisted generation metadata or structured JSON content this document has not
  enumerated — the honest position is that a full enumeration requires a repository-wide audit at
  implementation time, not a claim made here.

**Preferred policy — stop, report, and require an explicit repair before the index swap:**

1. Run the `group by project_id, code having count(*) > 1` collision audit against
   `builders_features` BEFORE the unique index is swapped — this is unchanged from the prior draft.
2. **If there are no collisions** (expected for every real project today, since only one MVP has
   ever been plannable at all — Part 0's core finding): apply the project-wide unique index
   directly. Pure no-op constraint tightening, no further action.
3. **If any collision exists: STOP the automatic migration.** The index swap does not run
   automatically against a project with a detected collision.
4. Produce a **repair report** — not a silent rename — identifying, per project: which MVPs are
   involved, which specific `builders_features` rows collide, and (best-effort, from the structured
   sources enumerated above) every artifact/manifest location that currently references the
   colliding code.
5. **Require an explicit, project-specific, transactional repair** that updates EVERY persisted
   reference enumerated above — not just `builders_features.code` — before the index swap is
   allowed to run for that project. This is a one-project-at-a-time operation, not a bulk migration
   step, precisely because "every persisted reference" is project-specific data, not schema.

**A future repair utility may automate this only if it can, all five, together — not partially:**

- Update every known structured and JSON reference (not only `builders_features.code`).
- Update Manifest ownership (`ApplicationManifestFile.featureIds` on every affected version, active
  or superseded).
- Validate, after the rewrite, that no ambiguous old reference remains anywhere in the enumerated
  surface.
- Run transactionally — a partial repair (row renamed, but a manifest reference left stale) is
  strictly worse than no repair, since it converts a detectable collision into an undetectable
  dangling reference.
- Record an audit event naming exactly what was repaired, for the same reason every other
  correction-of-existing-data in this codebase is logged, never silent.

Until such a utility exists, the correct operational behavior for a detected collision is: **stop,
report, and require a human-reviewed, project-specific repair** — never an automatic rename. Given
Part 0's own finding that no project today can actually have produced a cross-MVP collision yet (MVP
generation beyond MVP1 has never been reachable), the practical likelihood of hitting this path at
all is near zero — but the POLICY must be stated correctly regardless, not hand-waved because the
risk is currently small.

**Nothing downstream changes shape** once repaired. `dependsOn: string[]`, `featureIds: string[]`,
`HandoffFeatureRef`, `RoadmapRecommendation.featureRef` all stay bare Feature-code strings — this
correction fixes what the string is GUARANTEED to mean, not its type.

---

## Part 2 — MVP Lifecycle (reconciled)

Sprint 77 already extended `MvpStatus` with terminal/deployment states; Sprint 80's own example
(`Planning → Approved → Engineering → QA → Released → Customer Feedback → Roadmap Review → Next
MVP`) is the SAME chain, described at a coarser grain, with two new stages appended at the end.
**These two new stages are not `Mvp.status` values.** Extending `MvpStatus` further would
recreate exactly the "second parallel state machine" problem `lifecycleTransitions.ts`'s own
header comment (Sprint 78) already rejected once for `Mvp`/`Feature`. Instead:

```
planned → scoped → generating → ready_for_review → approved
   → provisioned → generated → qa_passed → ready_for_deployment → released → superseded
                                                        (Sprint 77/78, UNCHANGED)

MVP N released ──┐
                  │
                  ├─→ resolveLatestReleasedMvp(projectId)             (Part 3/4 — MVP N, the SOURCE)
                  │
                  ├─→ resolveNextRoadmapTarget(projectId)              (Part 4 — idempotent by SEQUENCE, any pre-release status)
                  │      creates MVP N+1's `Mvp` row (status `planned`) the FIRST time this runs;
                  │      every later call reuses that SAME row through however far it has
                  │      progressed (planned/scoped/generating/.../ready_for_deployment) —
                  │      never an engineering-authorized state on its own
                  │
                  ├─→ Product Feedback Report                          (Business Analyst — Part 3)
                  │      artifact.mvpId = MVP N+1 (target) — content.sourceMvpId = MVP N (source)
                  │
                  ├─→ Roadmap Analysis                                  (Product Owner — Part 4)
                  │      artifact.mvpId = MVP N+1 (target) — content.sourceMvpId = MVP N (source)
                  │
                  ├─→ Roadmap Review approval                            (Customer — Part 5)
                  │      MvpApproval { mvpId: MVP N+1.id, stage: 'roadmap_review', decision }
                  │      — attaches to the ALREADY-EXISTING planned row above, never a dangling FK
                  │
                  ↓ (only on 'approved')
              Gate A — UNCHANGED (`gateAApproval.ts`)
                  finds/reuses the SAME MVP N+1 row (its existing sequence-lookup-or-create
                  already tolerates a pre-existing 'planned' row), records `stage: 'scope'`,
                  promotes Features
                  ↓
              MVP N+1.status: planned → scoped        (Gate A remains the ONLY engineering boundary)
```

**Why the planned row must exist before Roadmap Review, not after.** Creating a lightweight
`planned` `Mvp` row is not an engineering authorization — `Gate A remains the engineering boundary`
exactly as before; `planned` today already means *"exists only in the Product Owner's
`roadmapSkeleton`, not yet an `Mvp` row"* per Sprint 77 §2's own table, and this correction simply
moves the moment that row is MINTED slightly earlier than Gate A (from "at Gate A" to "before the
review that precedes Gate A") without changing what the status VALUE means or what unlocks
engineering. Five concrete reasons this earlier row is required, not merely convenient:

1. **Artifact association.** `ProjectArtifact.mvpId` (Sprint 78 corrective) is how the Product
   Feedback Report and Roadmap Analysis declare which MVP they're FOR. Without a real row, both
   artifacts would have to carry `mvpId: undefined` (losing traceability entirely, indistinguishable
   from a legacy/no-MVP artifact) or be retroactively re-tagged once Gate A finally creates the row
   — silent backfilling this codebase's own conventions explicitly reject (see e.g. Sprint 78's own
   "never silently drift out of sync" language, reused verbatim in Part 8 below).
2. **Approvals.** `MvpApproval.mvpId` (`mvpTypes.ts:121`) is a required field, not optional — there
   is structurally no way to record a `'roadmap_review'` decision without a real row to attach it
   to. This was the original draft's actual bug.
3. **Audit history.** Activity log entries (`mvp_started` and friends, Sprint 77 Part 10) and every
   `ProjectArtifact` version's history need one stable `mvp_id` to group under from the FIRST
   artifact of this MVP's lifecycle onward, not from Gate A onward — otherwise the Product Review →
   Roadmap Analysis conversation that led to a "changes requested" and a second Roadmap Analysis
   round would have no shared identity to group its own history under.
4. **Retries.** Roadmap Review is explicitly allowed to be `changes_requested` and re-run (same
   append-only `MvpApproval` philosophy MVP1's Gate A already relies on) — a stable row across
   however many review iterations it takes is what makes "resume where you left off" mean anything;
   without it, each retry would be indistinguishable from planning a brand-new MVP.
5. **UI identity.** The Roadmap UI (Part 7) needs a concrete, stable `id` to route/link to the
   moment a Roadmap Review begins — a skeleton-only `RoadmapSkeletonEntry` has only a `sequence`,
   which is not enough for a multi-step review flow (draft feedback → draft analysis → review →
   approve, potentially spanning multiple sessions) to maintain a consistent deep-link across it.

This changes nothing about WHEN engineering may begin — that is still, and only, "Gate A has
recorded a `'scope'` approval," completely unchanged from Sprint 78. It only changes when the ROW
that Gate A eventually operates on first comes into existence.

- `resolveActiveMvpId` (`mvpRepository.ts:214`, "highest-sequence MVP past `planned` and not
  `superseded`") needs **zero changes** — a `planned` row is, by that function's own existing
  filter, correctly excluded from "active" (it hasn't passed Gate A yet), so its presence during
  Roadmap Review does not change what engineering treats as the current MVP. See Part 3's
  correction for why a SEPARATE resolver is still needed for a different question.
- `isValidMvpStatusTransition`/`isValidFeatureStatusTransition` need **zero changes** — `planned`
  remains a valid starting state, `planned → scoped` remains the only forward transition out of it.
- The Roadmap Review's own approve/reject decision fits the *existing* `MvpApproval` shape
  perfectly (see Part 5) rather than requiring a new decision table — it simply now has a real
  `mvpId` to attach to from the moment it's first recorded.

---

## Part 3 — Business Analyst: Product Review workflow

**The one hard rule this sprint states explicitly**: after MVP1 releases, the Business Analyst
must never ask "what should we build next" — that is the Product Owner's job, not this role's.
This is enforced structurally, not by prompt discipline alone:

- **New artifact type**: `ARTIFACT_TYPES.PRODUCT_FEEDBACK_REPORT` (`'product-feedback-report'`),
  added to `app/lib/projects/artifacts.ts` alongside the existing 9 (`requirements-draft` through
  `devops-draft`). Reuses the exact same `ProjectArtifact`/`createArtifact`/`getResumableArtifact`
  machinery every other role already uses — no new persistence primitive.
- **New draft shape**, `ProductFeedbackReport`, sibling to `RequirementsDraft`
  (`app/lib/projects/prompts/productFeedback.ts`, new file, following `prompts/requirements.ts`'s
  exact `*_FIELDS` + system/user-prompt-builder pattern):

```ts
interface ProductFeedbackReport {
  /**
   * Correction 3 — the MVP whose real-world release this report is ABOUT (the one customers have
   * actually been using). Resolved via `resolveLatestReleasedMvp`, NEVER `resolveActiveMvpId`
   * (see that resolver's own comment for why the two answer different questions). Persisted
   * inside this draft's own JSON `content` — no new column; `ProjectArtifact.mvpId` itself is
   * used for `targetMvpId` instead (see below), so a second FK-shaped field here would either
   * duplicate that column's meaning or overload it into meaning two different things at once.
   */
  sourceMvpId: string;

  /**
   * The planned MVP whose roadmap this feedback may inform — identical to this artifact's own
   * `ProjectArtifact.mvpId`. Kept as an explicit field (denormalized) for the same reason
   * `ApplicationManifestDraft.mvpCode` denormalizes onto the manifest despite `mvpId` already
   * being the FK of record (manifestTypes.ts) — so a reader of the raw JSON content never has to
   * cross-reference the artifact row to understand what this report is for.
   */
  targetMvpId: string;

  whatWorkedWell: string[];
  problemsExperienced: string[];
  unexpectedBusinessNeeds: string[];
  usabilityIssues: string[];
  performanceConcerns: string[];
  changedBusinessPriorities: string[];
  customerSuggestions: string[];
  requestedImprovements: string[];
  bugReports: string[];

  // Shared collaboration fields — same as every other draft (collaborationContext.ts, unchanged).
  engineeringNotes?: string;
  aiDecisions?: AIDecision[];
}
```

This is a 1:1 structural mapping of the sprint's own question list plus the two traceability fields
Correction 3 requires — no invented recommendation/decision fields **at all** (that's the whole
point: this role produces evidence, not decisions). The system prompt (mirroring
`BUSINESS_ANALYST_SYSTEM_PROMPT`'s existing framing) states explicitly: *"You are conducting a
Product Review of an ALREADY-RELEASED MVP. You gather and organize feedback. You NEVER recommend
what to build next, remove, or defer — that is the Product Owner's decision, made from your
report."*

- **New engine**: `productReviewEngine.ts` (sibling to `businessAnalystEngine.ts`, same
  orchestration-only shape: `canGenerateProductReview`, `buildProductReviewContext`,
  `buildProductReviewPrompt`, `parseDraft`, `createDraftArtifact`).
- **`canGenerateProductReview` — corrected gate (Correction 3).** The original draft gated on "the
  active MVP's status is `released`," using `resolveActiveMvpId`. That resolver's entire purpose
  (`mvpRepository.ts:214`'s own comment) is identifying the MVP **engineering should currently
  treat as in-flight** — it can just as easily resolve to an MVP that is `scoped`/`generating`
  (mid-engineering on MVP N+1 already, if a review cycle somehow ran ahead of itself) as to the one
  that's actually `released`. A Product Review must always be about a REAL, SHIPPED release, so the
  gate is instead: `const source = await mvpRepository.resolveLatestReleasedMvp(project.id); return
  source !== undefined;` — a Product Review literally cannot be started before
  `resolveLatestReleasedMvp` finds something.
- **`buildProductReviewContext`** resolves BOTH MVPs up front — `sourceMvp =
  resolveLatestReleasedMvp(project.id)` and `targetMvp = resolveNextRoadmapTarget(project.id).targetMvp`
  (Part 4) — and threads `sourceMvp.id`/`targetMvp.id` straight onto the parsed draft's
  `sourceMvpId`/`targetMvpId` fields (the AI is never asked to fill these in itself, same
  "identity is assigned by the application, never the model" discipline `formatMvpId`/`formatFeatureId`
  already established in Sprint 46C). `createDraftArtifact` sets `ProjectArtifact.mvpId =
  targetMvp.id`.
- **Context** it's built from: the just-released MVP's `Feature` rows + acceptance criteria
  (what was promised), plus — critically — whatever real usage signal the surrounding product
  provides today (support tickets, session data, etc. are explicitly **out of scope for this
  sprint's design**: this document specifies the workflow and artifact shape; wiring a live
  feedback channel is future work, Part 13). Until such a channel exists, this workflow runs the
  same way every other role does today — a human fills in what they know via the existing draft
  panel free-text fields, and the AI organizes/elaborates it.
- **Approval**: flows through the same `useDraftPanel` generate/approve/discard state machine
  every other role (except Product Owner) already uses — `handleApprove()` just flips artifact
  status to `'approved'`, unchanged. No MVP-level approval decision here — this is evidence-gathering,
  not a gate.

**Why not extend `RequirementsDraft` instead of a new type**: `RequirementsDraft` describes what
the product SHOULD be; `ProductFeedbackReport` describes what actually happened. Conflating them
would mean every subsequent MVP's requirements re-derivation risks silently absorbing stale
feedback fields, and would break `businessAnalystEngine.canGenerateRequirements`'s existing
single-purpose contract. A new, narrow type is the smaller change and matches this codebase's
established "one artifact type per distinct question" convention (10 roles, 10 types, no role's
draft ever answers two different questions).

---

## Part 4 — Product Owner: Roadmap Review workflow

Input is exactly the sprint brief's own diagram — **existing Roadmap + Product Feedback Report →
Roadmap Analysis** — and both halves of that input already exist as data Builders has:

- Existing Roadmap = `roadmapSkeleton` (still on the MOST RECENT approved `PRODUCT_OWNER_DRAFT`
  artifact — unchanged read path, `getApprovedArtifactContent<ProductOwnerDraft>`) + the released
  MVP's own `currentMvp` (what was actually built, for comparison against what was *planned* for
  the next one).
- Product Feedback Report = the artifact from Part 3.

### New artifact: Roadmap Analysis

`ARTIFACT_TYPES.ROADMAP_ANALYSIS` (`'roadmap-analysis'`), new draft shape:

```ts
interface RoadmapAnalysisDraft {
  targetMvpId: string;                  // == this artifact's own ProjectArtifact.mvpId — denormalized for the same reason ProductFeedbackReport.targetMvpId is (Part 3)
  sourceMvpId: string;                  // carried from the Product Feedback Report this analysis was built from
  sourceFeedbackArtifactId?: string;    // which Product Feedback Report artifact/version grounded this analysis — traceability, not re-derivable from mvpId alone once more than one exists
  targetMvpSequence: number;            // which roadmapSkeleton entry this analysis elaborates
  recommendations: RoadmapRecommendation[];
  updatedMvpPlan: CurrentMvpPlan;        // the SAME shape currentMvp already has — reused, not reinvented
  engineeringNotes?: string;
  aiDecisions?: AIDecision[];
}

interface RoadmapRecommendation {
  kind: 'add' | 'remove' | 'defer' | 'reprioritize' | 'unchanged';
  featureRef: string;                  // a Feature code — safe as a bare, project-wide-unique string once the Part 1 Cross-MVP Feature Identity correction lands; a proposed name when 'add'
  fromMvpSequence?: number;             // for 'add'/'defer': which MVP it's moving from/to
  toMvpSequence?: number;
  breakingChange?: boolean;             // Part 8 — decided here, at Roadmap Review time, never inferred later
  breakingChangeNote?: string;
  reasoning: string;                    // MANDATORY — every recommendation must explain WHY (the sprint's own explicit requirement)
}
```

`updatedMvpPlan` reuses `CurrentMvpPlan` **verbatim** (`prompts/productOwner.ts:114-133`) — this is
the load-bearing reuse decision of this whole document. The Product Owner does not get a second,
parallel "revised MVP" shape; a Roadmap Analysis's job is to produce the SAME
`sequence/features/acceptanceCriteria/risks/.../engineeringHandoff` shape the normal Product Owner
draft already produces for `currentMvp`, just reached via a different input path (roadmap +
feedback, instead of fresh requirements) and wrapped with the `recommendations` explaining what
changed and why.

### `resolveNextRoadmapTarget` — the corrected, idempotent resolver (Correction 2, revised again)

**Second-round correction.** The immediately-prior fix reused an existing target only when its
status was exactly `'planned'`. That is still wrong: the moment Gate A fires and the target moves
to `'scoped'` (or any later pre-release status — `'generating'`, `'ready_for_review'`, `'approved'`,
`'provisioned'`, `'generated'`, `'qa_passed'`, `'ready_for_deployment'`, or `'blocked'`), the
`status === 'planned'` filter no longer matches it, `resolveLatestReleasedMvp` still correctly
returns the PREVIOUS MVP (the target hasn't released yet), and the resolver would fall through to
`createNextRoadmapTargetRow` — attempting to INSERT a second row at the exact same `sequence`,
which `unique (project_id, sequence)` (already enforced, `20260720100000_mvp_foundation.sql`) would
reject. The resolver must key on **sequence**, not status, for the reuse check:

```ts
export interface RoadmapTargetResolution {
  targetMvp: Mvp;                        // the Mvp row at nextSequence — any pre-release status, or freshly created at 'planned'
  roadmapEntry: RoadmapSkeletonEntry;     // the skeleton entry this target elaborates (theme/targetRelease/estimatedEffort)
  previousReleasedMvp: Mvp | undefined;   // resolveLatestReleasedMvp's result at resolution time — see Part 3's correction for why this is a SEPARATE resolver
}

async function resolveNextRoadmapTarget(projectId: string): Promise<RoadmapTargetResolution | undefined> {
  const previousReleasedMvp = await mvpRepository.resolveLatestReleasedMvp(projectId);

  if (!previousReleasedMvp) {
    // No MVP has ever released — this resolver's precondition (Part 3's canGenerateProductReview
    // gate) already prevents it from being called in that case; returning undefined here keeps it
    // a safe no-throw no-op rather than trusting every future caller to check first.
    return undefined;
  }

  // The exact next sequence, always — this is the ONLY sequence this resolver will ever operate
  // on for a given `previousReleasedMvp`. It is never recomputed as "highest committed + 1" (the
  // original bug) and never advanced merely because a row already exists at it (this round's bug).
  const nextSequence = previousReleasedMvp.sequence + 1;

  const allMvps = await mvpRepository.listMvpsForProject(projectId);

  // Step 1 — REUSE FIRST, BY SEQUENCE, REGARDLESS OF STATUS. `superseded`/`released` are excluded
  // deliberately: a row at nextSequence can only be one of those if it has ALREADY completed its
  // own outer loop and become the new `previousReleasedMvp` — a state that, by definition, this
  // very call's own `resolveLatestReleasedMvp` result would already reflect. In every other
  // pre-release status (planned/scoped/generating/ready_for_review/approved/provisioned/
  // generated/qa_passed/ready_for_deployment/blocked), the row at nextSequence IS the target,
  // full stop — no new row is ever created while it exists.
  const existingTarget = allMvps.find(
    (mvp) => mvp.sequence === nextSequence && mvp.status !== 'released' && mvp.status !== 'superseded',
  );

  const targetMvp = existingTarget ?? (await createNextRoadmapTargetRow(projectId, nextSequence));

  if (!targetMvp) {
    return undefined; // no roadmapSkeleton entry exists yet for nextSequence — see below
  }

  const roadmapSkeleton = await getApprovedRoadmapSkeleton(projectId); // reads the latest approved PRODUCT_OWNER_DRAFT, unchanged read path
  const roadmapEntry = roadmapSkeleton.find((entry) => entry.sequence === nextSequence)!;

  return { targetMvp, roadmapEntry, previousReleasedMvp };
}

// Step 2 — only reached when NO row exists at nextSequence AT ALL (any status).
async function createNextRoadmapTargetRow(projectId: string, nextSequence: number): Promise<Mvp | undefined> {
  const roadmapSkeleton = await getApprovedRoadmapSkeleton(projectId);
  const roadmapEntry = roadmapSkeleton.find((entry) => entry.sequence === nextSequence);

  if (!roadmapEntry) {
    return undefined; // the Product Owner hasn't sketched a roadmap entry this far yet — surfaced to the UI as "no next MVP planned," not an error
  }

  // mvpRepository.createMvp already exists, unmodified — status defaults to 'planned' when
  // omitted (mvpRepository.ts:154), exactly the row this correction needs. `unique(project_id,
  // sequence)` (already enforced) is the DB-level backstop that makes this call safe even under a
  // hypothetical race — a concurrent second create at the same sequence fails at the constraint,
  // never silently duplicates the roadmap target.
  const created = await mvpRepository.createMvp({
    projectId,
    sequence: nextSequence,
    code: roadmapEntry.id,
    theme: roadmapEntry.theme,
    targetRelease: roadmapEntry.targetRelease,
    estimatedEffort: roadmapEntry.estimatedEffort,
  });

  return created.ok ? created.mvp : undefined;
}
```

**Why status must NOT gate the reuse check.** The whole point of `resolveNextRoadmapTarget` is to
answer one question — "which `Mvp` row is the immediate successor to the currently-released one" —
and that answer does not change as engineering progresses through it. `sequence` (unique per
project, immutable once assigned) is the only field that correctly identifies "the same target
MVP" across its entire pre-release lifetime; `status` is a property OF that target, not part of its
identity. Gating reuse on a specific status (this round's bug) or on "is it committed at all"
(the original bug) both confuse a transient property with identity.

**Idempotency, stated as a guarantee (final form)**: for a fixed `previousReleasedMvp` (i.e., for
as long as MVP N remains the latest released MVP), `resolveNextRoadmapTarget(projectId)` always
resolves to `nextSequence = previousReleasedMvp.sequence + 1`, and always returns THE SAME
`targetMvp.id` for that sequence regardless of how many times it is called and regardless of what
pre-release status that row has reached in the meantime — because step 1's reuse check is keyed on
`sequence`, never on `status`. The target identity changes ONLY when `targetMvp` itself reaches
`released` — at that exact moment `resolveLatestReleasedMvp` starts returning `targetMvp` instead of
`previousReleasedMvp`, `nextSequence` becomes `targetMvp.sequence + 1`, and the very next call
correctly resolves (or creates) the roadmap target after it. **This satisfies every one of the
correction's requirements**: reuse-first is keyed on sequence, not status (fixing both the original
`highestCommitted + 1` bug and the intermediate `status === 'planned'`-only bug); row creation
(`createNextRoadmapTargetRow`) is reached only when no row exists at `nextSequence` at all; repeated
calls return the same target by construction across the row's ENTIRE pre-release lifetime; and a new
target sequence becomes reachable only once the current one has itself released.

**Test cases required (Future Implementation Roadmap, Phase 0.2)** — repeated resolution of
`resolveNextRoadmapTarget` against a project where MVP1 is `released` and MVP2 exists at each of the
following statuses must return the IDENTICAL `targetMvp.id` for cases 1–4, and only case 5 may
advance to resolving/creating MVP3:

| # | MVP2's status | Expected `resolveNextRoadmapTarget` result |
|---|---|---|
| 1 | `planned` | Returns the existing MVP2 row unchanged — no new row created. |
| 2 | `scoped` | Returns the SAME MVP2 row (this is the case the intermediate, `'planned'`-only fix got wrong). |
| 3 | `generating` | Returns the SAME MVP2 row. |
| 4 | `approved` | Returns the SAME MVP2 row — still `previousReleasedMvp = MVP1`, since MVP2 hasn't released yet. |
| 5 | `released` | `resolveLatestReleasedMvp` now returns MVP2; `nextSequence` becomes `3`; the call may resolve an existing MVP3 row or create one if the roadmap has a sequence-3 entry — never MVP2 again. |

A sixth case worth its own test: MVP2 at `ready_for_review`/`provisioned`/`generated`/`qa_passed`/
`ready_for_deployment`/`blocked` — any one of them is sufficient to prove the resolver's `status
!== 'released' && status !== 'superseded'` check, rather than an exhaustive enumeration, is what's
actually being relied on.

This is also the function that "unlocks" MVP2+ planning — the Roadmap Analysis engine calls it
once, gets back `targetMvp`/`roadmapEntry`/`previousReleasedMvp` together, and has everything it
needs (Part 3's `sourceMvpId` = `previousReleasedMvp.id`, `targetMvpId` = `targetMvp.id`,
`targetMvpSequence` = `targetMvp.sequence`) without a second round-trip.

**Engine**: `roadmapAnalysisEngine.ts` (new, same orchestration-only shape). Its prompt reuses
`PRODUCT_OWNER_SYSTEM_PROMPT`'s prioritization discipline (dependency graph, value density,
MoSCoW) verbatim via a shared prompt fragment, with one addition: an explicit instruction that
every deviation from the existing `roadmapSkeleton` entry for this sequence must be logged as a
`RoadmapRecommendation` with `reasoning` filled in — never a silent rewrite.

---

## Part 5 — Customer Approval: Roadmap Review stage

This reuses `MvpApproval` (`mvpTypes.ts:110-118,132-139`) — **not** a new decision table. Today
`MvpApprovalStage` is `'scope' | 'delivery'` (Gate A / Gate B). This sprint adds one value:

```ts
export type MvpApprovalStage = 'scope' | 'delivery' | 'roadmap_review';
```

Sequencing for MVP2+ becomes three approvals instead of MVP1's two, all against the SAME table,
same `MvpApprovalDecision` (`'approved' | 'changes_requested'`), same append-only philosophy
(`MvpApproval`'s own comment: *"one row per decision, not upsert"*).

**Corrected sequencing (Correction 1)** — the MVP2 `builders_mvps` row already exists (created by
`resolveNextRoadmapTarget`, Part 4, BEFORE Product Feedback Report or Roadmap Analysis even ran) —
so `MvpApproval.mvpId` has a real row to attach to from the very first decision, never a dangling
reference:

```
resolveNextRoadmapTarget (Part 4) — MVP2 row already exists, status 'planned'
        ↓
Product Feedback Report (Part 3) drafted and approved — artifact.mvpId = MVP2.id
        ↓
Roadmap Analysis (Part 4) drafted — artifact.mvpId = MVP2.id
        ↓
Customer reviews: Original MVP2 (roadmapSkeleton entry) → Recommended Changes → Reasoning → Updated MVP2 (updatedMvpPlan)
        ↓
MvpApproval { mvpId: MVP2.id, stage: 'roadmap_review', decision }   ← attaches to the row created above
        ↓  (only on 'approved' — a 'changes_requested' decision loops back to a revised Roadmap Analysis against the SAME MVP2 row, never a new one)
Gate A, UNCHANGED (`gateAApproval.ts`): its existing resolve-or-create-by-`sequence` lookup
(`listMvpsForProject` + `sequence` match, already idempotent since Sprint 78) FINDS the
already-existing MVP2 row rather than creating a new one — no change to Gate A's own logic was
needed, it already tolerated a pre-existing row. Records `stage: 'scope'` approval, promotes
`updatedMvpPlan.features` into first-class `Feature` rows via `promoteFeaturesForMvp` — the EXACT
SAME function MVP1 already calls, with EXACT SAME idempotency guarantees (upsert-by-`(mvpId,
code)` for matching within this MVP; project-wide `(projectId, code)` uniqueness, Part 1's
correction, is what makes `code` itself safe to trust as unambiguous once promoted)
        ↓
Mvp.status: (the SAME row throughout this entire flow) 'planned' → 'scoped'
```

The Roadmap Review approval is deliberately a **precondition check gating whether Gate A may even
be invoked** for this sequence — not a merge into Gate A itself. This keeps `gateAApproval.ts`'s
existing, already-tested transactional orchestration (Sprint 78 corrective) completely untouched;
the new precondition is one extra guard clause at the call site
(`ProductOwnerDraftPanel.tsx`/a new `RoadmapReviewPanel.tsx`): *"has a `roadmap_review` approval
been recorded for this sequence? If not, Approve Roadmap (Gate A) is disabled."*

**"Only after approval may engineering begin"** is therefore enforced exactly the way Gate A
already enforces "only after Gate A may engineering begin" today — `resolveActiveMvpId` never
returns an MVP whose status hasn't passed `scoped`, and no engineering role's `canGenerate*` ever
resolves scope for an MVP that isn't active. No new enforcement mechanism needed.

---

## Part 6 — Incremental Engineering (unchanged reuse, explicitly confirmed)

This is the one section of this document where the honest answer is **"nothing new is required."**
Once MVP2's `Feature` rows exist (Part 5) and Gate A has advanced `Mvp.status`:

- `resolveActiveMvpId` now resolves to MVP2.
- `resolveActiveMvpFeatures`/`featureRepository.listFeaturesForMvp` now return MVP2's Features —
  some under brand-new `moduleSlug`s (a new module, e.g. Billing), some under an EXISTING
  `moduleSlug` an earlier MVP already used (e.g. a new Feature added to Appointments).
- `deriveBackendModulePlans` (Sprint 79) already accumulates featureIds correctly per module —
  this was built and tested in Sprint 79 Phase 1 explicitly anticipating this exact case (its own
  test suite already covers "a later MVP's new Feature under the SAME module").
- `resolveFileCarryForwardPlan` (Sprint 78 corrective) already carries forward every file whose
  owning `featureIds` are unchanged and regenerates only files whose ownership changed — this is
  the literal mechanism `"Released MVP1 → Approved MVP2 → only the delta should be generated"`
  requires, already built, already tested against exactly this Appointments/Billing scenario in
  `sprint79Validation.spec.ts`.
- `crossMvpTransition`/`previousMvpId` (`resumeOrchestrator.ts`, Sprint 48) already exist
  specifically to let activity logging narrate "this is MVP2 extending MVP1" — already wired into
  `createPlanReadyHandler` (`useCodeGeneration.ts`).

**The only genuinely new wiring**: `Mvp.status` progressing through `provisioned → generated →
qa_passed → ready_for_deployment → released` for MVP2 needs the same activity-logging /
QA-regression-vs-new-feature distinction Sprint 77 Part 4 already specified (regression tests
against Features from earlier MVPs, new tests only for this MVP's Features) — this was already
architected in Sprint 77 and remains unimplemented pipeline work, tracked there, not duplicated
here.

---

## Part 7 — Product Roadmap UI (architecture only, no implementation)

```
┌─ Dental Clinic — Roadmap ──────────────────────────────────────────┐
│                                                                      │
│  ✓ MVP1 — Appointments              Released  v1.0   [View]        │
│  ● MVP2 — Billing                   Roadmap Review    [Review]     │
│  ○ MVP3 — Inventory                 Planned (skeleton only)        │
│  ○ MVP4 — Reporting                 Future (skeleton only)         │
│                                                                      │
└──────────────────────────────────────────────────────────────────┘
```

- **Data source**: one read — `mvpRepository.listMvpsForProject` (committed MVPs) left-outer-joined
  in memory against the latest approved `ProductOwnerDraft.roadmapSkeleton` (skeleton-only future
  MVPs) by `sequence`. No new query primitive; this is the same "join two already-fetched lists in
  the component" pattern `ProjectManagerPanel.tsx` already uses for readiness computation.
- **Status badge** maps `Mvp.status` (committed) or "skeleton only" (uncommitted) to an icon —
  same `Record<Status, Label>` pattern `GenerationDashboard.tsx`'s `CATEGORY_LABELS`/`STATUS_LABELS`
  already establish (Sprint 79 added `backend` to exactly this kind of map without redesigning it).
- **Selecting an MVP** shows, per the sprint's own list — every one of these is a read against data
  that already exists, nothing computed net-new:
  - objective → `Mvp.theme`
  - Features → `featureRepository.listFeaturesForMvp`
  - Modules → `distinct(Feature.moduleSlug)` (Part 1)
  - dependencies → `Feature.dependsOn` resolved against sibling Features (Part 1)
  - approvals → `mvpRepository.listMvpApprovals` (already exists, now returns 3 stages instead of 2
    for MVP2+)
  - release history → Part 9
  - feedback summary → the `ProductFeedbackReport` artifact that preceded this MVP's Roadmap
    Analysis (Part 3), read via the same `getApprovedArtifactContent` every other artifact preview
    already uses.
- **The Roadmap Review moment itself** (Part 5's "Original → Recommended Changes → Reasoning →
  Updated → Approve") is a new panel, `RoadmapReviewPanel.tsx`, sibling to
  `ProductOwnerDraftPanel.tsx` and reusing its exact preview-card visual language (badges,
  MoSCoW/severity color maps) — rendering `RoadmapAnalysisDraft.recommendations` as a diff list
  (one row per recommendation, `kind` badge + `reasoning`) above the existing MVP-plan preview
  (which `ProductOwnerDraftPanel.tsx` already knows how to render, since `updatedMvpPlan` is the
  same `CurrentMvpPlan` shape) — no new preview-rendering logic, only a new diff header bolted onto
  the existing one.

---

## Part 8 — Release History

**Design decision: mostly derived, with a small extension to the existing Product Package model for
the genuinely new release facts.** No new table — see below. Re-reading the sprint's own required
fields against what already exists:

| Required field | Source |
|---|---|
| Version | `Mvp.targetRelease` (already exists) |
| Release Date | `Mvp.approvedAt` (Gate B) — or, once `released` fires as a real event (Part 6), that transition's timestamp |
| Features Added | `Feature` rows with `mvpId` = this MVP, `status = 'deployed'` — a plain query, not stored twice |
| Features Deferred | `RoadmapRecommendation`s with `kind: 'defer'` from the Roadmap Analysis that produced this MVP (Part 4) — already persisted on that artifact, read back, not duplicated |
| Breaking Changes | **Genuinely new** — nothing today records this. See below. |
| Database Changes | Sprint 77 recommendation #6's `SchemaDelta` (still unbuilt — tracked there, not here) rendered as markdown, exactly as Sprint 77 Part 9 already specified |
| Deployment | The `ApplicationManifest`'s delta file list for this MVP (`crossMvpTransition`, already exists) |
| Customer Approval | `mvpRepository.listMvpApprovals` filtered to this MVP (already exists) |
| QA Summary | The QA Draft artifact approved against this MVP (`ProjectArtifact.mvpId`, Sprint 78 corrective) |

Almost everything is a join, not a new fact. The two genuinely new facts are: (1) **Breaking
Changes** — nothing in this codebase today classifies a change as breaking (this is new judgment,
not new plumbing: it belongs on `RoadmapRecommendation`/the Roadmap Analysis as an optional
`breakingChange: boolean` + `breakingChangeNote?: string` per recommendation, decided by the
Product Owner at Roadmap Review time, not invented later); and (2) **a stable snapshot moment** —
because every other field above is computed by joining live tables, a Release record needs to
pin a `released_at` timestamp and a rendered narrative (Release Notes, per Sprint 77 Part 9's
already-specified rule-based generation — no AI call, same pattern as `buildProductSummaryMarkdown`)
so the history page doesn't have to re-derive it from possibly-since-changed live data every time
it's viewed.

**Recommendation: extend Product Package's already-approved-but-unbuilt append-only redesign**
(Sprint 77 recommendation #5) to BE the Release History anchor, rather than inventing a second,
parallel history table:

```sql
-- Additive to the (not-yet-implemented) append-only ProductPackage redesign:
alter table builders_product_packages add column if not exists mvp_id uuid references builders_mvps(id);
alter table builders_product_packages add column if not exists package_version int;
alter table builders_product_packages add column if not exists released_at timestamptz;
alter table builders_product_packages add column if not exists release_notes text;      -- rule-based markdown, Sprint 77 Part 9
alter table builders_product_packages add column if not exists breaking_changes text[]; -- from RoadmapRecommendation.breakingChangeNote
```

This is the smallest correct model: `ProductPackage` already IS "everything about this product's
current package" (Sprint 37); making it append-only and MVP-tagged (already recommended, twice,
by Sprint 77 and Sprint 78's own roadmaps) makes each historical row literally BE one release's
record, with every other field (Features/QA/Deployment/Approval) computed on read from the tables
above rather than copied into it — "complete traceability falls out for free... nothing is copied,
nothing can drift out of sync with its source," to reuse Sprint 77 Part 9's own words verbatim,
since it already reached this exact conclusion for the general case; Sprint 80 is simply the first
concrete consumer that needs it built.

### Product Package clarification — requires implementation-time verification, not implemented here

The append-only recommendation above is a DIRECTION, carried forward from Sprint 77/78 — it is
explicitly **not implemented, and not fully specified at the storage-engineering level, by this
architecture document**. Before it is built, the implementing sprint must verify, against the
actual current `builders_product_packages`/`builders_product_package_files` schema and every
existing caller, all of the following (none of which this document resolves):

- **Existing unique constraints.** `saveProductPackage`'s current delete-then-insert
  (`assemblyRepository.ts:118-165`) implies today's schema assumes at most one row per
  `project_id` — confirm whether a `unique(project_id)`-shaped constraint actually exists at the DB
  level (not just enforced by application logic) and must be relaxed to `unique(project_id,
  package_version)` instead.
- **Package-files foreign keys.** `builders_product_package_files` presumably references
  `builders_product_packages.id` with `on delete cascade` (matching this codebase's universal FK
  convention) — confirm the cascade still does the right thing once a project has MANY package
  rows instead of one, i.e. deleting one historical package must never cascade-delete a DIFFERENT
  version's files.
- **Latest-package selection.** Every current caller of `getProductPackage(projectId)` expects
  exactly one result. Once multiple rows exist, "latest" must be unambiguous (highest
  `package_version`, or `released_at is null` for an in-progress assembly vs. `released_at`
  descending for released ones) — define and test this BEFORE changing the write path, not after.
- **Version concurrency.** Two near-simultaneous assembly runs for the same project must not race
  to insert the same `package_version` — needs either a DB-level serial/sequence per project or an
  explicit read-then-insert-with-retry discipline, decided at implementation time against real
  concurrency characteristics, not assumed here.
- **Idempotent assembly.** Re-running assembly with no actual content change (the equivalent of
  `ApplicationManifest`'s own checksum-based version dedup, `manifestBuilder.ts`'s
  `computeManifestChecksum`) should arguably NOT mint a new `package_version` every time — whether
  Product Package adopts the identical checksum-dedup pattern, or accepts a new row per assembly
  regardless, is an implementation-time decision this document does not make.
- **Existing callers expecting one package per project.** Every current call site of
  `getProductPackage`/`saveProductPackage` must be enumerated and confirmed compatible with a
  history-shaped table before cutover (Part 13's migration strategy already flags this as the one
  step with real blast radius; this list is what "confirmed compatible" concretely means).

**Recommended future read contracts** (names only — signatures/implementation are for the
implementing sprint, not this one):

- `getLatestProductPackage(projectId)` — preserves today's `getProductPackage` contract exactly,
  under a name that no longer implies "the only one."
- `getProductPackageForMvp(mvpId)` — the read Part 7's Roadmap UI and Part 8's Release History
  panel actually need: "what did the package look like for this specific release."
- `listProductPackageHistory(projectId)` — the full chronological list, already named this in
  Sprint 77's own recommendation #5.

None of these three are implemented in this document — they are named here so the implementing
sprint has an agreed target contract rather than inventing one under time pressure.

---

## Part 9 — Changelog: reuse Release History, no new concept

Per the sprint's own instruction to avoid duplicate concepts: **no separate changelog is needed.**
A changelog is "Release History, rendered chronologically, narrative-first" — exactly
`release_notes` ordered by `package_version`/`released_at` from Part 8's table. The one existing
adjacent mechanism, `versionHistory.getRoleChangeLog` (Sprint 36), stays exactly what it already is
— a per-ROLE, per-ARTIFACT-VERSION diff tool (e.g. "what changed between Architecture Draft v2 and
v3") — genuinely different scope (one role's draft evolving through regenerations, not a shipped
release), so it is correctly *not* merged with Release History; the two answer different questions
and neither should absorb the other. `Release History`'s own `release_notes` generation MAY reuse
`diffListField` (the same `added`/`removed` primitive `summarizeVersionChange` already uses) when
computing Features Added/Deferred, purely as a shared utility — not a merged concept.

---

## Part 10 — Data model changes (summary)

| Change | Type | Why |
|---|---|---|
| `ARTIFACT_TYPES.PRODUCT_FEEDBACK_REPORT` | new enum value | Part 3 |
| `ProductFeedbackReport` type (now with `sourceMvpId`/`targetMvpId`) | new file, `prompts/productFeedback.ts` | Part 3, Correction 3 |
| `ARTIFACT_TYPES.ROADMAP_ANALYSIS` | new enum value | Part 4 |
| `RoadmapAnalysisDraft`/`RoadmapRecommendation` types (now with `sourceMvpId`/`targetMvpId`/`sourceFeedbackArtifactId`/`breakingChange`) | new file, `prompts/roadmapAnalysis.ts` | Part 4, Corrections 2/3 |
| `MvpApprovalStage` gains `'roadmap_review'` | extend existing union | Part 5 |
| `RoadmapTargetResolution` type (`targetMvp`/`roadmapEntry`/`previousReleasedMvp`) | new, `app/lib/mvp/mvpTypes.ts` | Part 4, Correction 2 |
| `mvpRepository.resolveLatestReleasedMvp` / `resolveNextRoadmapTarget` | new exported functions | Part 3/4, Corrections 2/3 |
| `featureRepository.listFeaturesForProject` | new exported function | Part 1, Correction 4 |
| `builders_features` unique index: `(mvp_id, code)` → `(project_id, code)` | **changed constraint**, not purely additive — see Part 1's Cross-MVP Feature Identity subsection for the pre-migration duplicate check this requires | Correction 4 |
| `builders_product_packages` gains `mvp_id`/`package_version`/`released_at`/`release_notes`/`breaking_changes` | additive columns, implementation-time-verified per Part 8's Product Package clarification | Part 8 |
| Everything else (`Mvp`, `Feature`'s own row shape, `ApplicationManifest`, `GenerationPlan`, `BackendModulePlan`) | **unchanged** | Parts 1, 6 |

Every change except one is purely additive (no table dropped/renamed, no column removed, no new
NOT NULL constraint, nullable/optional at the schema layer). The one exception is the
`builders_features` unique-index swap (Correction 4) — called out explicitly here because it is a
genuine constraint change, not a no-op addition, and Part 1/Part 13 both specify the pre-migration
verification it requires before it may ship.

---

## Part 11 — Repository impact

| Repository | Change |
|---|---|
| `app/lib/mvp/mvpRepository.ts` | Two new exported functions: `resolveLatestReleasedMvp` (Correction 3 — selects the HIGHEST-SEQUENCE `Mvp` row whose status is `released`, never merely "the first match in whatever order `listMvpsForProject` returns," so the description doesn't rely on list ordering; the existing auto-supersede invariant means there is normally at most one such row, but selecting by highest sequence rather than list position keeps the resolver defensively correct against legacy data or a temporary invariant violation, not just the expected case) and `resolveNextRoadmapTarget` (Correction 2, Part 4's full definition — reuse-first, then create via the ALREADY-EXISTING `createMvp`, no change to `createMvp` itself needed). `recordMvpApproval` already accepts any `MvpApprovalStage` value structurally (`stage: input.stage`, `mvpApprovals.ts:329-341`) — the `'roadmap_review'` decision does NOT drive an `updateMvpStatus` call the way `'scope'`/`'delivery'` do (Part 5: it gates *whether Gate A may run*, not a status transition itself), so its existing `if (decision === 'approved') { if (stage === 'scope') ... else ... }` branch needs one more arm that does nothing but persist the approval row. |
| `app/lib/features/featureRepository.ts` | One new exported function, `listFeaturesForProject(projectId)` (Correction 4 — same shape as the existing `listFeaturesForMvp`, filtered by `project_id`). `promoteFeaturesForMvp`'s own upsert-by-`(mvpId, code)` matching logic is **unchanged** — it already operates within one MVP; Correction 4 only broadens what the DATABASE guarantees about `code` uniqueness beyond that MVP, which `promoteFeaturesForMvp` never depended on being false. |
| `app/lib/projects/productOwnerEngine.ts` | `assignFeatureIds` (Correction 4) must be called with `listFeaturesForProject`'s result as its carry-forward source when generating for a NEW MVP (no `previousDraft` of its own yet), not left to silently restart at `FEAT-001`. |
| new `app/lib/projects/productReviewEngine.ts` | Part 3, mirrors `businessAnalystEngine.ts`; `canGenerateProductReview` now calls `resolveLatestReleasedMvp`, never `resolveActiveMvpId` (Correction 3) |
| new `app/lib/projects/roadmapAnalysisEngine.ts` | Part 4, mirrors `productOwnerEngine.ts`'s bespoke-parser shape (nested `updatedMvpPlan` needs the same non-generic parsing `CurrentMvpPlan` already requires); calls `resolveNextRoadmapTarget` once per generation, not a separate sequence-guessing step |
| `app/lib/product-assembly/assemblyRepository.ts` | `saveProductPackage` becomes insert-only (Sprint 77 recommendation #5) + `getLatestProductPackage`/`getProductPackageForMvp`/`listProductPackageHistory` (Part 8's clarification — named, not implemented, here) |
| new `app/lib/product-assembly/releaseHistoryRepository.ts` (or fold into `assemblyRepository.ts`) | Read-side joins for Part 8's derived fields — thin, no new writes beyond what `saveProductPackage` already does |

---

## Part 12 — BuildersDB impact

Additive for everything except one explicitly-called-out constraint change:

```sql
-- New migration (sketch — NOT applied by this sprint, architecture only):

-- Correction 4 — see Part 1's Cross-MVP Feature Identity subsection for the required
-- pre-migration duplicate-detection step before this may run.
drop index if exists builders_features_mvp_code_unique;
create unique index if not exists builders_features_project_code_unique on builders_features (project_id, code);

-- Product Package (Part 8) — additive columns only; see Part 8's clarification for the
-- implementation-time verification (constraints/FKs/concurrency/idempotency) still required
-- before the write path itself changes shape:
alter table builders_product_packages
  add column if not exists mvp_id uuid references builders_mvps(id) on delete set null,
  add column if not exists package_version int,
  add column if not exists released_at timestamptz,
  add column if not exists release_notes text,
  add column if not exists breaking_changes text[] not null default '{}';

-- builders_mvp_approvals.stage is already free text (see 20260720100000_mvp_foundation.sql) —
-- 'roadmap_review' needs NO schema change, only an application-layer union extension.

-- builders_mvps.status is already free text and 'planned' is already a valid existing value
-- (Sprint 45) — resolveNextRoadmapTarget's early row creation (Correction 1) needs NO schema
-- change; it only calls the already-existing createMvp earlier in the flow than before.

-- builders_role_outputs (ProjectArtifact's table) already stores any role_key string, and its
-- mvp_id column already exists (Sprint 78 corrective) — 'product-feedback-report' /
-- 'roadmap-analysis' need NO schema change; sourceMvpId lives in each artifact's own JSON
-- content (Correction 3), not as a second FK column.
```

**No new tables.** `ProductFeedbackReport` and `RoadmapAnalysisDraft` ride entirely on the existing
`builders_role_outputs` table, exactly like every one of the 10 existing artifact types — the same
reuse Sprint 78 relied on for `Feature` promotion riding on already-existing RLS helper functions,
just one layer up (artifacts, not a bespoke table). `sourceMvpId`/`targetMvpId` traceability
(Correction 3) needed no new column either — `targetMvpId` reuses the artifact's own existing
`mvp_id` FK, and `sourceMvpId` lives inside the same JSON `content` blob every artifact already
stores its structured draft in. The only genuine schema RISK in this document is the
`builders_features` index swap, called out on its own with its required pre-migration check —
never bundled silently into an "additive" list.

---

## Part 13 — Migration strategy

1. **Zero-risk first**: ship the `builders_product_packages` column additions alone (nullable,
   unused by any current code path) — purely additive, `if not exists` throughout. No behavior
   change.
2. **Cross-MVP Feature Identity (Correction 4) — before any roadmap workflow ships.** Run the
   `group by project_id, code having count(*) > 1` pre-flight check (Part 1) against every project.
   Any project with zero collisions gets the unique-index swap directly. Any project WITH a
   collision is excluded from the automatic migration — per Correction B's revised policy, that
   project instead gets a repair report and requires an explicit, transactional, project-specific
   repair (updating every enumerated persisted reference, not just the row) before its own index
   swap runs. This must fully resolve before step 4 below — Roadmap Analysis producing
   `dependsOn`/`featureRef` values that assume project-wide uniqueness would be unsafe to trust
   otherwise.
3. **`resolveLatestReleasedMvp` + `resolveNextRoadmapTarget` + Roadmap Analysis engine** — land and
   test in isolation (unit-level, same deterministic-test methodology Sprints 78/79 established)
   before any UI wires to them, exactly like `deriveBackendModulePlans` shipped and was fully
   tested before `useCodeGeneration.ts` was wired to it (Sprint 79). `resolveNextRoadmapTarget`'s
   idempotency (Correction 2) should be the FIRST thing tested — repeated calls against the same
   project state must return the identical `targetMvp.id`.
4. **`saveProductPackage` → append-only** — the one step with real blast radius (every existing
   caller of `getProductPackage(projectId)` must keep working). Ship only after Part 8's full
   implementation-time verification list is confirmed against the real schema, behind the same
   "existing contract unchanged, new capability additive" discipline, with regression tests against
   every current call site before cutover.
5. **Product Feedback Report + Roadmap Review UI** — last, since it's pure additive UI/workflow on
   top of steps 1–4, with no schema dependency beyond them.

At every step: the existing MVP1-only flow (today's entire live pipeline) is **completely
unaffected** — `resolveNextRoadmapTarget` returning `undefined` (no released MVP yet, or no
roadmap entry sketched that far) behaves identically to today's hardcoded `nextMvpSequence: 1` path
for any project that never triggers a Roadmap Review, the same backward-compatible-degrade
discipline every MVP-aware addition since Sprint 47 has followed.

---

## Part 14 — Future implementation roadmap (revised)

**Phase 0** (prerequisite — four items, reflecting the final correction round):
- **0.1 — Cross-MVP Feature Identity** (Correction 4, migration policy revised by Correction B) —
  the pre-migration duplicate audit, the collision-free-project index swap, the
  stop-and-report-for-collision path (no automatic rename), and the
  `assignFeatureIds`/`listFeaturesForProject` application-layer fix. A repair UTILITY that
  satisfies Correction B's five-part bar (structured+JSON references, Manifest ownership,
  no-ambiguous-reference validation, transactional, audited) is explicitly future work, not part
  of this phase — this phase only needs the audit + the safe (collision-free) path to ship.
- **0.2 — `resolveLatestReleasedMvp` + `resolveNextRoadmapTarget`** (Corrections 2/3, final
  sequence-keyed form) — the two resolvers that together actually unlock anything past MVP1.
  `resolveNextRoadmapTarget`'s idempotency must be verified against all six test cases in Part 4
  (planned/scoped/generating/approved/released, plus one other pre-release status) BEFORE any
  caller depends on it — this is the single most important regression surface in the whole
  document, since getting it wrong either duplicates a roadmap target or silently skips one.
- **0.3 — `MvpApprovalStage` extended with `'roadmap_review'`** (Part 5) — schema-free,
  application-layer only.
- **0.4 — The three-state roadmap-entry model** (Correction C, Part 1) — no code, but the UI/engine
  contracts in Phases 1–2 below are written against it, so it must be the shared mental model
  before either phase starts, not discovered mid-implementation.

**Phase 1** (Business Analyst Product Review, Part 3):
- **1.1** — `ARTIFACT_TYPES.PRODUCT_FEEDBACK_REPORT` + `prompts/productFeedback.ts` (now with
  `sourceMvpId`/`targetMvpId`) + `productReviewEngine.ts`, gated by `resolveLatestReleasedMvp`
  (never `resolveActiveMvpId`).
- **1.2** — `ProductReviewDraftPanel.tsx` (mirrors an existing `*DraftPanel` almost exactly, per
  Part 3).

**Phase 2** (Product Owner Roadmap Review, Parts 4–5):
- **2.1** — `ARTIFACT_TYPES.ROADMAP_ANALYSIS` + `prompts/roadmapAnalysis.ts` (now with
  `sourceMvpId`/`targetMvpId`/`sourceFeedbackArtifactId`/`breakingChange`) +
  `roadmapAnalysisEngine.ts`, built directly on Phase 0.2's resolvers.
- **2.2** — `RoadmapReviewPanel.tsx` (Part 7) — the diff-then-approve UI, gating Gate A per Part
  5's corrected sequencing (the target `Mvp` row already exists by the time this panel renders).

**Phase 3** (Release History, Parts 8–9):
- **3.1** — Implement Sprint 77 recommendation #5 (append-only Product Package), gated on Part 8's
  full implementation-time verification list (unique constraints, FKs, latest-selection,
  concurrency, idempotent assembly, existing-caller audit) — this is a standalone,
  already-specified, independently valuable prerequisite regardless of Sprint 80, and now
  explicitly NOT rubber-stamped as "just add columns."
- **3.2** — Add the `mvp_id`/`package_version`/`released_at`/`release_notes`/`breaking_changes`
  columns, the three named read contracts (`getLatestProductPackage`/`getProductPackageForMvp`/
  `listProductPackageHistory`), and the rule-based Release Notes generator (Sprint 77 Part 9,
  unbuilt).
- **3.3** — Roadmap UI's release-history/feedback-summary panels (Part 7).

**Phase 4** (depends on Sprint 77 recommendation #6, tracked there, not here):
- **4.1** — `SchemaDelta`/`diffStructuredSchemas` — needed for Release History's "Database
  Changes" field and for MVP2+ provisioning generally; independently required regardless of this
  sprint.

Nothing in Phase 0–3 depends on Phase 4 to be useful — Release History's Database Changes field can
render "not yet available" gracefully (same free-text-degrades-gracefully convention as
`ACTIVITY_ICON`) until Sprint 77 rec #6 ships, exactly like every other "known simplification"
already documented in this codebase.

---

## Summary: what this sprint reuses vs. adds

**Reused, unchanged**: `Mvp`, `MvpStatus`, `isValidMvpStatusTransition`, `Feature`,
`isValidFeatureStatusTransition`, `moduleSlug`, `gateAApproval.ts` (including its existing
resolve-or-create-by-`sequence` logic, which needed NO change to tolerate an earlier-created
`planned` row), `promoteFeaturesForMvp`, `createMvp`, `resolveActiveMvpId` (kept for its own,
unchanged, mid-engineering purpose — deliberately NOT reused for Product Review's gate, Correction
3), `ApplicationManifest`, `resolveFileCarryForwardPlan`, `BackendModulePlan`, `ProjectArtifact`
(including its existing `mvpId` column, now carrying `targetMvpId`), `getResumableArtifact`/
`getApprovedArtifactContent`, `MvpApproval`'s append-only shape, `CurrentMvpPlan`'s exact shape
(reused verbatim as `updatedMvpPlan`), `roadmapSkeleton`, `ACTIVITY_ICON`'s graceful-degrade
convention, `diffListField`.

**Added**: one `MvpApprovalStage` value, two `ARTIFACT_TYPES` values (riding the existing
`builders_role_outputs` table — no new table), five nullable columns on one existing table (Product
Package, implementation-time-verified, not yet built), one CHANGED constraint (`builders_features`'
unique index, project-scoped instead of MVP-scoped, with a mandatory pre-migration duplicate check),
`resolveLatestReleasedMvp`, `resolveNextRoadmapTarget` + its `RoadmapTargetResolution` return shape,
`listFeaturesForProject`, two new engine files following the exact established orchestration-only
pattern, two new prompt files, two new panel components.

**Not touched**: Manifest schema, Resume orchestration, Backend Module generation, Database
provisioning, Discovery, Business Analyst's core Requirements workflow, every existing engineering
role's `canGenerate*` gate, `gateAApproval.ts`'s own transactional orchestration logic.

This is the shape the sprint asked for: Builders becomes the custodian of a product across
releases — Vision → Roadmap → MVP1 → Release → Product Review → Roadmap Review → Customer Approval
→ Incremental Engineering → MVP2 Release → repeat — built entirely out of primitives Sprints 44–79
already proved out, with the roadmap loop as the one genuinely new piece of orchestration tying
them together.

Stop after this architecture document. Do not begin implementation until this has been reviewed
and approved.
