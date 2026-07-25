# Product Readiness Audit

**Sprint 74 — Product Readiness Audit.** This document is an engineering acceptance review of
Builders (the "AI Software Factory" product built on bolt.diy) as it exists on branch
`builders-v2` today. It answers one question: **can Builders reliably generate a real customer
MVP today?** Nothing here is aspirational — every claim is backed by a specific file, line, or a
live, first-hand walkthrough performed during this audit.

---

## 1. Executive Summary

Builders has a genuinely impressive, well-engineered **planning and orchestration layer**:
Business Discovery, Business Analysis, Product Owner/MVP scoping, a 9-role engineering pipeline
with real approval gating, Blueprint/Regional/Package Intelligence, context tracing, and resume
safety are all real, tested, and — as verified live during this audit — actually work end-to-end
without errors or data loss.

What Builders **cannot yet do** is generate a customer MVP with a real backend. The code-generation
pipeline that turns approved engineering drafts into an actual running application deliberately
and explicitly produces a **frontend-only, statically-hosted app with mocked, in-memory data** —
no real database, no real API server, no SQL applied anywhere, no deployment of the generated app,
and no provisioning of the customer's own GitHub/Supabase/hosting accounts. This is not a bug; it
is the current, intentional scope of `app/lib/code-generation/prompts.ts`, confirmed by reading the
prompt text itself.

**Bottom line:** Builders can reliably take a customer from an idea to an approved, well-reasoned
MVP plan, and can reliably generate a working **frontend prototype** of that plan with mock data.
It cannot yet deliver a customer MVP that needs a real, persistent backend — which is most real
customer MVPs. This gap, not any planning/orchestration defect, is the single blocker standing
between Builders and commercial pilot readiness.

## 2. Current Product Readiness Score: **58 / 100**

