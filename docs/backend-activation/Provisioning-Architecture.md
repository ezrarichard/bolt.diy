# Real Database Provisioning — Architecture (Sprint 76)

**Status: approved and implemented (Phase 2 complete).** This document was approved as written,
including the revised session-scoped credential design in §4.1-4.4, and Phase 2 implements exactly
this architecture — no deviations. See "Phase 2 implementation notes" at the end of this document
for what was actually built and where.

## 1. BuildersDB vs. customer database — the hard boundary

**BuildersDB** (`app/lib/builders-db/`) is the Builders platform's own database. It stores, in
Supabase project configured via `BUILDERS_DB_SUPABASE_URL`/`BUILDERS_DB_SUPABASE_ANON_KEY`:

- `builders_projects` — project metadata, plus a `metadata` JSONB column folding in a fixed
  allowlist (`METADATA_FIELDS`, `app/lib/builders-db/buildersDbTypes.ts`) that already includes
  `regionalSelection`, `packageSelection`, `databaseActivation` (Sprint 75), `githubRepo`, and
  **`supabaseProjectId`**.
- `builders_role_outputs` — every AI role's artifacts (including `DATABASE_DRAFT`/`DATABASE_SCHEMA`).
- `builders_project_tasks`, `builders_task_reviews`, `builders_execution_logs` — task/review/history.
- `builders_project_activity` — the activity feed.
- `builders_project_members`, `builders_context_traces`.

**Customer database** is whatever database a *generated application* ends up running against —
today that's undefined (nothing provisions it); Sprint 76 makes it a real, separate Supabase
project the customer already owns.

**The rule going forward:** BuildersDB stores *facts about* a customer database (which provider,
which project id, provisioning status, timestamps, error messages) — never the customer database's
data, and never a path that could execute generated SQL against BuildersDB's own project. No
`DatabaseProvisioner` implementation may ever be pointed at `BUILDERS_DB_SUPABASE_URL`. This is
enforced structurally in Phase 2 (Part 2 below), not just by convention.

## 2. Provisioning options — evaluation

