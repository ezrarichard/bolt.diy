# Product Owner Artifact Specification

**Sprint 46C update:** every MVP (`roadmapSkeleton` entries and `currentMvp`) and every feature now carries a permanent `id` (`MVP-001`, `FEAT-001`, ...), assigned by the application, never the AI — see [08-identity-and-traceability.md](08-identity-and-traceability.md) for the full design and why array position/title were both rejected as the ID source.

This defines the structure of the artifact the AI Product Owner produces — the input the Engineering phase consumes, per [01-Vision/02-software-factory-philosophy.md](../01-Vision/02-software-factory-philosophy.md). The full JSON Schema is in [03-json-schema.md](03-json-schema.md); this document explains *why* it's shaped this way.

## Two Tiers of Detail (See 01, Section 5)

The artifact is not one flat document — it is explicitly split into a **product-wide tier** (written once, revised rarely) and a **current-MVP tier** (fully elaborated for the MVP currently in progress, sketched for everything after it). This split is the artifact's central design decision, and it exists specifically to prevent the Product Owner from re-creating full-upfront-planning inside its own output.

## Sections

### Product-Wide Tier (written once at Sprint start, revised only when the customer changes direction)

| Section | Required? | Description |
|---|---|---|
| `productVision` | Required | One paragraph. What the product is, why it matters, derived from Requirements. |
| `businessObjectives` | Required | 1-5 short statements of business intent, carried forward from Requirements. |
| `productScope.inScope` | Required | Every feature/capability implied by Requirements that the product will eventually have. |
| `productScope.outOfScope` | Required (may be empty) | Anything explicitly excluded, so it's never silently assumed later. |
| `roadmapSkeleton` | Required | Ordered list of MVPs: `id` (Sprint 46C — permanent, e.g. `MVP-001`), `sequence`, `theme` (one line), `targetRelease` (optional, see 06). **No feature-level detail here** — that's the current-MVP tier, below, elaborated just-in-time. |

### Current-MVP Tier (fully elaborated only for the MVP currently being planned)

| Section | Required? | Description |
|---|---|---|
| `currentMvp.id` | Required | Sprint 46C — same permanent identifier as this MVP's `roadmapSkeleton` entry (both derived from `sequence`). |
| `currentMvp.sequence` | Required | Which roadmap entry this elaborates. |
| `currentMvp.features[]` | Required | Each feature: `id` (Sprint 46C — permanent, e.g. `FEAT-001`, carried forward across regenerations by name-match, never derived from position or name itself), `name`, `description`, `priority` (MoSCoW), `dependsOn[]` (other feature names in this MVP or prior MVPs), `customerValue` (one-line "why"). |
| `currentMvp.acceptanceCriteria[]` | Required | Business-readable, testable statements of "this MVP is done when...". |
| `currentMvp.risks[]` | Required (may be empty) | Each: `description`, `severity` (Critical/High/Medium/Low), optional `mitigation`. |
| `currentMvp.assumptions[]` | Required (may be empty) | Anything assumed because Requirements didn't say. |
| `currentMvp.openQuestions[]` | Required (may be empty) | Anything genuinely ambiguous, addressed to the customer. |
| `currentMvp.technicalConstraints[]` | Optional | Constraints already stated/implied by Requirements — captured, not authored (see 01, Section 1). |
| `currentMvp.businessConstraints[]` | Optional | Same boundary as above. |
| `currentMvp.engineeringHandoff` | Required | The structured, machine-consumable block Solution Architect actually reads — see [04-engineering-handoff.md](04-engineering-handoff.md). Distinct from the narrative sections above, which are customer-facing. |
| `futureEnhancements[]` | Optional | Lightweight, unordered — things Requirements implies but no MVP covers yet. **Deliberately not elaborated with priority/dependencies/acceptance criteria** — that would be re-planning future MVPs early, exactly what the two-tier split exists to prevent. |

### Metadata (every version)

| Field | Required? | Description |
|---|---|---|
| `version` | Required | Increments on every genuine content change, following `builders_role_outputs`' existing version semantics (see [02-Architecture/04-buildersdb-future-schema.md](../02-Architecture/04-buildersdb-future-schema.md)) — a status-only change (e.g. approval) does not bump it. |
| `generationType` | Required | `'manual' \| 'automatic'`, matching `RoleOutputGenerationType` already defined in `buildersDbTypes.ts` — reused, not reinvented. |
| `approvalStatus` | Required | `'draft' \| 'pending_review' \| 'approved' \| 'changes_requested'` — matches `ProjectArtifactStatus`'s existing vocabulary where possible; the Product Owner's artifact does not invent a parallel status vocabulary. |
| `createdAt` / `updatedAt` | Required | ISO timestamps, same convention as every other role output. |

## Validation Rules

1. Every feature in `currentMvp.features[]` whose `dependsOn` references a feature not present in this MVP or any prior approved MVP is invalid — this is the dependency-graph hard constraint from [01-responsibilities-and-decision-framework.md](01-responsibilities-and-decision-framework.md), Section 2, enforced structurally, not just as guidance.
2. `roadmapSkeleton` entries must have strictly increasing `sequence` values with no gaps, matching `builders_mvps.sequence`'s existing unique-per-project constraint.
3. `currentMvp.sequence` must match an entry in `roadmapSkeleton`.
4. At least one feature in `currentMvp.features[]` must be `priority: "Must Have"` — an MVP with nothing mandatory in it is not a valid MVP.
5. `productScope.outOfScope` may be empty but must be present as a field — its absence (vs. an empty array) is treated as "the Product Owner didn't consider exclusions," which should fail validation and prompt a regeneration, not be silently accepted.

## Versioning

Follows the existing `builders_role_outputs` pattern exactly: one row per version, keyed on `(artifact_id, version)`, with `parent_version_id` threading. No new versioning mechanism is introduced. The Product Owner's artifact is just another `role_key` in that same table (tagged `phase: 'product_planning'` via `builders_ai_roles.phase`, added in Sprint 45).
