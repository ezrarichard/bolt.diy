# Real Backend Activation — Phase 1: Database Activation (Sprint 75)

## Why

The Sprint 74 Product Readiness Audit (`docs/product-readiness/Product-Readiness-Audit.md`)
identified the one real blocker to a commercial MVP: the engineering pipeline produces high-quality
plans, but the generated application stays frontend-only with mocked data. The Database Engineer
stage in particular produced only a narrative planning artifact — prose describing entities and
relationships, with no columns, types, or anything a database could actually be built from — and
nothing downstream ever turned that into a real database.

The audit's recommendation, and this sprint's scope, was **not** to jump to full backend code
generation. It was to activate the existing pipeline one safe layer at a time, starting with the
smallest real step from "plan" to "provisioned": schema.

```
Approved Schema → Provisioned Database → Verified Connection
```

This document covers Phase 1 only: schema generation, validation, and a provider-independent
provisioning abstraction with a working mock implementation. No real Supabase/Postgres provisioning
happens yet, no backend code is generated, and the existing engineering pipeline (Business Discovery
→ Business Analyst → Product Owner → Solution Architect → Database Engineer → Product Package → Code
Generation) is unchanged in shape.

## Architecture

```
Database Engineer (LLM, one call — unchanged in scope, extended in output)
   → DatabaseDraft (narrative, human-readable — unchanged shape)
   → StructuredDatabaseSchema (machine-readable — new, first-class artifact)
   → both approved/discarded/regenerated together (lockstep), via the existing Gate/approval flow
        ↓
Deterministic SQL Generator      (schema JSON → schema.sql + migration.sql)
        ↓
Deterministic Validator          (schema JSON → validation-report.md + pass/fail)
        ↓
Provisioning Abstraction         (DatabaseProvisioner interface; MockDatabaseProvisioner only)
        ↓
Connection Verification          (provisioner.verifyConnection())
        ↓
Product Package                  ('database' section gains schema.sql/migration.sql/
                                   validation-report.md/database-summary.md)
Activity History                 (new database_* activity types)
Workspace UI                     (DatabaseActivationCard — explicit user-triggered actions only)
```

All new domain code lives in `app/lib/database-activation/`, the same self-contained-module
convention as `app/lib/package-intelligence/` and `app/lib/product-assembly/`. No earlier pipeline
stage (Business Discovery through Solution Architect) was touched.

## Where database information lives (Part 1 audit)

Before this sprint, the Database Engineer (`app/lib/projects/databaseDesignerEngine.ts`) was pure
orchestration with no LLM call of its own risk — no SQL, no provider connection, no table/column
data anywhere. Its output (`DatabaseDraft`, `app/lib/projects/prompts/database.ts`) was free-text
lists like `entities: ["Appointments table (FEAT-006, FEAT-007)"]` — enough for a human to review,
not enough for any generator to build real tables from. That gap was the reason schema generation
couldn't be built as a downstream reinterpretation step: the information a real schema needs
(columns, types, keys) simply didn't exist anywhere in the pipeline yet.

## The structured schema model

Rather than trying to reverse-engineer column/type data out of prose that never contained it, the
Database Engineer's existing single LLM call was extended to produce **two** outputs from the same
generation: the narrative `DatabaseDraft` (unchanged, for human review) and a
`StructuredDatabaseSchema` (`app/lib/database-activation/schemaTypes.ts`) — tables, columns
(name/type/nullable/default/unique), primary keys, foreign keys, indexes, and enums. `storageBuckets`
and `policies` are typed (future-ready, per the sprint brief) but nothing generates SQL from them
yet.

The structured schema is persisted as its own first-class artifact —
`ARTIFACT_TYPES.DATABASE_SCHEMA` (`app/lib/projects/artifacts.ts`) — sitting alongside
`DATABASE_DRAFT`, not nested inside it. This keeps every downstream consumer (SQL generation,
validation, provisioning, and future backend/API/ORM generation) reading one deterministic shape
directly, without ever re-interpreting the narrative draft's prose.

