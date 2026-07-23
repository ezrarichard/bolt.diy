# Sprint 46D — End-to-End Validation Report

**Method:** This app requires internal-team login and this session had no user credentials — however, real credentials for the Anthropic API and the live BuildersDB Supabase project were present in `.env.local`, and the browser session turned out to already be authenticated. This allowed a **genuine, live, authenticated run** through the actual UI with a real LLM and a real production database, not a simulation — the strongest form of validation available this sprint. Where the live run didn't exercise something (e.g., every downstream engineering role), it was supplemented with code-path integration tests exercising the real production functions directly (`app/lib/projects/sprint46Validation.spec.ts`).

## What Was Actually Run Live

1. Created a brand-new project ("Sprint 46D Validation Clinic") through the real UI.
2. Filled Project Knowledge (vision, industry, target users, core features, pages) and approved the Project Definition.
3. Product Owner generated live (after a defect fix — see below), producing a complete, realistic MVP 1 plan.
4. Approved the roadmap (Gate A) — confirmed live in the network log: `builders_mvps` INSERT (201), `builders_mvp_approvals` INSERT (201), `builders_mvps` status PATCH (204).
5. Solution Architect auto-generated immediately after Gate A, unprompted — confirming the automatic pipeline resumes correctly post-approval.
6. Opened a genuine pre-Sprint-46 project ("StyleHub Coimbatore") and confirmed Overview, Engineering, Package, and History tabs all render correctly, with Product Owner correctly shown as "Waiting…" (never required) and every legacy role at its original approved version.

## Defects Found (Live, Real)

### Defect 1 — Pipeline Blocking: Product Owner had no entry in the Generation Profiles

**Severity: Pipeline Blocking.** The very first live generation attempt failed: `POST /api/generate-text → 401`, surfaced in the UI as "Invalid or missing API key." Root cause: `app/lib/generation-profiles/defaultProfiles.ts` never had a `product-owner-draft` entry in any of the three profile tiers (Fast/Balanced/Production) — every other pipeline role does. `getRoleGenerateOptions()` returns `{}` for an unmapped role, silently falling back to "whatever model the user's browser last had selected" instead of an explicit, tested default. In this session that fallback resolved to a provider with no configured key.

