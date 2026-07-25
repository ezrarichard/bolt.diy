# Regional Intelligence

**Sprint 71 — Regional Intelligence Foundation. Sprint 72 — Regional Selection Activation.** This
document describes what actually exists in the codebase today. Nothing here is aspirational — if
a field, source, or behavior isn't listed, it hasn't been built yet.

Status: **Foundation established for India, UAE, UK, and US, and activated through the normal
Builders workflow.** Architecture is extensible to more regions without a pipeline rewrite (see
[Adding a New Region](#adding-a-new-region)). Two resolution sources are reachable today: an
explicit manual override, and a structured "primary operating market" captured during Business
Discovery (see [Known Limitations](#known-limitations) for what's still not built).

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
'workspace_default' | 'none'` — matching PART 5 of the Sprint 71 brief's suggested list exactly.
As of Sprint 72, **`'manual_override'`, `'business_discovery'`, and `'none'` are reachable**:

- `'manual_override'` — `Project.regionalSelection` is set. **Reachable**, and always wins over
  `'business_discovery'` below.
- `'business_discovery'` — `Project.projectKnowledge.primaryMarketCode` (see
  [Structured Discovery Market](#structured-discovery-market)) names a supported region code, and
  no manual override exists. **Reachable** (Sprint 72).
- `'project_metadata'` — would mean a region was present in project metadata but NOT through
  either read path above (e.g. a future bulk-import). **Reserved** — today only manual override
  and Business Discovery ever produce a resolved region.
- `'workspace_default'` — would mean an organization/workspace-level default existed.
  **Reserved** — no workspace/organization concept exists in this codebase at all.
- `'none'` — nothing resolved: no manual override, and no supported market captured in Business
  Discovery either (undefined, or `'OTHER'`/unsupported). **Reachable.**

### Resolution priority

`resolveEffectiveRegionalSelection(project)` checks, in order:

1. `project.regionalSelection` (manual override) — always wins if present, even if
   `projectKnowledge.primaryMarketCode` names a different market.
2. `project.projectKnowledge.primaryMarketCode` — only consulted when no manual override exists.
3. Unresolved (`selectionSource: 'none'`).

Clearing the manual override (`clearProjectRegionalSelection`/`clearManualRegionalSelection`)
falls through to whatever Business Discovery *currently* holds, not whatever it held when the
override was set — there is no hidden "remembered" automatic value; it's recomputed fresh each
time.

## 7. Manual Override Behaviour

`setManualRegionalSelection(projectId, regionCode)` and `clearManualRegionalSelection(projectId)`
in `regionalResolutionService.ts` remain the BuildersDB-only domain-layer functions from Sprint
71 (PART 11). Sprint 72 adds a UI-facing, store-reactive counterpart in
`app/lib/stores/projects.ts`: `setProjectRegionalSelection(projectId, regionCode)` and
`clearProjectRegionalSelection(projectId)`, which write through the same reactive `projectsStore`
+ BuildersDB-mirror pattern every other project mutator uses (e.g. `updateProjectKnowledge`) so
the Workspace tab's control re-renders immediately and the change survives a refresh.

- Manual selection always wins over a Business Discovery market (see
  [Resolution priority](#resolution-priority)).
- Both setters reject an unknown region code without persisting anything (never store a
  selection that can't resolve).
- Clearing removes the field, restoring whatever Business Discovery currently resolves (or
  `'none'` if that's also unset/unsupported) — "return to automatic resolution."

### Regional Profile card (Sprint 72 UI)

`app/components/sidebar/RegionalProfileCard.tsx`, rendered in `ProjectDashboard.tsx`'s Workspace
tab immediately next to the existing Generation Profile card (Sprint 39.5) — same footprint, no
new Dashboard page, no custom settings framework. Shows:

- A `<select>` of `Use automatic selection` plus every registered Regional Profile (built from
  `regionalEngine.getAllRegionalProfiles()`, never hardcoded).
- **Effective region** and **Source** (`Manual override` / `Business Discovery` / `Not set`),
  read via `resolveEffectiveRegionalSelection(project)` — pure and synchronous over the same
  in-memory `Project` already in the reactive `projectsStore`, no extra network round trip per
  render.
- A short, restrained explanatory line: *"Regional guidance adapts approved product scope to the
  selected market. It does not add product features or guarantee legal compliance."*

Selecting a market calls `setProjectRegionalSelection`; selecting "Use automatic selection" calls
`clearProjectRegionalSelection`.

## 7.5. Structured Discovery Market

`ProjectKnowledge.primaryMarketCode?: string` (`app/lib/projects/knowledge.ts`, Sprint 72) — the
customer's stated primary operating market, captured as structured discovery input. Deliberately
**separate** from the effective Regional Profile selection and from the pre-existing free-text
`location` field:

- Discovery market: *"The customer says the product will operate primarily in the UAE."*
- Effective Regional Profile: *"The Regional Intelligence system selected profile UAE v1 using
  Business Discovery."*

Values: `'IN' | 'AE' | 'GB' | 'US'` for a supported market, `'OTHER'` for an explicitly-marked
unsupported market, or `undefined` for "not specified." Never a display label — always the
ISO-style code. `PRIMARY_MARKET_OPTIONS` (same file) is the fixed option list the Requirements
dialog's select renders.

### Business Discovery integration

`app/lib/projects/projectKnowledgeEngine.ts`'s `KNOWLEDGE_SECTIONS` "Business" section gained one
new `kind: 'select'` field — "Primary operating market" — right after the existing free-text
"Region" field. `KnowledgeFieldKind` widened to include `'select'`, and `KnowledgeFieldConfig`
gained optional `options`/`helpText`. `ProjectRequirementsDialog.tsx`'s `renderField` renders it
as a native `<select>` (no shared Select primitive exists yet in the Sprint 69 Builders Design
System — see that sprint's own research), with the help text *"The main country where this
product will initially operate. This helps Builders apply appropriate currency, formatting and
compliance-aware guidance."* shown underneath the label. Saved the same way every other
Requirements field is: `updateProjectKnowledge(projectId, knowledge)`.

The pre-existing free-text `location` field ("Region") is untouched — no silent migration from
one to the other.

## 8. Persistence Decision

**`Project.regionalSelection?: { regionCode: RegionCode; selectedAt: string }`**, folded into
`builders_projects.metadata` via `METADATA_FIELDS` in
`app/lib/builders-db/buildersDbTypes.ts` — **no migration**.

This was a deliberate choice per PART 6 of the Sprint 71 brief, which explicitly prefers metadata
storage over a new table unless lifecycle/versioning genuinely justifies one. `METADATA_FIELDS`
is an existing, already-used mechanism (`projectDefinitionApproval`, `projectKnowledge`, and 9
other fields already persist this way) — adding `'regionalSelection'` to that array required
editing exactly one array literal, no DDL. Existing projects with no `regionalSelection` field
simply resolve to `'none'` — fully backward compatible.

**`ProjectKnowledge.primaryMarketCode` needed no persistence change at all** (Sprint 72, PART 8):
`projectKnowledge` was already in `METADATA_FIELDS` before this sprint, and `updateProjectKnowledge`
already does a shallow merge — adding one more optional field to the `ProjectKnowledge` interface
and its `KNOWLEDGE_SECTIONS` config was sufficient. Confirmed: **no BuildersDB migration was
required for Sprint 72.**

A dedicated table (mirroring `builders_blueprint_resolutions`) was considered and rejected: that
table exists to store a *scoring engine's* history (candidates, confidence, explanation) across
Business Understanding updates. Regional resolution has no scoring engine — the only two
persisted facts are an explicit manual choice and a structured discovery value, each of which a
single field fully represents.

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

**No IP or device-location data is ever traced** — the source is always either "this project's
stored manual selection" or "this project's stored Business Discovery market," never anything
about where a request came from. Sprint 72 records `selectionSource: 'business_discovery'` and
`sourceValue` (the stored `primaryMarketCode`) exactly the same way `'manual_override'` already
was — no free-text address is ever traced.

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

- **`project_metadata` and `workspace_default` remain unreachable.** No path other than manual
  override or Business Discovery ever produces a resolved region, and no
  workspace/organization-default concept exists in this codebase at all.
- The structured `primaryMarketCode` field is only captured through the **Form-mode** Requirements
  dialog (`ProjectRequirementsDialog.tsx`). Interview Mode and Document Import (Sprint 56/57's
  other two Business Discovery entry points) do not yet ask for it — a project discovered purely
  through those modes has no structured market until a user opens the Form dialog and sets one, or
  sets a manual override directly.
- Only 4 country-level profiles exist — no state/emirate/nation-level sub-profiles (explicitly
  out of scope per PART 13 of the Sprint 71 brief, and PART "Out of Scope" of the Sprint 72 brief).
- No workspace/organization-level default region exists (PART "Out of Scope" of the Sprint 72
  brief — only add one if that concept exists elsewhere in the codebase first).
- Regional guidance is advisory text, not enforced/validated data — an AI role could still, in
  principle, ignore the "only where already approved" qualifiers; this system informs, it does
  not gate generation programmatically.
- No live tax rates, tax calculation, legal advice, compliance certification, IP geolocation,
  browser-locale inference, translation/i18n, currency conversion, or payment-gateway automation
  — all explicitly out of scope for both sprints.

## 18. Remaining Regional Intelligence Work

- Extend structured market capture to Interview Mode and Document Import, so every Business
  Discovery entry point can produce a `'business_discovery'` resolution, not just the Form dialog.
- Consider a workspace/organization-level default once that concept exists elsewhere in the
  codebase.
- Expand `paymentGuidance`/`commerceGuidance`-style detail as real product needs surface — kept
  intentionally light in both sprints.
- Package Intelligence, Customer Intelligence, Blueprint Studio, and a Regional Profile Studio
  remain explicitly out of scope — not started by either Sprint 71 or Sprint 72.
