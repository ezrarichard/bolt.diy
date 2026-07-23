# Builders Discovery Experience (BDE) — Master Product & UX Specification

**Status: APPROVED (master product/UX specification) — no code, files, migrations, or
commits were created or modified.** This is the Product Definition Layer of Builders:
everything that happens before Business Analyst begins. It unifies and extends
[Sprint 55 — Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) and
[Sprint 55.1 — Interview Mode UX Specification](./03-sprint-55.1-interview-mode-ux-specification.md)
across every discovery method (Form, Interview, Document, Website, Template, Voice, Meeting,
and future sources), not just conversational interview.

**See also:** [06 — Requirements Discovery index](./00-index.md) ·
[Sprint 55 — Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) ·
[Sprint 55.1 — Interview Mode UX Specification](./03-sprint-55.1-interview-mode-ux-specification.md)

---

## Vision Statement

> Builders should feel less like software and more like the best business consultant a founder never had time to hire. By the time a customer reaches "Generate Project Definition," Builders shouldn't just have *data* about their business — it should **understand** it, the way a sharp analyst who sat through three meetings would. Every method of getting there — talking, typing, uploading, showing a website — is just a different way of *telling Builders about your business*, and they should all end up in the same understanding.

Everything below operationalizes that sentence.

---

## 1. Discovery Home

