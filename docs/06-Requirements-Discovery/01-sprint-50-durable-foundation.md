# Sprint 50 — Requirements Discovery Durable Foundation

**Status: IMPLEMENTED (foundation only), pending manual Supabase migration execution.**
Introduces durable BuildersDB storage for the Requirements Session, its append-only message
history, and its current-state Business Understanding Model — the storage layer the frozen
Business Analyst architecture documents (Requirements Session Architecture, Business Analyst
Intelligence & Requirements Discovery Architecture, Business Assessment & Discovery Strategy
Architecture, Business Analyst Technical Implementation Plan) require before any of their
reasoning logic can be built. No AI reasoning, no Interview/Document Mode UI, and no change
to the existing Form-based Requirements flow ships in this sprint. Nothing new is wired into
any UI or existing engine yet.

## What was added

- **Migration:** `supabase/migrations/20260727100000_requirements_discovery_foundation.sql`
  — three new tables, RLS policies, and indexes. Purely additive; no existing table's shape,
  data, or policies are touched.
- **Domain types:** `app/lib/projects/requirementsSession.ts` — `RequirementsSession`,
  `RequirementsSessionMessage`, `BusinessUnderstandingModel`, and the supporting
  `Recommendation`/`Assumption`/`Risk`/`OpenQuestion`/`TraceabilityReference`/
  `BusinessAssessmentState`/`BusinessUnderstandingCompleteness` shapes, matching the frozen
  architecture's own vocabulary.
- **Row mapping:** `app/lib/builders-db/requirementsSessionDbTypes.ts` — `BuildersDb*Row`
  interfaces and `to*Row`/`from*Row` functions, following the exact convention
  `buildersDbTypes.ts` already established. Kept in a separate file rather than appended to
  the existing one, so the existing file's diff stays untouched.
- **Repositories** (new files, `app/lib/builders-db/repositories/`):
  - `requirementsSessionRepository.ts` — `createRequirementsSession`, `getRequirementsSession`,
    `listRequirementsSessionsByProject`, `getLatestRequirementsSession`,
    `updateRequirementsSessionStatus`, `updateRequirementsSession`, `archiveRequirementsSession`.
  - `requirementsSessionMessageRepository.ts` — `appendRequirementsSessionMessage`,
    `listRequirementsSessionMessages`, `getLatestRequirementsSessionMessage`. No update/delete
    function exists — messages are append-only through this interface.
  - `businessUnderstandingRepository.ts` — `createBusinessUnderstandingModel`,
    `getBusinessUnderstandingModel`, `initializeBusinessUnderstandingModel` (get-or-create),
    `updateBusinessUnderstandingModel`, `upsertBusinessUnderstandingModel`.
- **Tests:** one `.spec.ts` per repository (24 tests total), mocking the Supabase client the
  same way `buildersDbRepository.spec.ts` already does.
- **Shared logging helper:** `app/lib/builders-db/repositories/requirementsDiscoveryLogging.ts`
  — added during a pre-commit engineering audit (see "Post-implementation audit" below) to
  remove duplicated `unavailable`/`logError` helper pairs that were initially copy-pasted into
  all three new repositories.

Every repository function follows the existing defensive convention exactly: check for a
configured client, wrap the Supabase call in try/catch, return a safe fallback (`null`/`[]`/
`false`) on any failure, never throw.

## Data model

Three tables, all project-scoped (`project_id` FK, no `owner_id` on any of them — access is
derived entirely from `project_id` via the existing `builders_user_can_access_project()`/
`builders_user_can_edit_project()` functions, matching every other project-scoped child table
added since Sprint 42):

- `builders_requirements_sessions` — one row per discovery effort. `mode` (`form` |
  `interview` | `document`) and `status` (`created` | `active` | `complete` | `approved` |
  `archived` | `abandoned`) are CHECK-constrained; `selected_discovery_strategy` and
  `assessment_confidence` are free text with no constraint yet, reserved for the Business
  Assessment Engine (a later sprint) — constraining them now would risk a destructive
  migration once that logic is actually designed in code.
- `builders_requirements_session_messages` — append-only, one row per turn. `sequence_number`
  gives deterministic ordering independent of `created_at`. `project_id` is duplicated here
  (not just reachable via `session_id`) for the same reason `builders_product_package_files`
  already duplicates it — direct RLS/query filtering without a join.
- `builders_business_understanding_models` — current state (NOT versioned), one row per
  session (`unique (session_id)`), with one JSONB column per model section (`business_goals`,
  `risks`, `recommendations`, etc.) rather than one giant blob. This is what makes partial
  updates safe: updating `business_goals` can never accidentally clobber `risks`, because each
  section is its own column.

## Cascade behaviour

```
builders_projects (delete)
  └── builders_requirements_sessions (ON DELETE CASCADE)
        ├── builders_requirements_session_messages (ON DELETE CASCADE via session_id,
        │     ALSO cascades via its own project_id FK)
        └── builders_business_understanding_models (ON DELETE CASCADE via session_id,
              ALSO cascades via its own project_id FK)
```

Deleting a project removes its sessions, messages, and model rows automatically — no
application-level cleanup code was added or is needed. `builders_project_activity`'s existing
`on delete set null` audit-trail behavior is untouched; this sprint does not write to that
table.

## RLS approach

Same ownership model as every table added since Sprint 42:

- `builders_requirements_sessions`: select for any accessible role, insert/update/delete
  (`for all`) for Owner/Editor.
- `builders_requirements_session_messages`: select for any accessible role, **insert only**
  for Owner/Editor — no update or delete policy exists for `authenticated` at all, so
  append-only is enforced by the database, not just the repository interface.
