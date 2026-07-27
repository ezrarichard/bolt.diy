# Builders v2.0 Platform Acceptance Test
## Round 1 — Engineering & Generation Validation

**Date:** 27 July 2026
**Reference project:** Builders Reference Project – TaskFlow Lite (`proj-1785136354819-hzkifl`)
**Target Supabase:** `builders-reference` / `onjbonnicuthlpdurkai`
**Tester role:** QA Lead, adversarial posture
**Status:** Paused after Phase 2 (partial) by agreement

---

# SECTION 1 — Executive Summary

## Purpose
First end-to-end acceptance verification of Builders as an AI Software Factory, exercising the platform exactly as a customer would: requirements → nine AI engineering roles → code generation → deployment → release → change request → incremental execution. The goal was to determine whether 97 sprints of work compose into a system that can deliver a real MVP.

## Scope executed
- **Phase 1 (Requirements → DevOps): COMPLETED.** All nine role outputs generated, approved and persisted.
- **Phase 2 (Package → Manifest → Generation): PARTIAL.** Product Package complete; manifest created; code generation reached 4–5 of 9 planned files before being paused.

## Scope not executed
Phases 3–8 in full: GitHub push, Supabase provisioning, Vercel deployment, deployment verification, delivery package, Release 1.0.0, change request, and the entire Sprint 95–97 evolution chain (impact analysis, evolution plan, incremental engineering, incremental execution).

## Overall outcome
**Conditional pass on the engineering core; unproven everywhere else.**

The AI engineering pipeline — the hardest and most differentiated part of the platform — performed better than expected. The surrounding infrastructure (persistence integrity, progress reporting, orchestration reliability, operator controls) is materially weaker and produced one critical blocker plus a cluster of high-severity defects.

## Major strengths
1. **Zero-retry AI generation.** Eight sequential role generations produced eight clean v1 artifacts. No truncation, no malformed JSON, no recovery path invoked.
2. **Aggressive cost optimisation.** Requirements capture, Business Discovery, Project Definition assembly and blueprint resolution are all deterministic — **zero LLM cost** for roughly a third of the visible workflow.
3. **Genuine scope discipline.** The Product Owner independently produced an explicit out-of-scope list matching the stated constraints.
4. **Real persistence.** Nine role outputs and 76+ activity events survived a hard page reload, read back from BuildersDB.
5. **Correct human gates.** Gate A blocked engineering until explicit approval; every AI spend was preceded by a confirmation dialog.

## Major weaknesses
1. **A missing migration silently disabled all manifest persistence** (BUG-008, Critical) — generation ran for over four minutes writing nothing, behind a UI reporting healthy progress.
2. **Silent failure is systemic.** Two independent stalls (BUG-007, BUG-014) and one total persistence failure all presented as "working" in the UI.
3. **No operator control over expensive operations** — no stop/cancel on code generation (BUG-011). Halting a credit burn required reloading the page.
4. **Schema drift is unguarded.** Two schema failures in two sessions, with nothing validating applied schema against the repo.
5. **Six of eight phases remain entirely unproven**, including everything from Sprint 92 onward.

---

# SECTION 2 — Acceptance Scope

## Phase 1 — Engineering ✅ COMPLETED

| Stage | Status | Evidence |
|---|---|---|
| Requirements | ✅ COMPLETED | `requirements-draft` v1 approved 07:16:35 |
| Business Discovery | ✅ COMPLETED | 88% completeness, High confidence, Ready = Yes |
| Blueprint | ✅ COMPLETED | Recommendation produced; operator override persisted |
| Product Owner | ✅ COMPLETED | v1 approved 07:27:02, Gate A |
| Architecture | ✅ COMPLETED | v1 approved 07:32:34 |
| Database | ✅ COMPLETED | v1 approved 07:33:46 |
| UI/UX | ✅ COMPLETED | v1 approved 07:36:30 |
| Backend | ✅ COMPLETED | v1 approved 07:38:10 |
| Frontend | ✅ COMPLETED | v1 approved 07:40:45 |
| QA | ✅ COMPLETED | v1 approved 07:46:05 (manual recovery after stall) |
| DevOps | ✅ COMPLETED | v1 approved 07:48:35 (manual) |

