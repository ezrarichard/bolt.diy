# Backend Generation Architecture (Sprint 78)

**Status: architecture only — no code changes in this sprint. Revised per review feedback.** This
document defines the canonical backend architecture every Builders-**generated** application will
follow. It is entirely a design document: no backend code generation, no pipeline changes, no
prompt changes, no artifact changes, no lifecycle changes. Sprint 77's Feature/MVP lifecycle is the
organizing principle throughout — this document does not touch it, only builds on top of it.

## Revision note

Three clarifications were requested after the first draft, all incorporated below:

1. **Request-scoped Supabase clients, not a memoized singleton.** The first draft described the
   Repository layer's database client the same way `app/lib/builders-db/client.ts` memoizes
   BuildersDB's own (unauthenticated, anon-key-only) client. That's wrong for authenticated,
   per-user RLS-scoped access — §8 and §6 now specify a client constructed fresh per serverless
   request from the anon key + that request's own Bearer JWT, and explicitly separate this from a
   privileged service-role client that must never be the default path or reach generated SPA code.
2. **Feature vs. generated module, formalized.** The first draft said "one folder per Feature" but
   its own Dental Clinic example already showed two Features (`FEAT-006`, `FEAT-007`) sharing one
   `appointments` folder — an unstated aggregation. §5 now formalizes
   `MVP → Features → Feature Slice/Module`, a many-Features-to-one-module relationship, with every
   generated file required to retain the complete owning `featureIds` list.
3. **Explicit dependency on Sprint 77 being implemented.** Sprint 77 was architecture-only — nothing
   in it has been built yet. The closing roadmap now states, as Phase 0, exactly which Sprint 77
   foundations must exist before any incremental backend generation can run, separated from the
   Sprint 79-specific backend work and from the parts of Sprint 77 that can proceed in parallel.

## Critical research finding — there is no existing backend to extend

Unlike Sprint 75/76 (which activated a Database Engineer that already had real structured output to
build on) and Sprint 77 (which formalized mechanisms — Manifest versioning, cross-MVP resume — that
already existed), **Builders today generates zero real backend**. The generated output is a plain
client-side Vite + React + TypeScript SPA (`app/lib/code-generation/templateResolver.ts:25`,
`REACT_VITE_TS_TEMPLATE_ID`), and its one "services" file is an explicit **mock data facade** — the
code-generation system prompt (`app/lib/code-generation/prompts.ts:52-58`) literally instructs the
AI to return "realistic mock data (no real network calls — use an in-memory array and simulated
latency)". There are no server-side routes, no loaders/actions, no database access, anywhere in
generated output today. The Backend Engineer's draft (`BackendDraft`,
`app/lib/projects/prompts/backend.ts`) already plans a real backend in prose — `apiEndpoints`,
`authenticationFlow`, `businessServices`, etc. — but its system prompt explicitly forbids writing
any code (lines 98-116), exactly like the pre-Sprint-75 Database Engineer. This sprint's job is the
same shape of work Sprint 75 did for the database: turn an already-real planning artifact into a
real, generated implementation — except here there is no prior partial implementation to build on,
so the architecture must be chosen carefully, once, since it will govern every future generation.

---

## 1. Research findings

**What Builders already reuses well (confirmed, not re-derived — see Sprint 75-77 docs for detail):**
- `StructuredDatabaseSchema` + deterministic `sqlGenerator.ts`/`schemaValidator.ts` (Sprint 75).
- `DatabaseProvisioner` — a provider-independent interface with one real implementation
  (`SupabaseProvisioner`) and a hard BuildersDB/customer-database isolation boundary enforced at
  three layers (Sprint 76). **This exact pattern — provider-independent interface, concrete
  provider implementation, structural isolation — is the template Part 7 (Database Access Strategy)
  reuses directly for the Repository layer.**
- `Mvp`/`Feature` lifecycle, cross-MVP resume, `ApplicationManifest` versioning with per-file status
  and `mvpId`/`featureIds` tagging, category-level carry-forward (`resolveCarryForwardPlan`)
  (Sprint 77).

**What does not exist and must be designed fresh:**
- Any real request-handling layer (routes/controllers) in generated output.
- Any real database-access code in generated output (only a mock `services/api.ts`).
- A `ManifestFileCategory` for backend code — today's categories
  (`'entry' | 'config' | 'pages' | 'components' | 'types' | 'services' | 'styles' | 'documentation'
  | 'other'`, `manifestTypes.ts:49-58`) collapse ALL backend planning into one aggregate
  `src/services/api.ts` mock file, regardless of how many endpoints were planned — there is no
  endpoint-to-file or feature-to-file granularity today.
- Any wired deployment target. `Project.deploymentTarget` exists but is explicitly dead/unset
  metadata (`stores/projects.ts:246`, "Future fields — intentionally unset"); the repo's Vercel/
  Netlify OAuth+deploy code is bolt.diy's original chat-shell feature for deploying whatever
  WebContainer session is open, never invoked by the code-generation pipeline.
