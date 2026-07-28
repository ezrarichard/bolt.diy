# Builders Acceptance Test — Round 2
## RunRide Event Registration

**Run date:** 28 July 2026
**Operator:** Claude (Claude Code), driving the Builders UI directly
**Status at time of writing:** BLOCKED for Round 2 continuation; AR2-BUG-008 and AR2-BUG-007 fixed in Sprint 99A and live-verified (see §24c)
**Last updated:** 28 July 2026, 16:31Z

---

## 1. Executive summary

Acceptance Round 2 exercised Builders end-to-end as an operator would, using a realistic paid-event
registration product (Razorpay + Supabase + admin dashboard). **Phases 1–5 completed. Phase 6 is
partially complete. Phases 7–12 were not run.**

**What Builders did well — and it did a lot well:**

- The nine-role engineering pipeline ran to completion **fully autonomously** after Gate A, with no
  operator intervention, in **21m 23s**.
- Requirement fidelity is excellent. Every one of the 18 requirements from the customer brief —
  including the entire payment-security specification — survived intact from the intake form through
  Business Analysis, the Product Owner MVP plan, and into all ten Product Package documents.
- **The AI planned the payment security correctly.** Unprompted by any code, FEAT-007 specifies that
  server-side signature verification "does NOT mark registration as confirmed until webhook
  confirmation," and FEAT-008 specifies an idempotent webhook with its own signature check. This is
  the exact security property the brief demanded and the hardest one to get right.
- Scope discipline held. Despite a poorly-matched blueprint, MVP-001 contains no commerce, catalog,
  chat, or multi-tenant contamination, and the out-of-scope list was carried verbatim into the plan.
- Two AI retries occurred (UI/UX, QA); both were **bounded to one retry, both recovered**, and neither
  produced a failure. No stalls, no runaway loops, no `[object Object]`.
- **Sprint 98C is confirmed working in production.** The cancelled state persists correctly, the
  timeline renders neutrally, and history reads correctly.

**Why this is not a PASS:** two things block it, one procedural and one structural.

1. **The commercial workflow was never proven.** PASS explicitly requires a working, deployed,
   test-mode payment flow plus a validated incremental change. No Razorpay account, no application
   Supabase project, no GitHub repository, and no Vercel account exist in this environment, and I
   cannot create accounts or enter credentials. Phases 7–11 are hard-blocked on human provisioning.
2. **Six defects were found**, none Blocker or Critical, but two Medium defects land directly on the
   Sprint 98C surface just signed off (cancelled state invisible after reload) and on operator trust
   in the generation UI (progress counters materially understate real progress).

No security defect was found. No stop condition was triggered.

---

## 2. Test environment

| Item | Value |
|---|---|
| Host | macOS (Darwin 24.6.0) |
| Builders dev server | `http://localhost:5190` (Remix vite:dev) |
| BuildersDB | Supabase, reachable, RLS active |
| AI provider | Anthropic (`ANTHROPIC_API_KEY`), 7 models cached |
| Models used | `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929` (per-role via Balanced profile) |
| Browser | In-app Chromium, 1094×732 |
| Credentials present | `ANTHROPIC_API_KEY`, `BUILDERS_DB_SUPABASE_URL`, `BUILDERS_DB_SUPABASE_ANON_KEY` |
| Credentials **absent** | Razorpay test keys, application Supabase project, GitHub token/repo, Vercel account |

No real money was processed. No production credentials were used or requested.

---

## 3. Builders branch and commit

| Item | Value |
|---|---|
| Branch | `builders-v2` |
| HEAD | `b99a14a6dde815f02a5639ebe1fc5967839c04ce` |
| Milestone | `milestone: Sprint 98C cancellation state fidelity` |
| Ancestry | descends from `b99a14a` (is `b99a14a`) |
| Working tree | clean at start and throughout; **no Builders code was modified during this run** |

### Phase 1 — Pre-flight: 10 / 10 PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Branch `builders-v2` | PASS | `git branch --show-current` |
| 2 | HEAD = `b99a14a` or descendant | PASS | `merge-base --is-ancestor` → yes |
| 3 | Working tree clean | PASS | `git status --porcelain -uall` empty |
| 4 | Production build | PASS | `remix vite:build` → built in 1.83s |
| 5 | TypeScript | PASS | `tsc --noEmit` → exit 0 |
| 6 | No stale dev servers | PASS | no vite/remix processes; ports 5173/3000/8788/4173 unbound |
| 7 | BuildersDB connectivity | PASS | `GET /rest/v1/builders_projects` → HTTP 200 |
| 8 | Authenticated session | PASS | app loaded authenticated; projects hydrated |
| 9 | Sprint 98A security fixes active | PASS | see below |
| 10 | `cancelled` state available | PASS | present in `b99a14a`; verified live in Phase 5 |

**Sprint 98A security verification (live, hard evidence).** Anonymous `POST` to
`rpc/builders_save_application_manifest` **with the correct 14-parameter signature** returned
**HTTP 401, PostgreSQL code `42501`, "permission denied for function"** — the anon revoke from Sprint
98A's `20260812100000_manifest_rpc_privilege_fix.sql` is still in force. Anonymous `SELECT` on
`builders_projects`, `builders_project_workspace_state`, `builders_application_manifests`, and
`builders_project_activity` each returned **HTTP 200 with `[]`** — RLS returns no rows to anon.

---

## 4. Customer requirement

Mobile-first registration and payment site for a one-day cycling and running event. Participants
arrive from Instagram, read event info, choose Cycling or Running, choose a distance, enter details,
accept waiver and terms, pay via Razorpay, and are redirected to the organiser's site once payment is
confirmed. Registrations stored in Supabase. Secure admin area to view, search, filter, total and
export registrations. Test mode only; all credentials via environment variables.

Entered through the Builders intake form exactly as a customer brief — no architecture or
implementation was pre-written outside Builders.

---

## 5. Final MVP scope

**MVP-001 — Core Registration & Payment Flow** — 16 features (14 MUST, 2 SHOULD), status `scoped`.