## Phase 2 — Generation ⚠️ IN PROGRESS (paused)

| Stage | Status | Evidence |
|---|---|---|
| Product Package | ✅ COMPLETED | 10 files, all APPROVED, assembled 13:30:33 |
| Application Manifest | ⚠️ PARTIAL | v1 active, checksum `2be304d9`, `total_files: 80`, `completed_files: 0` |
| Code Generation | ⚠️ IN PROGRESS | Reached file 4/9; paused |
| Application Persistence | ⚠️ PARTIAL | 0 files → **BLOCKED** (BUG-008) → 5 files after migration fix |

## Phases 3–8 — ⛔ NOT STARTED

| Phase | Stage | Status |
|---|---|---|
| 3 | GitHub | NOT STARTED |
| 3 | Supabase | NOT STARTED |
| 3 | Vercel | NOT STARTED |
| 3 | Deployment | NOT STARTED |
| 4 | Deployment Verification | NOT STARTED |
| 5 | Delivery Package | NOT STARTED |
| 6 | Release | NOT STARTED |
| 7 | Change Request | NOT STARTED |
| 8 | Impact Analysis | NOT STARTED |
| 8 | Evolution Plan | NOT STARTED |
| 8 | Incremental Engineering | NOT STARTED |
| 8 | Incremental Execution | NOT STARTED |

---

# SECTION 3 — Results

| Metric | Value | Source |
|---|---|---|
| LLM calls — Phase 1 | **8** | One per role generation; requirements deterministic |
| LLM calls — Phase 2 | **~4–5** | File generations; ~3 wasted pre-fix |
| **Total LLM calls** | **~12–13** | |
| **Retries** | **0** | Every role output is v1 |
| Role outputs | **9 / 9** | BuildersDB `builders_role_outputs` |
| Approved outputs | **9 / 9 (100%)** | All `status = approved` |
| Engineering completion | **100%** | Stage 5 of 5 |
| Product Package files | **10 / 10 APPROVED** | BRD, architecture, schema-plan, ui-spec, api-spec, backend-plan, frontend-plan, test-plan, deployment-plan, product-summary |
| Manifest versions | **1** | v1 active |
| Manifest `total_files` | **80** | Planned |
| Manifest files persisted | **5** *(last verified)* | Post-fix |
| Generated files | **4–5** *(last verified)* | |
| Failed files | **0** | |
| Activity events persisted | **76+** | `builders_project_activity` |
| Reload verification | **PASS** | 9 role outputs survived hard reload |
| Deployments created | **0** | |
| Releases created | **0** | |
| Defects found | **14** | 1 Critical, 5 High, 6 Medium, 2 Low |

**Files generated:** `src/types/index.ts`, `src/services/api.ts`, `src/pages/LoginPageUnauthenticatedRootAtLoginRendersPage.tsx`, `src/pages/DashboardPageAuthenticatedHomeAtDashboardRendersPage.tsx` (+1 in flight).

**Measurement caveat:** `builders_ai_usage_events` and `builders_ai_usage_daily` are not exposed through PostgREST, so LLM counts are derived from role-output versions and observed generation events, not from the usage ledger. Treat Phase 2's figure as ±1.

---

# SECTION 4 — Strengths

**1. AI output reliability — exceptional.** Eight sequential 8192-token generations, zero retries, zero truncations. Sprint 44's recovery machinery never fired. This is the single strongest result of the run.

**2. Cost optimisation — better than expected.** Requirements capture, Business Discovery, Project Definition assembly and blueprint resolution are entirely deterministic. A third of the user-visible workflow costs nothing. Most comparable products would have used an LLM for all of it.