**Design principle:** don't force a mode. The current flow (Sprint 51) drops every customer straight into the Requirements Form; Sprint 55/55.1 add Interview Mode as an alternative reached *from inside* that same panel. Discovery Home elevates method selection to a **first-class, deliberate moment** — the instant after project creation, before either the Form or Interview ever renders.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Plumber Coimbatore Website                                            │
│  ─────────────────────────────────────────────────────────────────── │
│                                                                          │
│           How would you like to tell us about your business?           │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  💬          │  │  📝          │  │  📄          │  │  🌐          │  │
│  │  AI Business  │  │  Quick       │  │  Upload      │  │  Website     │  │
│  │  Interview    │  │  Requirements│  │  Documents   │  │  Analysis    │  │
│  │  Talk it       │  │  Form        │  │  Business    │  │  Already     │  │
│  │  through with  │  │  Fill in      │  │  plan, brief,│  │  online?     │  │
│  │  an AI analyst │  │  structured   │  │  notes        │  │  Let us read │  │
│  │  ⭐ Recommended│  │  fields       │  │              │  │  it          │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                    │
│  │  🎙          │  │  🗒          │  │  🧩          │   More options ▾  │
│  │  Voice        │  │  Meeting     │  │  Start from  │                  │
│  │  Conversation │  │  Transcript  │  │  Template     │                  │
│  │  Coming soon  │  │  Coming soon │  │  Restaurant,  │                  │
│  │              │  │              │  │  Clinic, ...  │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                    │
│                                                                          │
│              [ Skip — I'll decide as I go ]                             │
└──────────────────────────────────────────────────────────────────────┘
```

**Key UX decisions:**
- **One method is marked "⭐ Recommended,"** not force-selected — Discovery Home *suggests*, never gatekeeps (see §2 for the recommendation logic).
- **Unavailable methods are shown, not hidden** ("Coming soon," disabled state) — this is deliberate: it signals Builders' *ambition* even in v1, and it primes customers to expect these later without ever needing a "what's new" tour.
- **"Skip — I'll decide as I go"** always present at the bottom — Discovery Home must never feel like a mandatory gate; a customer can land directly on the existing Requirements & Knowledge panel (today's default) and pick a method from there instead, exactly as Sprint 55.1 already designed ("Add Requirements" next to "Talk it through instead").
- **Method cards are re-enterable** — Discovery Home isn't a one-time modal. It's also reachable any time from the Requirements & Knowledge panel via a small "Change method" link, because customers change their mind (start with the Form, realize halfway through they'd rather talk, etc. — this is exactly what §10 of Sprint 55.1 already designed for Form↔Interview).

---

## 2. Discovery Methods

| Method | Advantages | Disadvantages | Builders should recommend when… |
|---|---|---|---|
| **AI Business Interview** | Feels natural; adapts dynamically; catches nuance a form field never asks about; lowest cognitive load for non-technical founders | Slower for someone who already has everything written down; requires the customer to *narrate*, which some find harder than typing into boxes | Default recommendation for first-time founders, solo owners, and anyone whose project description is short/vague — i.e., low existing signal, where a guided conversation extracts the most value per minute. |
| **Quick Requirements Form** | Fast for someone who already knows exactly what they want; scannable; easy to revise later; zero AI dependency (works even if BuildersDB/AI is degraded) | Blank-page problem — customers who don't yet know what they need stare at empty fields; doesn't adapt or follow up | Recommend when the project description (typed at creation) is already dense/specific, or the customer explicitly has a spec/brief in hand — they're translating, not discovering. |
| **Upload Documents** | Reuses work already done (business plan, one-pager, RFP); can extract a large amount of structured signal in one pass | Requires a document to exist; quality depends entirely on document quality; needs a human review step since extraction confidence varies by document structure | Recommend when the customer mentions ("I already have a doc for this") — detect via a simple prompt at project creation: "Do you already have anything written down?" |
| **Website Analysis** | Zero-effort for an existing business — Builders infers industry, tone, services straight from what's already public | Only useful for *existing* businesses rebuilding/extending, not new ventures; can't discover anything not already visible on the site (new features, private constraints) | Recommend when the project is described as "rebuild my website" / "add X to my existing site" — detect via keywords at creation ("rebuild," "redesign," "my current site"). |
| **Start from Template** | Fastest possible start; pre-fills industry-typical answers a customer can just confirm/adjust rather than generate from scratch | Risk of generic output if the customer clicks through without truly reviewing; less discovery, more validation | Recommend for extremely common, well-understood project types (a restaurant site, a clinic booking page) where 80% of the Business Understanding Model is predictable — the interview/form only needs to *confirm and customize*, not build from zero. |
| **Meeting Transcript** *(future)* | Captures discovery that already happened in a real sales/scoping call, with zero extra customer effort | Requires the meeting to have happened and been recorded/transcribed; noisier signal (small talk, tangents) than direct answers | Recommend for agencies/consultants who already run discovery calls with their own clients — Builders becomes the notetaker, not the interviewer. |
| **Voice Conversation** *(future)* | Same benefits as AI Interview, lower friction for users who dislike typing (mobile, on-the-go tradespeople) | Requires quiet environment, decent connectivity; transcription errors compound | Recommend for mobile-first personas (tradespeople, on-site business owners) once available — same detection logic as Interview, biased toward mobile session context. |

**Should AI recommend one automatically?**
Yes — **one soft recommendation, never a hard default the customer must opt out of.** The recommendation is computed from three cheap, available signals at project-creation time: (1) length/specificity of the initial project description, (2) explicit customer language ("I have a document," "rebuild my site"), and (3) device context (mobile → lean toward Interview/Voice over Form). This recommendation logic is itself just a **very small, deterministic rule set** — consistent with every other "no unnecessary AI" decision already made in this system (Sprints 53/54 kept classification rule-based; this follows the same discipline). No LLM call needed to decide *which method to suggest* — only the methods themselves use AI once selected.

---

## 3. Unified Discovery Pipeline

**The single most important architectural idea in this document: every method is an adapter, and every adapter terminates in the exact same pipeline already built and proven in Sprints 50–54.1.**

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Quick Form    │ │  AI Interview  │ │  Document      │ │  Website       │
│  (Sprint 51)   │ │  (Sprint 55/56)│ │  Upload        │ │  Analysis      │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │                  │                  │                  │
        │         ┌────────┴──────┐  ┌────────┴──────┐          │
        │         │ Template       │  │ Meeting/Voice  │          │
        │         │ (pre-filled     │  │ (future)       │          │
        │         │  form/interview)│  │                │          │
        │         └────────┬───────┘  └────────┬──────┘          │
        │                  │                     │                  │
        └──────────────────┴────────┬────────────┴──────────────────┘
                                     ▼
                    BusinessUnderstandingModelPatch
                    (the ONE contract every method produces —
                     already defined, already tested, unchanged)
                                     ▼
                    ┌────────────────────────────┐
                    │  runBusinessAssessment()     │  ← Sprint 53, unchanged
                    └────────────┬───────────────┘
                                     ▼
                    ┌────────────────────────────┐
                    │  runDiscoveryDecision()      │  ← Sprint 54, unchanged
                    └────────────┬───────────────┘
                                     ▼
                    ┌────────────────────────────┐
                    │  BusinessUnderstandingModel  │
                    │  (durable, single source of  │
                    │   truth, BuildersDB)          │
                    └────────────┬───────────────┘
                                     ▼
                    ┌────────────────────────────┐
                    │  Business Discovery UI        │  ← Sprint 54.1, unchanged
                    │  (Discovery Dashboard, §4)    │
                    └────────────┬───────────────┘
                          decision.state == READY
                                     ▼
                    ┌────────────────────────────┐
                    │  Generate Project Definition  │
                    └────────────┬───────────────┘
                                     ▼
                          Business Analyst → Approval →
                          Product Owner → Engineering
                          (entirely unchanged)
```

**Why this matters commercially, not just architecturally:** every new discovery method Builders ever ships (§12's Slack, CRM import, GitHub analysis, whatever comes after) is **only** the top layer of this diagram — a new adapter box feeding the same patch contract. None of them touch assessment, decision, UI, traceability, or anything downstream of discovery. This is what makes "world's most intelligent AI Software Discovery Platform" a *sustainable* claim rather than a one-time feature — the intelligence compounds because the foundation doesn't fragment per input type.

---

## 4. Discovery Dashboard

**This is the evolution of `BusinessDiscoveryCard` (Sprint 54.1) into the full "always know where you stand" surface — same component family, more sections, still one visual language.**

```
┌────────────────────────────────────────────────────────────────┐
│  Discovery Dashboard                                              │
│  ──────────────────────────────────────────────────────────────  │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Current State          │  │  Discovery Health                  │ │
│  │  NEEDS MORE INFORMATION │  │  ●●●●●●●●○○  Good (80/100)         │ │
│  │  via AI Interview        │  │  (blends completeness + confidence  │ │
│  └──────────────────────┘  │   + evidence quality — see §9)      │ │
│                              └──────────────────────────────────┘ │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Progress                │  │  Confidence                        │ │
│  │  ▓▓▓▓▓▓░░░░  49%         │  │  Overall: Medium                   │ │
│  │  Requirements Form: 24%   │  │  (Assessment: Low · Decision: Med) │ │
│  │  Discovery: 49% ← distinct│  └──────────────────────────────────┘ │
│  └──────────────────────┘                                          │
│                                                                     │
│  ┌──────────────────────────────────┐ ┌────────────────────────┐ │
│  │  What's Missing                     │ │  Risk Level               │ │
│  │  ⬤ Integrations  ⬤ Tech Prefs        │ │  ⚠ Medium                 │ │
│  │  Partial: Core Features              │ │  "Payment method unclear"  │ │
│  └──────────────────────────────────┘ └────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Recommended Next Action                                     │    │
│  │  → Continue your AI Interview — 3 more topics to cover        │    │
│  │    [ Continue Interview ]   or   [ Upload a document instead ]│    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Open Questions (2)                                          │    │
│  │  • Do you need multi-location support?                       │    │
│  │  • Any compliance requirements (GST, HIPAA-equivalent)?       │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

**Section-by-section design intent:**
- **Current State** — the exact `DiscoveryDecision.state` badge (unchanged from Sprint 54.1), plus a small subtitle naming *which method* most recently updated it — orienting the customer across multiple discovery methods used together.
- **Progress** — deliberately shows **both** the legacy Requirements Form completion **and** Discovery Completeness, distinctly labeled, exactly as Sprint 54.1 mandated ("Do not merge the two values") — now extended as a dashboard-level principle: *whichever methods were used, their contributions are visible, not blended into a single mystery number.*
- **Confidence** — surfaces both `assessmentConfidence` (Sprint 53) and `decision.overallConfidence` (Sprint 54) side by side, since they can legitimately diverge (e.g., we're very sure of the industry but not sure discovery is complete).
- **What's Missing** — direct reuse of the existing Missing/Partial chip design (Sprint 54.1), unchanged.
- **Risk Level** — **new** concept for this master document: a lightweight, deterministic derivation from specific `businessConstraints`/`currentSystems` gaps that commonly cause downstream engineering risk (e.g., "payment method unclear" when `businessConstraints` mentions payments but lacks a specific processor) — computed via simple rules, not new AI, following the same anti-hallucination discipline as everything upstream.
- **Recommended Next Action** — always exactly **one** primary recommendation plus one alternative — never a list of five options that reads like indecision. This is the dashboard's single most important line, because it answers "what do I do right now" without the customer having to interpret the rest of the panel themselves.
- **Open Questions** — surfaces the existing but-never-yet-rendered `OpenQuestion` domain type (reserved since Sprint 50) — this master document is the first place it earns a UI slot, since it only becomes meaningful once multiple discovery methods (especially documents/websites, which can't ask follow-ups themselves) can *leave behind* unanswered questions for a later Interview session to pick up.
- **Discovery Health** — a single blended score, deliberately separate from raw Completeness %, described fully in §9.

---

## 5. Discovery Agent

**Extending Sprint 55's Discovery Agent design from "conversational Q&A owner" to "owner of every discovery adapter."**

**Responsibilities:**
- Own the **Fact Extraction contract**: turn any input (chat answer, document text, website content, meeting transcript, voice transcript) into a `BusinessUnderstandingModelPatch`.
- Own **Question Planning** for any turn-based method (chat, voice, meeting) — deciding what's still needed, per Sprint 55 §2's deterministic algorithm.
- Own **evidence tagging** — every fact it extracts carries a `TraceabilityReference` back to its source, regardless of source type (§6, §7).

**Boundaries (explicitly NOT the Discovery Agent's job):**
- **Never** writes the Requirements Draft — that's Business Analyst's job, unchanged, downstream.
- **Never** decides `decision.state` — that's `discoveryDecisionEngine`'s deterministic job, always.
- **Never** auto-advances the pipeline (generates a draft, approves anything) — every pipeline transition remains an explicit customer action, exactly as today.

**Prompt strategy per input type:**

| Input | Prompt shape | Anti-hallucination guard |
|---|---|---|
| Chat answer | Narrow, single-dimension extraction (Sprint 55 §11) | Extractive only; never infer beyond literal text |
| Document | "Extract only facts explicitly stated in this document, mapped to these ten dimensions. Flag ambiguous/conflicting statements as Open Questions rather than guessing." | Same extractive discipline; low-confidence extractions default to `'inferred'`, never `'confirmed'`, until a human reviews (see Document review step below) |
| Website | Same as document, but scoped per-page (About, Services, Contact) with page URL as source metadata | Never infer offerings not literally described; a generic "we do great work" page yields near-zero extraction rather than fabricated features |
| Voice/Meeting transcript | Same as chat, applied per speaker turn | Speaker attribution preserved in provenance; low-confidence turns (poor transcription) are marked, not silently used |

**A required addition for document/website methods specifically: a lightweight review step.** Since these methods can't ask a clarifying follow-up in real time, every extracted patch from a document/website pass is shown to the customer as a **diffable review** ("Here's what we found — confirm or correct") before it's committed as `stated`/`confirmed` — this is the human-in-the-loop equivalent of the Confirmation question type from Sprint 55.1 §5, applied to non-conversational input.

**Memory / Knowledge:** the Discovery Agent's "knowledge" is never model-internal — it's always the current `BusinessUnderstandingModel` plus whatever bounded recent context Sprint 55 §5/§14 already specified. No discovery method gets its own separate memory silo; see §6.

---

## 6. Discovery Memory

**One understanding, many inputs — the memory model must make this literal, not just conceptual.**

```
                     ┌───────────────────────────┐
                     │  BusinessUnderstandingModel  │
                     │  (the ONE memory)             │
                     └─────────────┬─────────────┘
                                     ▲
        ┌───────────┬───────────┬───┴───────┬───────────┬───────────┐
        │            │            │            │            │            │
   Conversation   Form fields  Documents    Websites    Voice       Meeting
   (chat turns)   (Sprint 51)  (extracted   (extracted  (transcribed notes
                                 per-doc)    per-page)   turns)      (per-speaker)
        │            │            │            │            │            │
        └───────────┴───────────┴───────────┴───────────┴───────────┘
                                     │
                          Every contribution recorded as a
                          RequirementsSessionMessage (or an
                          equivalent durable record) +
                          TraceabilityReference — nothing is
                          "merged and forgotten"; the RAW
                          source of every fact is always
                          retrievable.
```

- **Raw history is method-specific but uniformly durable** — a chat turn, an uploaded PDF, and a crawled webpage are all just different `messageType`/source records, all pointing at the same target model. The *schema* doesn't need a new memory system per method; it needs a **new source type per method**, plugged into the existing `ProvenanceEntityType`/message pattern (already extensible — recall `ProvenanceEntityType` is a plain string-backed union, never requiring a schema migration to add a new source kind, per its own Sprint 52 design comment).
- **Templates are a special, pre-loaded memory** — starting from a template pre-populates the model with `'inferred'`-confidence facts (never `'stated'`/`'confirmed'`) that the customer then confirms or corrects through whatever method they continue with — templates are a *starting memory state*, not a separate method with its own pipeline.
- **Working memory for AI calls** (what actually goes in a prompt) stays bounded regardless of how many methods contributed, exactly per Sprint 55 §14 — the compact `BusinessUnderstandingModel` summary, not raw history, is what every method's AI calls are grounded in. This is what keeps a project that used Form + Interview + a document upload just as fast/cheap as one that only used one method.

---

## 7. Discovery Intelligence — How the Pieces Work Together

```
                        BusinessUnderstandingModel
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                    ▼                    ▼
      Business Assessment    Discovery Decision      Traceability
      (Sprint 53)             (Sprint 54)              (Sprint 52)
      • classification         • state                  • every fact's
      • industry                • completenessScore        source + rule
      • maturity                • missingAreas             that produced it
      • projectType             • partialAreas
      • confidence              • overallConfidence
                │                    │                    │
                └───────────────────┼───────────────────┘
                                    ▼
                      Derived, display-only concepts
                      (NEW in this document — no new
                       engines, only new READING of
                       existing data):
                ┌───────────────────┬───────────────────┐
                ▼                    ▼                    ▼
          Business Risks        Priority            Recommendations
          (rule-based, from     (dimension weight   (deferred — Sprint
           specific constraint   ordering already     54's explicit
           gaps — §4)            exists in            "no recommendations"
                                  discoveryDecisionEngine) rule still holds;
                                                        this is a FUTURE
                                                        capability, not
                                                        Sprint 55/56 scope)
                ▼
          Open Questions
          (existing domain type,
           populated by document/
           website review gaps — §5)
```

**Design rule carried forward from every prior sprint:** every box in this diagram that isn't already-shipped (Risks, Priority-as-a-UI-concept, Open Questions rendering) must be **derived from existing deterministic data**, never a new AI judgment layer. Recommendations remain explicitly out of scope until a dedicated future sprint designs them with the same rigor Sprint 54 gave Discovery Decision — bolting them on here would repeat the exact mistake this whole program has been careful to avoid (recall the Sprint 54 UX audit that caught scope creep after the fact).

---

## 8. Discovery Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│  Discovery Timeline                                                 │
│                                                                        │
│  ● Project Created            22 Jul, 14:20                         │
│  │                                                                    │
│  ● Interview Started           22 Jul, 14:22    via AI Interview     │
│  │                                                                    │
│  ● Document Uploaded            22 Jul, 14:35    "business-plan.pdf" │
│  │                              14 facts extracted, 2 need review     │
│  │                                                                    │
│  ● Requirements Edited          22 Jul, 14:40    via Quick Form       │
│  │                              (Target Users updated)                │
│  │                                                                    │
│  ○ Website Analysed              — not yet —                          │
│  │                                                                    │
│  ● Discovery Complete            22 Jul, 15:02    READY · 100%       │
│  │                                                                    │
│  ○ Business Analyst               — pending —                         │
│  ○ Engineering                    — pending —                         │
└─────────────────────────────────────────────────────────────────┘
```

- **Filled dots (●) = happened, with timestamp and a one-line "what changed."** Empty dots (○) = not yet reached, shown so the customer sees the whole arc, not just history.
- Every entry is a direct rendering of existing durable records — session creation timestamp, session messages, traceability entries' `recordedAt`, and downstream artifact timestamps (`RequirementsDraft`, Product Owner, etc. already have these). **No new "timeline" storage is needed** — it's a read-model over data that already exists across Sprints 50–54.1 plus the new discovery methods' own message logs.
- This is the natural home for **"nothing lost" reassurance** (§11) — a customer who used three different methods can see, at a glance, that all three actually counted.

---

## 9. Discovery Quality

**How does Builders know it truly understands the business?** Three distinct signals, never conflated into one number without explanation:

| Metric | What it measures | How it's computed |
|---|---|---|
| **Completeness** | Breadth — how many of the ten dimensions have signal | `decision.completenessScore` — unchanged, existing. |
| **Confidence** | Depth/certainty — how *sure* Builders is about what it has | Blend of `assessmentConfidence` (per-field rule confidence) and `decision.overallConfidence` — existing, just surfaced together. |
| **Evidence Density** *(new)* | Corroboration — how many independent sources agree on a fact | Count of distinct `TraceabilityReference.source` entries pointing at the same target dimension, across methods. A fact stated in the interview **and** confirmed by a document review carries more evidence density than one mentioned once, in passing. This directly rewards multi-method discovery without requiring the customer to use every method — it's purely additive when they do. |

**Discovery Health** (shown on the dashboard, §4) is a simple, explainable blend of these three — never a black-box "AI confidence score." The formula should be presented to the customer in plain language on request ("Health considers how much we know, how sure we are, and how well it's corroborated") — transparency here is a trust feature, not an implementation detail to hide.

---

## 10. Discovery Report

**Generated once, automatically, the moment `decision.state` reaches READY — available for download/review before "Generate Project Definition" is clicked.**

```
┌─────────────────────────────────────────────────────────────┐
│  Discovery Report — Plumber Coimbatore Website                  │
│  Generated 22 Jul 2026, 15:02 · Discovery Health: 92/100        │
│  ───────────────────────────────────────────────────────────  │
│                                                                    │
│  EXECUTIVE SUMMARY                                                 │
│  A simple online store for a boutique clothing retailer in         │
│  Coimbatore, discovered via AI Interview and one uploaded document.│
│                                                                    │
│  BUSINESS SUMMARY                                                  │
│  Classification: Retail · Industry: Retail · Maturity: Growing    │
│  Digital · Project Type: Website                                  │
│                                                                    │
│  REQUIREMENTS SUMMARY                                              │
│  Target Users: Shoppers                                            │
│  Core Features: Product catalog, online checkout                  │
│  Integrations: WhatsApp order notifications                        │
│                                                                    │
│  MISSING INFORMATION                                               │
│  Technical Preferences — not yet discussed                         │
│                                                                    │
│  ASSUMPTIONS                                                        │
│  None recorded (Assumption engine — future scope)                 │
│                                                                    │
│  CONFIDENCE                                                        │
│  Overall: High · Evidence Density: Medium (1 source per fact,      │
│  avg.)                                                             │
│                                                                    │
│  BUSINESS RISKS                                                     │
│  ⚠ Payment processor not specified — may affect checkout scope     │
│                                                                    │
│  READINESS SCORE                                                    │
│  92 / 100 — Ready for Business Analyst                             │
│                                                                    │
│         [ Download PDF ]      [ Proceed to Business Analyst ]      │
└─────────────────────────────────────────────────────────────┘
```

- **Every field in this report is a direct rendering of existing data** — Business Assessment fields, Discovery Decision fields, `businessConstraints`/`currentSystems` arrays, plus the new §9 Discovery Health and §4 Risk Level concepts. **No new generative summarization is strictly required for v1** — the Executive Summary line can be templated from the `businessVision` field plus method-used metadata rather than requiring a fresh LLM call, keeping this report cheap and fast to produce (an LLM-polished version is a reasonable v2 enhancement, not a requirement).
- **Assumptions** section is explicitly labeled as empty/future — honest about current scope rather than fabricating placeholder content.
- **This report is the natural "handoff artifact"** referenced in §11 — it's what Business Analyst, and later a human reviewer, can always point back to as "what did discovery actually establish."

---

## 11. Discovery Handoff

```
   Discovery                Business Analyst         Product Owner
  ┌───────────┐             ┌───────────────┐        ┌────────────┐
  │ Business    │───────────►│ Reads Business  │───────►│ Reads         │
  │ Understanding│  Discovery │ Understanding    │ Approved│ RequirementsDraft│
  │ Model +      │  Report    │ Model +          │ Draft   │ (unchanged)     │
  │ Discovery    │  (§10)     │ Discovery Report │        │                 │
  │ Report       │            │ as CONTEXT       │        │                 │
  └───────────┘             │ (never replaces   │        └────────────┘
                              │ its own synthesis)│
                              └───────────────────┘
                                        │
                              produces RequirementsDraft
                              (existing mechanism, unchanged)
                                        │
                                        ▼
                              Architecture → Engineering
                              (existing, unchanged)
```

**"Nothing should be lost" — concretely guaranteed by:**
1. **Every fact has traceability** (Sprint 52, extended in §6/§7 to every method) — Business Analyst's synthesis can always be traced back to *why* a requirement exists, all the way to the original chat turn, document paragraph, or webpage.
2. **The Discovery Report is the single artifact carried forward** — Business Analyst's context includes it explicitly (extending the existing `buildRoleContextBlock` mechanism already used for context assembly), so nothing requires a human to manually re-explain what discovery already established.
3. **Open Questions that were never resolved are carried forward, not dropped** — if discovery ends at `NEEDS_MORE_INFORMATION` and the customer chooses to proceed anyway (an existing, deliberately-allowed path per Sprint 54.1's gating design), the unresolved Open Questions travel with the handoff so Business Analyst (and eventually the customer, during Approval) sees them explicitly rather than the gap silently disappearing.

---

## 12. Future AI — Everything Plugs Into the Same Pipeline

| Future source | Adapter role | Notes |
|---|---|---|
| **Website Crawl** | Multi-page version of Website Analysis (§2/§5) | Crawls beyond the landing page; same extraction contract. |
| **GitHub Analysis** | Reads an existing codebase's README/structure to infer current systems, tech stack | Feeds `currentSystems`/`technicalPreferences` dimensions directly — a natural fit for the "rebuild/extend existing software" persona. |
| **Existing Software Analysis** | Screenshots/walkthroughs of a legacy system the customer wants replaced | Same extraction contract; likely pairs with a vision-capable model, still terminates in the same patch shape. |
| **Figma Import** | Reads existing design files for UI/UX signal | Feeds `technicalPreferences`/brand-tone-adjacent fields — a genuinely new *kind* of signal (visual, not textual), still normalized to the same patch contract before it reaches the model. |
| **Database Import** | Infers data model / existing entities from a live or exported schema | Feeds `currentSystems` + structural hints useful to Architecture later — may be the first adapter that produces signal Architecture consumes *directly* in addition to Business Understanding, worth flagging as a scope question for whoever designs it. |
| **Meeting Recordings, Slack, Teams, Email Threads, WhatsApp** | All variations of "conversational text/audio already happened elsewhere" | All route through the same Discovery Agent extraction contract as Interview/Voice (§5) — the only real engineering difference between them is the *ingestion* connector (OAuth, API, file import), not the discovery logic. |
| **CRM Import** | Structured business data already captured elsewhere (customer segments, deal sizes) | Feeds `targetUsers`/`businessGoals` with unusually high confidence (it's the customer's own operational data, not a description of it) — likely the highest evidence-density source type once it exists. |

**The design commitment this section makes explicit:** no future source gets its own bespoke pipeline. Each is scoped as "a new way to produce a `BusinessUnderstandingModelPatch`," full stop — the same sentence that closed Sprint 55's architecture doc, now proven out across a dozen different future sources, which is the strongest evidence the original architectural choice was the right one.

---

## 13. Information Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  DISCOVERY LAYER                                                     │
│  Discovery Home → [Form|Interview|Document|Website|Template|...]    │
│  → BusinessUnderstandingModel → Business Assessment →                │
│  Discovery Decision → Discovery Dashboard → Discovery Report         │
│  (THIS DOCUMENT'S SCOPE)                                             │
└───────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BUSINESS LAYER                                                       │
│  Business Analyst → RequirementsDraft → Approval                      │
└───────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PLANNING LAYER                                                       │
│  Product Owner → MVP Roadmap & Scope → Gate A Approval                │
└───────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ENGINEERING LAYER                                                    │
│  Architecture → Database → UI/UX → Backend → Frontend → QA → DevOps  │
└───────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  DELIVERY LAYER                                                       │
│  Deployment → Monitoring → Repair/Maintenance                         │
└─────────────────────────────────────────────────────────────────┘
```

Each layer already exists in Builders today except that the Discovery Layer, until this document, was really just "the Requirements Form" — this specification is what formally elevates it to a peer of the other four layers, with its own dashboard, report, and quality metrics, rather than being an implicit prerequisite bolted onto Business Analyst.

---

## 14. User Journeys

| Persona | Likely entry method | What Builders should get right for them |
|---|---|---|
| **Small Business Owner** | AI Interview or Voice (future) | Zero jargon, ever. Recognize local/regional business patterns (already true — see the `Church`/`Restaurant`/`Retail` classification rules). |
| **Startup Founder** | AI Interview, sometimes with an existing pitch deck (Document Upload) | Fast convergence to READY; tolerate ambiguity/pivots gracefully (a founder's answers may contradict themselves as they think out loud — §5's contradiction handling matters most here). |
| **Enterprise Product Manager** | Quick Requirements Form, often paired with Document Upload (an existing internal spec) | Precision and traceability matter more than conversational warmth — the Discovery Report and full evidence trail are the differentiators for this persona. |
| **Internal IT Team** | Document Upload + Database/GitHub Import (future) | Needs to describe *existing* systems accurately — `currentSystems`/`technicalPreferences` dimensions carry the most weight; Website/Interview matter less. |
| **Software Agency** | Meeting Transcript (future) — they already run discovery calls with clients | Builders becomes their notetaker/accelerator, not their interviewer — the agency is the analyst, Builders formalizes what they already extracted. |
| **Freelancer** | AI Interview, fastest path | Speed above all — likely the persona most sensitive to interview length; Question Planner's "ask only what's needed" matters most here. |
| **Government** | Quick Requirements Form + Document Upload (procurement documents) | Formality, auditability — the Discovery Report's traceability guarantees (§11) are a compliance feature for this persona, not a nice-to-have. |
| **Educational Institution** | Template ("School/College site") + AI Interview to customize | Template-first flow is the ideal fit — high genericity, low novelty per project. |
| **Church / NGO** | AI Interview | Already a first-class classification (`Church`, `NGO` industry rules exist since Sprint 53) — lean into warm, plain-language conversational tone specifically for this segment. |
| **Manufacturing Company** | Website Analysis (existing site) + AI Interview for gaps | Existing web presence is common and information-rich; Interview fills in what a catalog-style site can't say (internal processes, B2B specifics). |
| **Healthcare** | AI Interview + Document Upload (compliance docs) | Compliance-sensitive `businessConstraints` (HIPAA-equivalent) must be surfaced as Business Risks (§4/§9), never silently inferred. |
| **Retail** | Website Analysis or Template, then AI Interview to refine | Highest-frequency, most template-friendly vertical — likely the best proving ground for Template + confirm-don't-generate flows. |

---

## 15. Implementation Roadmap

**Sequenced for minimum risk, maximum reuse — every milestone ships something independently demoable, and nothing here duplicates Sprint 55/55.1's own roadmap (their numbering continues below rather than restarting).**

| Phase | Sprint(s) | Scope | Reuses |
|---|---|---|---|
| **Foundation** (done) | 50–54.1 | Durable discovery, Form, Assessment, Decision, Discovery UI | — |
| **Interview Core** | 56–60 | Per Sprint 55 §16 — Conversation Engine, Question Planner, AI phrasing/extraction, chat UI, traceability hardening | 100% of Sprints 50–54.1 |
| **Discovery Home & Method Selection** | 61 | §1/§2 of this document — the method-choice screen, recommendation logic, "Skip" path | Existing Requirements & Knowledge panel as the fallback destination |
| **Discovery Dashboard v2** | 62 | §4 — extend `BusinessDiscoveryCard` with Risk Level, Recommended Next Action, Open Questions rendering, Discovery Health (§9) | 100% of `BusinessDiscoveryCard`/`useDiscoveryIntelligence` |
| **Document Upload Adapter** | 63 | §5/§11 — document extraction + review-before-commit flow | Same patch contract; Sprint 55.1's already-reserved attach-icon slot |
| **Discovery Timeline & Report** | 64 | §8, §10 — read-models over existing durable data, no new write paths | Existing session messages, traceability, artifact timestamps |
| **Website Analysis Adapter** | 65 | §5/§12 — single-page, then multi-page crawl | Same patch contract as Document Upload |
| **Discovery Handoff Hardening** | 66 | §11 — wire Discovery Report into Business Analyst's context assembly | Existing `buildRoleContextBlock` mechanism |
| **Voice / Meeting Adapters** | 67+ | §12 — speech-to-text + transcript ingestion into the existing Chat Adapter pipeline | Sprint 56–60's turn-based extraction, unchanged |
| **Template Library** | 68 | §1/§2 — pre-filled `'inferred'`-confidence starting states per common vertical | Existing classification rules (industry keyword sets already encode "common verticals") |
| **Advanced Integrations** | 69+ | §12 — GitHub, Figma, Database, CRM, Slack/Teams/Email | Each independently scoped, independently risked, all terminating in the same contract |

**Risk discipline carried through every phase:** deterministic-first, AI-second (proven repeatedly from Sprint 53 onward); reuse the existing patch/assessment/decision/UI stack rather than parallel-building per method; ship each adapter behind its own review/confirmation step until its extraction quality is proven in production, mirroring exactly how Sprint 54.1's own UX audit caught (and this document's design explicitly prevents repeating) the mistake of shipping a decision engine with no visible surface.

---

## 16. Builders Differentiation

| Competitor | What they do | What Builders Discovery does differently |
|---|---|---|
| **Bolt / Lovable / v0** | Prompt → code, immediately. Discovery is a single text box, if it exists at all. | Builders treats discovery as its own *layer*, with a decision engine that knows whether there's enough information *before* generation — competitors generate on whatever's typed, then let quality suffer or force manual re-prompting. |
| **Firebase Studio / Replit** | Developer-first scaffolding; assumes the user already knows their requirements | Builders explicitly serves the *non-technical* founder who doesn't yet know what to ask for — Interview Mode's entire premise ("explaining my business," not "answering software questions") has no equivalent in developer-first tools. |
| **Cursor / Windsurf** | IDE-embedded AI pair programming — discovery, if any, is a code comment or a chat message to an already-scoped codebase | These tools assume a project already exists; Builders' Discovery Experience is entirely *pre-code*, closer to a business analyst engagement than a coding session. |
| **Manus / Claude Code** (general agents) | General-purpose autonomous agents; can *perform* discovery tasks if instructed, but have no dedicated, durable, multi-method discovery data model | Builders' `BusinessUnderstandingModel` + `DiscoveryDecision` + traceability is a **durable, structured, auditable business understanding**, not a transient agent context window that resets between sessions — this document's entire memory model (§6) is the differentiator: nothing is lost, nothing needs re-explaining, and every fact is traceable to its source, months later. |

**The one-sentence differentiator:** *every other tool in this list treats "understanding the business" as an implicit, disposable side-effect of getting to code; Builders treats it as a durable, explainable, multi-method product in its own right — one that other tools would have to bolt on top of an assumption they've already made (that the user knows what they want) rather than starting from Builders' assumption (that helping them figure it out **is** the product).*

---

## 17. Long-Term Vision (2030)

Imagine a founder opens Builders having said nothing yet. Builders already knows:
- Their business is registered (public filings, crawled), what industry it's in, what their existing website says, what their competitors' sites say by comparison.
- Their last three customer support emails, forwarded once, because that's where the *real* feature requests already live.
- A five-minute voice note recorded while driving between job sites, transcribed and understood as fluently as a typed answer.

Discovery, by 2030, is no longer something a customer *does* — it's something Builders **continuously does around them**, with their permission, across every surface they already use to run their business. The Discovery Agent (§5) becomes less an interviewer and more a standing analyst: it notices a new WhatsApp Business catalog was published and asks, next time the founder opens Builders, *"I saw you added a summer collection on WhatsApp — want that in the site too?"* — discovery as an ongoing relationship, not a one-time onboarding gate.

The `BusinessUnderstandingModel` becomes a genuine **living digital twin of the business** — not a fixed one-time capture, but a structure that Product Owner, Architecture, and even post-launch Repair/Maintenance all continuously reference and update, so "Requirements" stops being a phase that ends and becomes a permanent, evolving asset every later layer of Builders reads from. The architectural decision made all the way back in Sprint 50 — a durable, structured Business Understanding Model, separate from any one input method — is precisely what makes this 2030 vision reachable without a rewrite: **everything described in this document, and everything imagined here, is the same one contract, asked to do more.**

---

**This is the master product & UX specification only.** No code, files, migrations, or commits were created or modified.