| ID | Feature | Priority |
|---|---|---|
| FEAT-001 | Supabase database schema (constraints, indexes, RLS blocking anon reads) | MUST |
| FEAT-002 | Environment configuration & startup validation | MUST |
| FEAT-003 | Event landing page (mobile, activity + distance + full form) | MUST |
| FEAT-004 | Waiver & privacy consent | MUST |
| FEAT-005 | Server-side Razorpay order creation | MUST |
| FEAT-006 | Razorpay Checkout (public key only) | MUST |
| FEAT-007 | Server-side payment signature verification | MUST |
| FEAT-008 | Idempotent Razorpay webhook handler | MUST |
| FEAT-009 | Payment success page + organiser redirect | MUST |
| FEAT-010 | Payment failed/cancelled page | MUST |
| FEAT-011 | Admin authentication (Supabase Auth) | MUST |
| FEAT-012 | Admin registrations dashboard (search, filters, totals) | MUST |
| FEAT-013 | CSV export | MUST |
| FEAT-014 | Privacy policy page | SHOULD |
| FEAT-015 | Terms/waiver/cancellation/refund page | SHOULD |
| FEAT-016 | Mobile-optimised layout for Instagram in-app browser | MUST |

**Explicitly out of scope** (carried through unchanged): social network, participant chat,
marketplace, multiple organisers / multi-tenant, subscriptions, advanced analytics, native mobile
app, production Razorpay credentials.

**MVP-002** "Enhanced Admin & Operations" and **MVP-003** "Participant Experience & Engagement" were
planned as `Future` — correctly kept out of MVP-001.

---

## 6. Blueprint selected

Auto-adopted: **LocalShop India** at **9% confidence**. Other candidates: AI Agent 5%, Business
Website 3%, Blank Project 0%. Rationale given: "Matches core feature: Razorpay payment".

The project had been created with **Blank Project** deliberately so Builders' own recommendation
would run. It adopted a commerce-storefront blueprint for an event-registration product at 9%
confidence without warning the operator (**AR2-BUG-001**).

**Materially, no harm resulted** — downstream outputs show no commerce contamination. The defect is
that a near-zero-confidence recommendation is silently adopted, not that this particular one damaged
the build. The dashboard header also continued to display "Blank Project" throughout.

---

## 7. Discovery and requirements result

Business Discovery ran automatically on save:

| Field | Value |
|---|---|
| Status | Ready |
| Classification | Small Business |
| Industry | Sports & Events |
| Project type | Website |
| Discovery completeness | 86% |
| Overall confidence | High |
| Assessment confidence | **Low** |
| Ready for requirements draft | Yes |
| Partial areas | Industry, Project Type, Business Constraints |

Project Definition v1 approved 20:07:57. Counters: 14 modules, 7 pages, **0 user flows**,
est. 2–4 weeks.

**Phase 3 coverage review — 18 / 18 requirements explicitly present:** Instagram mobile traffic ·
responsive form · Cycling/Running · distance categories · participant data (all 14 fields) · waiver
and privacy consent · Razorpay order creation · payment verification · webhook verification ·
Supabase storage · organiser redirect · failure handling · admin registration view · CSV export ·
security and RLS · mobile browser compatibility · test-mode payment · scope exclusions.

No requirement correction was needed. Two cosmetic oddities: "Assessment confidence: Low" sits beside
"Overall confidence: High" in the same panel, and "User flows: 0" is reported despite a fully
specified participant journey in the same document.

---

## 8. Nine-role engineering result

All nine roles completed and self-approved. **No operator intervention after Gate A.**

| Role | Output | Status |
|---|---|---|
| AI Project Manager | Project Definition v1 | Approved |
| Product Owner | MVP roadmap, 3 MVPs, 16 features | Approved (Gate A) |
| Solution Architect | `architecture.md` | Approved |
| Database Engineer | `schema-plan.md` | Approved |
| UI/UX Engineer | `ui-spec.md` | Approved |
| Backend Engineer | `backend-plan.md` | Approved |
| Frontend Engineer | `frontend-plan.md` | Approved |
| QA Engineer | `test-plan.md` | Approved |
| DevOps Engineer | `deployment-plan.md` | Approved |

---

## 9. Role durations and retry counts

| # | Role | Completed | Duration | AI calls | Retries | Model |
|---|---|---|---|---|---|---|
| 1 | AI Project Manager | 20:07:57 | form-driven | 0 | 0 | — |
| 2 | Product Owner | 20:19:12 | ~85s | 1 | 0 | — |
| 3 | Solution Architect | 20:21:02 | 110s | 1 | 0 | sonnet-4-6 |
| 4 | Database Engineer | 20:22:53 | 111s | 1 | 0 | sonnet-4-5 |
| 5 | UI/UX Engineer | 20:28:11 | **318s** | 2 | **1** | sonnet-4-5 |
| 6 | Backend Engineer | 20:30:18 | 127s | 1 | 0 | sonnet-4-6 |
| 7 | Frontend Engineer | 20:32:40 | 142s | 1 | 0 | sonnet-4-6 |
| 8 | QA Engineer | 20:38:13 | **333s** | 2 | **1** | sonnet-4-5 |
| 9 | DevOps Engineer | 20:40:35 | 142s | 1 | 0 | sonnet-4-5 |

**Engineering wall-clock: 20:19:12 → 20:40:35 = 21m 23s.**

Nine `/api/generate-text` calls were captured by a client-side interceptor, **all HTTP 200**. Payload
keys confirm role identity (`architectureSummary`, `databaseOverview`, `designVision` ×2,
`backendOverview`, `frontendOverview`, `qaOverview` ×2, `devopsOverview`).

**Retry analysis:** exactly two retries, one each in UI/UX and QA. Both retried calls returned
HTTP 200, so the retries were triggered by **output validation (truncation/parse), not transport
failure** — this is the Sprint 44 truncated-JSON recovery path working as designed. Both recovered on
the first retry. Retry limits are bounded and effective.

---