**3. Deterministic Discovery quality.** Progressed 80% → 88%, correctly identified missing areas (Business Constraints) and partial areas (Project Type, Current Systems, Integrations), and upgraded Digital Maturity as inputs improved — all without an LLM call.

**4. Scope discipline in role output.** The Product Owner produced an unprompted out-of-scope list naming teams, notifications, payments, analytics, admin portal, AI, uploads, search/tags, comments and recurring tasks. It did not invent features.

**5. Blueprint override.** Despite a poor recommendation, the override flow worked correctly, persisted as a distinct manual selection, and offered "Reset to Recommendation" — recommendation and decision correctly separated.

**6. Persistence and reload recovery.** Nine role outputs and 76+ activity events read back cleanly from BuildersDB after a hard reload. Local state was not authoritative.

**7. Human approval gates.** Gate A genuinely blocked engineering. Every expensive operation had a confirmation dialog stating what would happen and what would be saved.

**8. Manual role fallbacks.** When the pipeline stalled, per-role generate buttons allowed precise recovery of only the stalled stages — no restart, no regeneration of completed work.

**9. Incremental architecture (code-level).** Sprint 97's structural audit passed fully: 4 tables, 73 columns, 14 foreign keys, correct RLS. Not exercised at runtime, but structurally sound.

---

# SECTION 5 — Defect Log

### BUG-008 — Missing migration disables all manifest persistence
| | |
|---|---|
| **Severity** | 🔴 **CRITICAL** |
| **Area** | Database / Application Manifest |
| **Description** | Migration `20260726100000_file_ownership_and_feature_traceability.sql` was never applied to BuildersDB. All five columns it adds were absent. |
| **Evidence** | `feature_ids`, `ownership`, `current_hash`, `user_modified_at`, `conflict_state` all returned Postgres `42703 undefined_column`; control columns present. Console: `saveApplicationManifest() failed`. |
| **Expected** | Manifest and file rows persist. |
| **Actual** | Every file insert rejected; manifest orphaned with 0 files; generation ran 4m24s writing nothing. |
| **Root cause** | Schema drift — repo migration never applied. |
| **Workaround** | `supabase db push` (verified fixes it — files went 0 → 5). |
| **Sprint** | Immediate — **fixed during this run** |

### BUG-014 — Client-side generation throttled to a crawl
| | |
|---|---|
| **Severity** | 🔴 **HIGH** |
| **Area** | Code Generation |
| **Description** | Code generation runs in the browser tab and is deprioritised when not actively driven. |
| **Evidence** | 10 minutes wall time advanced the per-file timer only ~37s (4m11s → 4m48s). Files landed mainly when polling woke the tab. |
| **Expected** | Generation proceeds at full speed unattended. |
| **Actual** | ~1 file per 10 minutes; effectively requires babysitting. |
| **Root cause** | Long-running LLM orchestration in a foreground browser context, subject to browser throttling. |
| **Workaround** | Keep tab focused; poll to wake it. |
| **Sprint** | Next — likely also explains BUG-007 |

### BUG-007 — Autonomous engineering pipeline stalls silently
| | |
|---|---|
| **Severity** | 🔴 **HIGH** |
| **Area** | Engineering Pipeline |
| **Description** | After Frontend completed, the pipeline went `IDLE` with QA and DevOps showing "Waiting…" indefinitely. |
| **Evidence** | Frontend 13:10:46; still IDLE at 13:15 with no error. Manual "Generate QA Draft" recovered cleanly at 13:16:05. |
| **Expected** | UI states *"every engineering stage after it then generates, reviews, and approves itself automatically."* |
| **Actual** | Stopped after 7 of 9 roles, no error surfaced. |
| **Root cause** | **Not fully determined.** Ruled out the documented "one store write behind" race — `updateProjectArtifact` writes synchronously. Likely related to BUG-014. |
| **Workaround** | Per-role manual generate buttons. |
| **Sprint** | Next |