| Option | Verdict |
|---|---|
| **A. Provision into Builders' own existing Supabase project** | **Rejected.** This is BuildersDB's own project — provisioning customer schemas into it would mix platform and customer data in the same database. Never implemented, and Part 2 makes it structurally impossible (below). |
| **B. Programmatically create a brand-new Supabase project** | **Deferred**, not built in Sprint 76. The Management API supports project creation, but it requires selecting a billing org, takes ~2 minutes to provision, and has real billing consequences (a paid org may be charged) — this needs a deliberate product decision on org selection and cost-confirmation UX that's out of scope here. Today's `useSupabaseConnection.ts`'s `handleCreateProject` already just opens `app.supabase.com/new/new-project` in a new tab; that stays as-is. |
| **C. Connect an existing customer Supabase project** | **Recommended for Sprint 76.** This is the smallest safe step, and — critically — the primitives already exist and work: `useSupabaseConnection.ts`/`app/lib/stores/supabase.ts` already let a user authenticate with their own Supabase Management personal access token and pick one of *their own* existing projects (not Builders'), and `app/routes/api.supabase.query.ts` already executes arbitrary SQL against a chosen project via the Management API. Sprint 76 wires the Sprint 75 provisioning abstraction to this existing, working connection — it does not invent a new connection flow. |
| **D. Future self-hosted CubicleDB** | Not started (confirmed zero references anywhere in the repo). The abstraction accommodates it as a future `DatabaseProviderId` value, same shape as `'postgres'`; no code for it ships in Sprint 76. |
| **E. Provider-independent abstraction over all of the above** | **This is the architecture, not an alternative to it.** Sprint 75 already built `DatabaseProvisioner` (`provision()`/`verifyConnection()`) and `DatabaseProviderId = 'mock' \| 'supabase' \| 'postgres' \| 'sqlite'`. Sprint 76 implements `'supabase'` behind that exact interface (Option C's connection model), leaving `'postgres'`/`'sqlite'`/a future CubicleDB provider id as still-unimplemented but correctly-shaped seams. |

**Recommendation:** Option E as the standing architecture, with Option C as the one real
implementation Sprint 76 ships (`SupabaseProvisioner`, Mode A in Part 2 of the sprint brief).
Option B is explicitly out of scope. Option A is permanently rejected.

## 3. Current infrastructure audit — what's reusable

Already working and reused as-is (no duplication):

- **Connection + project selection model**: `app/lib/stores/supabase.ts` +
  `app/lib/hooks/useSupabaseConnection.ts` establish the *only* existing customer-Supabase auth
  model in the codebase — a user authenticates with their own Supabase Management personal access
  token and picks one of their own existing projects (Management API token, not OAuth, not a project
  service-role key). Sprint 76 reuses this **model** (same token type, same "list my projects, pick
  one" UX shape) but not this store's implementation: as revised in §4, provisioning uses a separate,
  session-scoped credential holder rather than `supabaseConnection`'s indefinite `localStorage`
  persistence, because provisioning executes real DDL and needs a stricter lifetime — see §4.1 for
  why, and note this legacy store/feature itself is unmodified and out of scope.
- **SQL execution primitive**: `app/routes/api.supabase.query.ts` — `POST` with `{ projectId, query }`
  and the user's Management token in the `Authorization` header, executing against
  `POST https://api.supabase.com/v1/projects/{projectId}/database/query`. This is the real SQL
  execution path `SupabaseProvisioner` calls into — it already returns structured success/error
  responses, which Part 3's execution report is built from directly.
- **`@supabase/supabase-js`** (`^2.110.0`, already a dependency) is used today only for BuildersDB's
  own project (`app/lib/builders-db/client.ts`, `app/lib/auth/authServer.ts`) and for a
  per-request-authenticated client pattern in `app/lib/ai-usage/aiUsageRepository.ts`. **Not used**
  for customer projects — the legacy feature deliberately goes through the Management API's SQL
  endpoint over raw `fetch`, not a `SupabaseClient` pointed at the customer's Postgres. Sprint 76
  keeps this precedent: `SupabaseProvisioner` calls the existing `/api/supabase/query` route rather
  than opening a direct Postgres/`supabase-js` connection to a customer project — no new client
  construction pattern, no new dependency.
- **Explicitly not reused**: `app/lib/builders-db/providers/supabaseProvider.ts` (the inert Sprint 18
  `ProjectRepository` skeleton) is unrelated — it's a dead selector abstraction for BuildersDB's own
  storage, superseded by `buildersDbRepository.ts`. Sprint 76 does not touch or resurrect it.

## 4. Database ownership model — tracking without exposing secrets

**What Builders tracks** (in `Project.databaseActivation`, extended — same metadata-folding
convention as today, no new BuildersDB table):

- `provider`: `DatabaseProviderId` (`'supabase'` for Sprint 76's real path).
- `connection`: the customer's Supabase **project id** only (public identifier, not a secret) —
  reuses the existing `supabaseProjectId` metadata field's *concept*; Sprint 76 stores it inside
  `databaseActivation.provisioning` rather than introducing a second place to look.
- `status`, `startedAt`/`finishedAt`, `message` — already exist from Sprint 75, extended with a real
  execution report (Part 3) and schema version (Part 5).

**What Builders never stores, ever:** the customer's Supabase Management personal access token, or
any service-role/database credential. Never in BuildersDB, never in `Project`/`databaseActivation`
or any other project metadata, never in an artifact, a Product Package file, a prompt sent to an
LLM, an activity log entry, or an error message. `DatabaseActivationState`'s type has no field that
could hold one — this is enforced by construction, not just convention, and Part 7's tests assert it
directly (§4.4 below).

### 4.1 Revision — this section replaces the original draft's credential design

The first draft of this document said the token "already lives client-side only (localStorage + a
cookie)... Sprint 76 does not change this." **That's wrong for a feature that executes real DDL**
against a customer's database, and this revision replaces it: indefinite `localStorage` persistence
is appropriate for the legacy feature's low-stakes use (browsing your own project list / env vars)
but not for something that runs arbitrary generated SQL. Sprint 76 introduces a **separate,
purpose-built, session-scoped credential holder** for provisioning specifically — it does not reuse
`app/lib/stores/supabase.ts`'s `supabaseConnection`/localStorage persistence, and it does not modify
that existing store or feature (still out of scope, untouched).

### 4.2 Credential flow (revised)

```
Browser                                          Builders server (Remix routes)          Supabase

1. User pastes their Supabase Management PAT
   into a provisioning-specific "Connect"
   form (DatabaseActivationCard). The PAT is
   held ONLY in an in-memory store for this
   tab — never written to localStorage.
   (Optional: mirrored to sessionStorage only,
   so a same-tab reload survives; sessionStorage
   is cleared automatically on tab close — this
   is explicitly a session/dev-safe convenience,
   not a security control. See §4.3.)
        │
        │ 2. Every Management API / SQL call is a
        │    request to Builders' OWN server route
        │    (never a direct browser → api.supabase.com
        │    call), with the PAT attached per-request
        ▼
   POST /api/supabase/query  ────────────────────►  3. Route runs server-side, under
   { projectId, sql }                                  requireAuthenticatedUser. Uses the
   Authorization: Bearer <PAT>                          PAT ONLY for this one request —
                                                         never written to disk, a database
                                                         row, or a persistent log line.
                                                            │
                                                            │ 4. Forwards to Supabase's
                                                            │    Management API with the
                                                            │    same PAT, server-to-server
                                                            ▼
                                                    ────────────────────────────────►  Customer's
                                                                                        Supabase
                                                                                        project
                                                            ◄────────────────────────────
                                                    5. Response (or error) is SANITIZED
                                                       before it's returned to the browser
                                                       or touches any log line — the
                                                       Authorization header value is never
                                                       echoed back, and error objects are
                                                       stripped of anything containing the
                                                       raw token before they reach
                                                       console.error, the activity log, or
                                                       ProvisioningResult/ConnectionResult.
   6. Result flows back into
      databaseActivationService, which persists
      only status/message/timestamps/projectId
      to Project.databaseActivation — never the
      PAT — and logs only a redacted, token-free
      description to activity history.
```

### 4.3 Explicit limitation — this is a session-scoped, development-safe mode, not production secret storage

**Labeled clearly, per the requirement that this never be described as production-ready:** Sprint
76's connection mode holds the Management PAT in-memory (optionally mirrored to `sessionStorage`)
for the duration of a browser tab/session only. This is acceptable for development and early
production use where the person running provisioning is present in the browser, but it is **not** a
substitute for real secret management:

- The token is still, for the duration of the session, resident in browser memory/`sessionStorage`
  and transits over the wire on every provisioning request — acceptable for a session-scoped,
  human-in-the-loop flow, not for unattended/background provisioning.
- If Builders ever needs to provision without an active browser session (a background job, a CI
  step, a scheduled retry), that requires a genuinely different design: encrypted server-side secret
  storage scoped per-user/per-project (e.g. a dedicated secrets manager or Supabase Vault), with
  audit logging and token rotation/expiry — **not built in Sprint 76**, listed under Future Work.
- Sprint 76 ships **no** feature that silently upgrades this session-scoped token into durable
  storage. If a future sprint adds durable server-side credential storage, it must be a deliberate,
  separately-reviewed change — not an incidental side effect of provisioning UX polish.

### 4.4 Enforcement

- **Never persisted**: `DatabaseActivationState`/`Project` types have no token-shaped field; the
  session credential holder is a standalone module (`app/lib/database-activation/provisioning/
  supabaseSessionCredentials.ts`, Phase 2) never imported by `stores/projects.ts`, `buildersDbRepository.ts`,
  or the artifact/Product-Package assembly code.
- **Never logged/leaked**: every function that builds an activity description
  (`logProjectActivity`), a `ProvisioningResult`/`ConnectionResult.message`, or a thrown `Error`
  from the provisioning path is reviewed to confirm it never interpolates the raw token; the server
  route sanitizes upstream Supabase error bodies before they leave the server.
- **Server-mediated only**: `SupabaseProvisioner` never constructs a request directly to
  `api.supabase.com` from browser code — only to Builders' own `/api/supabase/*` routes.
- **Disconnect wipes everything**: a single `clearSupabaseProvisioningSession()` call (wired to the
  Workspace UI's disconnect action) clears the in-memory value and any `sessionStorage` mirror —
  nothing survives a disconnect.
- **Tested** (Part 7, Phase 2): a fixture PAT is placed in the session credential holder, a full
  provisioning run is exercised, and the test asserts the fixture value appears in **none** of:
  `JSON.stringify(project)`, `Project.databaseActivation`, every `logProjectActivity` call's
  arguments, every thrown/returned error, and the assembled Product Package's serialized files.

## Architecture diagram

```
DatabaseActivationCard (Workspace UI)
        │ user connects via a NEW session-scoped credential flow (§4.2) — in-memory,
        │ not the legacy localStorage-persisted supabaseConnection store
        ▼
databaseActivationService.provisionDatabase(project, 'supabase')
        │
        ▼
getDatabaseProvisioner('supabase') → SupabaseProvisioner
        │  reads: selected customer projectId (from state) + PAT (from the in-memory
        │  session credential holder only — never from BuildersDB or project metadata)
        │  calls: existing /api/supabase/query server route (per-statement, retries,
        │  structured + sanitized errors) — never Supabase directly from the browser
        ▼
Customer's own Supabase project  ←── SQL only ever runs here, never against BUILDERS_DB_*
        │
        ▼
ProvisioningResult / ConnectionResult (token-free) → Project.databaseActivation
        (provider + projectId + status/timestamps/message only — BuildersDB metadata, no secret)
```

## Future work (explicitly not this sprint)

- Option B (programmatic new-project creation) — needs its own product decision on org
  selection/billing confirmation UX.
- Real, encrypted server-side secret storage (secrets manager / Supabase Vault) for provider
  credentials, required before provisioning can run outside an active browser session (e.g. a
  background job) — Sprint 76's session-scoped credential holder is explicitly not this.
- `PostgresProvisioner`/`SQLiteProvisioner`/a future CubicleDB provider — same interface, no design
  changes needed, just new implementations behind `getProvisioner.ts`.

## Phase 2 implementation notes

What actually shipped, matching this document exactly:

- `app/lib/database-activation/provisioning/supabaseSessionCredentials.ts` — the §4.2 session-scoped
  credential holder (in-memory + `sessionStorage` mirror only; never `localStorage`).
- `app/lib/database-activation/provisioning/supabaseProvisioner.ts` — `SupabaseProvisioner`, calling
  the existing `/api/supabase/query` route (unchanged) with retry (`retry.ts`, provider-agnostic),
  an execution report, and schema-existence verification via `information_schema.tables`. Every
  error path is sanitized (`sanitizeMessage`) so the token can never reach a result, a log line, or
  persisted state — enforced by tests in `supabaseProvisioner.spec.ts` and
  `databaseActivationService.spec.ts`'s "credential non-leakage" suite.
- `getProvisioner.ts` extended with an optional `{ projectId }` connection config — the
  `DatabaseProvisioner` interface itself (`provision`/`verifyConnection`) is unchanged from Sprint
  75, so orchestration (`databaseActivationService.ts`) and the Workspace UI never branch on
  provider identity beyond passing `providerId` through.
- `databaseActivationService.ts` gained `connectSupabaseProject`/`disconnectSupabaseProject` (public
  project id only, ever) and `retryProvisionDatabase`; `provisionDatabase`/`verifyDatabaseConnection`
  now pass connection config and the approved schema through to the provisioner.
- `DatabaseActivationCard.tsx` gained the provider selector, Connect flow, Connected/Schema
  version/Retry/Refresh — all still explicit, user-triggered actions (Part 10's safety requirement
  carried forward unchanged from Sprint 75).
- The `'mock'` provider and every Sprint 75 project (no `connectionConfig`) continue to work
  unchanged — verified in `databaseActivationService.spec.ts`'s backward-compatibility tests.

**Post-implementation fix — BuildersDB isolation was under-enforced at first pass.** §1 promised
this would be "enforced structurally... not just by convention," but the initial Phase 2 pass never
actually added a check comparing a customer-selected Supabase project id against BuildersDB's own
project. This was caught during final verification and fixed with
`app/lib/database-activation/provisioning/buildersDbProjectGuard.ts`'s `isBuildersDbProjectId()` —
derives BuildersDB's own Supabase project ref from `BUILDERS_DB_SUPABASE_URL` and compares it
against any customer-supplied project id. Checked at three independent layers, each one sufficient
on its own: `connectSupabaseProject` (refuses to even persist the connection),
`SupabaseProvisioner.provision()`/`verifyConnection()` (refuses before any network call), and
`api.supabase.query.ts` (the actual server route that reaches `api.supabase.com` — the true
structural backstop, independent of any client-side code path). Returns `false` (never blocks)
whenever BuildersDB isn't configured, so this can't accidentally block legitimate use in an
environment without BuildersDB set up. Tested in `buildersDbProjectGuard.spec.ts` plus a refusal
test at each of the three call sites.