## 10. Product Package result

Assembled 20:42:37 — **10 documents, all APPROVED, 165,261 characters.**

| Document | Size |
|---|---|
| `requirements/BRD.md` | 4,706 |
| `architecture/architecture.md` | 15,166 |
| `database/schema-plan.md` | 16,416 |
| `uiux/ui-spec.md` | 21,124 |
| `api/api-spec.md` | 6,478 |
| `backend/backend-plan.md` | 24,150 |
| `frontend/frontend-plan.md` | 25,999 |
| `qa/test-plan.md` | 24,598 |
| `devops/deployment-plan.md` | 24,715 |
| `documentation/product-summary.md` | 1,900 |

**All 11 required Phase 4 contents present.** Verified by term frequency across the package scoped to
this project's package id:

- Environment-variable requirements: `RAZORPAY_KEY_ID` ×8, `RAZORPAY_KEY_SECRET` ×11,
  `RAZORPAY_WEBHOOK_SECRET` ×8, `SERVICE_ROLE` ×7, `NEXT_PUBLIC` ×10
- Razorpay integration flow: `razorpay` ×322, `signature` ×91, `webhook` ×256, `idempot` ×37
- Supabase integration flow: `supabase` ×202, `RLS` ×57

---

## 11. Generation result

**Run 1 (deliberately cancelled — Phase 5):** started 15:14:53Z, manifest v1 created with **127
declared files**, cancelled 15:18:09Z.

**Run 2 (the intended successful run):** started 15:23:38Z. **Still in progress when this report was
written** (15:32:42Z) — 10 file rows, 9 `generated`, 1 `generating`, stage 5/14.

Files generated so far, all with professional names and correct structure:

```
src/types/index.ts                            src/pages/PrivacyPolicyPage.tsx
src/services/api.ts                           src/pages/TermsPage.tsx
src/pages/HomePage.tsx                        src/pages/AdminLoginPage.tsx
src/pages/EventLandingAndRegistrationPage.tsx src/pages/AdminDashboardPage.tsx
src/pages/PaymentSuccessPage.tsx              src/pages/PaymentFailedPage.tsx
```

All seven MVP pages are accounted for.

**Phase 4 in-generation checks:**

| Check | Result |
|---|---|
| Schema guard runs before AI calls | PASS (Sprint 98A gate; no drift error, generation proceeded) |
| Manifest creation succeeds | PASS (v1, active, 127 files) |
| Manifest file counts accurate | PASS (127 declared; 14 pages, 6 components, 1 service, 1 type, 1 style, 5 config, 1 doc, 2 entry) |
| Filenames professional | PASS |
| **Progress counters coherent** | **FAIL — AR2-BUG-006** |
| Structured errors readable | PASS (none raised) |
| No `[object Object]` | PASS |
| No silent stalls | PASS |
| Retry limits bounded | PASS |
| Activity history recorded | PASS |
| Reload does not duplicate generation | PASS |
| No orphan manifests / file rows | PASS |

---

## 12. Sprint 98C live cancellation result

**This is the headline positive result of the run: Sprint 98C works in production.**

Baseline: `last_generation_status = "not-generated"`, zero manifests.
Generation started 15:14:53Z → Stop clicked 15:15:58Z → cancelled state landed 15:18:09Z.

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Generation begins | **PASS** | status → `generating`, stage `planning` |
| 2 | Manifest created | **PASS** | `ae7f7091-…` v1, active, 127 files |
| 3 | Stop Generation clicked | **PASS** | 15:15:58Z |
| 4 | Generation stops | **PASS** | run ended, panel returned to "Generate Application" |
| 5 | Status persists as `cancelled` | **PASS** | `last_generation_status = "cancelled"` in BuildersDB |
| 6 | Timeline neutral stopped state | **PASS** | icon `i-ph:stop-circle-fill text-bolt-elements-textTertiary` |
| 7 | History correct | **PASS** | `generation_cancelled` / "Generation stopped by the operator" |
| 8 | Reload preserves `cancelled` | **PARTIAL** | DB yes; **UI shows nothing** — AR2-BUG-004 |
| 9 | No auto-resume | **PASS** | nothing restarted after reload |
| 10 | No orphan manifests | **PASS** | exactly one manifest row |
| 11 | No extra AI calls after Stop | **PARTIAL** | 11 → 13 completions — AR2-BUG-005 |

Additional confirmations: `current_stage` recorded as `generating-pages` (the Sprint 98C addition, so
future resume logic knows where the run stopped); `last_error` is `null`; and a DOM sweep found
**zero failure indicators** anywhere in the timeline — the only red on the page was an unrelated
sidebar delete-button hover style.

DEF-1 and DEF-2 are both confirmed fixed in live use. The gap is that Sprint 98C stopped at the
timeline and the home-dashboard branch, and never taught the reloaded dashboard summary about the
state (AR2-BUG-004).

---

## 13. Manifest integrity

| Property | Result |
|---|---|
| Manifests for this project | Exactly **1** (v1, `active`, 127 files) across two generation runs |
| Orphan manifests | **None** — the cancelled run left no orphan (the Round 1 failure mode) |
| Duplicate manifests on restart | **None** — run 2 reused manifest v1 |
| Declared vs. persisted files | Consistent; every persisted row carries `manifest_id` and `manifest_file_id` |
| Structure checksum | `4c6f528a`, stable |
| Transactional persistence | Sprint 98A RPC path in force, anon-revoked |

Manifest integrity is the strongest area of the product. Sprint 98A/98B hardening holds under a
cancel-then-restart sequence.

---

## 14. GitHub result

**NOT RUN — blocked.** No GitHub repository or token is configured for this environment. The
Deployment panel reports "Not Connected / Connect a repository from Deploy → GitHub". Repository
creation requires account access I do not have and must not assume.

---

## 15. Supabase result

**NOT RUN — blocked.** Applying the generated schema requires a dedicated test Supabase project for
the RunRide application, separate from BuildersDB. None is provisioned.