### BUG-009 — Non-transactional manifest save leaves orphans
| | |
|---|---|
| **Severity** | 🔴 **HIGH** |
| **Area** | Application Manifest |
| **Description** | Manifest row inserted before file rows with no transaction; file failure leaves an orphaned `active` manifest. |
| **Evidence** | Manifest v1 persisted with `total_files: 80`, `completed_files: 0`, zero file rows. |
| **Expected** | Atomic save, or cleanup on failure. |
| **Actual** | Orphaned active manifest; retries supersede and accumulate versions. |
| **Root cause** | No transaction/RPC wrapping the two inserts. |
| **Workaround** | None. |
| **Sprint** | Next |

### BUG-010 — Silent failure behind a healthy-looking UI
| | |
|---|---|
| **Severity** | 🔴 **HIGH** |
| **Area** | Observability |
| **Description** | Total persistence failure presented as normal progress; the only signal was an unserialised error. |
| **Evidence** | Dashboard showed "Generating… (3/9)", running timer, status Active for 4m24s with 0 rows saved. Console: `saveApplicationManifest() failed: [object Object]`. |
| **Expected** | Failure surfaced to the operator; error serialised. |
| **Actual** | No user-visible error; useless log. |
| **Root cause** | Error object not serialised; generation loop doesn't surface persistence failures. |
| **Workaround** | Watch DB row counts directly. |
| **Sprint** | Next |

### BUG-002 — Settings statistics endpoints cannot read stored tokens
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Integrations / Settings |
| **Description** | `/api/github-user`, `/api/vercel-user`, `/api/supabase-user` read tokens via cookies; connection flows store them in localStorage. |
| **Evidence** | All three returned `401 token not found`. Vercel tab showed "Connected to Vercel" beside "Failed to fetch Vercel statistics". |
| **Expected** | Settings reflects true connection health. |
| **Actual** | Healthy connections display as broken. |
| **Root cause** | Two token-storage conventions; `getApiKeysFromCookie` vs localStorage. |
| **Workaround** | Ignore Settings stats — **it is not a reliable indicator of deployment health**. |
| **Sprint** | Next+1 |

**This defect cost significant time**: it made a working Vercel connection appear broken and contributed to two wasted token regenerations.

### BUG-011 — No stop control on code generation
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Generation UX |
| **Description** | No Stop/Cancel/Abort on the generation dashboard. |
| **Evidence** | Halting a credit burn required a full page reload. |
| **Expected** | Operator can stop an expensive long-running operation. |
| **Actual** | Reload is the only mechanism. |
| **Root cause** | Not implemented. |
| **Workaround** | Reload the page. |
| **Sprint** | Next |

### BUG-013 — Inconsistent generation progress accounting
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Generation Dashboard |
| **Description** | Four different file counts displayed simultaneously. |
| **Evidence** | Manifest `total_files: 80`; "Planned Files (2)"; 4 rows in DB; header "0 / 2 files complete — 0%". |
| **Expected** | One consistent count. |
| **Actual** | Four disagreeing numbers; progress reads 0% while files persist. |
| **Root cause** | Planned-file count and completion counters not reconciled. |
| **Workaround** | Query DB directly. |
| **Sprint** | Next+1 |

### BUG-012 — Generated filenames built from description text
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Manifest Planning |
| **Description** | Filenames derived from the full description rather than component name. |
| **Evidence** | `src/pages/LoginPageUnauthenticatedRootAtLoginRendersPage.tsx`; `DashboardPageAuthenticatedHomeAtDashboardRendersPage.tsx`. |
| **Expected** | `LoginPage.tsx`, `DashboardPage.tsx`. |
| **Actual** | Unwieldy names shipped into a customer repository. |
| **Root cause** | Filename slug built from description string. |
| **Workaround** | None. |
| **Sprint** | Next+1 — **customer-visible in generated code** |