| Dimension | Score | Rationale |
|---|---|---|
| Discovery & planning pipeline | 90/100 | Real, tested, live-verified; one cosmetic mislabeling bug found and fixed this sprint |
| Engineering role pipeline (9 roles) | 85/100 | Real, auto-approving, live-verified end-to-end; review is opt-in past Gate A |
| Code generation (frontend) | 70/100 | Real, working, live-verified pattern (per prior sprints' code review); explicitly mock-data-only |
| Backend/database generation | 5/100 | No SQL, no server, no ORM, no provisioning — explicitly out of scope by design |
| Deployment (GitHub/Vercel/Supabase for the generated app) | 15/100 | Real integrations exist but are disconnected from the Builders pipeline |
| Resume/recovery/multi-project | 85/100 | Live-verified: survives refresh, mid-flight generation resumes, project state stays isolated |
| Build/test/type quality | 100/100 | Clean typecheck, 0 lint errors, 1263/1263 tests passing, production build succeeds |
| Operational telemetry | 40/100 | AI usage-cost RPC function is missing from the deployed database schema (confirmed live) |

The weighted overall score is **58/100** — a strong foundation let down by one large, well-understood
gap (real backend generation) and one operational gap (a DB migration that exists but was never
deployed).

## 3. End-to-End Pipeline Map

```
Project creation (guided_engineering only — quick_build is frozen)
  → Discovery (Form / Interview / Document Import → one shared BusinessUnderstandingModel)
    → Business Analyst draft (auto-synced, auto-approved, no LLM call for the synced version)
      → Product Owner draft (real LLM call) → Gate A: MANDATORY HUMAN APPROVAL
        → Solution Architect (auto-generates, auto-approves)
          → Database Engineer (auto — produces a SCHEMA PLAN, not SQL)
            → UI/UX Designer (auto)
              → Backend Engineer (auto — produces a PLAN, not server code)
                → Frontend Engineer (auto)
                  → QA Engineer (auto)
                    → DevOps Engineer (auto — produces a PLAN, never a Dockerfile/CI config/deploy)
                      → Product Package assembly (per-role Markdown bundle, real, load-bearing)
                        → Code Generation Pipeline (real; frontend-only, mock data services)
                          → WebContainer write + npm install + dev server (real)
                            → Live Preview (real, for the frontend-only app)
                              → [GAP] no real DB/server, no GitHub push, no deploy, no domain
```

**Mandatory steps:** Discovery → Business Analysis → Product Owner + **Gate A** → Architecture →
Database → UI/UX → Backend → Frontend → QA → DevOps → Product Package. Every role's
`canGenerateX` gate structurally requires the previous role's artifact to be `approved` — this is
real and enforced in code, not just documentation.

**Optional steps:** Blueprint selection (defaults to Blank Project), Regional Profile selection,
Package Profile selection, Generation Profile choice, manual per-role review (auto-approved by
default for every role except Product Owner).

**Broken links found:**
- The dashboard's "Current Stage" hero (`ProjectManagerPanel.tsx`) computed its own, separate
  stage list that had no concept of the Gate A step — **found live, root-caused, fixed, and
  tested this sprint** (see §12).
- `builders_record_ai_usage`, the Postgres RPC that records AI cost/usage telemetry, is missing
  from the live database schema — **found live** (every AI call in this session logged a
  `PGRST202` error). A repair migration already exists in the repo
  (`supabase/migrations/20260718110000_ai_usage_rpc_repair_and_shared_settings_write_path.sql`)
  but has evidently never been applied to this environment's Supabase project.

**Duplicate/dead logic found:**
- `app/lib/projects/reviewEngine.ts` and its supporting `executionEngine`/task-card UI are a
  Sprint-12-era review system for the now-frozen `quick_build` project type. It is still wired
  into several components but is a dead end for any new project, since all new projects are
  `guided_engineering` and use per-artifact approval instead.
- `app/lib/builders-db/providers/supabaseProvider.ts` is an explicitly inert Sprint-18 skeleton
  (every method logs and returns empty) — easily confused with the two other, real "Supabase"
  concepts in this codebase (BuildersDB's own control-plane connection, and the generic
  generated-app-connection feature in `app/lib/stores/supabase.ts`).

## 4. Working Capabilities

- Unified Business Discovery (Form/Interview/Document Import) writing one shared model.
- Deterministic, non-LLM discovery-readiness scoring (`discoveryDecisionEngine.ts`).
- Real LLM-backed Product Owner MVP planning — **verified live** with genuinely high-quality,
  well-reasoned output (vision, in-scope/out-of-scope, feature list with dependencies and "why"
  rationale) in ~35-40 seconds against a real Anthropic call.
- Gate A human-approval checkpoint — **verified live**, structurally cannot be skipped.
- Autonomous 9-role engineering pipeline — **verified live**: Solution Architect and Database
  Engineer both generated and self-approved in real time with zero human input after Gate A.
- Blueprint, Regional, and Package Intelligence — all three now live, tested, and correctly
  layered as separate context sections (confirmed via this sprint's own code review and prior
  sprints' extensive test suites).
- Generation & Activity History — real, detailed, timestamped audit trail — **verified live**.
- Resume-after-refresh mid-generation — **verified live**: refreshing the browser mid-Solution-
  Architect-generation caused no data loss; the project reopened at the correct stage.
- Multi-project isolation — **verified live**: switching to a different project and back left
  both projects' independent state (and the first project's still-running background pipeline)
  intact.
- Code generation pipeline for a frontend-only app, WebContainer live preview, and an auto-repair
  loop (Code Reviewer/Repair Engineer/Build Validator) — real and load-bearing, per code review.
- Full local build/test/type toolchain — clean.

## 5. Partially Working Capabilities

- **GitHub integration**: real Octokit-based push exists (`GitHubDeploymentDialog.tsx`) but writes
  only to `localStorage`, never to `Project.githubRepo` — disconnected from the Builders pipeline.
- **Vercel/Netlify deployment**: real, working deploy automation exists but is a legacy bolt.diy
  chat feature, never triggered from `Project.deploymentTarget` or the DevOps Engineer role.
- **Review/approval model**: structurally mandatory at Gate A, but every other role auto-approves
  itself with no human in the loop unless the user manually opens a Draft Panel — a deliberate
  design choice worth an explicit product decision for pilot customers.
- **AI usage telemetry**: the client-side code and repository layer are complete; the
  server-side RPC function is simply not deployed in this environment.

## 6. Missing Capabilities

- Real backend/API code generation (no server, no endpoints beyond mocked in-memory data).
- Real SQL generation or database provisioning (Database Engineer produces a plan only, by
  explicit design — confirmed in that engine's own header comment).
- Real Supabase project provisioning for a generated app (`handleCreateProject` simply opens
  Supabase's own website in a new tab).
- Environment-variable collection/export for a generated app.
- Real auth scaffolding in the structured pipeline (Backend Engineer produces a text description
  only; the legacy free-chat path could theoretically write real Supabase-auth code, but it is not
  part of the structured, product-facing pipeline this audit is scoped to).
- Storage/bucket provisioning, custom domains, secrets management, and CI/CD generation — all
  confirmed absent, several explicitly disclaimed in the DevOps Engineer's own system prompt.

## 7. Technical Debt

- Two independent "current stage" computations exist in the same dashboard
  (`ProjectManagerPanel.tsx` vs. `ProjectDashboard.tsx`'s own `workflowStageStatusById`) — one was
  wrong, and got fixed this sprint; consider consolidating to a single source of truth in a future
  sprint rather than keeping two parallel derivations in sync by hand.
- Legacy Quick Build review machinery (`reviewEngine.ts`, `executionEngine.ts`, related task-card
  UI) is inert for any new project and is a maintenance/onboarding-confusion liability.
- Three different "Supabase" concepts share a name across the codebase (BuildersDB's own
  connection, an inert Sprint-18 skeleton, and the generated-app connection feature) with no
  in-code disambiguation for a newcomer.
- The word "Package" now has two unrelated meanings in this codebase (`ProductPackage` — a
  deliverable bundle, since Sprint 37 — and `PackageProfile` — a delivery-maturity tier, since
  Sprint 73). Both are already documented as deliberate, unrelated concepts, but this remains a
  standing readability/onboarding risk.

## 8. Critical Blockers

1. **No real backend/database generation.** Builders' own product narrative ("a complete AI
   engineering team... Database, Backend, DevOps") implies full-stack delivery, but the actual
   generated artifact is a static frontend with fake data. Any customer MVP that needs real user
   accounts, real data persistence, or a real API is not deliverable today.
2. **No deployment wiring for the generated app.** Even a frontend-only MVP cannot be handed to a
   customer through the product itself — GitHub push, Vercel/Netlify deploy, and custom domains
   all exist as separate, disconnected legacy features rather than pipeline outputs.

## 9. High-Priority Fixes

1. Wire the Database Engineer's schema plan (or a new, explicit "apply schema" step) to a real
   Supabase project, even a customer-provided one — the closest existing building block is
   `useSupabaseConnection.ts`, which today only opens Supabase's website.
2. Wire `devopsEngineerEngine.ts`'s deployment plan (or a new explicit action) to the already-real
   Vercel/Netlify deploy code (`api.vercel-deploy.ts`/`api.netlify-deploy.ts`), scoped to the
   code-generation pipeline's actual output.
3. Apply the already-written `20260718110000_ai_usage_rpc_repair_and_shared_settings_write_path.sql`
   migration to every BuildersDB-backed environment (this one included) — the fix exists, it was
   simply never deployed.
4. Decide, as a product decision, whether auto-approval of 7 of 9 engineering roles is acceptable
   for pilot customers, or whether a configurable "require human review" toggle is needed before
   commercial pilots begin.

## 10. Medium-Priority Improvements

1. Consolidate the dashboard's two independent "current stage" computations into one shared
   source, so a future stage addition can't reintroduce this sprint's Gate A display bug in a new
   form.
2. Give the top-banner "Add Your Requirements" button feedback (or have it open the Requirements
   dialog directly) instead of silently no-op'ing when the user is already on the Business tab.
3. Retire or clearly gate off the legacy Quick Build review system so it can't be mistaken for the
   active review mechanism during onboarding or future audits.

## 11. Low-Priority Improvements

1. Disambiguate the three "Supabase" concepts and the two "Package" concepts with clearer naming
   or a short glossary in developer docs.
2. Consider code-splitting the largest client bundle chunk (`Header-*.js`, ~4.1 MB / 1.14 MB
   gzip) — flagged by Vite's own build output, not customer-facing but worth tracking.

## 12. Safe Fixes Completed This Sprint

**Fixed: misleading "Engineering is in progress" hero banner before Gate A approval.**

- **Root cause** (found live, confirmed by reading code): `ProjectManagerPanel.tsx`'s `stages`
  array only models the 8 post-Product-Owner engineering roles
  (`requirements..devops` minus Product Owner itself); it has no concept of the Product
  Owner/Gate A step. The instant the Requirements draft was approved, this component's
  `currentStage` jumped straight to `architectureStatus` and displayed "Engineering is in
  progress" — even though the customer was still looking at an unapproved MVP roadmap. The
  dashboard's *other*, separate stage computation (`ProjectDashboard.tsx`'s
  `workflowStageStatusById`, which drives the "Stage X of 5" header and circles) was already
  correct; only this one hero panel was wrong.
- **Fix**: added an optional `productOwnerApproved` prop to `ProjectManagerPanel`, threaded from
  the value `ProjectDashboard.tsx` already computed. When Requirements is approved but Product
  Owner is not, the hero now shows "MVP Planning" / "Approve your MVP roadmap to begin
  engineering" / "Review MVP Roadmap" / Approval Required: Yes, instead of the previous, incorrect
  "Engineering is in progress."
- **Scope discipline**: no engine files were touched, no existing prop/behavior changed for
  callers that don't pass the new prop (verified by test), no architecture redesign.
- **Verified**: 5 new unit tests (`ProjectManagerPanel.spec.tsx`) plus a live before/after
  screenshot comparison in the browser, showing the exact bug and the exact fix.
- **Not fixed (correctly out of scope for a "safe fix")**: the missing AI-usage-RPC migration
  (external database deploy action, not a code change) and the "no real backend generation" gap
  (a genuine, large scope decision, not a small fix).

## 13. Tests Executed

- `pnpm typecheck` — clean, 0 errors.
- `pnpm lint` — 0 errors, 22 pre-existing warnings (all `no-empty-function` in test mocks,
  unrelated to this sprint).
- `pnpm test` — **1263 passed**, 2 skipped, 103 test files, 0 failures.
- New this sprint: `ProjectManagerPanel.spec.tsx` (5 tests, all passing), covering both the fixed
  behavior and byte-for-byte preservation of prior behavior when the new prop is omitted.

## 14. Build Verification

- `pnpm build` — succeeds; client + SSR server bundles both build cleanly.
- Two pre-existing Vite warnings (a dynamically+statically imported module, and a large chunk
  size) — both present before this sprint's changes, unrelated to Sprint 74, not regressions.
- No hydration or SSR errors observed during any part of the live walkthrough.

## 15. Live Verification

Performed a full, first-hand walkthrough as a customer would, using a realistic project
("Riverside Dental Clinic," a Business Website blueprint):

- Created a new project, completed Business Discovery, saved requirements.
- Generated a real Product Owner MVP draft via a live Anthropic API call (~35-40s) — genuinely
  high-quality, well-scoped output.
- Approved Gate A, confirmed the autonomous engineering pipeline started and ran unattended.
- Watched Solution Architect and Database Engineer roles generate and self-approve in real time.
- Refreshed the browser mid-generation (a genuine interruption) — the project reopened with all
  prior state intact and the pipeline resumed the next pending role correctly, with no data loss.
- Switched to a different, older project and back — confirmed state isolation and that the first
  project's background pipeline had kept progressing while unobserved.
- Inspected the Generation & Activity History tab — confirmed detailed, accurate, timestamped
  entries including context-trace records.
- Found and root-caused the Gate A display bug (§12) and the missing AI-usage RPC function
  (§9.3) directly from this walkthrough's own console/network logs — not from static code review.

## 16. Customer MVP Readiness

**Not ready today** for any MVP that requires a real, persistent backend (the majority of real
customer MVPs — booking systems, accounts, saved data of any kind). **Ready today** for a
frontend-only informational or marketing-style MVP with mocked/no persistent data, generated and
previewed inside Builders' own WebContainer — but even that cannot yet be handed to a customer
through an in-product deploy/handoff step.

## 17. Commercial Pilot Readiness

Not yet ready for commercial pilots that promise a "complete AI engineering team" delivering a
deployed, working product. The planning/orchestration half of that promise is genuinely strong and
verified; the delivery half (real backend + real deployment) is not built. Recommend against
promising full-stack delivery to pilot customers until §8's two critical blockers are addressed,
or scoping initial pilots explicitly to frontend-only, no-persistence MVPs where Builders' current
capability is a strong, honest fit.

## 18. Recommended Sprint 75

**"Real Backend Activation, Phase 1"** — scoped narrowly, in the same spirit as this sprint's own
"identify and hardstop, don't redesign" mandate:

1. Wire the Database Engineer's approved schema plan to real Supabase table creation for a
   customer-linked (not Builders-internal) Supabase project — the smallest real step from "plan"
   to "provisioned."
2. Wire one deployment target (recommend Vercel, since its deploy code is already the most
   complete) from the code-generation pipeline's actual output, gated behind an explicit
   customer-facing "Deploy" action — not automatic.
3. Apply the pending AI-usage-RPC migration to restore cost telemetry.
4. Make an explicit product decision on auto-approval scope for pilot customers (§9.4) and, if
   needed, add a minimal "require review" toggle — not a redesign of the approval model itself.

Do not begin real backend code generation (API server code, auth implementation) in Sprint 75 —
schema provisioning and deployment wiring are the safer, smaller first steps toward closing the
critical blockers identified in this audit.