Verified at design level only: `schema-plan.md` (16,416 chars) specifies the expected entities, and
RLS appears 57 times across the package including FEAT-001's explicit "RLS policies preventing
anonymous reads of participant data".

BuildersDB's *own* access control was verified independently (Phase 1, item 9) and is sound.

---

## 16. Razorpay test-mode result

**NOT RUN — blocked.** No Razorpay test account exists. None of the eleven payment scenarios
(successful, failed, cancelled, invalid signature, valid webhook, invalid webhook signature,
duplicate delivery, refresh after success, success-URL replay, no double confirmation, no duplicate
registration on retry) could be executed.

This is the single largest gap in the run, and it is the reason PASS is unreachable: the brief states
PASS requires a working deployed test-mode payment flow.

---

## 17. Vercel deployment result

**NOT RUN — blocked.** No Vercel account or token is configured. No deployment URL exists.

---

## 18. Live mobile result

**NOT RUN** — depends on Phase 10 deployment.

---

## 19. Admin result

**NOT RUN** — depends on Phase 10 deployment. `AdminLoginPage.tsx` and `AdminDashboardPage.tsx` were
generated; neither has been executed.

---

## 20. Security review

**No security defect was found. No stop condition was triggered.**

### 20.1 Builders platform (fully verified, live)

| Check | Result |
|---|---|
| Anon cannot execute the manifest RPC | **PASS** — HTTP 401, `42501` permission denied |
| Anon cannot read project data | **PASS** — HTTP 200 `[]` on four tables (RLS) |
| Secrets in Builders repo | **PASS** — no keys, JWTs, or `.env` files in the working tree |

### 20.2 Generated application — static scan (partial)

Scanned all 9 persisted file versions (**131,760 characters** of generated frontend source):

| Pattern | Occurrences |
|---|---|
| `rzp_test_…` literal | **0** |
| `rzp_live_…` literal | **0** |
| JWT literal (`eyJ…`) — would indicate a service-role key | **0** |
| Hardcoded `KEY_SECRET` / `WEBHOOK_SECRET` / `SERVICE_ROLE_KEY` assignment | **0** |
| `RAZORPAY_KEY_SECRET` referenced in `src/` | **0** |
| `SERVICE_ROLE` referenced in `src/` | **0** |
| `WEBHOOK_SECRET` referenced in `src/` | **0** |

**Clean.** No secret material and no server-only secret *name* appears anywhere in the generated
client code.

### 20.3 Design-level security (verified in the plan, not in code)

The Product Owner plan independently specifies every required control: server-side order creation
(FEAT-005), Checkout with the public key only (FEAT-006), server-side signature verification that
**explicitly refuses to confirm until the webhook confirms** (FEAT-007), an idempotent
signature-verifying webhook safe against duplicate delivery (FEAT-008), startup env-var validation
(FEAT-002), and RLS blocking anonymous participant reads (FEAT-001).

### 20.4 Limitation — stated plainly

**This is a partial review.** Only frontend `src/` files existed when the scan ran; the backend and
API-route files, which are exactly where secrets are legitimately handled and where the
payment-verification logic lives, had not yet been generated. The twelve Phase 6 payment-security
expectations are **verified as specified, not as implemented**. A full source review must be repeated
against the completed generation before any deployment.

---

## 21. Change-request result

**NOT RUN.** Phase 12 requires a working application as its baseline.

---

## 22. Incremental engineering result

**NOT RUN** — see Phase 12.

---

## 23. Incremental generation result

**NOT RUN** — see Phase 12.

---

## 24. LLM usage summary

| Stage | Calls | Retries | Failures |
|---|---|---|---|
| Business Discovery | 0 (deterministic) | 0 | 0 |
| AI Project Manager | 0 (form-driven) | 0 | 0 |
| Product Owner | 1 | 0 | 0 |
| Solution Architect | 1 | 0 | 0 |
| Database Engineer | 1 | 0 | 0 |
| UI/UX Engineer | 2 | 1 | 0 |
| Backend Engineer | 1 | 0 | 0 |
| Frontend Engineer | 1 | 0 | 0 |
| QA Engineer | 2 | 1 | 0 |
| DevOps Engineer | 1 | 0 | 0 |
| **Engineering subtotal** | **10** | **2** | **0** |
| Generation run 1 (cancelled) | 3 | 0 | 0 |
| Generation run 2 (in progress) | ~10+ at cut-off | 0 observed | 0 |

**Approximately 23+ AI calls.** Token usage is not surfaced per call in the UI and was not
instrumented; response payloads were captured but not tokenised, so token counts are unavailable —
stated as a limitation rather than estimated.

Efficiency: every role succeeded on its first or second attempt. **No output was regenerated
identically, no role was manually re-run, and no work was discarded** except the deliberately
cancelled generation required by Phase 5. Cost control was respected.

All evidence was preserved. No BuildersDB cleanup was performed.

---

---

## 24a. External interruption — exhausted Anthropic credits (28 July 2026)

### Root cause — confirmed, external

Application generation run 2 did not fail for any Builders reason. The provider refused every call:

```
ERROR api.generate-text Text generation failed: AI_APICallError: Your credit
balance is too low to access the Anthropic API. Please go to Plans & Billing
to upgrade or purchase credits.
```

Builders surfaced this to the client as HTTP 500, which is why every file failure read
`Request failed with status 500`. **Classified as an external environment interruption, not a
Builders product defect.** No Builders code was modified at any point.

### Interrupted-run final state (15:57:18Z)

The run did not stall — it converged to failure and terminated.

| Metric | Value |
|---|---|
| Generated (usable) | 22 |
| Failed | 96 |
| Never attempted (`attempts = 0`) | 6 |
| Retry cap observed | **9 attempts per file** |
| Manifest | v1, `active`, 133 file rows |

Roughly 800 futile calls were spent retrying a hard, non-retryable billing error. A fail-fast
check on billing/authentication responses would have avoided all of them.

### Manifest 127 vs 133 — explained

`builders_application_manifest_files` `created_at` buckets for manifest v1:

- **127 rows at 15:14** — created by run 1 (the Phase 5 cancelled run)
- **6 rows at 15:41** — added by run 2 into the **same** manifest v1
- `builders_application_manifests.total_files` remained **127**, never recomputed
- 0 duplicate paths, 0 unplanned files, 0 rows missing a manifest link

So the data is not corrupt: the header scalar simply drifted from its own child rows. The warning
text is additionally inverted — it reads *"declares 127 file(s) but **only** 133 are recorded"* for a
number that is larger than 127. The dashboard denominator uses the row count (133) while the warning
compares against `total_files` (127).

### The 0% display

`0 / 133 files complete — 0% (22 generated, awaiting validation)`. The numerator counts **validated**
files; validation never ran because the run aborted. This is AR2-BUG-006 seen under failure
conditions.

### Post-credit probe — SUCCESS

Exactly one controlled probe through the same `/api/generate-text` path and the same
`ANTHROPIC_API_KEY` loaded by the application:

| Field | Value |
|---|---|
| Timestamp | **2026-07-28T16:11:50.439Z** |
| Model | `claude-haiku-4-5-20251001` |
| HTTP status | **200** |
| Latency | 2,404 ms |
| Response | `{"text":"OK","finishReason":"stop"}` |

An earlier probe at 15:56:46Z (890 ms real round-trip) had still returned 500 with the credit error,
so the restoration is confirmed to have taken effect between those two points.

### Recovery behaviour — verified

Restarted **only** the application-generation phase at 16:13:02Z via the normal
"Generate Application" path. Discovery, Requirements, Product Owner, the nine engineering roles and
the Product Package were **not** re-run.

| Check | Result |
|---|---|
| Manifest version behaviour | **Reused manifest v1** — no v2 created |
| Manifest rows | 133, unchanged |
| 22 successful files reusable | **Yes** — all 22 carry content (266,816 chars) and checksums |
| Already-successful files regenerated? | **No** — all 22 remain `generation_attempts: 1`, `latest_version: 1`, checksums unchanged |
| Failed files recovered | **Yes** — all 96 reset from `failed` to `generating` and requeued |
| Provider errors after restart | **None** — monitored calls all HTTP 200 |

State at 16:17:13Z: **22 generated, 102 generating, 0 failed**, status `generating`.

Recovery through the existing manifest worked exactly as designed. This is a positive result for
Sprint 44.2/49 resume behaviour: a mass-failure run was resumed without losing completed work and
without duplicating a manifest.

---

## 24b. AR2-BUG-008 — root-cause investigation (28 July 2026)

### Controlled stop — could not be performed

The run **self-terminated at 16:33:08Z** before the Stop control could be used, and again recorded
`generation_cancelled` / "Generation stopped by the operator" with no operator involved. This is a
**second independent reproduction of AR2-BUG-007**.

Final state (before = after; no further activity, no new AI calls):

| Field | Value |
|---|---|
| Manifests | 1 (v1, `active`) |
| `total_files` | 127 |
| Child rows | 133 |
| Generated / with content | 22 |
| Generating | 102 |
| Failed | 0 |
| Validated (`validation_status` non-null) | **0** |
| Duplicate generated paths | 0 |
| Duplicate manifest paths | 0 |
| Orphan manifests | 0 |
| AI calls (recovery run) | 11, all HTTP 200 |
| Workspace | `cancelled` / `generating-backend` / `last_error: null` |

Stop attribution: **incorrect** (AR2-BUG-007).

### Traced feature: FEAT-005 (server-side Razorpay order creation)

| Boundary | Function | Result |
|---|---|---|
| Stage loop | `runGenerationPipeline`, `for (const module of plan.backendModules)` — generationPipeline.ts:934 | runs |
| Mark generating | `fileHooks.onFilesStarting(role)` | runs — marks **all 96** `category='backend'` rows `generating` and increments `generation_attempts` |
| AI call | `callForFiles(buildBackendModulePrompt(...), BACKEND_GENERATION_SYSTEM_PROMPT)` | HTTP 200 |
| Parse | `parseGeneratedFilesResponse` → `generateRoleWithRecovery` | returned **ok** (proven by elimination below) |
| Path filter | `acceptedFiles = backendResult.files.filter(f => expectedPaths.has(f.path))` — generationPipeline.ts:997 | **empty** |
| Persist | `fileHooks.onFileReady` per accepted file | **never invoked** |
| Stage completion | loop `continue`s | reported as success |

### Controlled response capture (one AI call)

Replicated the FEAT-005 backend prompt with the pipeline's own system prompt and its
`CODE_GENERATION_MAX_OUTPUT_TOKENS = 8192` cap:

| Field | Value |
|---|---|
| HTTP status | 200 |
| **`finishReason`** | **`length`** — truncated at the cap |
| Text length | 12,584 chars |
| Opening | ```` ```json ```` fence, then `{"files":[{"path":"src/features/FEAT-005/types.ts", ...` |
| Ending | cut off mid-string inside a `content` value (`const am`) |

Two findings: the model emits the **correct canonical paths**, and a six-file backend module
**does not fit** in the 8192-token output budget.

### First broken boundary — proven

`generationPipeline.ts:995–1013`. `callForFiles` returns `ok: true`, the `expectedPaths` filter
yields **zero** accepted files, and the loop then:

- pushes **no** `error` issue (only `warning`s for dropped paths),
- does **not** call `onStageFailed`,
- does **not** call `onFileReady`,
- falls through to the next module, leaving the stage reported as completed.

**Proof that `backendResult.ok === true`:** `onStageFailed` marks *every* `category='backend'` row
failed with `last_error` (it targets by category when no path is given —
useCodeGeneration.ts:616–637). During the credit-exhaustion phase that is exactly what happened: all
96 rows went `failed` with `last_error = "Request failed with status 500"`. In the recovery run all
96 rows are `generating` with `last_error: null`, so `onStageFailed` never ran — therefore the
result was `ok`, and the only remaining branch producing zero persisted files is an empty
`acceptedFiles`.

### Root cause

**A backend module stage treats "zero accepted files" as success.** There is no guard asserting that
a stage produced its expected files, so a module that yields nothing is indistinguishable from one
that succeeded. The condition is reachable whenever the AI output survives parsing but no returned
path matches the module's six canonical paths.

The 8192-token ceiling is the demonstrated trigger: a six-file backend slice cannot fit, so the first
attempt always truncates. The final link — what the post-recovery response contained such that zero
paths matched — is **not yet proven** and is carried into the fix plan's verification step rather
than asserted here.

### Why tests missed it

`generationPipeline.spec.ts` exercises cancellation, truncation recovery and the happy path with
**stubbed** `generate` functions that return well-formed, complete JSON at the requested paths. No
test asserts that a backend module stage which returns zero usable files fails; no test drives a
response at the real 8192-token ceiling; and no test asserts `last_error` is populated when a stage
produces nothing. The category-wide `onStageFailed`/`onFilesStarting` targeting is also untested.

### Blast radius

- **Affected:** all backend modules in all application generations (`src/features/*`, `api/*`) — the
  strict `expectedPaths` filter and the missing zero-output guard are unconditional.
- **Aggravated by:** large modules (six files) against the fixed 8192-token cap; the failure is
  systemic, not specific to RunRide.
- **Not affected:** pages, components, services, types, config and entry files — these generate and
  persist correctly (22 files verified with content), because those stages accept extra/unplanned
  paths rather than dropping everything.
- **Not caused by:** the provider (all calls HTTP 200), the resume path, manifest reuse, or the
  Product Package.

### Smallest safe fix plan (not implemented)

1. **Stage-completion guard** — `generationPipeline.ts` backend loop: if `acceptedFiles.length === 0`
   while `pathList.length > 0`, treat the module as failed: push a `severity: 'error'` issue and call
   `onStageFailed` so `last_error` is populated.
2. **Structured error** — include the module slug, the expected paths and the paths actually
   returned, so the mismatch is diagnosable from the activity log.
3. **Retry** — allow one bounded retry of the module on zero-output before failing; never unbounded.
   Do not re-enter on a non-retryable provider error.
4. **Token budget** — raise the backend-module output budget, or generate the six files in smaller
   batches, so a normal module is not truncated on its first attempt.
5. **Persistence** — unchanged; already-successful files must stay reusable (16 of 22 were correctly
   reused this run).
6. **Manifest** — unchanged; also recompute `total_files` when rows are added (fixes 127-vs-133).
7. **Regression tests** — backend stage returning zero files → run fails with a populated
   `last_error`; returning wrong paths → error names them; returning correct paths → all six persist;
   truncated-then-recovered response → files persist; assert bounded retry count.
8. **Live verification** — one project, watch a single backend module produce six persisted rows with
   `latest_version > 0`.
9. **Migration** — none required.

---

## 24c. Sprint 99A — AR2-BUG-008 / AR2-BUG-007 fixed and live-verified (28 July 2026)

Backend module generation was rebuilt to request **2 files per AI call** instead of six, with a
zero-output guard, structured errors, non-retryable provider classification and an explicit
`terminationReason`.

**Controlled live verification — module `FEAT-001` (non-payment, non-admin):**

| Batch | Files | HTTP | finishReason | Returned |
|---|---|---|---|---|
| contract | types, validators | 200 | **stop** | exactly those 2 |
| data | repository, service | 200 | **stop** | exactly those 2 |
| surface | routes, api adapter | 200 | **stop** | exactly those 2 |

3 AI calls · all six files persisted, non-empty (641–2,737 chars) · zero errors, zero warnings ·
not operator-cancelled. **No BuildersDB rows were written** — the Round 2 evidence in
`proj-1785249124131-ub231n` is untouched.

This directly refutes AR2-BUG-008: the old six-file call reproducibly truncated
(`finishReason: "length"`) and persisted nothing.

A Node-side attempt that hit HTTP 401 additionally confirmed AR2-BUG-007 live — the run aborted with
`terminationReason: 'provider-error'`, a populated `last_error`, and was **not** recorded as
"Generation stopped by the operator".

**Still open:** AR2-BUG-006 (progress counters), the manifest `total_files` 127-vs-133 drift, and
Round 2 Phases 6–12. Sprint 99 Checkpoints B–D are not implemented.

## 25. Defect register

### AR2-BUG-001 — Blueprint auto-adopted at 9% confidence, no warning
- **Severity:** Medium · **Phase:** 2
- **Expected:** A near-zero-confidence blueprint match is flagged, or the operator is asked.
- **Actual:** "LocalShop India" (commerce storefront for Indian MSMEs) auto-adopted at **9%
  confidence** for an event-registration product, labelled "Following Recommendation". Runners-up:
  AI Agent 5%, Business Website 3%, Blank Project 0%.
- **Repro:** Create a Blank Project, enter the RunRide brief, save requirements, open Blueprint tab.
- **Root cause (likely):** The recommendation engine adopts the top-ranked candidate without a
  minimum-confidence floor or an operator prompt.
- **Impact:** Steers architecture silently. No downstream harm observed in this run.
- **Also:** the dashboard header kept showing "Blank Project" after adoption — the two surfaces
  disagree.
- **Workaround:** "Choose a Different Blueprint" is available.

### AR2-BUG-002 — Approving the Project Definition does not start engineering, despite the copy
- **Severity:** Medium · **Phase:** 2
- **Expected:** Per the UI: "Approving locks the current Project Definition (v1) and **starts your AI
  Engineering Team automatically** — Architecture, Database, UI/UX, Backend, Frontend, QA, and
  Product Package."
- **Actual:** Nothing started. 25s after approval the project sat at Stage 3 of 5 with an un-actioned
  "Generate Product Owner Draft" button and no AI activity. A manual click was required.
- **Repro:** Approve the Project Definition; observe the Plan tab.
- **Impact:** An operator who trusts the copy will wait indefinitely.
- **Note:** After **Gate A**, auto-progression works correctly for all seven engineering roles — the
  gap is only at this one gate.
- **Workaround:** Click "Generate Product Owner Draft" manually.

### AR2-BUG-003 — Fixed "~20s" estimate for every role, actual 85–333s
- **Severity:** Low · **Phase:** 2
- **Actual:** Every role displays "(est. ~20s)". Real durations were 85s–333s; UI/UX overran the
  estimate by ~16×.
- **Impact:** Long roles read as stalls. Compounds AR2-BUG-006.

### AR2-BUG-004 — Cancelled state persisted but never surfaced after reload
- **Severity:** Medium · **Phase:** 5 · **Directly on the Sprint 98C surface**
- **Expected:** After reload, an operator can see the last run was stopped.
- **Actual:** BuildersDB correctly holds `last_generation_status = "cancelled"`, but **no UI surface
  reports it.** The Home "Continue Working" card shows "Requirements · **Not Generated** · No
  activity yet"; the Project Dashboard shows "**Ready to Preview**", CURRENT STAGE "Complete", NEXT
  ACTION "Generate your prototype".
- **Repro:** Cancel a generation, reload, inspect the home card and dashboard.
- **Evidence:** DB `cancelled` / `generating-pages` / `last_error: null`, verified twice after reload.
- **Root cause (likely):** Home cards read `project.workspaceState`, which is only hydrated when the
  Project Dashboard opens, so on a cold load the card never reaches the `cancelled` branch added in
  Sprint 98C; and the dashboard's stage/next-action calculator was never taught the state.
- **Impact:** An operator returning to a stopped project is told it was never generated. This is
  precisely the confusion DEF-1 set out to remove — the persistence half landed, the presentation
  half did not.
- **Workaround:** None in the UI; the database is correct.

### AR2-BUG-005 — Cancellation latency; AI calls complete after Stop
- **Severity:** Medium · **Phase:** 5
- **Expected:** Generation halts promptly; no further AI spend.
- **Actual:** **2m 11s** between Stop (15:15:58Z) and the cancelled state landing (15:18:09Z).
  Captured call completions went **11 at Stop → 13 at cancel**.
- **Honest limitation:** At least one call was unavoidably in flight at Stop. Whether the second
  *started* after the abort could not be determined from the client side, so this is reported as
  latency plus possible extra spend, **not** a confirmed violation of "no extra AI calls".
- **Mitigating:** No runaway — the count stopped at 13 and the run terminated cleanly with one
  manifest.

### AR2-BUG-006 — Generation progress counters materially understate real progress
- **Severity:** Medium · **Phase:** 4
- **Expected:** Coherent counters (Sprint 98A BUG-013: "one authoritative source for every counter").
- **Actual:** The Application Generation Dashboard displayed **"0 / 127 files complete — 0%
  (3 generated, awaiting validation)"** while BuildersDB simultaneously held **7 file rows (6
  `generated`, 1 `generating`)** and the activity log showed stage **5 of 14** complete. Later, at 10
  DB rows, the UI still read 3.
- **Repro:** Start a generation; compare the dashboard counter against
  `builders_generated_application_files` and the activity log.
- **Root cause (likely):** The dashboard reads a snapshot that is not refreshed as files persist;
  "0 / 127 complete" appears to count only fully *validated* files while the "generated" sub-count
  lags separately.
- **Impact:** A 20+ minute generation appears frozen at 0%. This is the most likely defect to make an
  operator wrongly cancel a healthy run — and it interacts badly with AR2-BUG-003 and AR2-BUG-005.

### AR2-BUG-007 — Internal abort / mass failure recorded as an operator cancellation
- **Severity:** Major · **Phase:** 4 (generation run 2)
- **Expected:** A run that ends because every file failed against a provider error is reported as a
  failure, with the provider error surfaced to the operator.
- **Actual:** At 15:57:18Z — immediately after the final file failure — the run recorded
  `activity_type = generation_cancelled`, description **"Generation stopped by the operator"**,
  workspace `last_generation_status = "cancelled"`, and an Engineering Timeline entry reading
  "Generation stopped / Stopped by the operator". **No operator cancelled this run.**
- **Evidence:** `builders_project_activity` shows 96 consecutive `generated_file_failed` entries
  ("Request failed with status 500") followed directly by the `generation_cancelled` entry. The
  operator's only Stop click in the entire session was at 15:15:58Z against the *previous* run.
- **Analysis:** `runGenerationPipeline` returns `cancelled: true` **only** when `signal.aborted`
  ([generationPipeline.ts:601](../../app/lib/code-generation/generationPipeline.ts)), and the only
  wired caller of `.abort()` on that controller is `cancelGeneration`
  ([useCodeGeneration.ts:1289](../../app/lib/hooks/useCodeGeneration.ts)), bound to the Stop button.
  Notably `stallWatchdog.ts` is referenced **only by its own spec file** and is not wired into the
  generation pipeline at all, so it cannot be the trigger. The abort source could not be identified
  from runtime evidence and is **not** speculated upon here.
- **Impact:** Two compounding harms. The operator is told they stopped a run they did not stop, and
  the real cause — a provider billing failure across 96 files — is erased from the status, the
  history and the timeline. `last_error` is explicitly cleared to `null` by the cancel branch, so no
  diagnostic survives. An operator would have no way to learn why their generation ended.
- **Interaction with Sprint 98C:** the cancel branch is working exactly as written; the defect is
  that a non-operator abort reaches it. Sprint 98C made cancellation a first-class state, which makes
  correct attribution more important, not less.
- **Status:** **Not fixed** — documented only, per instruction.

### AR2-BUG-008 — Backend/feature files never generate; stages report success with zero output
- **Severity:** **Blocker** · **Phase:** 4 (recovery run 3, provider healthy)
- **Expected:** Feature stages generate the planned backend files (`src/features/FEAT-*/`,
  `api/FEAT-*/`) and persist them.
- **Actual:** Across all three generation runs, **not one backend file has ever been produced.**
  Split of the 124 generated-file rows by path:

  | Group | Files | Status | With content | `generation_attempts` |
  |---|---|---|---|---|
  | `src/features/FEAT-*/`, `api/FEAT-*/` | **96** | 100% `generating` | **0** | **13 (all)** |
  | pages / components / services / types | 28 | 22 `generated`, 6 `generating` | 22 | 1–2 |

- **Silent failure:** `last_error` is `null` on all 96, no row is marked `failed`, and there is no
  console error and no server-log entry. The stages report completion normally:
  FEAT-002 16:18:59 · FEAT-003 16:22:35 · FEAT-004 16:26:06 · FEAT-005 16:29:28 — each consuming a
  paid AI call (all HTTP 200) and persisting **zero** files. The last `generated_file_persisted`
  event of the entire recovery run was at 16:15:25.
- **Attempt counter:** climbed 9 → 10 → 13 uniformly across all 96 backend files, so the work is
  being re-attempted and re-billed without ever producing output.
- **Not the provider:** the credit fault is resolved; every monitored call in the recovery run
  returned HTTP 200.
- **Impact — this is why it is a Blocker:** the missing files are the entire security surface of the
  product. FEAT-005 (server-side Razorpay order creation), FEAT-007 (payment signature verification)
  and FEAT-008 (idempotent webhook) do not exist, along with FEAT-001 (schema), FEAT-011 (admin
  auth), FEAT-012/013 (admin dashboard and CSV export). **The backend security review required
  before any external provisioning cannot be performed, because there is no backend code to review.**
- **Projected outcome if allowed to run on:** roughly 28 of 133 files — a frontend-only shell with no
  payment logic, not a deployable application.
- **Status:** **Not fixed** — documented only, per instruction.

**Severity roll-up:** **Blocker 1** · Critical 0 · **Major 1** · **Medium 5** · **Low 1**.

No defect was fixed during this run — none was an isolated low-risk defect, and Builders code was
deliberately left untouched.

---

## 26. Remaining risks

1. **The commercial claim is unproven.** Payment integrity, RLS enforcement, webhook idempotency and
   deployment have been verified *as designed*, never *as running code*. Design-level correctness is
   necessary, not sufficient — and payment code is exactly where the gap between the two bites.
2. **Backend source is unreviewed.** The secret scan covered frontend files only. The API routes
   holding Razorpay secrets and verification logic had not been generated at cut-off.
3. **Operator-trust cluster.** AR2-BUG-003, -005 and -006 together make a healthy long generation
   look stalled. The realistic failure mode is an operator cancelling good work, then (via
   AR2-BUG-004) being told on reload that the project was never generated.
4. **Sprint 98C is half-surfaced.** The state model is right; the presentation is not. Any resume
   feature built on `cancelled` will work, but operators still cannot see it.
5. **Blueprint selection is unguarded.** A 9% match was adopted silently. A different brief could be
   steered badly with no signal.
6. **Generation throughput.** ~14 stages for 127 files at 45–70s per stage implies 15–25 minutes per
   full generation, with no reliable progress signal (AR2-BUG-006).

---

## 27. Cleanup recommendations

**Do not clean up yet** — all evidence is deliberately preserved, per the brief.

When the run is formally closed:

- Retain project `proj-1785249124131-ub231n` until Phases 6–12 are completed; it is the only record.
- Let generation run 2 finish before any cleanup, so the manifest and file rows stay consistent.
- Nothing to revoke: no external accounts were created, no credentials issued, no deployments made.
- The Builders working tree is clean; no revert is required.
- Remove the acceptance project only once Round 2 is re-run to completion and signed off.

---

## 28. Commercial-readiness assessment

**The engineering core is genuinely strong.** Nine roles ran autonomously in 21 minutes and produced
a 165k-character package that a competent contractor would recognise as a real specification. The AI
independently arrived at the correct payment-security architecture — refusing to confirm a
registration until an idempotent, signature-verified webhook says so — which is the single hardest
requirement in the brief and the one most often got wrong. Requirement fidelity was total across five
transformations, scope discipline held against a bad blueprint, retries were bounded and recovered,
and manifest integrity survived a cancel-and-restart with zero orphans.

**What is not ready is the last mile and the operator's view of it.** Builders has not been shown to
take a project through GitHub, Supabase, Razorpay and Vercel to a working paid transaction — not
because it failed, but because it was never given the credentials to try. That is an unproven claim,
not a demonstrated weakness, and the distinction matters. Separately, the generation UI actively
misleads: counters that read 0% during real progress, a 20-second estimate for a five-minute role,
and a cancelled project that reports itself as never generated. None of these corrupts data; all of
them erode the operator's ability to trust what they are looking at, and trust is what a commercial
operator is buying.

For controlled small commercial projects, the planning and engineering half is credible today. The
delivery half is unverified, and the observability defects should be fixed before an operator who is
not the developer is put in front of it.

---

## 29. Final verdict

⚠️ **CONDITIONAL PASS — Builders can begin controlled projects after listed fixes**

**Required before controlled commercial use:**

1. Complete Phases 6–12 with real credentials — this is the substantive condition. PASS is
   unreachable until a test-mode Razorpay payment completes end-to-end on a deployed instance and an
   incremental change is validated.
2. Fix **AR2-BUG-006** (progress counters) — highest operator-impact defect.
3. Fix **AR2-BUG-004** (cancelled state invisible after reload) — completes Sprint 98C.
4. Fix **AR2-BUG-002** (approval copy promises an automatic start that does not happen).
5. Re-run the full generated-source security review once backend files exist.

**Recommended:** AR2-BUG-001 (confidence floor on blueprint adoption), AR2-BUG-003 (adaptive
estimates), AR2-BUG-005 (cancellation latency).

To be explicit: **this verdict is conditional primarily because the commercial workflow was never
exercised, not because Builders failed it.** Nothing in Phases 1–5 suggests the product cannot pass;
the six defects found are all Medium or Low and none touches payment integrity, data integrity or
security. A re-run with credentials provisioned is the deciding test.