### BUG-004 — Low-confidence, incorrect blueprint recommendation
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Blueprint Resolution |
| **Description** | Recommended "AI Agent" for a product with AI explicitly out of scope. |
| **Evidence** | AI Agent 25%, SaaS Starter 20%, Next.js SaaS 20%, LocalShop India 6%. Reasons: *"Matches core feature: User Authentication"*, *"Shared keywords with AI Agent"*. Badge read "Following Recommendation" while the project used Blank Project. |
| **Expected** | Sensible recommendation, or an honest "no confident match". |
| **Actual** | Wrong pick at 25% confidence with spurious reasoning. |
| **Root cause** | Weak keyword scoring; no minimum-confidence threshold. |
| **Workaround** | Manual override (works well). |
| **Sprint** | Next+2 |

### BUG-003 — Stale Supabase project reference not validated
| | |
|---|---|
| **Severity** | 🟠 **MEDIUM** |
| **Area** | Supabase Integration |
| **Description** | Cached `selectedProjectId` and derived credentials never validated against the live project list. |
| **Evidence** | Cached `xlghoxxpynorrbhncnyl` (ap-northeast-1); live project is `onjbonnicuthlpdurkai` (ap-northeast-2). Settings rendered the dead reference as current. |
| **Expected** | Stale reference detected and cleared. |
| **Actual** | Dangling ref presented as valid; would have failed mid-Phase-3. |
| **Root cause** | No reconciliation of cached selection against live API. |
| **Workaround** | Select from the live dropdown in Database Activation. |
| **Sprint** | Next |

### BUG-006 — Vercel team selection exposed as free text
| | |
|---|---|
| **Severity** | 🟡 **LOW** |
| **Area** | Vercel Deployment |
| **Description** | `listVercelTeams()` exists and returns `{id, name, slug}` but is wired to no component; the deploy dialog exposes "Team ID (optional)" as free text. |
| **Evidence** | `grep` confirms zero component usage; placeholder `team_xxxxxxxx`. |
| **Expected** | Dropdown populated from the existing function. |
| **Actual** | Operator must know their raw team ID. |
| **Root cause** | Dead code; UI not wired. |
| **Workaround** | Leave blank (works for single-workspace accounts). |
| **Sprint** | Next+2 |

### BUG-001 — configured-providers startup 401
| | |
|---|---|
| **Severity** | 🟡 **LOW** |
| **Area** | Startup |
| **Description** | `/api/configured-providers` 401s on load, firing before the auth interceptor attaches. |
| **Evidence** | Console error at `settings.ts:41`; the same call returns 200 after hydration. |
| **Expected** | Call waits for session hydration. |
| **Actual** | Console error each load. |
| **Root cause** | Race between store init and auth interceptor. |
| **Workaround** | None needed — self-heals; affects only local-provider auto-enable. |
| **Sprint** | Backlog |

### BUG-005 — Duplicate "None, None, None" compliance rendering
| | |
|---|---|
| **Severity** | 🟡 **LOW** |
| **Area** | Project Definition |
| **Description** | Three separately-answered operations fields concatenated without de-duplication. |
| **Evidence** | Project Definition rendered `COMPLIANCE: None, None, None`. |
| **Expected** | "None". |
| **Actual** | Repeated value; appears in AI role context. |
| **Root cause** | No de-duplication on join. |
| **Workaround** | None. |
| **Sprint** | Backlog |

---

# SECTION 6 — Production Readiness