- Any auth flow in generated output. Builders' own auth (Supabase Auth, header-based
  `X-Builders-Auth`, `requireAuthenticatedUser`) is real working precedent to draw the *pattern*
  from, but it authenticates against BuildersDB's own Supabase project — a generated app must
  authenticate against the *customer's* provisioned Supabase project instead (Part 5).

---

## 2. Architecture recommendation

**Feature-Sliced Vertical Architecture with a thin Service/Repository layering inside each slice,
deployed as a Vite SPA + framework-agnostic serverless API functions.**

### Why not the alternatives

| Pattern | Verdict |
|---|---|
| **Remix-native loaders/actions** | Rejected. Builders itself is Remix, but nothing it generates is — migrating generated output to Remix would mean adopting a server-runtime requirement (Node process, not purely static+functions) for every generated app and every future deployment target, a far bigger footprint change than needed. Also breaks today's working Vite+React generation with no corresponding benefit. |
| **Full Domain-Driven Design (aggregates, domain events, CQRS)** | Rejected as too heavy. Generated apps are typically small-to-medium MVP-scoped products; heavy DDD ceremony fights against "deterministic, AI-regeneratable, one feature at a time" — the sprint's own stated objectives. |
| **Pure Repository Pattern with no Service layer** (Controllers call Repositories directly) | Rejected — collapses business logic into Controllers, which then can't be reused between an API route and, say, a background job or a second entry point. Keep the Service boundary. |
| **Vertical Slice architecture** | **Adopted as the organizing principle** — each Feature (Sprint 77's first-class entity) is a self-contained slice. This is the one pattern that maps 1:1 onto "Feature-based generation" without translation. |
| **Service Layer + Repository Pattern** | **Adopted as the internal layering within each slice** — thin, conventional, well-understood by any AI model asked to generate code in this shape, and it's the exact shape `DatabaseProvisioner` already proved works for provider-independence (Sprint 76). |
| **Lightweight feature-based folder structure with no explicit Service/Repository split (routes call the DB client directly)** | Rejected — this is what today's mock `services/api.ts` effectively already is (one undifferentiated blob), and it's exactly the shape that makes provider-independence and incremental regeneration hard, since there's no clean seam to regenerate around. |

**The combination — Vertical Slice for *organization*, Service/Repository for *internal layering* —
is not a trend-chase; it's the direct structural echo of two things Builders already does
successfully**: Sprint 77's Feature model (one slice per Feature) and Sprint 76's
`DatabaseProvisioner` abstraction (one interface, swappable implementations, applied here to every
Repository, not just the top-level database provisioner).

### Deployment shape

Generated apps stay a **Vite + React SPA** for the frontend (unchanged, still the correct choice —
no server-side rendering requirement exists today and none is introduced), with a new **`/api`
serverless functions directory** added alongside it — the Vercel/Netlify/Cloudflare Pages Functions
convention (a directory of framework-agnostic `(req) => response` handlers, zero custom server
process required). This is the smallest structural change that turns "no backend" into "a real
backend," while staying deployable everywhere a static site + functions already deploys today,
including providers not yet integrated (Part 11).

---

## 3. Folder structure (canonical, for every generated project)

```
src/
  app/                    # App shell: main.tsx, App.tsx, router config, root layout, providers
                           # (auth context, query client) — the ONLY place cross-feature wiring lives
  features/
    <module-slug>/         # e.g. "appointments" — one directory per Feature Slice/Module (§5), NOT
                           # one per Feature. A module owns a stable slug and may implement several
                           # related FEAT-NNN Features over its lifetime (§5 formalizes this).
      routes.ts            # Thin HTTP handlers for every endpoint this module owns (imported by /api/*)
      service.ts            # Business logic for this module
      repository.ts          # ALL Supabase/database access for this module — the only file in
                             # the module allowed to import a database client
      validators.ts           # Shared request/response schemas (Zod or equivalent), used by both
                               # the API route and any UI form in this module (Part 6)
      types.ts                 # Module-local types (extends, never duplicates, the DATABASE_SCHEMA-
                                # derived global types in src/types/)
      components/                # Module-specific UI components
      pages/                       # Module-specific pages/routes (frontend)
      hooks/                        # Module-specific React hooks
      tests/                         # Unit + feature tests for this module (Part 10)
  components/               # Shared, cross-feature UI components only (e.g. Button, Layout)
  services/                  # Cross-cutting services only (auth session, notifications) — never
                              # feature-specific business logic, which belongs inside a feature slice
  repositories/                # Shared base: the DB client wrapper every feature Repository composes
                                # (Part 7) — not a place for feature-specific queries
  lib/                          # Framework glue: Supabase client init, env/config loading, generic
                                 # utilities with no feature or domain knowledge
  types/                          # Global types generated directly from StructuredDatabaseSchema —
                                   # one source of truth every feature's types.ts extends
  hooks/                            # Shared, cross-feature hooks only
api/                                 # Deployment-target serverless functions — thin, one file per
                                      # route, each simply imports and calls the matching feature's
                                      # routes.ts handler. This directory is what makes the app
                                      # deployable on Vercel/Netlify/Cloudflare Pages Functions
                                      # unchanged; `src/features/*/routes.ts` stays framework-
                                      # agnostic so a future deployment target needs only a new,
                                      # thin adapter here — never touching feature code.
```

Every folder's existence is justified by one of the sprint's stated objectives: `features/` is
Feature-based generation itself; `repositories/`+per-feature `repository.ts` is provider
independence; `validators.ts` is shared, deterministic validation; `api/` is deployment-target
portability; `types/` sourced from `StructuredDatabaseSchema` is determinism (the same schema that
already deterministically generates SQL, Sprint 75, deterministically generates TypeScript types).

---

## 4. Layer responsibilities

```
Application
    ↓
Routes            (api/*.ts — deployment-target adapters; src/features/*/routes.ts — the real,
                    portable handler)
    ↓
