# Regional Intelligence

**Sprint 71 — Regional Intelligence Foundation.** This document describes what actually exists
in the codebase today. Nothing here is aspirational — if a field, source, or behavior isn't
listed, it hasn't been built yet.

Status: **Foundation established for India, UAE, UK, and US.** Architecture is extensible to
more regions without a pipeline rewrite (see [Adding a New Region](#adding-a-new-region)), but
only these four are seeded, and the only reachable resolution source today is manual selection
(see [Known Limitations](#known-limitations)).

---

## 1. Purpose

Regional Intelligence answers **"how should approved product scope behave in this market?"** —
currency, tax terminology, date/address/phone conventions, privacy reminders, accessibility
expectations, payment/commerce conventions, and data-residency/deployment considerations.

It is a **separate system from Blueprint Intelligence** (`app/lib/blueprints/`). A Blueprint
answers "what does this kind of product typically need"; a Regional Profile answers "how does
this market expect that already-approved product to behave." The two are combined at the
context-provider layer as two clearly separate sections — never merged.

## 2. Non-Goals

Regional Intelligence never answers **"what additional product features should be added?"** It
never automatically authorizes payments, invoicing, authentication, customer accounts, tax
calculation, legal-document generation, identity verification, data-residency infrastructure,
multi-language support, or regional integrations — those capabilities must already exist in
approved upstream scope. Every formatted guidance section carries this instruction explicitly
(see [Scope-Control Rules](#scope-control-rules)).

Also not built in this sprint (see the Sprint 71 brief's own "Out of Scope" list): live tax-rate
APIs, automatic tax filing, legal-document generation, legal advice, automatic compliance
certification, IP-based geolocation, browser-location inference, a full i18n/translation engine,
multi-currency checkout, currency conversion, payment-gateway automation, state/emirate/nation-
level sub-profiles, a Regional Profile Studio, or an admin UI.

## 3. Regional Profile Structure

`app/lib/regional/regionalProfileTypes.ts` defines `RegionalProfile` — a small, coherent model
adapted from the Sprint 71 brief's suggested field list (not every suggested field was added;
`industryOverrides`, `effectiveFrom`, and `deprecatedAt` were deliberately omitted — no seed
profile needs them, and `version`/`status` are sufficient lifecycle tracking for a 4-profile
code-based catalog).

**Identity/locale core** (always present): `id`, `code` (`RegionCode`: `'IN' | 'AE' | 'GB' |
'US'`), `name`, `countryCode`, `regionCode?` (reserved for a future sub-national variant, unused
today), `version`, `status`, `locale`, `dateFormat`, `timeFormat`, `phoneCountryCode`,
`addressFormat`.

**Optional identity fields**: `defaultCurrency` (present on every seed profile), `defaultTimezone`
(present on every seed profile **except US** — see below).

**Guidance arrays** (every one optional, `string[]`, structural guidance only — never a rate,
threshold, or legal deadline): `taxGuidance`, `invoiceGuidance`, `privacyGuidance`,
`dataProtectionGuidance`, `accessibilityGuidance`, `consumerProtectionGuidance`,
`paymentGuidance`, `commerceGuidance`, `dataResidencyGuidance`, `deploymentGuidance`,
`complianceNotes`. Plus `taxTerminology: string` (the term this market uses, not a rate).

**`sourceMetadata`**: `{ lastReviewed: string; disclaimer: string }` — provenance about the
profile *content*, never about a customer's location (no IP, device, or browser data is ever
recorded anywhere in this system).

## 4. Supported Initial Regions

| Code | Name | Locale | Currency | Timezone |
|---|---|---|---|---|
| `IN` | India | `en-IN` | INR | `Asia/Kolkata` |
| `AE` | United Arab Emirates | `en-AE` | AED | `Asia/Dubai` |
| `GB` | United Kingdom | `en-GB` | GBP | `Europe/London` |
| `US` | United States | `en-US` | USD | **none — never assumed nationally** |

The US profile deliberately has no `defaultTimezone` — the Sprint 71 brief explicitly requires
this ("Timezone must not be assumed nationally; require project-specific selection or mark
unresolved"), since the US spans multiple time zones.

Each profile's guidance is written as implementation guidance, not legal advice — see
[Legal-Safety Wording](#legal-safety-wording).

## 5. Regional Profile Repository

`app/lib/regional/regionalProfileRegistry.ts` — a typed, code-based catalog (`Record<RegionCode,
RegionalProfile>`), mirroring `app/lib/blueprints/registry.ts`'s own pattern rather than a
database table. `regionalEngine.getRegionalProfile(code)` and
`regionalEngine.getAllRegionalProfiles()` are synchronous — no network round trip per generation
call, per PART 13 of the Sprint 71 brief.

This is deliberately **not** a table like `builders_blueprint_resolutions`: Blueprint Resolution
needs a table because it records a scoring engine's output that changes per Business
Understanding update — a genuine per-project, evolving computation worth an audit trail. A
Regional Profile is closer to Blueprint *content*: a small, curated, versioned catalog that
doesn't change per project and doesn't need an admin UI at this foundation stage.

## 6. Regional Resolution Mechanism

`app/lib/regional/regionalResolutionService.ts` exposes:

- `resolveEffectiveRegionalSelection(project)` — pure, synchronous, given an already-loaded
  `Project`.
- `getEffectiveRegionalSelection(projectId)` — async; fetches the project via the existing
  `getProjectById` repository function and delegates to the pure function above.

Both return a `RegionalResolutionResult` (`app/lib/regional/regionalResolutionTypes.ts`) —
**always** an object, never `undefined` (unlike Blueprint's `EffectiveBlueprintSelection |
undefined`): when nothing resolves, `selectionSource` is `'none'` and every profile-identifying
field is `null`, with `unresolvedReason` set.

**Never infers a region from IP, browser locale, device location, currency alone, timezone
alone, Blueprint industry, or model guesswork** — see PART 4 of the Sprint 71 brief. The
resolver reads exactly one thing: `Project.regionalSelection`.

### Selection sources

`RegionalSelectionSource` is `'manual_override' | 'business_discovery' | 'project_metadata' |
'workspace_default' | 'none'` — matching PART 5 of the brief's suggested list exactly, but
**only `'manual_override'` and `'none'` are reachable today**:

- `'manual_override'` — `Project.regionalSelection` is set. **Reachable.**
- `'business_discovery'` — would mean Business Discovery captured a structured country/market
  field. **Reserved** — `BusinessUnderstandingModel` has no such field (confirmed by this
  sprint's own architecture research; see [Known Limitations](#known-limitations)).
- `'project_metadata'` — would mean a region was set through a path other than manual override
  (e.g. a future bulk-import). **Reserved** — today the only writer of
  `Project.regionalSelection` is the manual-override path itself.
- `'workspace_default'` — would mean an organization/workspace-level default existed.
  **Reserved** — no workspace/organization concept exists in this codebase at all.
- `'none'` — nothing resolved. **Reachable** (the default state for every project today).

## 7. Manual Override Behaviour

`setManualRegionalSelection(projectId, regionCode)` and `clearManualRegionalSelection(projectId)`
in `regionalResolutionService.ts` implement the domain-layer capability (PART 11):

- Manual selection always wins — it is the only source this resolver reads.
- `setManualRegionalSelection` rejects an unknown region code without persisting anything (never
  stores a selection that can't resolve).
- `clearManualRegionalSelection` removes the field, returning the project to `'none'` — "return
  to automatic resolution" means unresolved today, since no automatic source is reachable yet.
- Both are `false`-returning, never-throwing on failure (project not found, BuildersDB
  unavailable), matching every other BuildersDB-backed write in this codebase.

**No UI was added.** No existing settings/edit-flow convention was found that a minimal control
could safely attach to without touching Dashboard layout (PART 11: "do not redesign project
settings" / "do not force a new Dashboard feature") — the domain layer is implemented and fully
tested; wiring a control is future work (see [Remaining Work](#remaining-regional-intelligence-work)).

## 8. Persistence Decision

**`Project.regionalSelection?: { regionCode: RegionCode; selectedAt: string }`**, folded into
`builders_projects.metadata` via `METADATA_FIELDS` in
`app/lib/builders-db/buildersDbTypes.ts` — **no migration**.

This was a deliberate choice per PART 6 of the brief, which explicitly prefers metadata storage
over a new table unless lifecycle/versioning genuinely justifies one. `METADATA_FIELDS` is an
existing, already-used mechanism (`projectDefinitionApproval`, `projectKnowledge`, and 9 other
fields already persist this way) — adding `'regionalSelection'` to that array required editing
exactly one array literal, no DDL. Existing projects with no `regionalSelection` field simply
resolve to `'none'` — fully backward compatible.

A dedicated table (mirroring `builders_blueprint_resolutions`) was considered and rejected: that
table exists to store a *scoring engine's* history (candidates, confidence, explanation) across
Business Understanding updates. Regional resolution in this foundation sprint has no scoring
engine — the only persisted fact is an explicit manual choice, which a single field fully
represents.

## 9. Role-Family Projections

Per PART 7 of the brief, the full `RegionalProfile` is never injected into every role. Three
family-level projections exist in `app/lib/regional/`:

| File | Roles | Fields projected |
|---|---|---|
| `regionalBusinessProductProjection.ts` | Business Analyst, Product Owner | `locale`, `defaultCurrency`, `addressFormat`, `phoneCountryCode`, `taxTerminology`, `taxGuidance`, `invoiceGuidance`, `privacyGuidance`, `consumerProtectionGuidance`, `paymentGuidance`, `commerceGuidance`, `complianceNotes` |
| `regionalArchitectureEngineeringProjection.ts` | Solution Architect, Database, Backend, Frontend, DevOps | `locale`, `defaultCurrency`, `defaultTimezone`, `addressFormat`, `phoneCountryCode`, `privacyGuidance`, `dataProtectionGuidance`, `dataResidencyGuidance`, `deploymentGuidance`, `complianceNotes` |
| `regionalDesignQualityProjection.ts` | UI/UX Designer, QA Engineer | `locale`, `dateFormat`, `timeFormat`, `defaultCurrency`, `addressFormat`, `phoneCountryCode`, `accessibilityGuidance`, `privacyGuidance`, `consumerProtectionGuidance`, `complianceNotes` |

Each file follows the same 4-piece shape as the Blueprint projections it's modeled on:
`projectRegionalProfileForX`, `hasXRegionalContent`, `describeSuppliedSections`,
`formatXRegionalGuidanceSection` — pure, synchronous, non-mutating, deterministic. Unlike
Blueprint's per-role split (9 separate files, because `BlueprintContent`'s 24 sections are
genuinely disjoint per role), regional facts are comparatively uniform across roles, so 3
family-level projections — not 9 — satisfy "ensure each role receives only relevant guidance"
without copy-paste duplication.

The Architecture/Engineering family's format function surfaces an **explicit** "confirm the
project-specific operating timezone(s)" note whenever `defaultTimezone` is absent (i.e., always
for the US profile) rather than silently omitting timezone guidance.

## 10. Context-Provider Integration

`app/lib/ai/context/buildersDbContextProvider.ts`:

- `REGIONAL_ROLE_FAMILY: Record<string, 'business-product' | 'architecture-engineering' |
  'design-quality'>` maps every one of the 9 pipeline `ARTIFACT_TYPES` to its family.
- `buildRegionalGuidance(projectId, roleKey)` — **one shared function**, not nine — resolves the
  effective profile, looks up the family, calls that family's projection/format functions, and
  builds a `ContextTraceSource`. Same never-throws/safe-fallback discipline as every
  `buildXBlueprintGuidance` function.
- `buildRoleContextBlock` computes `regionalGuidance` alongside the existing `blueprintGuidance`,
  pushes `regionalGuidance.text` as its **own** section (after Blueprint Guidance, never merged
  into it), and folds `regionalGuidance.source` into `recordContextTrace` via a new optional
  parameter.
- The empty-context early-return check now also considers `!regionalGuidance`.

Every pipeline role receives **some** family (unlike Blueprint guidance, which only reaches
roles with a dedicated projection) — market conventions are relevant to every role in some form.

## 11. Prompt Changes

One additive sentence in `COLLABORATION_FRAMING` (`app/lib/projects/prompts/shared.ts`), which
every role's system prompt already appends verbatim — no per-role prompt file was touched:

> "If Regional Guidance is present in your context, it adapts approved product scope to the
> selected market (currency, terminology, formatting, compliance reminders) — it does not
> authorize new features, legal conclusions, or infrastructure beyond approved upstream
> decisions."

## 12. Scope-Control Rules

Every formatted Regional Guidance section (all 3 families) carries the same discipline:

- An explicit instruction paragraph stating Regional Guidance adapts approved scope, never
  authorizes new features/legal conclusions/infrastructure.
- Every conditionally-relevant section (tax, invoice, payment, commerce, consumer-protection) is
  worded with an explicit "only where already approved" / "only where [capability] is already
  approved" qualifier — enforced by the format functions themselves, not left to model judgment
  alone.
- Data-residency guidance is explicitly labeled "advisory only — never authorizes new hosting
  infrastructure by itself."
- Timezone guidance for the US explicitly asks for project-specific confirmation rather than
  assuming a default.

This is guidance-text-driven scope control (the projection layer has no access to "what's
actually approved" — that lives in the Product Owner's Engineering Handoff, a separate upstream
source per the Source Priority order), not code that inspects approved features. The AI role is
instructed to apply the gating language itself, consistent with how Blueprint guidance's own
"never add a feature the approved MVP doesn't include" instruction already works.

## 13. Legal-Safety Wording

Every seed profile carries a standing disclaimer (`sourceMetadata.disclaimer`): *"This guidance
is implementation-focused, not legal advice. Validate current requirements with a qualified
local adviser — applicable rules may depend on industry, state/emirate/nation, and customer
type."* `regionalProfileRegistry.spec.ts` scans every profile's full guidance text for banned
phrases (`"fully compliant"`, `"legally compliant"`, `"meets all"`, `"guarantees compliance"`,
`"no legal review required"`, `"automatically calculates all taxes correctly"`) and fails if any
appear — a permanent regression guard, not just a one-time review.

## 14. Traceability

`ContextTraceSource` (`app/lib/builders-db/buildersDbTypes.ts`) was widened (additive only) with
a `'regional-resolution'` type and `regionalProfileId` / `regionalProfileCode` /
`regionalProfileVersion` / `resolvedAt` fields, plus `selectionSource` was widened to also accept
the Regional-only values. Every Regional Guidance build records: Regional Profile ID, code,
version, selection source, sections supplied, content available, and resolution timestamp — via
the same `recordContextTrace`/`saveContextTrace` mechanism Blueprint guidance already uses.

**No IP or device-location data is ever traced** — the source is always "this project's stored
manual selection," nothing about where a request came from.

## 15. Adding a New Region

1. Add the new code to `RegionCode` in `regionalProfileTypes.ts`.
2. Add a new `RegionalProfile` object in `regionalProfileRegistry.ts` and register it in
   `REGIONAL_PROFILES`.
3. Write guidance text following the same legal-safety discipline as the existing 4 profiles
   (see §13) — `regionalProfileRegistry.spec.ts`'s banned-phrase scan will catch violations.
4. No other file needs to change — the resolution service, projections, and context-provider
   wiring are all keyed off `RegionCode` generically.

## 16. Versioning Expectations

Each `RegionalProfile.version` is a plain integer, bumped when that profile's guidance text
meaningfully changes. There is no migration path for old versions — `RegionalResolutionResult`
records the version that was active at resolution time for traceability, but there is no
historical profile-version lookup (matching PART 13's "does not require a complex admin UI").

## 17. Known Limitations

- **Only `manual_override` and `none` are reachable selection sources.** No structured
  country/market field exists anywhere in `BusinessUnderstandingModel` or Business Discovery
  today (confirmed via this sprint's own architecture research) — `'business_discovery'` is
  defined in the type union for forward compatibility but never produced by the current
  resolver.
- **No UI control exists** for setting/clearing a manual regional selection — only the tested
  domain-layer functions (`setManualRegionalSelection`/`clearManualRegionalSelection`).
- **No workspace/organization-default concept exists** in this codebase, so
  `'workspace_default'` is unreachable.
- Only 4 country-level profiles exist — no state/emirate/nation-level sub-profiles (explicitly
  out of scope per PART 13).
- Regional guidance is advisory text, not enforced/validated data — an AI role could still, in
  principle, ignore the "only where already approved" qualifiers; this system informs, it does
  not gate generation programmatically.

## 18. Remaining Regional Intelligence Work

- Capture a structured country/market field in Business Discovery and wire it as the
  `'business_discovery'` resolution source.
- Wire a minimal manual-override UI control once a suitable settings surface exists.
- Consider a workspace/organization-level default once that concept exists elsewhere in the
  codebase.
- Expand `paymentGuidance`/`commerceGuidance`-style detail as real product needs surface — kept
  intentionally light in this foundation sprint.
