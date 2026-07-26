# Sprint 84A — Builders UI Audit and Product Evolution UX Architecture

**Status: planning/architecture only — no production UI was implemented in this sprint.**

This document is the output of a UI/UX audit of the current Builders dashboard, run against the
real, running application (not just source reading), followed by an information-architecture
decision for where Product Evolution (Sprint 82's Business Analyst Product Review, Sprint 83's
Product Owner Roadmap Review, and multi-MVP status generally) should live in the product.

---

## 1. Executive Recommendation

**Recommended architecture: Option B — a dedicated Product workspace, entered from a new
"Product" tab in `ProjectDashboard`, with a compact read-only Product-context strip surfaced next
to the application Preview (a hybrid of B and C).**

Concretely:

- Add **one** new dashboard tab, `product`, positioned right after `plan` and before
  `engineering` in `DASHBOARD_TABS`. It replaces the deeply-buried "MVP Roadmap (lightweight)"
  list currently hidden inside `ProductOwnerDraftPanel`'s expanded preview with a first-class MVP
  timeline + Product Review + Roadmap Review screen.
- Do **not** try to cram Product Evolution into the Preview panel itself (Option C alone) — Preview
  is, and should stay, about the running application. Instead, add a **small, dismissible header
  strip** inside `Preview.tsx` ("Viewing: MVP1 — Released · Next: MVP2 — Roadmap Approved ·
  [Open Product]") that deep-links into the new Product tab. This satisfies Principle 2
  ("product management information should be available from Preview without permanently
  consuming significant Preview space") without duplicating the full workspace.
- Do **not** add an eighth *dense* tab — the new Product tab absorbs functionality that is
  currently scattered (the buried roadmap skeleton preview, the Product Package's "which MVP is
  this for" ambiguity, and the generic activity-log rendering of Product/Roadmap Review events)
  rather than purely adding net-new surface area. Net dashboard tab count goes from 7 to 8, but the
  **information density of the existing dashboard goes down**, not up (see Phase 6).
- This is only reachable/relevant once a project has at least one MVP row (`resolveActiveMvpId`
  returns something) — for a project still on MVP1-in-progress, the tab shows a single-MVP,
  simplified version of the same screen (Section 5.G, "Empty/legacy states").

This recommendation is justified in detail in Phase 4 below, but the one-sentence reason is: the
current dashboard already suffers from **duplicated status surfaces** (Section 3) and a **buried,
undiscoverable roadmap preview** (Section 3, Finding UI-9) — adding Product Evolution as a
same-tier tab that owns "everything about the product across releases" fixes both problems at
once, while Option A (bolt it into an existing tab) would make an already-dense tab worse, and
Option C alone (Preview-embedded) would either starve Preview of space or under-serve
non-technical users who never open Preview at all (operations/support persona, Journey 5).

---

## 2. Screens/Components Inspected

Read directly (source):

- `app/components/sidebar/ProjectDashboard.tsx` (1799 lines) — full read of tab structure,
  workflow-bar stage computation, and all 7 tabs' content.
- `app/components/sidebar/ProjectWorkflowBar.tsx` (189 lines) — full read.
- `app/components/sidebar/ProjectManagerPanel.tsx` (536 lines) — full read.
- `app/components/chat/HomeDashboardSections.tsx` (577 lines) — full read.
- `app/components/sidebar/ProjectHistoryPanel.tsx` (216 lines) — full read, including the
  `ACTIVITY_ICON` map (confirmed it already carries every Sprint 82/83 activity type).
- `app/components/sidebar/ProductPackagePanel.tsx` (357 lines) — full read.
- `app/components/sidebar/ProductOwnerDraftPanel.tsx` — read (Gate A / MVP-creation logic,
  roadmap-skeleton preview rendering).
- `app/components/sidebar/ProjectDefinitionWorkspace.tsx` — read (pre-approval Business Analyst
  workspace + AI Project Manager chat).
- `app/components/sidebar/AIEngineeringTeamPanel.tsx` — read (role checklist/timeline, drives
  `useAutoEngineeringPipeline`).
- `app/components/workbench/Workbench.client.tsx` (537 lines) — read (Code/Diff/Preview slider,
  mobile branch via `useViewport(1024)`).
- `app/components/workbench/Preview.tsx` (1060 lines) — read (live iframe, device-frame simulator,
  port dropdown, inspector mode).
- `app/components/sidebar/Menu.client.tsx` (359 lines) — read (sidebar/nav shell, the one place
  with a real mobile breakpoint: `MOBILE_BREAKPOINT_PX = 768`).
- `app/components/chat/CurrentProjectBadge.tsx` — read.
- `app/lib/mvp/mvpRepository.ts`, `app/lib/features/featureRepository.ts`,
  `app/lib/product-review/*`, `app/lib/roadmap-review/*` (Sprints 81–83, already known from
  implementing them) — re-checked for what read APIs already exist vs. what a UI would still need.

Grepped for confirmation rather than fully read: `app/lib/projects/autoEngineeringEngine.ts`
(`isProjectDefinitionApproved`, `isAutoEngineeringComplete`), `app/lib/projects/projectManagerEngine.ts`
(`analyzeProject`'s return shape), tab/label constant definitions in `ProjectDashboard.tsx`.

---

## 3. Current UI Inventory

Legend for **Action**: Keep / Simplify / Move / Merge / Hide-under-details / Remove.

| # | Screen / Component | Information shown | Target user | Importance | Primary/Secondary | Duplicates? | Technical/Business | Action |
|---|---|---|---|---|---|---|---|---|
| 1 | `ProjectWorkflowBar` (persistent, all tabs) | 5-stage progress (Business→Blueprint→MVP→Engineering→Application), click-to-navigate | Customer | High | Primary | Overlaps `ProjectManagerPanel`'s "Current Stage" card (#3) and header's "Stage X of 5" text (#2) | Business-facing | **Keep**, but see Finding UI-2 (three redundant renderings of the same "current stage" fact) |
| 2 | Dashboard header (name/icon/blueprint/"Stage X of 5"/started date) | Identity + stage ordinal | Both | High | Primary | Duplicates WorkflowBar's implicit stage position | Business | Keep |
| 3 | `ProjectManagerPanel` hero (persistent, all tabs) | Status message, progress %, 4 `StatusMetric`s (Current Stage/Overall Progress/Time Remaining/Approval Required), Continue CTA | Customer | High | Primary | Current Stage + Overall Progress duplicate WorkflowBar and Workspace-tab "Status" cards (#12) | Business | **Keep** as the one canonical "where are we / what's next" surface — see Finding UI-2, consolidate others toward it, not away from it |
| 4 | `ProjectManagerPanel` "Project details (Advanced)" (collapsed by default) | Readiness %, health grade, 8-stage `StagePill` grid, missing items, warnings, recommendations, roadmap/task/review counters | Operator / power customer | Medium | Secondary | Overlaps `AiEngineeringTeamPanel`'s own per-role checklist | Mixed | Keep (already correctly hidden by default — good existing progressive disclosure) |
| 5 | `business` tab — Business Discovery/Understanding | Requirements capture, 3 entry flows | Customer | High (pre-MVP1) / Low (post-release) | Primary during onboarding | No | Business | Keep; becomes low-relevance after release (Finding UI-6) |
| 6 | `blueprint` tab | Blueprint recommendation card | Customer | Medium (once, early) | Primary during onboarding | No | Business | Keep; low-relevance after Blueprint is picked (Finding UI-6) |
| 7 | `plan` tab — Business Analysis section | Requirements draft approval | Customer | High (once) | Primary during onboarding | No | Business | Keep |
| 8 | `plan` tab — Product Owner "MVP Roadmap & Scope" (`ProductOwnerDraftPanel`) | Gate A approval UI; **buried inside it**, an expandable "MVP ROADMAP (lightweight)" list showing every `roadmapSkeleton` entry (MVP-001 label + effort chip) | Customer | High for MVP1 approval; **the only existing UI for "what's the roadmap beyond MVP1"** | Primary (Gate A) / the roadmap list itself is accidental-secondary | The roadmap list here is the seed of what Product Evolution needs to become first-class | Business, but framed as a raw draft-preview, not a decision surface | **Move** the roadmap-skeleton list out into the new Product tab's MVP timeline (Finding UI-9); leave Gate A approval itself here, unchanged |
| 9 | `engineering` tab — `AiEngineeringTeamPanel` | Per-role checklist (AI PM→DevOps), status/version/timestamp, live elapsed-time while running | Customer (light) / Developer (heavy, via children draft panels) | High while building | Primary during Engineering | No | Technical, wrapped in a business-friendly checklist | Keep, but per-role draft panels (children) are technical — already implicitly progressive-disclosure via the checklist-first layout; confirm this stays true post-MVP1 |
| 10 | `application` tab — `ProductPackagePanel` | Assemble Product Package button, file browser (role-grouped files, status badges), content preview pane | Developer / power customer | High during build, low after release | Primary during build | No | Technical | **Simplify** post-release: file-browser detail should move behind progressive disclosure once a project has a released MVP (Finding UI-7) |
| 11 | `application` tab — Deployment card | Status/Target | Customer | Medium | Secondary | No | Mixed | Keep |
| 12 | `workspace` tab — "Status" mini-cards (Project Type/Current Stage/Application Status/Last Build/Last Activity/Generation Profile) | Same facts as `ProjectManagerPanel`'s hero, re-rendered | Operator | Medium | **Fully duplicate** | **Yes — near-exact duplicate of #3** | Mixed | **Remove** (Finding UI-2) |
| 13 | `workspace` tab — connection cards (GitHub/BuildersDB/Supabase/Deployment/Environment/Team/Templates/Preview Status/Last Build/Self-Healing) | 10 separate cards, mostly "Not Connected"/"Not set" for any non-advanced project | Operator/developer | Low-to-medium, mostly config | Secondary | Some overlap with Deployment card in Application tab (#11) | Technical | **Hide-under-details** — collapse into a single "Connections & Configuration" disclosure, expand only on demand (Finding UI-3) |
| 14 | `workspace` tab — Generation Profile / Regional Profile / Package selectors | 3 dropdown selector cards with descriptive copy | Operator | Medium (decision, not status) | Secondary-but-actionable | No | Mixed | Keep, but reframe as "Product configuration," not mixed in with raw connection status (Finding UI-4) |
| 15 | `workspace` tab — Blueprint Overview | Recommended stack/integrations (static, "nothing applied automatically") | Customer/operator | Low after Blueprint is chosen | Secondary | Overlaps `blueprint` tab | Business | **Merge** into `blueprint` tab or hide-under-details in Workspace (Finding UI-5) |
| 16 | `workspace` tab — "Project Roadmap" (blueprint execution checklist: Requirements→...→ `ProjectProgressCard`) | Static onboarding-task roadmap, **NOT the multi-MVP Product Roadmap** | Customer | Medium during onboarding | Primary during onboarding | **Name collision** with the new Product Roadmap concept (Finding UI-8) | Business | Keep function, **rename** to avoid colliding with "Product Roadmap" (MVP1→MVP2→MVP3) — e.g. "Getting Started Checklist" |
| 17 | `workspace` tab — "Task Execution Plan" (`ProjectTaskCard`s + `ExecutionStat`s) | Per-task breakdown/quick actions | Customer | Medium | Primary during onboarding | No | Business | Keep |
| 18 | `history` tab — `ProjectHistoryPanel` | Generic activity log (all `activityType`s incl. Sprint 82/83 events rendered as plain text lines with an icon), repair attempts, task review history, review summary | Operator/customer | Medium | Primary for audit | No | Mixed — Sprint 82/83 events are business decisions rendered as raw log lines | **Keep** as the audit trail; Product/Roadmap Review *decisions* additionally get a real, structured surface in the new Product tab (not removed from History — History stays the append-only log) |
| 19 | `HomeDashboardSections.tsx` — Continue Working / Stats / Recent Projects / Activity / Coming Soon | Cross-project home screen | Customer | High (entry point) | Primary | `BuildersActivitySection` reuses `ACTIVITY_ICON`, same events as #18 across multiple projects | Business | Keep unchanged in this sprint; note for later that once MVP2+ exists, "current stage" here should be able to say "MVP2 — Engineering," not just a single project-level stage (Finding UI-10, out of scope this sprint) |
| 20 | `ComingSoonStrip` | 4 static "Soon" chips | Customer | Low | Secondary | No | Business | Keep (unrelated to this sprint) |
| 21 | `Preview.tsx` (workbench) | Live iframe, port dropdown, device-frame simulator, inspector mode | Customer/developer | High once generated | Primary | No | Mixed | Keep unchanged; **add** the compact Product-context header strip (Phase 5.F) |
| 22 | `Workbench.client.tsx` Code/Diff view | Source code + diff | Developer | High for devs, near-zero for non-technical customers | Primary for devs | No | Technical | Keep unchanged |

### Empty / placeholder-heavy tabs observed live

Running the app against a fresh ("Sprint 34 BuildersDB Verify") project confirmed: `blueprint`
tab shows only "No Blueprint recommendation yet"; `workspace` tab shows nine cards reading "Not
Connected"/"Not set"/"0" for a project that hasn't left `business` stage yet; `history` tab shows
"No activity recorded yet" + an empty "Recent Chats" panel. All of Section 13's connection cards
render even when every single one is unpopulated — this is real, observed clutter, not a
hypothetical.

### Tabs combining unrelated responsibilities

`workspace` is the clearest offender: it mixes **live status** (duplicate of the hero card),
**connection/infrastructure config** (GitHub/Supabase/Deployment), **product configuration**
(Generation/Regional/Package profiles), **static blueprint reference info**, and **onboarding
task tracking** (roadmap checklist + task plan) — five different responsibilities in one tab.

---

## 4. Duplicate / Unnecessary-Information Findings

- **Finding UI-1 (label inconsistency, minor, likely intentional).** The `plan` tab is labeled
  "Plan" in the tab bar (`DASHBOARD_TAB_LABELS.plan`) but the *same* stage is labeled **"MVP"** in
  the persistent `ProjectWorkflowBar` (`WORKFLOW_STAGE_LABELS.plan`, `ProjectDashboard.tsx:483`,
  comment "Sprint UX-2"). This reads as a deliberate customer-facing simplification (WorkflowBar
  is the business-friendly one), but it means "MVP" as a word is already customer-visible today —
  worth reusing that exact vocabulary for the new Product tab rather than introducing a third term.
- **Finding UI-2 (duplicated status, confirmed live).** The fact "current stage = Engineering,
  progress = 41%" was independently rendered in **three** places simultaneously while inspecting
  the "Riverside Dental Clinic" project: the `ProjectWorkflowBar` node highlight, the
  `ProjectManagerPanel` hero's "Current Stage"/"Overall Progress" `StatusMetric` cards, and the
  `workspace` tab's own "Status" mini-cards (Project Type/Current Stage/Application
  Status/Last Build/Last Activity/Generation Profile) — the last one is a near-verbatim repeat of
  the hero card's numbers, one tab-click away. Recommendation: delete the Workspace "Status"
  block entirely; the hero card is already visible on every tab.
- **Finding UI-3 (technical clutter, confirmed live).** The Workspace tab's connection cards
  (Deployment/Environment/Team Members/Templates/Preview Status/Last Build/Self-Healing — 7 cards)
  render fully expanded even when every field reads "Not Connected"/"Not set"/"Never". For a
  non-technical customer this is pure noise. Recommendation: collapse behind one
  "Connections & Configuration" disclosure (Principle 6, progressive disclosure), matching the
  pattern `ProjectManagerPanel`'s "Advanced" section already uses correctly.
- **Finding UI-4 (mixed responsibility).** Generation/Regional/Package Profile selectors are real
  *decisions* the customer/operator makes, but they're visually identical in weight to inert status
  cards around them, so they read as more status than action.
- **Finding UI-5 (duplicate reference info).** "Blueprint Overview" inside Workspace repeats what
  the `blueprint` tab already shows.
- **Finding UI-6 (content valuable only pre-release).** `business` and `blueprint` tabs are
  essential during onboarding and nearly irrelevant once MVP1 is released — they don't need to be
  removed (a customer may still want to re-read their original brief), but they're candidates for
  becoming secondary/collapsed once a project has a released MVP (this sprint does not implement
  that; flagged for Phase 6).
- **Finding UI-7 (content that should be an action, not a static list).** `ProductPackagePanel`'s
  file browser is valuable while building MVP1, but once released, "here are 40 markdown files"
  is not what a returning customer wants — they want "is my site running" (already answered by
  Preview) and "what's next" (answered by the new Product tab).
- **Finding UI-8 (naming collision — important for Sprint 84's own new terminology).** The
  Workspace tab already has a section literally titled **"Project Roadmap"** (a static blueprint
  onboarding checklist: Requirements → ... → Deployment, unrelated to MVPs). The new **Product
  Roadmap** concept (MVP1 → MVP2 → MVP3, Sprint 80/81/83) must NOT reuse the word "Roadmap" without
  qualification anywhere near this tab, or the two will be confused. Recommendation: rename the
  existing section to **"Getting Started Checklist"** or **"Onboarding Roadmap"** (small copy
  change, not in this sprint's implementation scope, but noted so a future sprint doesn't
  reintroduce the collision) and always say **"Product Roadmap"** in full for the new concept,
  never bare "Roadmap."
- **Finding UI-9 (the actual gap this sprint exists to close).** The *only* existing UI rendering
  of `roadmapSkeleton` (future MVP list) anywhere in the app is buried three interactions deep:
  open dashboard → `plan` tab → expand the already-approved `ProductOwnerDraftPanel` preview →
  scroll past the entire MVP1 feature list → reach a small "MVP ROADMAP (lightweight)" block
  listing `MVP-001`/`MVP-002` with an effort chip. This was confirmed live (Riverside Dental
  Clinic project, screenshot: `MVP 1 — Core Website Launch [MVP 1] [SMALL]`, `MVP 2 — Enhanced
  Patient Engagement [FUTURE] [MEDIUM]`). It is not linked from anywhere else, not visible from
  Preview, not visible from the dashboard header, and disappears from relevance once Gate A is
  approved (the panel's job at that point is "show me MVP1 was approved," not "show me the
  roadmap"). This is the single clearest justification for a dedicated Product/MVP surface.
- **Finding UI-10 (Sprint 82/83 events exist only as generic log lines).** `ProjectHistoryPanel`'s
  `ACTIVITY_ICON` map already has entries for every Sprint 82 (`product_review_*`) and Sprint 83
  (`roadmap_review_*`) event, confirmed by direct code read — but they render exactly like every
  other activity line (icon + one sentence + timestamp). A Product Review or Roadmap Review is a
  *business decision* (Principle 10: "should appear as business decisions, not raw database
  records") — today it appears as neither a decision nor a record, just a log entry. This sprint's
  Product/Roadmap Review areas (Phase 5.D/E) are what turns that log line into an actual reviewable
  surface; History keeps the log line too, unchanged, as the audit trail.
- **Finding UI-11 (responsive overflow, confirmed live).** At a 375px mobile viewport, **both** the
  `ProjectWorkflowBar` (5 nodes) and the `DASHBOARD_TABS` pill bar (7 tabs) overflow their
  container and get visually clipped (the 5th workflow node and the last 2-3 tab pills are cut off
  mid-word — "Applicat…", "App"). This is a **pre-existing** problem, not something Sprint 84
  introduces — but it is the strongest possible evidence for Principle 8/Phase 8: a naive
  horizontal MVP1→MVP2→MVP3+ timeline would inherit and worsen this exact failure mode, so the new
  timeline must not be a simple flex-row of unlimited width (Phase 8 specifies the fix).

---

## 5. Current User-Journey Issues

### Journey 1 — Build MVP1 (existing, works reasonably well)

Entry: Business tab → ... → Application tab. **Issue found**: the roadmap-skeleton preview
(Finding UI-9) surfaces during this journey (inside Gate A approval) but is never referenced again
— a customer who noticed "MVP 2 — Enhanced Patient Engagement" while approving MVP1 has no way to
return to that information later without re-opening and re-expanding the same approved draft.

### Journey 2 — Use a released product (does not really exist today)

**Issue found**: there is no "released" concept surfaced in the UI at all. `Mvp.status` values
`released`/`superseded` (Sprint 78) have zero UI representation — `ProjectWorkflowBar` stops at
`application` (generation), not deployment/release. A customer returning to a live product has to
open the same 7-tab dashboard and figure out from context (Application tab's Deployment card,
Workspace tab's Preview Status) whether their product is actually live. This is the single biggest
journey gap Product Evolution needs to fix, independent of Sprint 82/83 specifically.

### Journey 3 — Plan MVP2 (Sprint 82/83 exist as data; zero UI exists)

**Issue found**: every step in this journey (Product Review, Product Review approval, Roadmap
Review, Roadmap approval) currently has **no UI at all** — confirmed by grep (`Finding` in Phase 2
of the audit): no component named `ProductReviewPanel`/`RoadmapReviewPanel` exists anywhere under
`app/components`. The only visible trace is generic activity-log lines in History. A customer
literally cannot perform this journey through the UI today; it would require direct API/database
interaction. This is expected — Sprints 82/83 were domain/backend-only by design — but it means
Phase 5's Product Review/Roadmap Review areas are not simplifying an existing bad UI, they are the
**first** UI these domains will ever have.

### Journey 4 — Compare releases (no UI exists)

**Issue found**: there is no "view MVP1 vs. MVP2" comparison anywhere. `Feature.status`,
`RoadmapRecommendation`-shaped data (added/deferred/removed — Sprint 83's `newFeatures`/
`deferredFeatures`/`removedFeatures`) exists in the domain layer but nothing reads it into a
comparison view.

### Journey 5 — Operations/support user (no non-technical-safe surface exists)

**Issue found**: every existing surface that shows "what's the current status" also shows
technical detail nearby (file browsers, connection strings, generation profiles). There is no
screen an operations/support person could safely be pointed to without also seeing Code/Diff
workbench content or raw config cards. This directly motivates Principle 6 (progressive
disclosure) and the Product tab's design (Phase 5) being business-decision-first.

### Per-journey entry/primary-screen/next-action/hidden-by-default table

| Journey | Entry point | Primary screen | Next action | Supporting info | Hidden by default |
|---|---|---|---|---|---|
| 1. Build MVP1 | New Project | `business`→`plan`→`engineering`→`application` tabs | Whatever `ProjectManagerPanel.nextRecommendedAction` says | Blueprint reference, task plan | Advanced project details, connection cards |
| 2. Use released product | Sidebar project list / Home "Continue Working" | **New**: Product tab header ("Live: MVP1 Released") + `[Open Preview]` | Open Preview, or open Product tab for detail | Deployment status | File browser, engineering role detail |
| 3. Plan MVP2 | **New**: Product tab, "Start Product Review" action once `canGenerateProductReview` | **New**: Product Review area → Roadmap Review area | Approve Product Review → Approve Roadmap Review | Source MVP's shipped Features | Raw `analysis` JSON, artifact internals |
| 4. Compare releases | **New**: Product tab MVP timeline, select MVP1 vs MVP2 | **New**: Selected-MVP summary, side note comparing to prior MVP | Open the Roadmap Review that produced MVP2 | Approvals, artifact links | Full feature body text (collapsed rows, expand on click) |
| 5. Operations/support | Sidebar project list | **New**: Product tab header + MVP timeline only | None (read-only) | Current release, next planned release, blockers | Everything technical: Code/Diff, connection cards, generation profile |

---

## 6. Three Architecture Options

### Option A — Product Evolution as another dashboard tab (flat)

Add `product` to `DASHBOARD_TABS` at the same level as the other 7, with no special treatment —
just another tab rendering MVP list + Product Review + Roadmap Review inline, same visual weight
as `workspace`.

- Clarity: Medium — findable, but competes for attention with 7 already-dense tabs.
- Discoverability: Medium — same as any other tab, no special promotion.
- Dashboard complexity: **Increases** — 8th tab, all content inline, no reduction elsewhere.
- Usefulness while previewing: Low — still requires leaving Preview entirely, no compact
  Preview-side surface.
- Scalability MVP1→MVP3+: Medium — fine content-wise, but inline-in-a-tab layout doesn't obviously
  support a timeline widget without redesigning the tab's own scroll area.
- Suitability for customers: Medium.
- Suitability for operators: Medium.
- Implementation complexity: **Low** (closest to "just add a tab").
- Compatibility with workbench layout: N/A (doesn't touch it) — but then Journey 2/5 still require
  the full dashboard dialog, not a lightweight glance from Preview.
- Mobile impact: Same overflow risk as Finding UI-11 unless explicitly designed against.

### Option B — Dedicated Product/Evolution workspace

A first-class Product tab/area that owns: MVP timeline, selected-MVP summary, Product Review area,
Roadmap Review area — i.e., everything Section 5 (Phase 5 spec) below describes, as one coherent
screen with its own internal navigation (select an MVP, see its reviews), NOT just another flat
tab of cards.

- Clarity: **High** — one place, one clear purpose ("everything about the product across
  releases"), matching Principle 7.
- Discoverability: High if promoted from the workflow bar / header (e.g. WorkflowBar gains a 6th
  node, or the header's "Live: MVP1 Released" text is itself a link).
- Dashboard complexity: **Net decrease** — absorbs Finding UI-9 (buried roadmap list) and gives
  Finding UI-10 (raw log lines) a real home, while other tabs (Workspace) get simplified in
  parallel (Phase 6).
- Usefulness while previewing: Medium alone — needs the Preview-side compact strip (hence the
  hybrid) to be useful *while* previewing, not just as a destination.
- Scalability MVP1→MVP3+: **High** — a dedicated screen can own a real timeline component with
  its own responsive/collapse behavior (Phase 8), not constrained by a generic tab's card grid.
- Suitability for customers: High — business-decision-first framing (Product Review/Roadmap Review
  as approvals, not data).
- Suitability for operators: High — read-only-safe, no technical detail required to understand
  status.
- Implementation complexity: **Medium** — new components, but reads existing data (Phase 7), no
  new persistence.
- Compatibility with workbench layout: Fully compatible — doesn't touch Preview/Workbench at all
  (that's the point of pairing it with the compact strip).
- Mobile impact: Manageable IF the timeline is designed responsively from the start (Phase 8) —
  this is the option where that design work actually pays off, since it's a dedicated screen.

### Option C — Product Evolution integrated beside Preview

Put the MVP timeline / review summaries directly into the Workbench/Preview layout (e.g., a
persistent side panel next to the iframe).

- Clarity: Medium — good *while already in Preview*, but Preview is not where a customer starts
  (they start from the project list/dashboard), so this alone under-serves Journeys 3/4/5.
- Discoverability: Low for anyone who hasn't yet generated an app (Preview doesn't exist pre-MVP1).
- Dashboard complexity: No change to the dashboard (doesn't fix Finding UI-9 at all).
- Usefulness while previewing: **High** — this is the option's whole strength.
- Scalability MVP1→MVP3+: Low — Preview is already visually busy (device-frame simulator, port
  dropdown, inspector mode — 1060-line component); a full timeline competes for the same limited
  horizontal space Finding UI-11 already shows is under strain at narrow widths.
- Suitability for customers: Medium.
- Suitability for operators: **Low** — an operations/support person (Journey 5) explicitly should
  not need to open the code workbench to check product status; putting Product Evolution's primary
  home inside Preview contradicts Principle 1 ("Preview remains focused on the running product")
  and would force exactly the persona this sprint cares about into a technical surface.
- Implementation complexity: Medium-high — `Preview.tsx` is already a large, stateful component;
  adding a real feature surface into it raises regression risk for the existing preview
  functionality.
- Compatibility with workbench layout: Requires restructuring `Preview.tsx`'s layout.
- Mobile impact: **High risk** — `Workbench.client.tsx` already has a dedicated mobile branch
  (`isSmallViewport`, `useViewport(1024)`) that goes full-width and disables hiding chat; adding a
  full Product Evolution surface into that already-constrained mobile workbench layout is the
  riskiest option for small screens.

### Decision Matrix

| Criterion | A: Flat tab | B: Dedicated workspace | C: Beside Preview | B+C Hybrid (recommended) |
|---|---|---|---|---|
| Clarity | Medium | High | Medium | **High** |
| Discoverability | Medium | High (if promoted) | Low pre-release | **High** |
| Dashboard complexity | Increases | Net decrease | No change | **Net decrease** |
| Useful while previewing | Low | Medium | High | **High** |
| Scales to MVP3+ | Medium | High | Low | **High** |
| Suits customers | Medium | High | Medium | **High** |
| Suits operators | Medium | High | Low | **High** |
| Implementation complexity | Low | Medium | Medium-high | **Medium** (B's cost + a small strip) |
| Workbench compatibility | N/A | Full | Requires restructuring | **Full** |
| Mobile risk | Medium (Finding UI-11) | Low (dedicated design) | High | **Low** |

**Selected: the B+C hybrid**, not because it's cheapest (it isn't — A is), but because it's the
only option that scores well on discoverability, operator-suitability, and mobile risk
simultaneously, which are exactly the dimensions Option A and Option C alone each fail on for a
different reason.

---

## 7. Recommended Navigation Architecture

```
Sidebar (project list)
  └─ ProjectDashboard (dialog)
       ├─ Header (name / live-release badge / primary next action)   ← header gains release info
       ├─ ProjectWorkflowBar (persistent)                             ← unchanged, 5 stages, pre-release
       ├─ ProjectManagerPanel (persistent)                            ← unchanged
       └─ Tabs
            ├─ Business
            ├─ Blueprint
            ├─ Plan            (Gate A / MVP1 approval — unchanged)
            ├─ Product   ← NEW  (MVP timeline, Product Review, Roadmap Review)
            ├─ Engineering
            ├─ Application
            ├─ Workspace       (simplified — Phase 6)
            └─ History         (unchanged; still the audit-trail source of truth)

Workbench / Preview (sibling surface, opened once generation exists)
  └─ Preview.tsx
       ├─ [NEW] Compact Product-context strip (collapsible header row)
       │    "Viewing: MVP1 — Released · Next: MVP2 — Roadmap Approved · [Open Product]"
       │    → click routes back into ProjectDashboard, Product tab, no state duplicated
       └─ existing iframe / device frame / port dropdown / inspector (unchanged)
```

**Tab position**: `Product` is inserted between `Plan` and `Engineering` — it's the natural
successor to Gate A (the moment an MVP exists, its lifecycle belongs in Product) and precedes
Engineering because, per the domain architecture (Sprint 80 Part 5), Roadmap Review approval is
what *gates* the next Engineering cycle for MVP2+. For MVP1-only projects, the tab still exists but
shows a single-MVP simplified view (Section "Empty/legacy states" below) rather than being hidden
— consistent visibility beats conditional tab presence for discoverability.

**Preview → Product**: the compact strip's `[Open Product]` link sets `activeTab = 'product'` and
opens `ProjectDashboard` (reusing the exact same `isProjectDashboardOpenStore`/tab-select
mechanism `CurrentProjectBadge.tsx` already uses) — no new routing primitive needed.

**Product → Preview**: the Product tab's header carries an `[Open Preview]` action (mirrors the
wireframe example in the sprint brief) that closes the dialog and focuses the Workbench/Preview
surface — reusing `workbenchStore.showWorkbench`.

---

## 8. Product Workspace Wireframe

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Riverside Dental Clinic                                    [Open Preview]│
│ Vision: "A clean, trustworthy website that converts visitors into        │
│          booked appointments..."                                         │
│ Live: MVP1 — Released         Planned: MVP2 — Roadmap Approved           │
│ Next action: Begin Engineering for MVP2                                  │
├──────────────────────────────────────────────────────────────────────────┤
│  MVP Timeline                                                            │
│  ● MVP1  ───────  ● MVP2  ───────  ○ MVP3                                │
│  Released           Roadmap          Future (skeleton only)              │
│                     Approved                                             │
│  (horizontal on wide screens; see Phase 8 for the collapse behavior      │
│   once a 4th+ MVP exists, or on narrow screens)                          │
├──────────────────────────────────────────────────────────────────────────┤
│  Selected: MVP2 — Enhanced Patient Engagement                            │
│  Status: Roadmap Approved · Effort: Medium · Target: v0.2                │
│                                                                            │
│  [ Overview ]  [ Features ]  [ Reviews ]  [ Approvals ]   ← sub-tabs      │
│  ──────────────────────────────────────────────────────────────────────  │
│  Overview:                                                               │
│    Modules: Patient Portal, Reminders                                   │
│    New Features (3)   Deferred (1)   Removed (0)                        │
│    Dependencies: Invoicing depends on existing customer record model    │
│                                                                            │
│  Reviews tab expands into:                                              │
│  ┌ Product Review (source: MVP1) ───────────────────────────────────┐   │
│  │ Status: Approved                                                  │   │
│  │ Executive Summary: "..."                                          │   │
│  │ Business Risks (2)  Opportunities (3)  Recommendations (4)        │   │
│  │ [View full report]                                                │   │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌ Roadmap Review (target: MVP2) ─────────────────────────────────────┐  │
│  │ Status: Approved                                                  │   │
│  │ New Features · Deferred · Removed · Dependencies · Risks          │   │
│  │ Release Recommendation: "Target v0.2 in 6 weeks."                 │   │
│  │ [View full report]     Approval recorded: 27 Jul 2026             │   │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│  Approvals: MVP2 Scope (pending) · Roadmap Review (approved, 27 Jul)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Section-by-section (Phase 5 spec)

**A. Product header** — product name, one-line vision (from `ProductOwnerDraft.productVision`,
already exists), `resolveLatestReleasedMvp` for "Live," `resolveNextRoadmapTarget`'s `targetMvp`
for "Planned," and a single computed next action (reuse the same kind of decision tree
`projectManagerEngine.analyzeProject` already implements, extended with MVP-aware branches — see
Phase 7).

**B. MVP timeline** — reads `mvpRepository.listMvpsForProject` (committed) left-outer-joined
against the approved `roadmapSkeleton` (skeleton-only future entries) — this is the exact join
Sprint 80 Part 7 already specified and this document's Finding UI-9 shows is already computed once
(inside `ProductOwnerDraftPanel`) but never reused. Supports N MVPs (Phase 8 covers the responsive
behavior beyond 3).

**C. Selected MVP summary** — objective (`Mvp.theme`), status, dates, Features
(`featureRepository.listFeaturesForMvp`), Modules (`distinct(Feature.moduleSlug)`, same derivation
`BackendModulePlan` already performs — Sprint 80 Part 1), approvals (`mvpRepository.listMvpApprovals`),
related Product Review (`productReviewRepository.listProductReviewsByMvp`), related Roadmap Review
(`roadmapReviewRepository.listRoadmapReviewsByProductReview`), artifact links (`artifactId` on
each review, resolved via `getResumableArtifact`/`getApprovedArtifactContent`).

**D. Product Review area** — status, source MVP, `summary`, `businessRisks`, `opportunities`,
`recommendations` (all already-curated fields on `ProductReview` — zero new derivation needed),
plus an **Approve** action wired to `productReviewEngine.approveProductReview` when the review is
`ready_for_review` and the viewer has the right role. This is the first UI ever to call that
function — see Phase 7.

**E. Roadmap Review area** — target MVP, `newFeatures`/`deferredFeatures`/`removedFeatures`/
`priorities`/`dependencies`/`technicalRisks`/`businessRisks`/`recommendedReleaseGoal` (all already
on `RoadmapReview`), approval state (`approvalNotes`, plus the linked `MvpApproval` record via
`mvpRepository.listMvpApprovals(targetMvpId)` filtered to `stage: 'roadmap_review'` — Sprint 83's
own Final Approval Integration work already persists exactly this), and an **Approve** action
wired to `roadmapReviewEngine.approveRoadmapReview`.

**F. Compact Preview context** — see Section 9.

**G. Empty / loading / failure / legacy-data states**:

- **No MVP yet** (pre-Gate-A): Product tab shows a simple "Your roadmap will appear here once MVP1
  is approved" placeholder — same tone as the existing "No Blueprint recommendation yet" pattern
  (Finding: empty states already have an established visual language in this codebase, reuse it).
- **MVP1 only, not yet released**: timeline shows one node (MVP1, current engineering status),
  Reviews area shows "Product Review becomes available once MVP1 is released."
- **MVP1 released, no Product Review started yet**: timeline shows MVP1 (Released), a "Start
  Product Review" action appears (gated on `productReviewEngine.canGenerateProductReview`).
- **Loading**: skeleton rows for the timeline + summary card, matching existing `Skeleton`-style
  loading patterns already used elsewhere in the dashboard (not introducing a new loading idiom).
- **Failure** (a repository call returns an error): inline error banner with retry, same visual
  language `ProductPackagePanel`'s failure banner already uses.
- **Legacy project** (an `Mvp` row exists from before Sprint 82/83, so no `ProductReview`/
  `RoadmapReview` rows exist at all for it): Reviews area reads "No Product Review recorded for
  this release yet" rather than erroring — this is a real, not hypothetical, case: every project
  created before this sprint's own predecessors falls into it.

---

## 9. Compact Preview-Context Wireframe

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Viewing: MVP1 — Released      Next: MVP2 — Roadmap Approved            │
│  [ Open Product ]                                                [ ✕ ]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                     (existing Preview iframe, unchanged)                │
│                                                                           │
```

- Renders as a single collapsible row **above** the existing Preview toolbar in `Preview.tsx`
  (not a side panel — avoids competing for the iframe's horizontal space, directly addressing
  Option C's biggest weakness).
- Content: two short facts (current live MVP + label, next planned MVP + its Roadmap/Product
  Review status) and one link. No lists, no risk/feature detail — this is intentionally the
  thinnest possible summary, per the sprint brief's own instruction ("This should not duplicate
  the complete Product workspace").
- Dismissible (`[✕]`) per session, remembered via the same kind of local workspace-state flag
  `project.workspaceState` already stores other UI preferences in (no new persistence table).
- **Does not render at all** for a project with only one, unreleased MVP — there is nothing
  meaningful to summarize yet, and an empty/placeholder strip above Preview would just be more
  clutter (Principle 5).

---

## 10. Dashboard Cleanup Proposal

| Current section | Classification | Action |
|---|---|---|
| `ProjectWorkflowBar` | Primary dashboard | Keep unchanged |
| `ProjectManagerPanel` (hero) | Primary dashboard | Keep unchanged — canonical status source |
| `ProjectManagerPanel` "Advanced" | Primary dashboard (collapsed) | Keep unchanged |
| Business/Blueprint/Plan tabs | Primary dashboard (onboarding) | Keep; candidate to visually de-emphasize (not hide) once a project has a released MVP — **not implemented this sprint** |
| **Product tab (new)** | Primary dashboard | **New** |
| Engineering tab (`AiEngineeringTeamPanel`) | Build/Engineering workspace | Keep unchanged |
| Application tab — Assemble/Deploy actions | Build/Engineering workspace | Keep |
| Application tab — file browser detail | Build/Engineering workspace, progressive disclosure | Simplify: collapse by default once a project has a released MVP |
| Workspace tab — "Status" mini-cards | — | **Remove** (Finding UI-2, exact duplicate) |
| Workspace tab — connection cards (7) | Workspace/Settings | **Move** behind one "Connections & Configuration" disclosure |
| Workspace tab — Generation/Regional/Package profile selectors | Workspace/Settings | Keep, regrouped under a clearer "Product Configuration" heading |
| Workspace tab — Blueprint Overview | — | **Merge** into `blueprint` tab (or hide-under-details if kept in Workspace) |
| Workspace tab — "Project Roadmap" (onboarding checklist) | Primary dashboard (onboarding) | Keep function, **rename** to avoid colliding with "Product Roadmap" |
| Workspace tab — Task Execution Plan | Primary dashboard (onboarding) | Keep |
| History tab | History/Audit | Keep unchanged — remains the append-only log, including Product/Roadmap Review activity lines |
| Repair status (inside History) | History/Audit | Keep |
| Raw approval records (`MvpApproval`/`ProductReview`/`RoadmapReview` rows) | Product workspace (presented) / History (logged) | Present as decisions in Product tab (Phase 5.D/E); keep raw log entries in History too — not mutually exclusive |
| Role-by-role engineering detail (per-role draft panels) | Build/Engineering workspace | Keep, already appropriately secondary to the checklist |
| Preview / device-frame simulator | Application/Preview | Keep unchanged |
| **Preview compact strip** | Application/Preview | **New** |

Net effect: **one new tab, one new Preview-header strip, one removed duplicate block, three
consolidations, one rename.** No tab is deleted; no functionality is removed (per the sprint's own
constraint) — only relocated, consolidated, or given progressive disclosure.

---

## 11. Component Reuse / Refactor / New-Component Map

### Reuse unchanged

- `ProjectWorkflowBar`, `ProjectManagerPanel`, `AiEngineeringTeamPanel`, `ProductPackagePanel`
  (minus the file-browser default-collapse tweak), `ProjectDefinitionWorkspace`,
  `ProjectHistoryPanel` (and its `ACTIVITY_ICON` map — already complete), `Workbench.client.tsx`,
  all existing card primitives (`StatusMetric`, `InfoCard`, `BuildersSurface`, `BuildersButton`,
  `BuildersStatusBadge`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`).
- `useDraftPanel` state machine — the Product Review/Roadmap Review approval actions can reuse its
  generate/approve/discard shape (they're structurally the same "AI draft → human approval" flow
  every other role panel already uses).

### Refactor (small, scoped)

- `ProjectDashboard.tsx`: add `'product'` to `DASHBOARD_TABS`/`DASHBOARD_TAB_LABELS`; add the new
  tab's content block (same pattern as every existing tab); remove the Workspace "Status" mini-card
  block (Finding UI-2); wrap the 7 connection cards in a single collapsible section.
- `ProductOwnerDraftPanel.tsx`: remove (or shrink to a one-line "See the full roadmap in the
  Product tab" link) the buried "MVP ROADMAP (lightweight)" block now that it has a real home —
  avoids the same information existing in two places going forward.
- `Preview.tsx`: add the compact context strip as a new top-of-panel row; no change to the iframe,
  device-frame, or inspector logic.

### New components required

- `ProductWorkspacePanel.tsx` (or similar) — the Product tab's root, owns MVP selection state.
- `MvpTimeline.tsx` — the horizontal/responsive MVP1→MVPn selector (Phase 8 governs its collapse
  behavior).
- `MvpSummaryCard.tsx` — Section 5.C.
- `ProductReviewCard.tsx` — Section 5.D, including the approve action.
- `RoadmapReviewCard.tsx` — Section 5.E, including the approve action.
- `PreviewProductContextStrip.tsx` — Section 9.

### Tabs/routes/navigation requiring change

- `DASHBOARD_TABS`/`DASHBOARD_TAB_LABELS` (add one entry).
- No URL/route changes are required elsewhere — the dashboard is a dialog, not route-driven, and
  Preview already lives at its existing location.

### Hooks/repositories needed

Already sufficient, no new repository methods required:

- `mvpRepository.listMvpsForProject`, `resolveLatestReleasedMvp`, `resolveNextRoadmapTarget`,
  `listMvpApprovals` (all exist, Sprints 45/81).
- `featureRepository.listFeaturesForMvp`, `listFeaturesForProject` (exist, Sprints 78/81).
- `productReviewRepository.listProductReviewsByMvp`, `getProductReview`,
  `productReviewEngine.approveProductReview`/`canGenerateProductReview` (exist, Sprint 82).
- `roadmapReviewRepository.listRoadmapReviewsByProductReview`, `getRoadmapReview`,
  `roadmapReviewEngine.approveRoadmapReview`/`canGenerateRoadmapReview` (exist, Sprint 83).
- `getApprovedArtifactContent`/`getResumableArtifact` for resolving `artifactId` links (exists,
  Sprint 14/16).

### Missing read-model / selector functions

One genuinely missing piece, **read-only, no new persistence**: a function that joins
`listMvpsForProject` with the approved `roadmapSkeleton` into the single ordered "MVP1 (committed)
→ MVP2 (committed or skeleton) → MVP3 (skeleton)…" list the timeline needs. Sprint 80 Part 7
already specifies this exact join ("same 'join two already-fetched lists in the component' pattern
`ProjectManagerPanel.tsx` already uses") — Sprint 84's implementation should extract it into a
small, testable selector (e.g. `buildProductRoadmapView(mvps, roadmapSkeleton)`) rather than
inlining it in the component, so it's unit-testable the way every other read-model in this
codebase already is. This is a **pure function over existing data**, not a new table/repository.

### Is a dedicated `ProductEvolutionViewModel` useful?

**Yes, as a single selector function, not a new class of persisted object.** One function that
takes `(project, mvps, roadmapSkeleton, productReviews, roadmapReviews)` and returns the exact
shape `ProductWorkspacePanel` needs (timeline entries + selected-MVP detail + linked reviews) keeps
the component itself simple and gives Sprint 85+ one seam to extend rather than several components
each re-deriving the same joins.

### URL-addressable MVP selection?

Not required for Sprint 84 (the dashboard is a modal dialog, not deep-linkable today at the tab
level either — `lastSelectedTab` is persisted but not URL-encoded). Selected-MVP state can be
local `useState` inside `ProductWorkspacePanel`, mirroring how `activeTab` already works. If a
future sprint makes tabs URL-addressable, MVP selection should follow the same mechanism, not
invent its own.

### Preview ↔ Product linking

Covered in Section 7 — both directions reuse existing stores (`isProjectDashboardOpenStore`,
`workbenchStore.showWorkbench`) with no new global state introduced.

---

## 12. Data and Selector Plan

**Prefer read composition over new persistence — confirmed, no new domain tables needed.** Every
field the wireframes in Section 8/9 require already exists on `Mvp`, `Feature`, `ProductReview`,
or `RoadmapReview` (Sprints 45/78/82/83). The only new code is:

1. `buildProductRoadmapView` selector (pure function, Section 11).
2. The 6 new/refactored components (Section 11) — presentation only, calling existing
   repository/engine functions.
3. `Preview.tsx`'s compact strip — reads the same selector output, no separate data path.

No migration, no new table, no new repository method. This satisfies the sprint's own constraint
("Sprint 84 should not create new domain tables unless a real missing persisted concept is
discovered") — none was.

---

## 13. Responsive Behaviour

Observed baseline (375px, live): both the existing `ProjectWorkflowBar` and `DASHBOARD_TABS` pill
row already overflow/clip at mobile width (Finding UI-11) — this is the constraint any new
timeline must design against, not a hypothetical risk.

| Breakpoint | MVP Timeline | Selected-MVP detail | Reviews area |
|---|---|---|---|
| Desktop (≥1280px) | Full horizontal row, all MVPs visible, no scroll | Side-by-side with timeline (as wireframed) | Two cards side-by-side (Product Review / Roadmap Review) |
| Laptop (1024–1279px) | Horizontal row, **scrollable** past ~4 MVPs (`overflow-x-auto` with snap, not `flex-wrap`) rather than shrinking nodes illegibly | Stacked below timeline | Stacked |
| Narrow sidebar collapsed / tablet (768–1023px) | Horizontal scrollable strip, same as laptop but smaller node size | Stacked, full width | Stacked, full width |
| Mobile (<768px) | **Vertical list**, not horizontal — each MVP as a compact row (icon + label + status chip), current/selected MVP expands in place; this is the direct fix for Finding UI-11's failure mode | Inline under the selected MVP row (accordion-style), not a separate panel | Inline, collapsed by default (tap to expand each review) |

Rationale: rather than shrinking a horizontal timeline until it's illegible (what currently happens
to the WorkflowBar/tab-pills at mobile width), the timeline **changes shape** at the mobile
breakpoint — vertical accordion instead of horizontal scroll — which is a stronger fix than "make
it scroll" alone, though laptop/tablet do use horizontal scroll (with visible partial-next-item
affordance, matching how `ProjectDashboard.tsx`'s existing card grids already degrade at `sm:`/`md:`).

The compact Preview strip (Section 9) is a single row of text + one button — it degrades trivially
(wrap to two lines below `md:`) and needs no special mobile handling.

---

## 14. Accessibility Considerations

- MVP timeline nodes must be real buttons (not `div onClick`), keyboard-focusable and
  arrow-key-navigable in sequence, matching `ProjectWorkflowBar`'s existing pattern (it already
  uses accessible node buttons with tooltips — reuse that exact pattern, don't reinvent it).
- Status must never be color-only: every "Released"/"Roadmap Approved"/"Future" state needs a text
  label alongside its color chip (already the convention `BuildersStatusBadge` follows elsewhere in
  this codebase — reuse it).
- The Product Review/Roadmap Review "Approve" actions are consequential (Sprint 82/83's own
  immutability rules make approval effectively permanent) — require the same confirm-before-commit
  pattern `ProductOwnerDraftPanel`'s Gate A approval already uses, and ensure the action is
  reachable and clearly labeled for screen readers (`aria-label="Approve Product Review for MVP1"`,
  not a bare icon button).
- The compact Preview strip's dismiss control needs a real `aria-label` ("Hide product status
  banner"), and dismissing it must not remove keyboard-reachable access to `[Open Product]` — the
  link should remain reachable elsewhere (e.g. the dashboard header always has it) even when the
  strip itself is hidden.
- Mobile vertical-accordion MVP list: expand/collapse state needs `aria-expanded` on each row,
  matching the collapsible pattern `ProjectManagerPanel`'s "Advanced" section already implements.

---

## 15. Implementation Phases (for a future implementation sprint — not this one)

1. **Phase 1 — Selector + read-model.** `buildProductRoadmapView` (Section 11), unit-tested against
   the same deterministic-test conventions Sprints 78–83 established. No UI yet.
2. **Phase 2 — Product tab skeleton.** Add the tab, header, MVP timeline (desktop-only first pass,
   reading real data), and empty/loading states (Section 8.G). No approve actions yet — read-only.
3. **Phase 3 — Selected-MVP summary + Reviews areas.** Section 8.C/D/E, still read-only.
4. **Phase 4 — Approval actions.** Wire `approveProductReview`/`approveRoadmapReview` into the UI,
   with the confirm-before-commit pattern (Section 14).
5. **Phase 5 — Preview compact strip.** Section 9, plus the Preview↔Product linking (Section 7).
6. **Phase 6 — Dashboard cleanup.** Remove the Workspace "Status" duplicate, collapse connection
   cards, merge Blueprint Overview, rename "Project Roadmap" (Section 10) — deliberately last, so
   cleanup lands alongside a working replacement rather than removing information before its
   replacement exists.
7. **Phase 7 — Responsive pass.** Section 13's mobile vertical-accordion behavior, tested against
   the same 375px viewport this audit used.

---

## 16. Risks

- **Scope creep risk**: the Product tab is the natural place someone will want to add Release
  History/Release Notes/Roadmap Approval-workflow UI next — explicitly out of scope here (Section
  17); the component boundaries in Section 11 are drawn so those can be added later without
  restructuring what Sprint 84 builds.
- **Duplicate-state risk**: if `ProductOwnerDraftPanel`'s buried roadmap list isn't actually
  removed/shrunk when the Product tab ships, the exact Finding UI-9 problem reappears in a new
  form (two roadmap displays instead of one). Phase 6 must not be skipped.
- **UI-only-state risk**: every status value the Product tab renders must come from real
  persisted domain data as it's read and presented (Principle 9), never introduce parallel
  UI-only status, so no `MvpStatus`-shaped local state should ever be created purely for display.
- **Mobile regression risk**: Finding UI-11 shows the *existing* WorkflowBar/tabs already have a
  latent mobile bug; a naive implementation of the new timeline could inherit rather than fix it if
  Section 13 is treated as optional.
- **Legacy-project risk**: pre-Sprint-82/83 projects have `Mvp` rows with no `ProductReview`/
  `RoadmapReview` history — the empty/legacy state (Section 8.G) must be explicitly tested, not
  assumed to "just render empty arrays fine."
- **Approval-action risk**: exposing `approveProductReview`/`approveRoadmapReview` in a UI for the
  first time means real customer-facing consequences from Sprint 82/83's immutability rules (an
  approved review can never have its business content edited again) — the confirm-before-commit UX
  (Section 14) is not optional polish, it's the only safeguard between a misclick and a permanent
  state change.

---

## 17. Explicit Sprint 84 Implementation Scope

*(For the future implementation sprint this plan feeds — nothing below was built in Sprint 84A
itself, which is planning-only.)*

- Add `product` tab to `ProjectDashboard`.
- Build `ProductWorkspacePanel`, `MvpTimeline`, `MvpSummaryCard`, `ProductReviewCard`,
  `RoadmapReviewCard`.
- Build `PreviewProductContextStrip` and wire it into `Preview.tsx`.
- Build the `buildProductRoadmapView` selector.
- Wire `approveProductReview`/`approveRoadmapReview` to real UI actions with confirmation.
- Remove the Workspace tab's duplicate "Status" block; collapse its connection cards; merge
  Blueprint Overview; rename "Project Roadmap" to avoid the naming collision.
- Shrink/remove the buried roadmap-skeleton preview inside `ProductOwnerDraftPanel`.
- Responsive behavior per Section 13, accessibility per Section 14.

## 18. Explicit Out-of-Scope List

Confirmed not implemented in Sprint 84A (this planning sprint) and explicitly deferred past the
future implementation sprint described in Section 17 as well:

- Gate A changes of any kind (unchanged, `gateAApproval.ts` untouched).
- MVP2 engineering generation / Feature promotion.
- Release History persistence or Release Notes generation (Sprint 80 Part 8/9 — still tracked
  there, not here).
- Deployment automation, customer portal, collaboration features, new AI roles.
- New Product Review or Roadmap Review domain/backend logic (Sprints 82/83 remain untouched).
- Sprint 85+ features generally.
- Any large visual redesign unrelated to Product Evolution (color system, typography, unrelated
  component restyling).
- Any database/migration change (none was needed or proposed).
- Renaming the Workspace "Project Roadmap" section, collapsing its connection cards, or removing
  its duplicate Status block — **noted as required cleanup (Section 10) but not executed by this
  planning sprint**, since this sprint produced no code changes at all.

---

## 19. Screenshot References / Written Visual Observations

All observations below are from the actual running application (`npm run dev`, port 5190),
Chromium via the Browser pane, not from source reading alone.

1. **Home screen** (unauthenticated local dev state): hero "Describe the problem. Your AI team
   builds the product," sidebar with `New Project`/`Search projects` and a stack of existing
   project rocket-icons.
2. **Project search/list panel**: "Hi, Richard 👋 AI Product Engineer" header, `New Project`
   button, search box, scrollable project list — confirmed dozens of existing local test projects
   spanning many past sprints (Sprint 31 through Sprint 64+ verification projects, several
   "Quick Build"-type projects with a lightning-bolt icon distinct from the rocket icon used for
   Software Factory/guided-engineering projects, and one realistic example project, "Riverside
   Dental Clinic").
3. **"Sprint 34 BuildersDB Verify" (blank project, Business stage, 10% progress)**:
   - Dashboard header: name, "Active" badge, "Blank Project", "Stage 1 of 5", started timestamp.
   - `ProjectWorkflowBar`: 5 nodes (Business active, Blueprint/MVP/Engineering/Application
     pending), each with icon + label + one-line description.
   - `ProjectManagerPanel` hero: "Business Analysis" title, "Add Your Requirements" CTA, 10%
     progress bar, 4 `StatusMetric` cards (Current Stage/Overall Progress/Time Remaining/Approval
     Required), purple "Next Action" callout, collapsed "Project details (ADVANCED)".
   - Tab pill row: Business (active)/Blueprint/Plan/Engineering/Application/Workspace/History.
   - **Blueprint tab**: "Choose Your Blueprint" section, empty-state illustration, "No Blueprint
     recommendation yet."
   - **Workspace tab**: "Status" section (Project Type/Current Stage/Application Status/Last
     Build/Last Activity/Generation Profile — all showing defaults), connection badges
     (BuildersDB: Connected, GitHub: Not Connected, Deployment: Not Connected), then Deployment/
     Environment/Team Members/Templates/Preview Status/Last Build/Self-Healing cards (all empty/
     default), then Generation Profile/Regional Profile/Package selector cards, then "Shared AI
     Provider" (Anthropic connected), "Blueprint Overview" (Blank Project, no suggestions),
     "Project Execution" → "Project Roadmap" (Requirements: Not Started, Project Progress).
   - **History tab**: "No activity recorded yet," "Review Summary: 0 pending, 0 approved, 0
     changes requested," empty "Recent Chats" panel with a "Start Chat" CTA.
4. **"Riverside Dental Clinic" (real example project, Engineering stage, live-generating)**:
   - Header: "Business Website," "Stage 2 of 5," started yesterday, one-line description matching
     the sprint brief's own wireframe example project name.
   - `ProjectWorkflowBar`: Business ✓, Blueprint ✓ (filled, current-looking), MVP ✓ (green check —
     confirms Gate A/MVP1 already approved), Engineering (active, spinning code icon), Application
     (pending).
   - `ProjectManagerPanel` hero: "Engineering — Your AI team is building your product," 35%→41%
     progress (observed increasing across two screenshots taken moments apart, confirming live
     polling), "Engineering is in progress" next action.
   - **Plan tab**: "Plan Your Product" — Business Analysis: Approved (v1); Product Owner — MVP
     Roadmap & Scope: Approved (v1), with copy "The Product Owner Draft is stored locally for this
     project only. Approving it (Gate A) creates MVP 1 in BuildersDB and unlocks Engineering —
     nothing is generated or deployed by this approval itself." Expanding it revealed "PRODUCT
     OWNER DRAFT PREVIEW — MVP 1" (Product Vision, Business Objectives, In/Out of Scope), and,
     further down, **the buried roadmap-skeleton block**: "MVP ROADMAP (LIGHTWEIGHT — ONLY THE
     CURRENT MVP BELOW IS FULLY ELABORATED)" listing `MVP-001: MVP 1 — Core Website Launch [MVP 1]
     [SMALL]` and `MVP-002: MVP 2 — Enhanced Patient Engagement [FUTURE] [MEDIUM]`, followed by
     "MVP-001 — FEATURES" (FEAT-001 Site Navigation Structure, FEAT-002 Homepage with Hero
     Section, FEAT-003 Services Overview Page, FEAT-004 About Section with Dentist Bios, each with
     MoSCoW priority badge, description, "Depends on"/"Why" notes).
   - **Engineering tab**: "Engineer Your Solution" intro, "AI ENGINEERING TEAM" checklist —
     AI Project Manager ✓ v1, Product Owner ✓ v1, Solution Architect ✓ v1, Database Engineer ✓ v1,
     UI/UX Engineer ✓ v1, Backend Engineer (spinner, "Working... 12s elapsed (est. ~20s)"),
     Frontend Engineer/QA Engineer/DevOps Engineer all "Waiting..." — confirmed live, sequential
     role execution exactly as `useAutoEngineeringPipeline` was described.
   - **Application tab**: "Generate & Deploy" — "Assemble Product Package" button, "Nothing
     assembled yet," Deployment card (Not Connected/Not set).
5. **Mobile viewport (375×812) of the Riverside Dental Clinic dashboard**:
   - `ProjectWorkflowBar`'s 5th node ("Application") is visually clipped at the container edge.
   - The 7-item tab pill row overflows its container; the last tab reads "App" (word-clipped) and
     `History` is off-screen entirely without horizontal scroll being obviously discoverable.
   - Confirms Finding UI-11 as a real, currently-shipping issue, not a hypothetical risk.

No production data was persisted or altered — all interaction was read-only navigation of existing
local project data; no new project was created and no form was submitted during this audit.

---

## Final Report

1. **Branch confirmed**: `builders-v2`.
2. **Current UI areas inspected**: `ProjectDashboard.tsx`, `ProjectWorkflowBar.tsx`,
   `ProjectManagerPanel.tsx`, `HomeDashboardSections.tsx`, `ProjectHistoryPanel.tsx`,
   `ProductPackagePanel.tsx`, `ProductOwnerDraftPanel.tsx`, `ProjectDefinitionWorkspace.tsx`,
   `AIEngineeringTeamPanel.tsx`, `Workbench.client.tsx`, `Preview.tsx`, `Menu.client.tsx`,
   `CurrentProjectBadge.tsx`, plus the Sprint 45/78/81/82/83 domain/repository layer.
3. **App states reviewed in the browser**: blank/new project at Business stage (10% progress,
   empty Blueprint/Workspace/History tabs observed directly); a real, actively-generating project
   ("Riverside Dental Clinic") at Engineering stage with MVP1 already Gate-A-approved, observed
   live including a running Backend Engineer role and increasing progress percentage; the same
   project's Plan tab with its buried roadmap-skeleton preview; the same project's dashboard at a
   375px mobile viewport. States "MVP1 released" and "MVP1 released + MVP2 planned/Roadmap
   Approved" (target states F/G) do **not exist in any local project data** — confirmed via code
   that no UI renders them today at all (Section 4, Finding UI-9/UI-10), which is itself direct
   evidence for this sprint's premise rather than a gap in the audit.
4. **Major dashboard problems found**: three redundant renderings of "current stage" status
   (WorkflowBar/hero card/Workspace "Status" block — Finding UI-2); a fully-populated but
   entirely-empty Workspace tab with 7 connection cards on a fresh project (Finding UI-3); a
   naming collision between the existing "Project Roadmap" (onboarding checklist) and the new
   Product Roadmap concept (Finding UI-8); the only existing roadmap-skeleton UI buried three
   interactions deep with no other entry point (Finding UI-9); Sprint 82/83 activity events
   rendering only as generic log lines with no decision surface (Finding UI-10); and a
   **confirmed-live** mobile overflow bug in both the WorkflowBar and tab pill row at 375px
   (Finding UI-11).
5. **Recommended placement of Product Evolution**: a new `Product` tab in `ProjectDashboard`,
   positioned between `Plan` and `Engineering`, built as a dedicated workspace (Option B) rather
   than flat cards in an existing tab or embedded in Preview.
6. **Recommended relationship with Preview**: a small, dismissible, single-row context strip
   ("Viewing: MVP1 — Released · Next: MVP2 — Roadmap Approved · [Open Product]") above the
   existing Preview iframe — never a full panel, never consuming Preview's horizontal space.
7. **Dashboard content recommended for removal/movement**: remove the Workspace tab's duplicate
   "Status" block entirely; move its 7 connection cards behind one collapsed disclosure; merge
   "Blueprint Overview" into the `blueprint` tab; rename "Project Roadmap" to avoid colliding with
   the new Product Roadmap concept; shrink/remove the buried roadmap-skeleton preview inside
   `ProductOwnerDraftPanel` once the Product tab exists.
8. **New components likely required**: `ProductWorkspacePanel`, `MvpTimeline`, `MvpSummaryCard`,
   `ProductReviewCard`, `RoadmapReviewCard`, `PreviewProductContextStrip`, plus one pure selector
   function (`buildProductRoadmapView`).
9. **Existing components that can be reused**: `ProjectWorkflowBar`, `ProjectManagerPanel`,
   `AiEngineeringTeamPanel`, `ProductPackagePanel`, `ProjectHistoryPanel` (its `ACTIVITY_ICON` map
   already covers Sprint 82/83 events), `Workbench.client.tsx`, `useDraftPanel`'s
   generate/approve/discard state machine, and every existing card/badge/tab primitive
   (`BuildersSurface`, `BuildersButton`, `BuildersStatusBadge`, `Tabs`).
10. **Whether database changes are needed**: **no.** Every field required by the wireframes
    already exists on `Mvp`, `Feature`, `ProductReview`, or `RoadmapReview` (Sprints 45/78/82/83).
    Only one new pure read-model selector function is proposed, no new table or migration.
11. **Proposed implementation phases**: (1) selector/read-model, (2) Product tab skeleton +
    timeline (read-only), (3) selected-MVP summary + Reviews areas (read-only), (4) approval
    actions with confirmation, (5) Preview compact strip + linking, (6) dashboard cleanup
    (deliberately last, after the replacement exists), (7) responsive pass.
12. **Files changed**: one — this document,
    `docs/product-management/Sprint-84-Product-Evolution-UX-Plan.md` (new file). No application
    source file was modified.
13. **Confirmation that no production UI was implemented**: confirmed — no component, tab, or
    styling change was made to any file under `app/`. Only read-only browser navigation of
    existing local project data was performed.
14. **Confirmation that nothing was committed**: confirmed — `git status` shows exactly one new,
    untracked file (this document); no `git add`/`git commit` was run.