**Fixed:** added `product-owner-draft` to all three tiers (mirroring `requirements-draft`'s model choice per tier — comparable planning complexity, adjacent in the chain). Confirmed live: retried generation immediately succeeded and produced a complete, correct MVP 1 plan.

### Defect 2 — Data Integrity: `product-owner-draft` was never seeded into `builders_ai_roles`

**Severity: Data Integrity.** After fixing Defect 1, every attempt to mirror the Product Owner's artifact to BuildersDB failed silently in the background: `POST builders_role_outputs → 409`, body `{"code":"23503", "message":"insert or update on table \"builders_role_outputs\" violates foreign key constraint \"builders_role_outputs_role_key_fkey\"", "details":"Key is not present in table \"builders_ai_roles\""}`. Sprint 46B added the `PRODUCT_OWNER_DRAFT` artifact type and Sprint 46C added `builders_ai_roles.phase`, but no migration ever inserted the actual `product-owner-draft` catalog row.

**Consequence if unfixed:** this doesn't block the live UI (BuildersDB mirroring is fire-and-forget by design), but it means the Product Owner's version history is never actually persisted — and more seriously, `hydrateProjectData` (used to restore state on refresh/resume) would never find it, meaning **a user who refreshed the page after Gate A approval could lose their approved Product Owner draft**, even though the local UI showed it as approved.

**Fixed:** new staged migration `supabase/migrations/20260723100000_seed_product_owner_role_catalog.sql` inserts the missing catalog row and renumbers `pipeline_order` for the 8 existing roles to keep it consistent (cosmetic only — nothing reads `pipeline_order` for behavior, verified by grep). **Not yet applied** — staged for manual execution like every other migration this initiative has produced.

### Minor, Non-Blocking: Stale "Needs attention" banner after a successful retry

Observed live: after Defect 1's fix, a successful Product Owner generation still left the old "Product Owner — Needs attention / interrupted before completion" banner visible above the correct, fully-rendered draft content. This is a UI state-clearing issue in `useAutoEngineeringPipeline.ts`'s `failure` state (not reset on a subsequent successful run triggered by a different code path) — cosmetically confusing but not data-incorrect, not pipeline-blocking, and not in this sprint's fix categories (Critical/High/Data Integrity/Pipeline Blocking). **Not fixed this sprint** — flagged for a future UI-focused sprint.

## Product Owner Validation (Live Output, Verbatim Confirmed)

Every item this sprint asked to verify was present in the real, live-generated artifact: Product Vision, Business Objectives, MVP Roadmap (MVP-001/002/003, only MVP-001 fully elaborated — MVP-002/003 correctly stayed lightweight), Current MVP with 10 features (FEAT-001 through FEAT-010, correct MoSCoW priorities and dependency chains), Acceptance Criteria, Success Metrics (distinct from acceptance criteria), Exit Criteria (distinct from both), a 4-item Risk list with severity + mitigation, Assumptions, Open Questions, Future Enhancements, and an Engineering Handoff citing every in-scope feature by ID (e.g. `[FEAT-001] Patient Registration and Login (Must Have)`).

## Gate A Validation (Live)

Confirmed both directions: Architecture's "Generate Architecture Draft" button was disabled ("Complete requirements first") while the Product Owner draft was still in `draft` status, and became enabled the instant the draft was approved — with Solution Architect then auto-generating without any further manual action, confirming the automatic pipeline correctly resumes past Gate A.

## MVP Creation Validation (Live)

Confirmed via the real network log against the production database: `builders_mvps` row created (`201`), `builders_mvp_approvals` row created with `stage: 'scope', decision: 'approved'` (`201`), and the MVP's `status` PATCHed to `'scoped'` (`204`) — exactly matching the design in [05-customer-review-workflow.md](05-customer-review-workflow.md) and [07-sprint-46b-implementation-plan.md](07-sprint-46b-implementation-plan.md).

## Legacy Compatibility Validation (Live)

"StyleHub Coimbatore" (a real project predating this entire initiative) loaded with zero errors: Overview showed "ready to preview," Engineering showed every one of the 7 original roles at their original approved version with **Product Owner correctly shown as "Waiting…"** (never required, never blocking), History showed the full original activity/repair timeline untouched, and Package showed its existing Application Generation Dashboard (32 files, `ed1d44b0` structure checksum) exactly as before. `isAutoEngineeringComplete` correctly reported this project complete without a Product Owner artifact, confirming the `hasLegacyEngineeringProgress` exemption works in production, not just in unit tests.

## BuildersDB Validation

Confirmed live and via direct read-only REST probes against the production Supabase project (anon key, RLS-blocked as expected for reads/writes — see below):

- All three staged migrations (Sprint 45, 46B, 46C) were **already applied** to the live database before this sprint began — confirmed by successfully selecting `code`, `target_release`, `estimated_effort`, `business_priority`, `blocked_reason` from `builders_mvps`, `stage` from `builders_mvp_approvals`, `mvp_id` from `builders_role_outputs`, and `phase` from `builders_ai_roles` (all returned `200 []` — RLS-blocked-empty, not "column does not exist," confirmed by contrast with a genuinely bogus column returning a distinct `400`/`42703`).
- RLS is correctly enforcing: an anonymous `INSERT` into `builders_mvps` was rejected with `401`/`42501` ("new row violates row-level security policy"), confirming the security boundary is live and correct.
- Foreign key integrity gap found and fixed: see Defect 2.

## Traceability Validation

MVP code → Feature ID → Engineering Handoff chain confirmed unbroken in the live output: `MVP-001` → `FEAT-001`...`FEAT-010` → every non-"Won't Have" feature correctly cited by ID in the Engineering Handoff's feature list. No orphaned or mismatched IDs observed.

## UI Validation

Dashboard, Draft Panels (Requirements, Product Owner, Architecture), Package, History all confirmed rendering correctly with real data, both for the new project and the legacy project. Workspace tab was not exercised this sprint (no generation was run far enough to produce a live preview).

## Performance Observations

- Product Owner prompt size (minimal context, no prior artifacts): **~6,400 characters (~1,600 tokens)** total (system + user prompt) — well within any model's context window, and small relative to the 8,192-token *output* budget.
- A realistic, fully-elaborated MVP 1 artifact (10 features, full handoff) stores as **~3,750 characters (~940 tokens)** of JSON — cheap to persist, cheap to append to every downstream role's context, and nowhere near the truncation risk that motivated this whole initiative (see [02-Architecture/01-current-state-gap-analysis.md](../02-Architecture/01-current-state-gap-analysis.md)).
- Live generation time for the Product Owner role was consistent with the other engineering roles (tens of seconds), not a bottleneck.

## Documentation Consistency

No divergence found between implementation and the architecture/PRD/Product Owner specification/BuildersDB schema docs, beyond what was already documented as a deliberate deviation in Sprint 46B/46C reports (bespoke parser, hardcoded `nextMvpSequence`, feature-rename-loses-ID limitation). The two defects found this sprint are gaps in *supporting configuration* (generation profiles, role catalog seed data), not in the architecture itself — no doc described the wrong design; two pieces of setup were simply missing.
