# Package Intelligence

**Sprint 73 — Package Intelligence Foundation.** This document describes what actually exists in
the codebase today. Nothing here is aspirational — if a field, source, or behavior isn't listed,
it hasn't been built yet.

Status: **Foundation established for Starter, Professional, and Premium, with a manual selection
UI in the Workspace tab.** Architecture is extensible to more packages without a pipeline rewrite
(see [Adding a New Package Profile](#adding-a-new-package-profile)), but only these three are
seeded, and the only reachable resolution source today is manual selection (see
[Known Limitations](#known-limitations)).

---

## 1. Purpose

Package Intelligence answers **"how deeply and robustly should already-approved product scope be
implemented?"** — architecture depth, security controls, testing depth, performance expectations,
observability, deployment maturity, backup/recovery planning, documentation depth,
maintainability, auditability, and operational-support expectations.

It is a **third, separate system** alongside Blueprint Intelligence (`app/lib/blueprints/`) and
Regional Intelligence (`app/lib/regional/`). A Blueprint answers "what does this kind of product
typically need"; a Regional Profile answers "how does this market expect that product to behave";
a Package Profile answers "how mature and robust should the implementation be." All three are
combined at the context-provider layer as three clearly separate sections — never merged.

## 2. Non-Goals

Package Intelligence never answers **"what additional product features should be added?"** It
never automatically authorizes authentication, payments, analytics, multi-tenancy, SSO, audit
logs, notifications, admin portals, mobile applications, integrations, additional user roles,
advanced reporting, data warehouses, or new infrastructure components — those capabilities must
already be approved upstream or explicitly identified as implementation-quality requirements that
don't change product scope.

Also not built in this sprint (per the Sprint 73 brief's own "Out of Scope" list): package
pricing, quotations, invoices, sales proposals, subscription billing, customer checkout, a package
comparison marketing page, an AI package recommendation/upselling engine, automatic package
inference from budget or business size, more package tiers, a custom package builder, Package
Studio, a package governance workflow, Customer Intelligence, Blueprint Studio, Blueprint
Governance, Regional expansion, new AI roles, a full Dashboard redesign, or any automatic
infrastructure provisioning (Kubernetes, multi-region deployment, SSO, multi-tenancy,
microservices migration).

## 3. Naming Note — Two Different "Packages" in This Codebase

`app/lib/product-assembly/assemblyTypes.ts` (Sprint 37) already defines `ProductPackage` — a
**generated deliverable bundle** (every approved role output assembled into structured files),
persisted to `builders_product_packages`. This is a **completely unrelated concept** from the
"Package Profile" (Starter/Professional/Premium delivery-maturity tier) this document describes.
No code, naming, or relationship is shared between them — this is simply two pre-existing uses of
the English word "package" in this codebase. Package Intelligence's own types are named
`PackageProfile`/`PackageCode`/`PackageSelection`/`PackageResolutionResult` to keep them
textually distinguishable from `ProductPackage` at a glance.

## 4. Package Profile Model

`app/lib/package-intelligence/packageProfileTypes.ts` defines `PackageProfile` — a small, coherent
model adapted from the Sprint 73 brief's suggested field list (not every suggested field was
added as a required field; every guidance field beyond the identity core is optional, same
discipline as `RegionalProfile`).

**Identity core** (always present): `id`, `code` (`PackageCode`: `'STARTER' | 'PROFESSIONAL' |
'PREMIUM'`), `name`, `deliveryPositioning`, `version`, `status`, `exclusions` (`string[]`),
`qualityFloor` (`string[]`), `sourceMetadata`.

**Guidance arrays** (every one optional, `string[]`): `architectureGuidance`,
`securityGuidance`, `testingGuidance`, `performanceGuidance`, `scalabilityGuidance`,
`observabilityGuidance`, `deploymentGuidance`, `backupRecoveryGuidance`,
`documentationGuidance`, `maintainabilityGuidance`, `supportGuidance`, `integrationGuidance`,
`dataGovernanceGuidance`, `uiQualityGuidance`, `qaExitCriteria`.

**`exclusions`**: an explicit list of capabilities this package's guidance must NOT be read as
authorizing (e.g. "Does not add authentication, authorization, or new user roles.") — every
formatted guidance section always renders this list.

**`qualityFloor`**: the shared minimum-quality baseline every package must meet (see
[Minimum Quality Floor](#minimum-quality-floor)) — every formatted guidance section always
renders this too.

**`sourceMetadata`**: `{ lastReviewed: string; disclaimer: string }` — provenance about the
profile *content*, and the standing scope-control disclaimer (never commercial pricing metadata).

## 5. Supported Initial Packages

| Code | Name | Delivery Positioning |
|---|---|---|
| `STARTER` | Starter | A reliable, focused implementation for small businesses, prototypes, and straightforward customer projects — production-conscious for its approved scope, not a reduced-quality tier. |
| `PROFESSIONAL` | Professional | A more complete implementation for established businesses and products expected to support regular day-to-day operations. |
| `PREMIUM` | Premium | A high-assurance implementation for larger businesses, more demanding operations, or higher-value delivery — proportional rigor, not automatic enterprise technology. |

Every profile's guidance is written to never mandate a specific technology (no "use Kubernetes,"
no "use microservices," no "add SSO" anywhere) — `packageProfileRegistry.spec.ts` enforces this
with a sentence-level negation scan: any sentence mentioning "microservices," "Kubernetes," "add
authentication," "add SSO," or "add multi-tenancy" must also contain a negation word ("not" /
"never") in the same sentence.

Premium's own `exclusions` are explicit about this: it does not automatically require
microservices, Kubernetes, multi-region deployment, SSO, multi-tenancy, event-driven/message-queue
architecture, a data warehouse, SOC 2 certification, penetration testing, or 24/7 support — those
require approved need and proportional justification, same as the Sprint 73 brief's PART 3.

## 6. Minimum Quality Floor

`PACKAGE_QUALITY_FLOOR` (`app/lib/package-intelligence/packageProfileRegistry.ts`) is a single
shared array — the **same array reference** on every seed profile's `qualityFloor` field, so
"every package includes the minimum quality floor" is a structural guarantee
(`packageProfileRegistry.spec.ts` asserts every profile's `qualityFloor` deep-equals the first
one), never a per-profile judgment call that could silently drift.

The floor covers: basic security controls, input validation, graceful error handling, automated
tests on critical user-facing paths, responsive behavior, accessibility fundamentals, documented
environment configuration, clear deployment instructions, and no known critical defects at
handoff. Starter must never mean insecure, untested, unvalidated, inaccessible, undocumented,
unmaintainable, or unsafe deployment — `packageProfileRegistry.spec.ts` scans Starter's full
guidance text for exactly those banned words.

Every formatted "### Package Guidance" section (all three role families) always renders this
floor, regardless of which package resolved or which family-specific sections happen to be
populated.

## 7. Package Repository

`app/lib/package-intelligence/packageProfileRegistry.ts` — a typed, code-based catalog
(`Record<PackageCode, PackageProfile>`), mirroring `regionalProfileRegistry.ts`'s own pattern
rather than a database table. `packageEngine.getPackageProfile(code)` and
`packageEngine.getAllPackageProfiles()` are synchronous — no network round trip per generation
call.

This is deliberately **not** a table like `builders_blueprint_resolutions`: there is no scoring
engine here, no per-project evolving computation to audit — a small, curated, versioned catalog
that doesn't change per project, and doesn't need an admin UI at this foundation stage (PART 9 of
the brief explicitly rules out "Package Studio").

## 8. Regional Resolution Mechanism

`app/lib/package-intelligence/packageResolutionService.ts` exposes:

- `resolveEffectivePackageSelection(project)` — pure, synchronous, given an already-loaded
  `Project`.
- `getEffectivePackageSelection(projectId)` — async; fetches the project via the existing
  `getProjectById` repository function and delegates to the pure function above.

Both return a `PackageResolutionResult` (`app/lib/package-intelligence/packageResolutionTypes.ts`)
— always an object, never `undefined`: when nothing resolves, `selectionSource` is `'none'` and
every profile-identifying field is `null`, with `unresolvedReason` set.

**Never infers a package from company size, budget, Blueprint, Region, feature count, model
guesswork, or a package name found in free-text requirements** (PART 4 of the brief). The resolver
reads exactly one thing: `Project.packageSelection`.

### Selection sources

`PackageSelectionSource` is `'manual_override' | 'project_selection' | 'business_discovery' |
'project_metadata' | 'workspace_default' | 'system_default' | 'none'` — matching PART 5 of the
brief's suggested list exactly, but **only `'manual_override'` and `'none'` are reachable today**:

- `'manual_override'` — `Project.packageSelection` is set (via the Workspace tab's Package card
  or the domain-layer function). **Reachable.**
- `'project_selection'` — would mean a package was chosen at project-creation time through a
  dedicated creation-flow control. **Reserved** — no such creation-time control exists yet.
- `'business_discovery'` — would mean Business Discovery captured a structured package/tier
  field. **Reserved** — this sprint deliberately does not add one (PART 4 explicitly forbids
  inferring package from "package name found in free-text requirements"; a structured field
  would need its own deliberate design, out of scope here).
- `'project_metadata'` — would mean a package was present in project metadata but NOT through the
  manual-override write path. **Reserved** — today the only writer of `Project.packageSelection`
  is the manual-selection path itself.
- `'workspace_default'` — would mean an organization/workspace-level default package existed.
  **Reserved** — no workspace/organization concept exists in this codebase at all.
- `'system_default'` — would mean Builders assumed a package when none was selected. **Reserved**
  — current product behavior does not assume any package by default.
- `'none'` — nothing resolved. **Reachable** (the default state for every project today).

## 9. Selection and Override Behaviour

`setManualPackageSelection(projectId, packageCode)` and `clearManualPackageSelection(projectId)`
in `packageResolutionService.ts` are the BuildersDB-only domain-layer functions. Sprint 73 also
adds UI-facing, store-reactive counterparts in `app/lib/stores/projects.ts`:
`setProjectPackageSelection(projectId, packageCode)` and `clearProjectPackageSelection(projectId)`,
which write through the same reactive `projectsStore` + BuildersDB-mirror pattern every other
project mutator uses.

- Manual selection always wins — it is the only source this resolver reads.
- Both setters reject an unknown package code without persisting anything.
- Clearing removes the field, returning the project to `'none'` (no automatic source is reachable
  yet — "clear to restore automatic resolution" today just means unresolved).

### Package Profile card (UI)

`app/components/sidebar/PackageProfileCard.tsx`, rendered in `ProjectDashboard.tsx`'s Workspace
tab immediately next to the Generation Profile and Regional Profile cards — same footprint, no
new Dashboard page, no pricing/checkout/quotation UI. Shows:

- A `<select>` of `No package selected` plus every registered Package Profile (built from
  `packageEngine.getAllPackageProfiles()`, never hardcoded).
- **Package** and **Source** (`Project selection` / `Business Discovery` / `Not set`), read via
  `resolveEffectivePackageSelection(project)`.
- A short, restrained explanatory line: *"Package guidance controls implementation depth and
  delivery maturity. It does not add unrelated product features."*

Selecting a package calls `setProjectPackageSelection`; selecting "No package selected" calls
`clearProjectPackageSelection`.

## 10. Persistence Decision

**`Project.packageSelection?: { packageCode: PackageCode; selectedAt: string }`**, folded into
`builders_projects.metadata` via `METADATA_FIELDS` in `app/lib/builders-db/buildersDbTypes.ts` —
**no migration**.

This mirrors `regionalSelection`'s own Sprint 71 decision exactly: `METADATA_FIELDS` is an
existing, already-used mechanism, so adding `'packageSelection'` to that array required editing
exactly one array literal, no DDL. Existing projects with no `packageSelection` field simply
resolve to `'none'` — fully backward compatible.

Kept a completely separate field from `blueprintId`, `regionalSelection`, `projectKnowledge`, the
`ProductPackage` deliverable-bundle artifact, MVP scope, and any commercial price/quotation — no
field here is derived from or feeds into any of those.

## 11. Role-Family Projections

Per PART 7 of the brief, the full `PackageProfile` is never injected into every role. Three
family-level projections exist in `app/lib/package-intelligence/`:

| File | Roles | Fields projected |
|---|---|---|
| `packageBusinessProductProjection.ts` | Business Analyst, Product Owner | `documentationGuidance`, `maintainabilityGuidance`, `supportGuidance`, `qaExitCriteria` |
| `packageArchitectureEngineeringProjection.ts` | Solution Architect, Database, Backend, Frontend, DevOps | `architectureGuidance`, `securityGuidance`, `performanceGuidance`, `scalabilityGuidance`, `observabilityGuidance`, `deploymentGuidance`, `backupRecoveryGuidance`, `integrationGuidance`, `dataGovernanceGuidance`, `maintainabilityGuidance` |
| `packageDesignQualityProjection.ts` | UI/UX Designer, QA Engineer | `uiQualityGuidance`, `testingGuidance`, `qaExitCriteria` |

Each file follows the same 4-piece shape as the Blueprint/Regional projections it's modeled on:
`projectPackageProfileForX`, `hasXPackageContent`, `describeXPackageSuppliedSections`,
`formatXPackageGuidanceSection` — pure, synchronous, non-mutating, deterministic.
`maintainabilityGuidance` and `qaExitCriteria` are deliberately shared across two families each
(same overlap precedent as Regional's `addressFormat`/`phoneCountryCode` appearing in multiple
families) — "ensure each role receives only relevant guidance" doesn't mean zero overlap where
two role families both genuinely care about the same concern.

Every format function always renders, regardless of which family-specific sections are populated:
1. The "### Package Guidance (Advisory)" header with the profile name and selection source.
2. The scope-control instruction paragraph.
3. `deliveryPositioning`.
4. Family-specific sections (only where populated).
5. The shared minimum quality floor.
6. The package's explicit `exclusions`.

## 12. Context-Provider Integration

`app/lib/ai/context/buildersDbContextProvider.ts`:

- `PACKAGE_ROLE_FAMILY: Record<string, 'business-product' | 'architecture-engineering' |
  'design-quality'>` maps every one of the 9 pipeline `ARTIFACT_TYPES` to its family — identical
  shape to `REGIONAL_ROLE_FAMILY`.
- `buildPackageGuidance(projectId, roleKey)` — one shared function, not nine — resolves the
  effective package, looks up the family, calls that family's projection/format functions, and
  builds a `ContextTraceSource`. Same never-throws/safe-fallback discipline as every other
  `buildXGuidance` function: an unrecognized `roleKey`, no manual package selection, or a lookup
  failure all resolve to `null`.
- `buildRoleContextBlock` computes `packageGuidance` alongside `blueprintGuidance` and
  `regionalGuidance`, pushes `packageGuidance.text` as its **own** section (after Regional
  Guidance, never merged into it), and folds `packageGuidance.source` into `recordContextTrace`
  via a new optional parameter.
- The empty-context early-return check now also considers `!packageGuidance`.

Every pipeline role receives **some** family, same as Regional Guidance.

## 13. Prompt Changes

One additive sentence in `COLLABORATION_FRAMING` (`app/lib/projects/prompts/shared.ts`), which
every role's system prompt already appends verbatim — no per-role prompt file was touched:

> "If Package Guidance is present in your context, it controls implementation depth and delivery
> maturity for approved scope. It does not authorize unrelated features, integrations, roles, or
> infrastructure."

## 14. Scope-Control Rules

Every formatted Package Guidance section (all 3 families) carries the same discipline:

- An explicit instruction paragraph stating Package Guidance controls implementation depth, never
  authorizes new features/integrations/roles/infrastructure.
- The package's explicit `exclusions` list, always rendered.
- The shared minimum quality floor, always rendered.
- Every profile's guidance text passes a sentence-level negation scan (see
  `packageProfileRegistry.spec.ts`) — any mention of a scope-expanding capability
  (authentication, SSO, multi-tenancy, microservices, Kubernetes) only ever appears as something
  the package does NOT do.

This is guidance-text-driven scope control, not code that inspects approved features — same
discipline Regional Guidance already established.

## 15. Relationship with MVP Scope

Package selection must not expand MVP scope. The Product Owner's `EngineeringHandoff`
(`app/lib/projects/prompts/productOwner.ts`) — specifically its `scope`/`outOfScopeFeatures`
fields — remains the single authoritative boundary every downstream engineering role reads
(`solutionArchitectEngine.ts`, `databaseDesignerEngine.ts`, `backendEngineerEngine.ts`,
`frontendEngineerEngine.ts`, `qaEngineerEngine.ts`). Package Intelligence has no code path that
writes to or reads from `EngineeringHandoff` — it is a purely additive context section, and every
projection's `exclusions`/scope-control instruction explicitly tells the AI role that Package
Guidance never authorizes a feature the approved MVP doesn't already include. If an approved MVP
excludes analytics, Professional/Premium Package Guidance may only ever suggest logging/metrics
readiness as an *implementation* concern — never a customer-facing analytics feature; the
`packageProfileRegistry.spec.ts`/context-provider scope-control tests assert this text discipline.

## 16. Relationship with Generation Profile

`app/lib/generation-profiles/` (Sprint 39.5) controls **which LLM model is used per AI role** —
`GenerationProfile.mode` (`'fast-prototype' | 'balanced' | 'production'`) maps each role to a
`modelKey`/`temperature`/`maxTokens`. It has no field about implementation depth, security
posture, testing rigor, or architecture maturity.

Generation Profile answers *"how should Builders execute the generation process?"* (which model,
how much token budget). Package Profile answers *"how mature and robust should the approved
implementation be?"* (what depth of testing/security/observability guidance a role receives).
These are orthogonal concepts with zero overlap — no merge was made, and `workspaceState.ts`'s
`selectedGenerationProfileId` and `Project.packageSelection` remain two completely separate
fields, surfaced as two separate cards in the same Workspace grid.

## 17. Relationship with Blueprint Intelligence

Package Intelligence never reads or writes `Project.blueprintId`, and Blueprint guidance's own
context-provider wiring (`buildXBlueprintGuidance` functions) is untouched by this sprint — a
Blueprint answers "what kind of product is this," Package answers "how deeply should it be
built," and the two are rendered as separate "### Blueprint Guidance" / "### Package Guidance"
sections, never merged, exactly like Blueprint and Regional guidance already coexist.

## 18. Relationship with Regional Intelligence

Package Intelligence never reads or writes `Project.regionalSelection`. Regional guidance answers
"how should this market expect the product to behave" (currency, tax terminology, address
conventions); Package guidance answers "how mature should the implementation be." Both follow the
identical architectural pattern (profile type → registry → resolution service → role-family
projections → context-provider integration → own heading → own traceability), rendered as three
separate sections in this order: Blueprint Guidance, then Regional Guidance, then Package
Guidance.

## 19. Traceability

`ContextTraceSource` (`app/lib/builders-db/buildersDbTypes.ts`) was widened (additive only) with a
`'package-resolution'` type and `packageProfileId` / `packageProfileCode` / `packageProfileVersion`
fields (reusing the existing `resolvedAt` field rather than duplicating it), plus `selectionSource`
was widened to also accept `'project_selection'` and `'system_default'` (Package-only additions;
`'business_discovery'`/`'project_metadata'`/`'workspace_default'` are already shared with
Regional). Every Package Guidance build records: Package Profile ID, code, version, selection
source, sections supplied, content available, and resolution timestamp — via the same
`recordContextTrace`/`saveContextTrace` mechanism Blueprint and Regional guidance already use, as
a distinct entry never overwriting either of theirs.

## 20. Adding a New Package Profile

1. Add the new code to `PackageCode` in `packageProfileTypes.ts`.
2. Add a new `PackageProfile` object in `packageProfileRegistry.ts` and register it in
   `PACKAGE_PROFILES`, reusing `PACKAGE_QUALITY_FLOOR` for its `qualityFloor` field.
3. Write guidance text following the same scope-control discipline as the existing 3 profiles
   (see §14) — `packageProfileRegistry.spec.ts`'s sentence-level negation scan will catch
   violations.
4. No other file needs to change — the resolution service, projections, and context-provider
   wiring are all keyed off `PackageCode` generically.

## 21. Versioning Expectations

Each `PackageProfile.version` is a plain integer, bumped when that profile's guidance text
meaningfully changes. There is no migration path for old versions — `PackageResolutionResult`
records the version that was active at resolution time for traceability, but there is no
historical profile-version lookup (matching PART 9's "does not require a complex admin UI").

## 22. Known Limitations

- **Only `manual_override` and `none` are reachable selection sources.** No structured
  package/tier field exists anywhere in Business Discovery or project-creation flow —
  `'project_selection'`/`'business_discovery'` are defined in the type union for forward
  compatibility but never produced by the current resolver.
- **No project-creation-time package picker exists** — the only place to set a package is the
  Workspace tab's Package Profile card, after a project already exists.
- **No workspace/organization-default concept exists** in this codebase, so
  `'workspace_default'`/`'system_default'` are unreachable.
- Only 3 package tiers exist — no custom package builder, no Package Studio.
- Package guidance is advisory text, not enforced/validated data — an AI role could still, in
  principle, ignore the exclusions/scope-control instructions; this system informs, it does not
  gate generation programmatically.
- No pricing, quotation, billing, or checkout concept exists — explicitly out of scope.

## 23. Remaining Package Intelligence Work

- Consider a project-creation-time or Business Discovery-integrated package capture, mirroring
  Sprint 72's activation of Regional Intelligence, once product direction calls for it.
- Consider a workspace/organization-level default once that concept exists elsewhere in the
  codebase.
- Expand guidance detail (e.g. richer `integrationGuidance`/`dataGovernanceGuidance`) as real
  product needs surface — kept intentionally focused in this foundation sprint.