| Subsystem | Verdict | Justification |
|---|---|---|
| **Requirements Engine** | ✅ **READY** | 89% capture, structured sections, deterministic and zero-cost. Only cosmetic BUG-005. |
| **Engineering Pipeline** | ⚠️ **NEARLY READY** | Output quality is excellent — 9/9 roles, all v1, zero retries. But BUG-007 stalled it silently at 7/9. Quality ready; reliability not. |
| **Generation Engine** | 🔴 **NEEDS WORK** | Never completed a single application. BUG-008 (blocked entirely), BUG-014 (throttled), BUG-011 (no stop), BUG-012 (bad filenames), BUG-013 (broken progress). |
| **Manifest** | 🔴 **NEEDS WORK** | Non-transactional (BUG-009), orphaned rows, inconsistent counts (BUG-013). Structurally sound but operationally fragile. |
| **Persistence** | ⚠️ **NEARLY READY** | Role outputs and activity persist reliably and survive reload. Undermined by unguarded schema drift. |
| **Deployment** | ❓ **NOT TESTED** | Never exercised. Code inspection shows correct `teamId` parameterisation; **0 deployments have ever existed in BuildersDB.** |
| **Release** | ❓ **NOT TESTED** | **0 releases have ever existed in BuildersDB.** |
| **Evolution (Sprints 95–97)** | ❓ **NOT TESTED** | Structurally verified (tables, FKs, RLS, 2480 unit tests). **0 change requests, 0 plans, 0 executions ever.** |
| **Overall Platform** | 🔴 **NEEDS WORK** | Strong core; unfinished delivery chain; 6 of 8 phases unproven. |

---

# SECTION 7 — Priority Fix List

### 🔴 Critical — before any further acceptance testing
1. **BUG-008 / schema drift guard.** Already fixed for this instance, but add a startup check comparing expected columns against `information_schema`. Two schema failures in two sessions with no detection is the single biggest systemic risk.

### 🔴 High — before Round 2
2. **BUG-014 — generation throttling.** Blocks unattended generation entirely. Everything downstream depends on generation completing.
3. **BUG-007 — pipeline stall.** Likely shares a root cause with BUG-014; fix together.
4. **BUG-010 — surface failures.** Serialise errors; propagate persistence failures to the UI. This defect is what made BUG-008 expensive.
5. **BUG-009 — transactional manifest save.** Prevents orphan accumulation.

### 🟠 Medium
6. **BUG-011 — stop control.** Small change, prevents uncontrolled credit burn.
7. **BUG-003 — validate cached Supabase reference.** Would have failed Phase 3 mid-run.
8. **BUG-002 — unify token storage.** High time-cost defect; caused two unnecessary token regenerations.
9. **BUG-013 — reconcile progress counters.**
10. **BUG-012 — filename derivation.** Customer-visible in generated repositories.

### 🟡 Low
11. **BUG-004 — blueprint confidence threshold.** Suppress recommendations below ~40%.
12. **BUG-006 — wire the team dropdown.**
13. **BUG-001 — defer provider discovery.**
14. **BUG-005 — de-duplicate compliance fields.**

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → remainder.

Rationale: fix the guard first so nothing else is invalidated by drift; then reliability (2–5) so generation can complete unattended; then operator safety (6); then the integration defects that waste engineer time (7–8); then polish.

---

# SECTION 8 — Acceptance Verdict

## Could Builders deliver a real customer MVP today?

**No — not without a Builders engineer supervising every step.**

### What is genuinely proven
Builders can take a customer conversation to a complete, approved, nine-role engineering specification — reliably, cheaply, and with correct human gates. That is real and it is the hard part. Nine role outputs, all first-attempt, all approved, all persisted and reload-safe, for roughly 12 LLM calls.

### What blocks customer delivery
1. **No application has ever been fully generated.** Best result this run was 4–5 of 9 files.
2. **Generation cannot run unattended** (BUG-014).
3. **Zero deployments and zero releases have ever existed in BuildersDB** — the delivery half of the product is unproven on real data.
4. **Failures are silent.** Three separate silent-failure modes appeared in one session. For a customer-facing factory this is disqualifying on its own.

### Conditions under which it could deliver today
A Builders engineer could hand-shepherd an MVP: keeping the tab focused, watching DB row counts rather than the UI, manually recovering stalls, and manually completing deployment. That is consulting with AI assistance — not a software factory.

## Production readiness: **38%**