**Lockstep lifecycle.** `DATABASE_DRAFT` and `DATABASE_SCHEMA` are versioned, approved, discarded,
and regenerated together — there is no separate "approve schema" action anywhere. This is enforced
in `app/lib/hooks/useDraftPanel.ts` via an optional `pairedArtifactType`/`createPairedArtifact`
config (used only by the Database Design panel; every other role's draft panel is unaffected) and by
`app/lib/projects/artifacts.ts`'s `getArtifactByVersion`, which looks up the paired artifact at the
*exact same version* rather than "whichever is numerically latest." Regression coverage:
`app/lib/hooks/useDraftPanel.spec.ts`.

## SQL generation

`app/lib/database-activation/sqlGenerator.ts`'s `generateSchemaSql(schema)` is a pure, deterministic
function — same input always produces byte-identical output, no timestamps or randomness in the SQL
itself. It renders `CREATE TYPE` for enums, `CREATE TABLE` (with `PRIMARY KEY`, `FOREIGN KEY`,
`NOT NULL`, `DEFAULT`, `UNIQUE`, and `timestamps: true` → `created_at`/`updated_at`) in FK-dependency
(topological) order so a referenced table always precedes its dependent, and `CREATE INDEX`
statements last. No ORM output, no runtime database access. `migrationSql` wraps the same statements
as "Migration 0001 — Initial Schema" in a transaction — Phase 1 only ever produces one migration,
there is no diffing engine yet.

## Validation

`app/lib/database-activation/schemaValidator.ts`'s `validateStructuredSchema(schema)` checks
duplicate tables, duplicate columns, FK validity (local column exists, target table exists),
reserved SQL keywords (warning, not error), unsupported column types, circular FK references (DFS
cycle detection over the FK graph — self-references like `parent_id` are not flagged), and missing
primary keys. Returns `{ passed, errors, warnings }`; `renderValidationReportMarkdown()` renders the
`Database/validation-report.md` Product Package file. Provisioning is blocked in code (not just by
disabling a button) whenever `passed !== true`.

## Provisioning abstraction

`app/lib/database-activation/provisioning/` defines a provider-independent `DatabaseProvisioner`
interface (`provision(schema, sql)`, `verifyConnection()`) — deliberately not Supabase-first.
`DatabaseProviderId` is `'mock' | 'supabase' | 'postgres' | 'sqlite'`; only `'mock'`
(`mockDatabaseProvisioner.ts`) has a working implementation in Phase 1 — it deterministically
simulates success and never touches a network or real database. `getProvisioner.ts` is the single
factory every caller uses; it throws a clear "not implemented in Phase 1" error for the other three
provider ids rather than silently falling back to the mock, so Sprint 76+ can add real
implementations behind this exact interface without any call site changing.

**Safety.** Provisioning only ever runs in direct response to an explicit button press in
`DatabaseActivationCard.tsx` (never automatically on validation pass), only after validation has
passed, and Phase 1's SQL generator never emits any destructive statement (no `DROP`/`TRUNCATE`/
`ALTER ... DROP`). No implementation may execute destructive SQL — this is a hard interface
requirement, not just a convention followed by the mock.

## Orchestration and state

`app/lib/database-activation/databaseActivationService.ts` is the single place that chains generate
→ validate → (user-triggered) provision → verify, and the only writer of both
`Project.databaseActivation` (schema/validation/provisioning/connection status) and the `database_*`
activity history entries. State persistence follows the exact same convention as
`regionalSelection`/`packageSelection`: a field on `Project`, folded into
`builders_projects.metadata` via `METADATA_FIELDS` (`app/lib/builders-db/buildersDbTypes.ts`) — no
new BuildersDB table or migration.

## Activity history

New activity types, written via the existing `addProjectActivity`/`logProjectActivity`:
`database_schema_generated`, `database_validation_passed`, `database_validation_failed`,
`database_provisioning_started`, `database_provisioning_finished`, `database_provisioning_failed`,
`database_connection_verified`. Icons added to `ACTIVITY_ICON`
(`app/components/sidebar/ProjectHistoryPanel.tsx`) — no other change needed, since `activityType` is
already a free-text column.

## Product Package

`app/lib/product-assembly/productAssembler.ts`'s `'database'` section gains four generated files
once a schema has been generated — `Database/schema.sql`, `Database/migration.sql`,
`Database/validation-report.md` (once validated), and `Database/database-summary.md` — alongside the
existing narrative `Database/schema-plan.md`. It never replaces the narrative file.

## Workspace UI

`app/components/sidebar/DatabaseActivationCard.tsx`, mounted in `ProjectDashboard.tsx`'s Workspace
tab next to `RegionalProfileCard`/`PackageProfileCard`. Shows Database Status, Schema Status,
Validation, Provisioning Status, Provider, and Connection Status, with explicit "Generate Schema" /
"Validate" / "Provision (mock)" / "Verify Connection" buttons — each gated on the previous step
having succeeded.

## Testing

57 new tests across `sqlGenerator.spec.ts`, `schemaValidator.spec.ts`,
`mockDatabaseProvisioner.spec.ts`, `getProvisioner.spec.ts`, `databaseActivationService.spec.ts`,
`databaseDesignerEngine.spec.ts` (structured-schema parsing/degradation), `useDraftPanel.spec.ts`
(lockstep pairing regression), and `DatabaseActivationCard.spec.tsx`. Full suite: 1320 passed (2
pre-existing skips), `pnpm typecheck` and `pnpm lint` clean (0 errors — remaining lint warnings are
pre-existing and unrelated), `pnpm build` succeeds.

## Remaining work for Sprint 76

- Real provider implementations behind `DatabaseProvisioner` — `SupabaseProvisioner` and
  `PostgresProvisioner` at minimum, wiring the existing (currently disconnected) legacy Supabase
  connection layer (`app/lib/stores/supabase.ts`, `useSupabaseConnection.ts`, and the working SQL
  execution primitive at `app/routes/api.supabase.query.ts`) behind this interface.
- Deciding how a customer-linked (not Builders-internal) Supabase project gets selected/authorized
  for real provisioning, and building the actual safety rails (confirmation UX, RLS defaults) around
  running real DDL against it.
- A real migration/diffing engine once schemas can change after initial provisioning — Phase 1 only
  ever produces one "Migration 0001."
- Backend/API/ORM code generation that consumes the validated `StructuredDatabaseSchema` — now
  possible without inventing schema structure from scratch, per the audit's recommended progression.