Controllers/Actions  (the handler function itself: parse request → validate → call Service →
                       shape response → map errors to HTTP status)
    ↓
Services            (business logic: feature rules, orchestration across repositories, calls
                      to external integrations named in the Backend Draft's
                      `externalIntegrations`)
    ↓
Repositories          (the ONLY layer that talks to a database client — one Repository per
                        Module, implementing a small, module-specific interface covering every
                        Feature that module implements)
    ↓
Database                (the StructuredDatabaseSchema-defined schema, Sprint 75)
    ↓
Supabase                  (today's one real provisioned target, Sprint 76 — swappable per
                            Part 7, never assumed above the Repository layer)
```

| Layer | Responsibility | Must NOT do |
|---|---|---|
| Routes (`api/*.ts`) | Adapt one deployment target's function signature to a plain request/response call into `features/*/routes.ts` | Contain any logic — a one-line passthrough only |
| Controllers/Actions (`features/*/routes.ts`) | Validate input via `validators.ts`, call exactly one Service method, map its result/error to an HTTP response | Touch a database client; contain business rules |
| Services (`service.ts`) | Business logic, orchestration, external integrations | Know about HTTP (no request/response objects); import a database client directly |
| Repositories (`repository.ts`) | Encapsulate every query for this module's tables against the current provider | Contain business logic or validation |
| Database | The provisioned schema | — |
| Supabase (or a future provider) | The concrete engine a Repository's queries execute against | Ever be referenced outside a Repository file |

This is the same discipline `SupabaseProvisioner` already enforces for the platform-level database
provisioning concern (Sprint 76) — Sprint 78 simply applies the identical discipline one layer down,
per Feature, for application-level data access.

---

## 5. Feature generation model — formalizing Feature vs. Module

**Correction from the first draft**: the first draft said "one folder per Feature," but its own
Dental Clinic example assigned two Features (`FEAT-006`, `FEAT-007`) to one `appointments` folder
without ever stating the rule that made that legitimate. This revision makes the relationship
explicit and names both levels:

```
MVP
  └── Features (Sprint 77's first-class Feature rows — the unit Product Owner/QA/traceability
       │         reason about; FEAT-NNN, one row per planned capability)
       │
       └── Feature Slice / Module (the unit CODE is organized into — a stable, human-meaningful
             domain grouping, e.g. "appointments"; may implement one Feature or several
             related ones)
```

- **A Module is not a Feature, and not automatically one-per-Feature.** `FEAT-006` ("Book an
  appointment") and `FEAT-007` ("Cancel an appointment") both belong to the `appointments` Module
  because they operate on the same underlying entity/table cluster
  (`StructuredDatabaseSchema`'s `appointments` table and its close relations). A later MVP's
  `FEAT-012` ("Appointment reminders") would *also* belong to the `appointments` Module if it
  operates on the same tables — grouping is decided by shared data ownership, not by MVP or
  arrival order.
- **Module assignment is explicit, not inferred at generation time.** Each `Feature` row gains one
  new field, `moduleSlug` (default: the Feature's own `code`, i.e. 1:1 with its own module unless
  explicitly grouped) — set once, at the same Gate-A commit-on-approval moment `Feature` rows
  themselves are created (Sprint 77 §3), by the Product Owner/Solution Architect's existing scoping
  work (which entities a feature touches is already implicit in `EngineeringHandoff`/Architecture
  Draft content — Sprint 79 makes it an explicit field rather than leaving grouping to be
  re-inferred by whichever engine happens to run later). This is additive to the `Feature` shape
  Sprint 77 already specified — no new entity, one new field.
- **Every generated manifest file retains the complete owning `featureIds` list — never collapsed to
  one id.** A file inside `src/features/appointments/` that implements behavior for both `FEAT-006`
  and `FEAT-007` is planned with `featureIds: ["FEAT-006", "FEAT-007"]` on
  `ApplicationManifestFileDraft` (the field already exists, Sprint 49) — not `["FEAT-006"]` picked
  arbitrarily. This is what keeps per-feature traceability (QA regression-vs-new classification,
  Product Package feature lists, activity history) accurate even though the file boundary is the
  Module, not the Feature.

```
Module: appointments (implements FEAT-006, FEAT-007)
  generates only:
    src/features/appointments/routes.ts        featureIds: [FEAT-006, FEAT-007]
    src/features/appointments/service.ts       featureIds: [FEAT-006, FEAT-007]
    src/features/appointments/repository.ts    featureIds: [FEAT-006, FEAT-007]
    src/features/appointments/validators.ts    featureIds: [FEAT-006, FEAT-007]
    src/features/appointments/types.ts         featureIds: [FEAT-006, FEAT-007]
    src/features/appointments/components/*     featureIds: (per-file — whichever of the two a
                                                 given component actually implements)
    src/features/appointments/pages/*          same
    src/features/appointments/hooks/*          same
    src/features/appointments/tests/*          same
    api/appointments/*.ts   (thin adapters)
  never touches:
    any other module's directory
    src/components/, src/services/, src/repositories/, src/lib/, src/types/  — unless this
      Module is the FIRST module generated for the project (these shared/global files are
      scaffolded once, then only extended — never regenerated wholesale — by later modules;
      see §9's carry-forward rule)
```

**When a later MVP adds a Feature to an *existing* Module** (e.g. MVP2 adds `FEAT-012`,
"Appointment reminders," also `moduleSlug: "appointments"`): only the `appointments` Module's files
regenerate, and the regenerated files' `featureIds` accumulate — `["FEAT-006", "FEAT-007",
"FEAT-012"]`, never dropping the Features a module already implemented. Every *other* module (e.g.
`billing`) remains untouched, exactly as if the new Feature had introduced a brand-new module —
module-level carry-forward (§9) does not care whether a module's regeneration was triggered by a
new Feature in an existing module or a wholly new module.

Mechanically, this is `Feature` (Sprint 77) driving `ApplicationManifest` planning exactly as
Sprint 77 already specified for Backend/Frontend evolution generally, grouped by `moduleSlug` for
file-boundary purposes — Sprint 78 is the concrete file-shape that plan produces.

---

## 6. Authentication architecture (design only — no implementation)

- **Provider**: Supabase Auth, on the **customer's own provisioned Supabase project** (the one
  connected via Sprint 76's `SupabaseProvisioner`/session-scoped credential flow) — never
  BuildersDB's project. This mirrors Builders' own precedent (`authServer.ts`) at the pattern level
  only; the actual project/credentials are completely disjoint, by the same isolation boundary
  Sprint 76 already enforces structurally.
- **Session handling**: client-side, via `@supabase/supabase-js`'s own session management
  (`onAuthStateChange`, its default `localStorage` persistence) — appropriate for a client-side SPA
  with no server session store. This is a deliberate, narrower choice than Builders' own header-based
  pattern (`X-Builders-Auth`): Builders' pattern exists because Builders' own backend is Remix with
  server-side route guards; a generated app's serverless functions are stateless and each already
  needs to independently verify the caller's Supabase JWT on every request regardless of transport —
  so a standard `Authorization: Bearer <supabase-jwt>` header (Supabase's own convention, not a
  Builders-specific header) is the natural fit, verified server-side via
  `supabase.auth.getUser(token)` inside each feature's Controller — the exact same verification call
  `requireAuthenticatedUser` already makes today, reused as a *pattern*, not as shared code (a
  generated app is a separate codebase from Builders).
- **Protected routes**: every Controller (`features/*/routes.ts`) that needs an authenticated user
  calls a shared `requireUser(request)` helper (new, generated once into `src/lib/`, reused by every
  feature) — same shape as `requireAuthenticatedUser`, generated rather than imported since generated
  apps don't depend on Builders' own source tree. `requireUser` extracts the Bearer JWT and is also
  the one place that constructs the request-scoped Supabase client every Repository call in that
  request uses — see §8 for why this must never be a memoized/global client.
- **Roles/permissions**: primarily enforced at the database layer via **Postgres Row-Level Security
  policies** — `StructuredDatabaseSchema.policies` already exists as a reserved, "future-ready" field
  (`schemaTypes.ts`, Sprint 75) specifically for this; Sprint 78 is the first consumer that gives it
  real meaning. Service-layer authorization checks (e.g. "only an Appointments admin can cancel
  another user's booking") are defense-in-depth on top of RLS, never a replacement for it —
  RLS is the enforcement boundary that holds even if a Service-layer check has a bug.
- **User context**: the Controller resolves the authenticated user once (via `requireUser`) and
  passes it explicitly into Service calls that need it — never a global/ambient context reached into
  from deep inside a Repository.

---

## 7. Validation architecture

- **Validation lives in `features/<feature>/validators.ts`**, one schema per endpoint/form, shared
  between the API Controller (server-side, authoritative) and any UI form in the same feature
  (client-side, for fast feedback) — imported by both, never duplicated. This directly answers "how
  does generated validation remain deterministic": validators are generated **directly from
  `StructuredDatabaseSchema`'s column definitions** (type, `nullable`, `unique`, enum values) plus
  the Feature's `acceptanceCriteria` (already on `EngineeringHandoff`, Sprint 46B) — never invented
  freeform by the AI per endpoint, so the same schema always produces the same validation shape.
- **API validation vs. UI validation**: same schema, two call sites. The Controller uses it as a hard
  gate (reject with 400 on failure); the UI uses the identical schema for inline field-level
  feedback before submission. There is exactly one place a validation rule is defined per field —
  eliminates the classic "frontend and backend validation drift apart" failure mode by construction.
- **Repositories never validate** — by the time a Repository method runs, its input has already
  passed through a Controller's validator; Repositories trust their callers within the same request,
  the same discipline `sqlGenerator.ts` already has toward `schemaValidator.ts` (SQL generation
  never re-validates what the validator already gated).

---

## 8. Repository strategy (database access)

**Services never talk directly to Supabase (or any provider) — only Repositories do.** This is the
direct, one-layer-down application of the exact pattern `DatabaseProvisioner` (Sprint 76) already
proved: a small, provider-independent interface, with today's Supabase implementation the only
concrete one that exists.

```ts
// Generated once per feature, shape only — illustrative, not literal generated code:
interface AppointmentsRepository {
  findById(id: string): Promise<Appointment | null>;
  listForUser(userId: string): Promise<Appointment[]>;
  create(input: NewAppointment): Promise<Appointment>;
  // ...one method per query this feature's Service layer actually needs — never a generic
  // "query anything" escape hatch, which would defeat the provider-independence boundary.
}
```

- **How generated code accesses the database**: through this interface only. The concrete
  implementation generated today (`SupabaseAppointmentsRepository`) uses `@supabase/supabase-js`
  against the customer's provisioned project — the same client library, same connection precedent
  Sprint 76 already established, just used at the application layer instead of the platform
  provisioning layer.
- **How future providers fit without changing business logic**: a `PostgresAppointmentsRepository`/
  `MySQLAppointmentsRepository`/future-CubicleDB implementation satisfies the exact same interface.
  Services depend only on the interface (constructor/factory injection, resolved once at app
  startup from a single provider-selection point in `src/lib/`), so swapping providers is a
  Repository-layer-only change — precisely mirroring how `getDatabaseProvisioner(providerId)`
  (Sprint 76) is the one place provider selection happens for platform provisioning. No Service,
  Controller, or UI code ever imports a database client directly; this is enforced by convention
  (documented here) and is straightforward to lint for in Sprint 79 (a rule: only `repository.ts`
  files may import `@supabase/supabase-js` or any future provider SDK).
### Request-scoped clients — not a memoized singleton

**Correction from the first draft**: the normal Repository execution path must **not** use a
memoized/global Supabase client the way `app/lib/builders-db/client.ts` memoizes BuildersDB's own
(unauthenticated, anon-key-only) connection. That pattern is only safe for BuildersDB's own
control-plane access; it is the wrong shape for a generated app's per-user, RLS-scoped data access,
and Builders itself already has the correct working precedent to follow instead:
`app/lib/ai-usage/aiUsageRepository.ts` constructs a **fresh, per-request Supabase client carrying
the caller's own access token as an `Authorization` header** — never the memoized singleton —
specifically so Postgres RLS's `auth.uid()` resolves to the actual calling user. Sprint 78's
Repository layer applies this exact pattern at the application-data layer:

- **Shared base** (`src/repositories/`): a `getRequestScopedClient(bearerJwt: string)` factory —
  called once per incoming request (inside `requireUser`, §6), constructing a new
  `createClient(customerProjectUrl, customerAnonKey, { global: { headers: { Authorization:
  \`Bearer ${bearerJwt}\` } } })` **every time**, never cached, never reused across requests. This is
  what every feature Repository composes.
- **This client preserves the caller's RLS context by construction**: because it's built from the
  public anon key plus that specific request's JWT, every query it issues runs as that
  authenticated user, so RLS policies (`StructuredDatabaseSchema.policies`, §6) see the real
  `auth.uid()` — exactly the property `aiUsageRepository.ts`'s pattern already relies on today.
- **It must never leak state between serverless requests.** Because the client is constructed fresh
  per invocation from that invocation's own JWT, there is no shared client instance in which one
  request's identity could bleed into another's — this is a structural property of "always
  construct, never memoize," not something achieved by careful cleanup after the fact.

### Privileged service-role client — explicitly separate, server-only, not the default path

A small number of operations (Sprint 79 will need to name them precisely — e.g. system-initiated
background jobs with no calling user, or an admin operation that must bypass RLS deliberately) may
require Supabase's **service-role key**, which bypasses RLS entirely. This is architecturally a
**different, clearly-labeled client** (`getPrivilegedClient()`, not `getRequestScopedClient`), and:

- The service-role key is a server-only secret — it must never be bundled into the SPA's client-side
  JavaScript, never sent to the browser, and never read from any code path reachable by
  `src/app/`, `src/components/`, `src/features/*/pages`, `src/features/*/components`, or
  `src/features/*/hooks`. It exists only in serverless-function-only code (`api/*.ts` and files
  under `src/features/*/` that are never bundled client-side — this boundary already exists in a
  standard Vite + serverless-functions project, since `api/` is never included in the client build).
- **It is never the normal Repository execution path.** A default-generated `Repository`
  implementation always uses `getRequestScopedClient`. `getPrivilegedClient` is opt-in, per method,
  and every such method must be named and justified explicitly (e.g.
  `AppointmentsRepository.adminCancelAnyBooking`, not a silent fallback inside `findById`) so a
  future reader — human or AI — can see at a glance which queries deliberately bypass RLS and why.
- Sprint 79 must design exactly which (if any) generated operations need this — this document only
  establishes that the seam exists and is structurally impossible to blur with the normal path,
  since the two are different function names with different, non-overlapping call sites.

---

## 9. Incremental generation strategy

**This is the central mechanism — it is a direct, mechanical extension of what Sprint 77 already
specified, made concrete at the file level.**

```
Current Product (the previously-released MVP's Manifest — files whose category/content
                  checksum is unaffected by the new MVP's Features)
        ↓
Current Features (Feature rows with status = 'deployed', owned by earlier, released MVPs)
        ↓
Selected MVP (Sprint 77 §2 — the one Mvp row currently in engineering)
        ↓
Selected Features (Feature rows with mvpId = selected MVP's id, §Sprint 77 §3)
        ↓
Selected Modules (the distinct set of moduleSlug values those Features map to, §5 — a
                   Selected Feature belonging to an EXISTING module marks that whole module
                   selected too, not just the new Feature's own slice)
        ↓
Generate only:
    src/features/<selected-module-slug>/routes.ts        (featureIds: full owning list, §5)
    src/features/<selected-module-slug>/service.ts
    src/features/<selected-module-slug>/repository.ts
    src/features/<selected-module-slug>/validators.ts
    src/features/<selected-module-slug>/tests/*
    api/<selected-module-slug>/*.ts
        ↓
No regeneration of any other module.
```

Mechanically:

1. `buildGenerationPlan` (`generationPipeline.ts`) resolves the active MVP's `Feature` rows (Sprint
   77 recommendation #3 — querying the Feature repository directly, not a copied scope list),
   resolves each to its `moduleSlug` (§5), and plans manifest entries **only** for files under
   `src/features/<moduleSlug>/` and `api/<moduleSlug>/` for the resulting set of modules — each
   entry's `featureIds` is that module's complete, accumulated Feature list, not just the newly
   selected one.
2. Every other planned file (shared `src/lib/`, other modules) is left to
   `resolveCarryForwardPlan`'s existing category-invalidation logic (`resumeOrchestrator.ts:81-132`)
   — unaffected categories are carried forward from the previous manifest version unchanged, exactly
   as it already does for same-MVP replans today. **No new carry-forward mechanism is needed** —
   Sprint 78 only needs `ManifestFileCategory` extended with module-scoped granularity (either new
   category values, or, more simply, keeping the existing categories but adding a mandatory
   `moduleSlug` on every backend file so carry-forward can be evaluated per-`(category, moduleSlug)`
   pair instead of per-category alone) so that "Appointments' service checksum is unchanged" and
   "Billing's service checksum is new" can be independently true within what is today a single
   undifferentiated `'services'` category.
3. `crossMvpTransition`/`previousMvpId` (already computed today, Sprint 77) is exactly the signal
   that should cause the new activity types `backend_delta_generated`/`frontend_delta_generated`
   (Sprint 77 §Part 10) to fire, narrating precisely which modules were newly generated versus
   carried forward, and which Features (potentially several per module) each covers.

**Never regenerate the whole application**: enforced structurally, not by convention — a module is
only ever touched by a generation run whose Selected Features include at least one Feature owned by
that module.

---

## 10. Testing strategy

| Test kind | Location | Scope |
|---|---|---|
| Unit tests | `features/<moduleSlug>/tests/service.spec.ts`, `repository.spec.ts`, `validators.spec.ts` | One module's business logic/data access/validation, in isolation (Repository tests run against a test/staging Supabase project, never BuildersDB, never the customer's production project) |
| Integration tests | `features/<moduleSlug>/tests/routes.spec.ts` | The module's Controller + Service + Repository wired together, hitting a real (test) database |
| Feature tests | `features/<moduleSlug>/tests/<feature-code>.spec.ts` | End-to-end for one specific Feature's user-facing behavior, tagged with that Feature's `code` — one file per Feature even when several share a module, so regression classification (below) stays per-Feature, not per-module |
| Regression tests | Existing Feature test files, for any Feature owned by an MVP *before* the active one | Re-run unchanged on every new MVP's QA pass — directly implements Sprint 77 §Part 4's QA distinction |

**How future AI QA consumes this structure**: because every Feature test file lives inside the
module it tests, is named after its Feature, and every Feature already carries a `status`
(Sprint 77), a QA Engineer generation run needs only two facts to know exactly what to do: which
`Feature` rows are new this MVP (write new feature tests) and which are `deployed` from a prior MVP
(re-run their existing tests as regression) — no separate "test plan" artifact to keep in sync, no
re-deriving scope from prose, and no ambiguity from a module implementing more than one Feature.

---

## 11. Deployment compatibility

| Target | Fit |
|---|---|
| **Vercel** | Native — `api/*.ts` is Vercel's own serverless function convention, zero adapter needed. |
| **Supabase** | Already the primary, working provider (Sprint 76) — Repositories generated today target it directly. |
| **Future self-hosted providers** (Postgres, MySQL, CubicleDB) | Absorbed entirely by the Repository layer (§8) — no other layer changes. |
| **Netlify / Cloudflare Pages Functions** | Both support the same "static site + functions directory" shape; `api/*.ts` needs only a thin per-target adapter (a build-time rename/re-export), never touching `src/features/*/routes.ts`. |
| **Incremental deployments** | A direct consequence of §9 — only changed feature slices' compiled output differs between deployments; most deployment targets (Vercel included) already diff-deploy based on changed files. |
| **Database migrations** | Sprint 77's Schema Diff engine (recommendation #6) feeds the same, unchanged `SupabaseProvisioner.provision()` — no new provisioning path for incremental schema changes. |
| **Feature evolution** | New feature slices are additive folders — nothing about deployment changes shape as the product grows, only volume. |

---

## 12. Product Package evolution (backend artifacts)

Additive to Sprint 77's already-recommended append-only Product Package history (recommendation #5)
— new backend-specific files per MVP's package snapshot:

- **API documentation**: generated deterministically from every feature's `validators.ts` +
  `routes.ts` shape (endpoint, method, request/response schema) — no AI call, same rule-based
  pattern as today's `database-summary.md`.
- **Route manifest**: every planned `api/*.ts` file this MVP, with its owning Feature id.
- **Service manifest** / **Repository manifest**: one entry per feature slice generated or carried
  forward this MVP, and which (new vs. carried-forward) — directly answers "what changed" without
  re-diffing anything.
- **Migration summary**: Sprint 77's `SchemaDelta`, already planned to render as markdown.
- **Validation summary**: the set of validators generated this MVP, and which schema fields they
  derive from.
- **Architecture summary**: a per-project instantiation of this document's layer diagram (§4),
  useful as a durable reference for anyone maintaining the generated app later, human or AI.

---

## 13. Verification example: Dental Clinic

```
MVP1 — Features FEAT-006, FEAT-007 → Module: appointments (moduleSlug "appointments", §5)
  Generated:
    src/features/appointments/{routes,service,repository,validators,types}.ts
    src/features/appointments/{components,pages,hooks,tests}/*
    api/appointments/*.ts
    src/lib/ (supabase client, requireUser) — scaffolded once, this being the first module
    src/types/ (from StructuredDatabaseSchema) — scaffolded once
  Manifest: every file tagged featureIds: ["FEAT-006", "FEAT-007"] (the module's complete
  owning list), carry-forward evaluated per (category, moduleSlug) (§9).

MVP2 — Features FEAT-010, FEAT-011 → new Module: billing
  Gate A approved → Feature rows FEAT-010/011 committed under MVP2 (Sprint 77 §3), each with
  moduleSlug "billing" (a new module — no prior Feature shared this slug).
  Generated ONLY:
    src/features/billing/{routes,service,repository,validators,types}.ts
    src/features/billing/{components,pages,hooks,tests}/*
    api/billing/*.ts
  Untouched (carried forward, checksums unchanged):
    src/features/appointments/*  — every file, byte-identical
    src/lib/, src/types/ (unless Billing's schema changes required new global types — in which
      case only src/types/ is regenerated, via the same file-level checksum comparison, never
      the whole directory blindly)
  Manifest: new entries tagged featureIds: ["FEAT-010", "FEAT-011"]; Appointments' existing
  entries retained at their prior manifest version, `status` unchanged.
  Database: diffStructuredSchemas(MVP1 schema, MVP2 schema) → invoices/payments tables only;
  Appointments' repository.ts queries continue to run against the exact same, untouched tables.
  Deployment: only billing's compiled output ships; appointments' bundle is unchanged and is
  not re-uploaded.

MVP3 — Feature FEAT-018 ("Appointment reminders") → EXISTING Module: appointments
  Gate A approved → Feature row FEAT-018 committed under MVP3, moduleSlug "appointments"
  (explicitly assigned, per §5, because it operates on the same appointments table).
  Selected Modules = { appointments } — NOT a new module, so the whole appointments module is
  regenerated (not just a new file):
    src/features/appointments/{routes,service,repository,validators,types}.ts  — regenerated
    src/features/appointments/{components,pages,hooks,tests}/*                 — regenerated
    api/appointments/*.ts                                                       — regenerated
  Manifest: appointments' entries now tagged featureIds: ["FEAT-006", "FEAT-007", "FEAT-018"]
  — accumulated, not replaced. FEAT-006/007's own behavior/tests are unaffected by this
  regeneration (same Feature test files, still passing, now sitting alongside FEAT-018's new
  test file in the same module's tests/ directory).
  Untouched: src/features/billing/* — entirely unaffected, since none of its Features changed.
```

This is the same Dental Clinic walkthrough Sprint 77 used, now shown at the actual generated-file
level, including the one case Sprint 77's own version didn't need to show — a later MVP extending
an *existing* module rather than introducing a new one — confirming the two documents describe one
continuous mechanism, not two separate ones.

---

## Implementation roadmap — explicit dependency order

**Correction from the first draft**: the first draft's recommendations read `Feature`,
`resolveActiveMvpId`, and manifest `mvpId`/`featureIds` tagging as already-usable primitives.
**They are not** — Sprint 77 was architecture-only; none of it has been built. This roadmap makes
the dependency explicit as three phases, in order. Phase 0 is a hard blocker for Phase 1. Phase 2
can proceed before, after, or in parallel with Phase 1 — it is gated separately, not by Phase 1.

### Phase 0 — Sprint 77 foundations (must exist before any incremental backend generation)

Everything in this phase is a **prerequisite**, not a Sprint 78/79 deliverable — it is Sprint 77's
own recommendation list, reordered here to make explicit exactly which subset backend generation
depends on:

1. **Persisted, first-class `Feature` records** (Sprint 77 recommendation #2) — without a real,
   queryable `Feature` table, there is nothing for `moduleSlug` (§5) to live on and nothing for
   `buildGenerationPlan` to resolve "selected Features" from.
2. **Idempotent Gate A Feature promotion** (Sprint 77's explicit implementation guardrail — keyed on
   `(mvpId, code)`, safe to re-run on resume/re-approval) — without this, a resumed or re-triggered
   generation run risks planning against duplicate or drifting Feature rows.
3. **Valid Feature and parent-MVP status transitions** (Sprint 77's other explicit guardrail — the
   centralized allowed-transitions check) — without this, `Feature.status`
   (`planned → in_progress → generated → qa_passed → deployed`) and the extended `MvpStatus` have no
   enforcement, and §9/§10's "which Features are new vs. deployed" logic can't trust the data it
   reads.
4. **Active-MVP Feature resolution** (Sprint 77 recommendation #3 — resolving "features in scope" by
   querying `Feature WHERE mvpId = activeMvpId`, replacing `GenerationPlanScope.inScopeFeatureIds`)
   — this is the exact query §9's "Selected Features" step performs; it must exist first.
5. **Feature-aware manifest planning and carry-forward** (Sprint 77 recommendation #1 — `mvpId` on
   `ProjectArtifact` — plus this document's own extension of that idea, `moduleSlug`/per-module
   `featureIds` carry-forward, §9) — the mechanism §9 describes IS this item; it is listed here
   because it is inseparable from Phase 0, not something Sprint 79 can build standalone without the
   first four items already in place.

**Backend generation (Phase 1) cannot begin until all five of the above exist and are tested.**

### Phase 1 — Sprint 79: backend-generation-specific work (depends on Phase 0)

1. **Add `moduleSlug` to `Feature`** (§5's new field, additive to the Phase-0 `Feature` shape).
2. **Extend `ManifestFileCategory`** with module-scoped granularity (§9) — new category values, or a
   mandatory `moduleSlug` dimension alongside existing categories.
3. **Design the generated-app `Repository` interface generator** — one Repository interface +
   Supabase implementation per Module, using request-scoped clients (§8) — from
   `StructuredDatabaseSchema` and the module's Features' `EngineeringHandoff` scope, mirroring
   `getDatabaseProvisioner`'s provider-selection pattern.
4. **Design the generated-app auth scaffold** (`requireUser` helper constructing the request-scoped
   client, Supabase Auth client setup, RLS-policy generation from
   `StructuredDatabaseSchema.policies`, and the explicitly-separate privileged-client seam, §8) —
   one-time, project-level, not per-module.
5. **Design the validator generator** — deterministic Zod-schema-shape generation from
   `StructuredDatabaseSchema` columns + Feature acceptance criteria (§7).
6. **Update `manifestBuilder.ts`** to plan one manifest entry per module-slice file (grouped by
   `moduleSlug`, tagged with the module's full `featureIds`) instead of one aggregate
   `services`/`pages` file — the Backend/Frontend Engineer *prompts themselves* need no changes.
7. **Wire `api/*.ts` deployment-target adapters**, starting with Vercel (native fit, §11).

### Phase 2 — separately gated, may proceed before, after, or alongside Phase 1

Not a dependency of backend generation — these improve traceability/database evolution but backend
generation does not require them to function:

1. **Product Package append-only history** (Sprint 77 recommendation #5) — needed for §12's backend
   Product Package artifacts to have a place to live across MVPs, but backend generation itself can
   run and ship correctly before this exists; it only means package history is missing until it does.
2. **Schema Diff / migration engine** (Sprint 77 recommendation #6) — needed for Database evolution
   past MVP1, but a Module's Repository/validators can be generated and reviewed against MVP1's
   schema regardless of whether the diff engine exists yet; it only gates *provisioning* an MVP2+
   schema change, a database-layer concern, not a backend-code-generation one.

Stop after this architecture document. Do not begin Backend Code Generation until this has been
reviewed and approved.