| Component | Weight | Score | Contribution |
|---|---|---|---|
| Requirements & Discovery | 15% | 90% | 13.5 |
| Engineering pipeline | 25% | 75% | 18.8 |
| Generation | 20% | 20% | 4.0 |
| Persistence | 10% | 65% | 6.5 |
| Deployment | 10% | 0% (untested) | 0 |
| Release | 10% | 0% (untested) | 0 |
| Evolution | 10% | 0% (untested, structurally sound) | 0 |
| **Total** | | | **≈ 38%** |

Untested subsystems score zero deliberately. Passing unit tests and a clean structural audit are not evidence a subsystem works — and this run demonstrated exactly that: Sprint 97 passed a full structural audit while a Sprint-92-era migration was silently missing.

---

# SECTION 9 — Recommended Next Sprint

### Sprint 98A — Reliability & Observability *(prerequisite for Round 2)*
1. Schema-drift guard: startup validation of expected columns against `information_schema`, with a clear operator error.
2. Fix generation throttling (BUG-014) — move long-running orchestration off the throttled foreground path or add keep-alive.
3. Fix pipeline stall (BUG-007) — instrument the loop exit, add automatic re-entry.
4. Serialise all repository errors; propagate persistence failures to the UI (BUG-010).
5. Wrap manifest + files in a transaction or RPC (BUG-009).
6. Add Stop/Cancel to generation (BUG-011).

### Sprint 98B — Integration Correctness
7. Unify token storage across Settings and services (BUG-002).
8. Validate cached Supabase project against the live list (BUG-003).
9. Reconcile progress counters (BUG-013).
10. Fix filename derivation (BUG-012).

### Sprint 98C — Polish
11. Blueprint confidence threshold (BUG-004).
12. Wire Vercel team dropdown (BUG-006).
13. Defer provider discovery (BUG-001).
14. De-duplicate compliance fields (BUG-005).

**Explicitly not recommended:** Sprint 98 selective code generation as originally planned. Building incremental regeneration on top of a generation engine that has never completed one application would compound risk.

---

# SECTION 10 — Acceptance Round 2 Plan

## Entry criteria
- Sprint 98A complete and merged
- Schema-drift guard passing against BuildersDB
- One application generated **end-to-end unattended** in a dev environment
- All three connections verified via the *deploy* paths, not Settings stats

## Success criteria
- Phase 2 completes unattended: all planned files generated, `completed_files` matching, no orphaned manifests
- Phase 3 produces a real GitHub repo, provisioned Supabase schema, live Vercel URL
- Phase 4 verification passes against the live URL
- Phases 5–6 produce a persisted Delivery Package and Release 1.0.0
- Phases 7–8 complete the evolution chain, exercising Sprint 95–97 on real data for the first time
- Zero silent failures — every failure surfaces in the UI

## Expected duration
**6–9 hours** with the tab supervised: ~1h Phases 1–2, ~2h Phase 3 (real provisioning), ~1h Phases 4–6, ~2h Phases 7–8, plus contingency. Recommend splitting across two sessions at the Phase 6 boundary.

## Already fixed before Round 2
BUG-007, 008 (guard), 009, 010, 011, 014.

## To be re-tested
- Full Phase 1 on a **new** project (regression — confirm zero-retry reproduces)
- Phase 2 to completion
- Reload persistence at every phase boundary

## New areas to verify
- GitHub push and repo contents
- Supabase schema provisioning into `builders-reference`
- Vercel project creation and live deployment
- Deployment verification against a real URL
- Delivery Package contents
- Release 1.0.0, baseline and customer acceptance
- **The entire Sprint 95–97 evolution chain** — highest-value target, never exercised
- Multi-project isolation with two concurrent projects

---

# SECTION 11 — Overall Assessment
### External CTO Audit

## Current maturity
**Late prototype / early alpha.** The intellectual core is genuinely built and works. The operational envelope around it is not finished. The gap between "the AI produces excellent specifications" and "a customer receives a deployed application" is where the remaining work lives, and it is larger than the sprint count suggests.