- `builders_business_understanding_models`: select for any accessible role, insert + update
  for Owner/Editor — no delete policy, same append/cascade-only discipline as messages.

## Legacy compatibility

- `builders_projects.metadata.projectKnowledge` and `.projectDefinitionChat` are completely
  untouched — `buildersDbTypes.ts`'s `METADATA_FIELDS` list was not modified. Existing
  projects keep reading/writing them exactly as before.
- The existing Form-based Requirements flow (`ProjectRequirementsDialog.tsx`,
  `projectKnowledgeEngine.ts`, `businessAnalystEngine.ts`, `prompts/requirements.ts`) was not
  touched. No call site anywhere in the app imports any of this sprint's new files yet.
- The `RequirementsDraft` contract and `builders_role_outputs` are unaffected.

## Post-implementation audit

Before requesting commit approval, every new file was re-read against a 13-point checklist
(existing workflow/repositories/Product Owner/Engineering/prompts/contracts/UI unchanged;
no unrelated formatting; purely additive) plus a code-quality pass. `git diff <base>` against
the branch's base commit confirmed zero diff on any existing tracked file at every checkpoint
— every change is a brand-new file. Two quality issues were found and fixed in the new code
before commit (no existing files were affected by either fix):

1. **Duplicated logging helpers** — `unavailable()`/`logError()` had been copy-pasted
   near-identically into all three new repositories. Extracted into
   `requirementsDiscoveryLogging.ts`'s `createRepositoryLogger(tag)` factory; all three
   repositories now call it instead. Log output is byte-for-byte identical to before.
2. **Dead code / duplicated default shape** — `requirementsSession.ts` exported an unused
   `createEmptyBusinessUnderstandingModel()` that duplicated the same default-section values
   already defined (in row form) by `toBusinessUnderstandingModelInsert()`. Removed, since it
   had zero callers anywhere in the app.

Both fixes were re-verified with the full check sequence (typecheck, lint, all 24 new tests,
full 462-test suite, `git diff` against base) before this note was finalized.

## Verification completed

- `npx tsc --noEmit` — clean, no errors.
- `npx eslint` on every new file — clean after auto-fix (formatting only; no logic changes
  from `--fix`).
- `npx vitest --run` on the three new spec files — 24/24 passing.
- `npm run test` (full existing suite) — 462 passed, 2 skipped, 0 failed. No regressions.
- `npm run build` — succeeds (client + SSR bundles built cleanly; pre-existing chunk-size and
  dynamic-import warnings are unrelated to this change).
- `git status`/`git diff` reviewed — exactly 9 new, untracked files; nothing modified;
  nothing touching Product Owner, Engineering, or any existing route/component.

## Verification still requiring manual Supabase execution

**The migration file has been created in the repository but has NOT been applied to any
remote Supabase project, and no live RLS test has been run against a real database.** Per the
working rules, this is stated explicitly rather than assumed:

- **File to run:** `supabase/migrations/20260727100000_requirements_discovery_foundation.sql`
- If this repository's Supabase project has automatic migration deployment configured, it
  will apply on the next deploy/push to that environment.
- **If automatic execution is not configured, run this file's exact contents in the Supabase
  SQL Editor for the target BuildersDB project before any later sprint depends on these
  tables existing.**
- Real end-to-end RLS verification (a session created by User A being invisible to User B, a
  message insert being rejected for a Viewer, cascade delete actually removing rows) has not
  been executed against a live database in this session and should be done after the
  migration is applied, before Sprint 51 begins.

## Known limitations

- `appendRequirementsSessionMessage`'s `sequence_number` assignment (fetch current max, insert
  max+1) is not wrapped in a single atomic transaction/RPC. The `unique (session_id,
  sequence_number)` constraint means a genuine race surfaces as a clear insert error rather
  than silently duplicating an ordering position, but it is not itself race-proof. This is
  acceptable for Sprint 50 because no caller appends concurrently yet (no UI exists) —
  hardening this into an atomic RPC is a reasonable Interview Mode (Sprint 55) follow-up, once
  concurrent same-session appends become possible.
- `selected_discovery_strategy`/`assessment_confidence` are unconstrained free text by design
  (see Data model section) — a later sprint introducing the Business Assessment Engine should
  add a CHECK constraint once the exact value set is finalized in code.
- No repository function or UI reads/writes these tables yet outside their own tests — this
  is intentional (Sprint 50 scope is foundation only) but means the tables are inert until
  Sprint 51 (Form Mode migration) begins consuming them.

## Sprint 51 handoff points

- `requirementsSessionRepository`, `requirementsSessionMessageRepository`, and
  `businessUnderstandingRepository` are ready to be called from `ProjectRequirementsDialog.tsx`'s
  submission handler — Sprint 51's job is to route that existing form submission through
  `createRequirementsSession(projectId, 'form')` →
  `initializeBusinessUnderstandingModel(sessionId, projectId)` →
  `appendRequirementsSessionMessage(...)` (the form snapshot as a single `form_submission`
  turn), while leaving `businessAnalystEngine.ts`'s existing generation call untouched for now.
- `BusinessUnderstandingModel`'s list-shaped sections (`businessGoals`, `functionalRequirements`,
  etc.) are deliberately plain `string[]` in this sprint, not yet carrying the five-way
  provenance tag (Customer Requirement / AI Recommendation / Assumption / Optional Enhancement)
  described in the Business Analyst Intelligence Architecture — that tagging is Sprint 52's
  scope, not Sprint 50's.
- No Fact Extraction, Business Assessment, Discovery Strategy, Recommendation Engine,
  Assumption Engine, or Completeness Engine logic exists yet — every later sprint listed in
  the Business Analyst Technical Implementation Plan's Part 9 sprint breakdown still applies
  in full.