The most telling signal: 97 sprints in, with 190 test files and 2,480 passing unit tests, BuildersDB contained **zero deployments, zero releases, zero delivery packages**. Sprints 92–97 were built, tested and audited but never run on real data. This run was the first attempt — and it did not get there.

## Commercial readiness
**Not ready for paying customers.** Three silent-failure modes in one session is the disqualifier. A customer factory must fail loudly. A user who switched tabs would have watched generation stall forever with a progress bar suggesting work.

## Technical maturity
**High in parts, immature in others.** The AI orchestration, prompt engineering and role decomposition are strong — zero retries across eight generations is a result most teams do not achieve. Cost engineering is genuinely sophisticated. But error handling (`[object Object]`), transactional integrity, progress accounting and operator controls read as unfinished.

## Engineering quality
**Above average, with a specific blind spot.** The code I inspected is careful and unusually well documented — comments explain *why*, cite specific sprints, and state limitations honestly (the Sprint 96 header openly says reduced context is not yet applied). Test coverage is substantial.

The blind spot is **verification-by-construction**: correctness is assumed from passing unit tests and structural audits. Sprint 97 passed a complete structural audit while an earlier migration was silently missing from the same database. Nothing tests the system as a whole against reality.

## Architecture quality
**Strong.** Clean separation between pure decision modules and orchestration; repositories that never throw; deterministic engines separated from AI calls; append-only history; RLS on every table. The Sprint 97 incremental-execution design is genuinely good — it composes existing engines rather than duplicating them, and the reduction mechanism (narrowing the project handed to `buildContext`) is elegant.

## Business potential
**High, and the differentiator is real.** The zero-cost deterministic layer plus reliable single-pass AI generation is a genuine cost advantage. Producing a complete nine-role engineering specification for ~12 LLM calls is commercially meaningful. The change-request → impact → incremental-execution chain is the right long-term moat — if it works.

## Risk assessment

| Risk | Level | Note |
|---|---|---|
| Silent failure reaching customers | 🔴 High | Three modes observed in one session |
| Generation never completing | 🔴 High | Never completed once |
| Schema drift | 🔴 High | Two occurrences, two sessions, no detection |
| Delivery chain unproven | 🔴 High | 0 deployments, 0 releases ever |
| AI output quality | 🟢 Low | Strongest area |
| Architecture rework | 🟢 Low | Foundations sound |

## Confidence level
**Medium-high in this assessment; low in the untested subsystems.**

I directly observed Phases 1–2. Phases 3–8 I can only evaluate by code inspection and structural audit — and this run proved that is insufficient. My confidence that Phase 1 works is high (observed twice, reload-verified). My confidence that Phases 3–8 work is **low**, not because of evidence against them, but because of the absence of any evidence for them.

## Approval decisions

### Paying pilot customers — ❌ **NO**
Silent failures, no completed generation, unproven delivery. A pilot customer would encounter a stalled generation with no error within the first session.

### CubicleTech internal client work — ⚠️ **CONDITIONAL YES**
Acceptable for internal work **through Phase 1 only** — using Builders to produce engineering specifications, with humans performing generation and deployment. This is defensible today: Phase 1 is reliable, cheap, high-quality and reload-safe, and an internal engineer can spot a stall. Do **not** promise generated applications or deployments.

### Commercial production — ❌ **NO**
Requires Sprint 98A/B complete, one full unattended end-to-end run, and a successful Acceptance Round 2 through Phase 8. Realistically two to three sprints away, assuming Phases 3–8 hold up — which is genuinely unknown.

---

## Closing note

The most valuable outcome of Round 1 was not the pass/fail. It was discovering that **a critical migration had never been applied**, that **generation has never once completed**, and that **the entire delivery half of the platform has never executed on real data** — none of which were visible from the test suite, the structural audit, or the UI.

The engineering core of Builders is better than I expected. The confidence surrounding it is higher than the evidence supports. Closing that gap — not adding features — is the work that matters next.
