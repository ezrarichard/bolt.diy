# Sprint 55 — AI Business Interview Mode Architecture

**Status: APPROVED (architecture/design only) — no code, migrations, or tests exist yet.**
This is the implementation blueprint for the Interview Mode work that follows Sprint 54.1.
It does not modify any part of Builders — it defines how a future implementation sprint
should be structured.

**See also:** [06 — Requirements Discovery index](./00-index.md) ·
[Sprint 55.1 — Interview Mode UX Specification](./03-sprint-55.1-interview-mode-ux-specification.md) ·
[Builders Discovery Experience — Master Specification](./04-builders-discovery-experience-master-spec.md)

> **Sprint 56 implementation status (added post-approval — this note only; the specification
> below is unchanged):** the §16 roadmap's Sprint 56 scope ("Discovery Agent Skeleton & Session
> Plumbing") is implemented, along with a simplified, deterministic version of Sprint 57's
> Question Planner (§2) so the full turn loop is demoable end-to-end. Implemented:
> `'interview'`-mode `RequirementsSession` creation/resume via the existing repositories
> (`startOrResumeInterview` in `requirementsSessionOrchestrator.ts`), a `recordInterviewAnswer`
> orchestrator function mirroring `recordRequirementsFormSubmission` (§6's per-turn update
> sequence, verbatim), and `selectNextDimension`/`buildInterviewPatch` in the new
> `app/lib/projects/discoveryAgent.ts` (named per §15's recommendation). `runBusinessAssessment`/
> `runDiscoveryDecision` are reused unchanged, exactly as §0 requires. **Still exactly as
> specified — not yet built:** §2's topic-locality override (point 4), §11's two AI prompts
> (question phrasing and fact extraction are simple templates/literal mappings, not LLM calls —
> `buildInterviewPatch`'s doc comment flags this explicitly), §5's rolling interview digest, and
> §13's contradiction/short-answer handling beyond the basic "don't re-ask an already-asked
> dimension" rule. See the Sprint 56 entry in [00 — index](./00-index.md) for the full file list.

> **Sprint 57 implementation status (added post-approval — this note only; the specification
> below is unchanged):** §11's fact-extraction prompt (Prompt B) is now a real LLM call — the
> `buildInterviewPatch` mock this doc's own Sprint 56 note flagged has been replaced by the
> **Discovery AI Engine** (`app/lib/projects/discoveryAiEngine/`), which implements the full
> Context Builder → Fact Extractor → Fact Validator → Fact Normalizer → Confidence Scorer →
> Contradiction Detector → Evidence Tracker → Patch Generator pipeline this sprint's brief
> specifies, generalized beyond Interview Mode per §15 ("build Interview Mode as an agent with a
> chat UI as its first surface"). `recordInterviewAnswer` in `requirementsSessionOrchestrator.ts`
> now calls `runDiscoveryAiEngine` instead of containing any extraction logic itself — exactly
> the "Interview should become just another producer" requirement. The LLM call is
> dependency-injected (`GenerateTextFn`) and only ever returns structured candidate facts; it
> never writes to BuildersDB, matching §11's Prompt B contract verbatim ("Only extract what the
> user actually said — never infer beyond the text"). Confidence remains `'stated'` only, never
> `'confirmed'`, exactly as §11 requires. Contradiction detection (§5/§8/§13) is now real, but is
> a documented foundation-level heuristic (compares against the currently stored value, not yet
> tiered by `FactConfidence` per stored field — see `contradictionDetector.ts`'s own header
> comment) rather than the full `'confirmed'`-vs-`'inferred'`/`'stated'` distinction §5 describes.
> **Still exactly as specified — not yet built:** §2's topic-locality override, §5's rolling
> interview digest and full per-field confidence-tier tracking, §11 Prompt A (question phrasing is
> still templated, not LLM-generated), §13's Clarification-question UI for surfacing a detected
> contradiction to the user (contradictions are computed and excluded from the patch, but not yet
> shown in the chat). Document/Website/Voice/Meeting/CRM Context Builders (§15) are typed
> (`DiscoverySourceType`) but not implemented — only `buildInterviewDiscoveryContext` exists.

> **Sprint 57.1 implementation status (real-provider verification & hardening — this note only;
> the specification below is unchanged):** live-verified the Sprint 57 pipeline end-to-end
> against a real, authenticated Builders session, a real BuildersDB project, and a real
> Anthropic Claude call through the production `/api/generate-text` route — a full interview
> (single-dimension answers, one multi-dimension answer extracting 3 facts from 1 turn, an
> industry-synonym normalization, a full refresh/resume cycle) reached `READY` at 88%
> completeness with every step confirmed against actual BuildersDB rows (see the Sprint 57.1
> summary below the fold in this doc's implementation notes, or the session transcript retained
> by the implementing agent).
>
> **Root cause found and fixed — NOT an authentication bug.** The 401 ("Invalid or missing API
> key") observed during Sprint 57's own verification was traced precisely: `X-Builders-Auth`
> (the fetch interceptor in `app/lib/auth/authClient.ts`) and `requireAuthenticatedUser`
> (`app/lib/auth/requireUser.ts`) both worked correctly in every reproduction — a valid,
> non-expired Supabase session was present, and a direct `/api/generate-text` call with an
> explicit model/provider succeeded immediately. The actual cause: `useInterviewSession.ts`
> never supplied `model`/`provider` to `useGenerateText`, so it fell back to
> `DEFAULT_MODEL`/`DEFAULT_PROVIDER` (`app/utils/constants.ts`) — an Anthropic model id paired
> with whichever provider happens to register first in `LLMManager` (AmazonBedrock in this
> environment, not Anthropic), which has no configured credentials for that model. This is the
> exact same failure class Sprint 46D already hit and fixed for `product-owner-draft` (see
> `defaultProfiles.ts`'s own header comment) — Interview Mode simply hadn't adopted the fix yet.
> **Fix:** registered a `discovery-agent` role in every `DEFAULT_GENERATION_PROFILES` tier
> (`app/lib/generation-profiles/defaultProfiles.ts`, mirroring `requirements-draft`'s model
> tier), and `useInterviewSession.ts` now calls `getRoleGenerateOptions(project,
> 'discovery-agent')` — the same Generation Profile model-resolution path every other AI role
> call site already uses. No new authentication mechanism was introduced; the existing one was
> simply given a reliable model/provider to use.
>
> **Task 8 hardening — extraction failures no longer silently advance the conversation.**
> `factExtractor.ts`'s `extractFacts` now returns `{ candidates, error? }` instead of a bare
> array, distinguishing a genuine failure (network/auth/provider error, or an unparseable
> response) from a legitimate empty result (`{"facts": []}`, e.g. a short/irrelevant answer —
> still not an error). `runDiscoveryAiEngine` surfaces this as `DiscoveryAiEngineResult.
> extractionError`; `recordInterviewAnswer` skips the assessment/decision/patch write entirely
> on a genuine failure (Task 7: "no partial factual patch when extraction fails"), posts the
> exact UX-spec-approved copy ("I couldn't process that — mind trying again?", §3's Error
> States table) tagged `metadata: { kind: 'extraction_error', dimension }`, and returns the SAME
> `pendingDimension` so the UI keeps that question active. `InterviewChatDialog.tsx` renders
> this as a distinct red-bordered bubble with a Retry chip that resends the exact same answer
> text — live-verified end-to-end against real BuildersDB (a simulated failure left
> `completenessScore`/`functionalRequirements`/the model's own `updated_at` timestamp completely
> unchanged; an immediate real retry then applied the fact and advanced normally).
>
> **Verified:** 657/659 automated tests passing (2 skipped — a pre-existing, opt-in
> `RUN_LIVE_PIPELINE_CHECK`-gated live-provider harness unrelated to this sprint, not a
> regression), typecheck/lint/build clean. **Known limitation carried forward:** the industry
> synonym normalizer (`factNormalizer.ts`) only matches an exact full value ("shop"), not a
> substring within a longer phrase ("Plumbing shop") — live-verified as a real, minor gap, left
> as-is per Part 5's explicit "do not implement every feature completely" scope.

---

## 0. Grounding: What Already Exists (and What This Design Must Reuse)

Before designing anything new, it matters what Sprints 50–54.1 already built, because a good Interview Mode design **adds a second producer into an existing pipeline** rather than building a parallel system:

| Already exists | Where | Reuse in Interview Mode |
|---|---|---|
| `RequirementsSessionMode` = `'form' \| 'interview' \| 'document'` | `requirementsSession.ts` | `'interview'` was **reserved since Sprint 50** and never used. Interview Mode is its first consumer. |
| `RequirementsSessionMessage` with `role`, `messageType` (`text`, `clarification`, `confirmation`, ...), `sequenceNumber` | `requirementsSession.ts` | Already models a conversation turn with ordering and provenance addressability. No new message schema needed. |
| `FactConfidence` = `'inferred' \| 'stated' \| 'confirmed'` | `requirementsSession.ts` | Already defined, never used yet. This is exactly the tiering contradiction-handling needs. |
| `OpenQuestion` type | `requirementsSession.ts` | Already modeled (`field`, `question`, `reason`, `answeredAt`, `answer`) — reserved for exactly this. |
| `BusinessUnderstandingModelPatch` contract | `requirementsSessionDbTypes.ts` | The **universal input contract**. The Form produces one. Interview Mode should produce the same shape. |
| `runBusinessAssessment(patch)` → `BusinessAssessmentResult` | `businessAssessmentEngine.ts` | Reused unchanged. Never re-implement scoring for interview answers. |
| `runDiscoveryDecision(patch, assessmentResult)` → `DiscoveryDecisionResult` | `discoveryDecisionEngine.ts` | Reused unchanged. This is the stop-condition engine — Interview Mode consumes its output, never duplicates its logic. |
| `TraceabilityReference` / `ProvenanceEntityRef` | `requirementsSession.ts` | Reused unchanged for interview provenance. |
| `BusinessDiscoveryCard` + `useDiscoveryIntelligence` | Sprint 54.1 | Reused as the live side panel during interview — not rebuilt. |
| `recordRequirementsFormSubmission` orchestrator pattern | `requirementsSessionOrchestrator.ts` | The template for a new `recordInterviewAnswer` function — same shape, same fire-and-forget-but-awaitable contract. |

**Core design thesis:** *Interview Mode is not a new scoring/decision system. It is a new way to fill in a `BusinessUnderstandingModelPatch`, one conversational turn at a time, feeding the exact same deterministic engines the Form already feeds.* Everything downstream (assessment, decision, UI, traceability) is unchanged. This is what makes the design safe, and it's why it belongs as its own layer rather than inside the Form or inside Business Analyst.

---

## 1. Conversation Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERVIEW LIFECYCLE                          │
└─────────────────────────────────────────────────────────────────────┘

  User opens "Interview Mode"
            │
            ▼
  Load or create RequirementsSession (mode='interview')
            │
            ▼
  Load BusinessUnderstandingModel (existing state — may already have
  Form-submitted data; Interview Mode never starts from zero if the
  Form was used first)
            │
            ▼
  Load current Discovery Decision (state, missingAreas, partialAreas)
            │
            ▼
  ┌──────────────────────── TURN LOOP ────────────────────────────┐
  │                                                                 │
  │   Question Planner selects next dimension + question type      │
  │            │                                                    │
  │            ▼                                                    │
  │   Discovery Agent generates the question (LLM, narrow prompt)  │
  │            │                                                    │
  │            ▼                                                    │
  │   Question persisted as RequirementsSessionMessage (assistant) │
  │            │                                                    │
  │            ▼                                                    │
  │   User answers ─── persisted as RequirementsSessionMessage     │
  │   (user)                                                        │
  │            │                                                    │
  │            ▼                                                    │
  │   Fact Extraction → BusinessUnderstandingModelPatch             │
  │            │                                                    │
  │            ▼                                                    │
  │   updateBusinessUnderstandingModel (same call shape as Form)   │
  │            │                                                    │
  │            ▼                                                    │
  │   runBusinessAssessment(patch) → runDiscoveryDecision(...)      │
  │   (UNCHANGED engines — recomputed every turn)                  │
  │            │                                                    │
  │            ▼                                                    │
  │   decision.state == READY? ──── no ──── loop back to top        │
  │            │                                                    │
  │           yes                                                   │
  └────────────┼────────────────────────────────────────────────────┘
               ▼
     Stop asking. Show "You're ready" state.
     Offer: [Generate Project Definition] (same explicit,
     user-triggered action Sprint 54.1 already gates)
               │
               ▼
     Session status → 'complete' (only on explicit user action,
     mirroring how RequirementsDraft approval already works —
     never auto-advance the pipeline)
```

**Does Interview Mode automatically stop?**
Automatically stops **asking new questions** the instant `decision.state === 'READY'`. It does **not** automatically do anything else — it never auto-generates the Requirements Draft, never auto-closes the session. That stays a deliberate user action, consistent with every other gate already built (Form → Draft, Draft → Approval, Approval → Product Owner). Auto-stopping the *questions* is safe because it's driven by the same deterministic engine already trusted for that decision; auto-triggering *generation* would not be, because generation has real cost (LLM calls) and the user should still get to review.

**Should users manually stop?**
Yes, always — a visible "Pause" / "Continue later" control must exist at every turn regardless of `decision.state`. Forcing a user to keep answering because a deterministic engine says `NEEDS_MORE_INFORMATION` is a UX failure. This mirrors the Sprint 54.1 philosophy exactly: display the state, never trap the user.

**Should READY immediately end questioning?**
Yes — the moment a turn's recomputed decision flips to `READY`, the Question Planner returns "no next question" instead of picking one. No "just one more" question after READY; that's how interviews overstay their welcome.

---

## 2. Question Selection

**Inputs, in priority order:**

1. `DiscoveryDecision.missingAreas` — always outranks partial areas. A dimension with zero signal is worth more per question than refining one that's already partial.
2. `DiscoveryDecision.partialAreas` — asked only once `missingAreas` is empty, or when a partial area is cheap to complete via a natural follow-up to the current topic (see "topic locality" below).
3. `DIMENSION_WEIGHTS` (already defined in `discoveryDecisionEngine.ts`) — within `missingAreas`, prioritize highest-weight dimensions first (`businessVision` 15, `coreFeatures` 15, `targetUsers` 12 > `integrations` 6, `technicalPreferences` 6). Ask about the things that move the completeness score the most, first.
4. **Topic locality** — if the user just answered about `coreFeatures`, and `businessConstraints` naturally follows from that answer (e.g. they mentioned payments), prefer it over jumping to an unrelated dimension like `technicalPreferences`. This is what makes it feel like a conversation, not a form read aloud.
5. Conversation history — never re-ask a dimension already answered this session (tracked via which `RequirementsSessionMessage`s produced which target sections, exactly like Sprint 52's traceability already tracks).
6. Requirements Form data — if the Form already populated a dimension (even partially), the Question Planner treats it as already-attempted-once and asks a *refining* question, not a from-scratch one ("You mentioned WhatsApp as an integration — anything else, like payments or maps?").

**Concrete algorithm (deterministic, not LLM-decided):**

```
1. candidates = decision.missingAreas, sorted by DIMENSION_WEIGHTS desc
2. if candidates empty: candidates = decision.partialAreas, sorted by weight desc
3. if candidates empty: STOP (no next question)
4. next = candidates[0], unless a topic-locality override applies
   (previous answer's extracted facts touched a dimension still
   in candidates — prefer that one instead, to stay on-topic)
5. hand `next` (a single dimension, e.g. 'targetUsers') to the
   Discovery Agent to phrase as one question
```

This keeps the *decision of what to ask about* deterministic and cheap (no LLM call), and only uses the LLM for *phrasing* — same anti-hallucination posture as Sprints 53/54.

---

## 3. Question Types

Not every question should be the same. Type should be chosen by dimension shape and current confidence:

| Type | When | Example |
|---|---|---|
| **Open-ended** | Default for free-text dimensions (`businessVision`, `targetUsers`) | "Tell me about who this product is for." |
| **Multiple choice** | Enumerable dimensions with a known value set (`industry`, `projectType`) | "Is this closer to: a Website, a Marketplace, a CRM, or something else?" |
| **Examples-prompt** | Abstract dimensions where users struggle to start | "For example, features like online booking or inventory tracking — what does your product need?" |
| **Yes/No** | Confirming a single binary fact (e.g. "Do you need online payments?") | Used to close out `businessConstraints` cheaply |
| **Confirmation** | Restating an *inferred* fact to promote it to *stated*/`confirmed` (reuses `FactConfidence`) | "I'm assuming this is a retail business based on what you said — is that right?" |
| **Clarification** | Contradiction or ambiguity detected | "Earlier you said cash-only, but just now you mentioned Stripe — which is it?" |
| **Priority ranking** | Only when multiple partial features compete and Requirements Draft needs an order | Lower priority; not needed for Sprint 55/56 MVP — defer |

**Rule:** one dimension per question, one question per turn. Never batch multiple dimensions into one message — that's what the Form is for; Interview Mode's entire value is asking one good thing at a time.

---

## 4. Dynamic Adaptation

Scenario: mid-interview, unprompted, the user says *"I also need appointment booking."*

This must be handled the same way **every** answer is handled — Interview Mode has no separate "unprompted info" code path:

1. The current turn's answer (regardless of what it was asked) goes through **Fact Extraction**, not pattern-matching on the literal question asked. Fact Extraction's job is: *given this raw answer, extract every dimension signal present in it*, not just the one the question targeted.
2. "I also need appointment booking" extracts into `coreFeatures` (and possibly nudges `projectType` toward "Booking Platform" style signals), regardless of what dimension the question was actually about.
3. `runBusinessAssessment` + `runDiscoveryDecision` recompute from the **updated full patch**, not incrementally reasoned about — so `coreFeatures` moves from missing/partial to more complete immediately.
4. On the **next** turn, the Question Planner re-runs its algorithm from scratch against the fresh `missingAreas`/`partialAreas`. Since it's stateless-per-turn (always re-derives from current decision state, never from a fixed question script), it automatically stops asking about `coreFeatures` if that dimension is now satisfied, and moves to whatever is still missing.

**This is why the design must never be a fixed question script.** A scripted interview ("ask Q1, then Q2, then Q3...") cannot adapt to unprompted information without special-casing every possible interruption. A **decision-driven** planner (always: "what does the *current* state say is missing?") adapts for free, because adaptation is just "run the same algorithm again with fresher inputs."

---

## 5. Memory

Two distinct layers, matching how the domain model already separates raw history from distilled state:

**Durable raw history** — every `RequirementsSessionMessage` (question + answer), append-only, exactly as Sprint 50 already persists. Never deleted, never mutated. This is the audit trail and what traceability points at.

**Working memory** — what's actually fed into each turn's LLM call:
- The **current** `BusinessUnderstandingModel` (already a compact, structured summary — this *is* the interview's memory of "what's known").
- The last **2–3 raw turns** (for pronoun resolution, "as I mentioned," follow-up coherence).
- A rolling **interview digest** — a short AI-maintained free-text summary of anything not yet cleanly captured in structured fields (nuance, tone, things said but not yet dimension-mapped). Regenerated/compacted every ~5 turns so it never grows unbounded.

**Corrections & contradictions**, using the existing `FactConfidence` tiers:
- A new answer about an already-`stated` fact **overwrites** it and re-promotes confidence (people correct themselves; the latest explicit statement wins).
- A new answer that **conflicts** with a `confirmed` fact (one the user explicitly confirmed via a Confirmation-type question) does **not** silently overwrite — it triggers a Clarification-type question instead. Confirmed facts have earned a higher bar to change.
- `inferred` facts are always freely overwritten by anything more explicit — they were never solid to begin with.

**Should it keep every message?** Yes, durably (already free — the schema exists). **Should it summarize?** Yes, but only for what goes *into the prompt*, never for what's *stored*. Storage is complete; the prompt is curated.

---

## 6. Business Understanding Updates

**Every answer, immediately** — not batched. This is a hard requirement, not a preference, for one reason: the Question Planner's very next decision depends on the freshly recomputed `DiscoveryDecision`. If updates were batched (e.g. every 3 answers), the system would ask questions against stale missing-areas data and could easily re-ask something just answered, which is exactly the repetition the sprint brief says to avoid.

Per-turn update sequence (mirrors `recordRequirementsFormSubmission` exactly, generalized):

```
1. appendRequirementsSessionMessage (user's answer, durable)
2. extractFacts(answer, currentModel) → BusinessUnderstandingModelPatch
3. buildTraceabilityForInterviewAnswer(messageId, patch) → TraceabilityReference[]
4. runBusinessAssessment(patch)
5. runDiscoveryDecision(patch, assessmentResult)
6. updateBusinessUnderstandingModel(sessionId, { ...patch, assessment, decision, traceability })
7. updateRequirementsSession(sessionId, { assessmentConfidence })
```

Steps 4–7 are **byte-for-byte the same calls** `recordRequirementsFormSubmission` already makes. Only step 2 (Fact Extraction from a conversational answer instead of structured form fields) and step 3 (provenance pointing at a specific `RequirementsSessionMessage` in a conversation instead of one bulk form submission) are new.

**Cost note:** this means one assessment/decision recompute per turn. Both engines are pure, synchronous, in-memory functions with no I/O (confirmed in Sprints 53/54) — recomputing every turn is cheap and was explicitly designed for exactly this kind of repeated re-evaluation.

---

## 7. Stop Conditions

Reusing Sprint 54's three states exactly, with interview-specific behavior:

| State | Interview Mode continues asking? | UI behavior |
|---|---|---|
| **READY** | **No.** Question Planner returns nothing next. | Green "Ready" banner (reuses `BusinessDiscoveryCard`'s existing badge). Offer "Generate Project Definition" — same explicit action Sprint 54.1 already gates. |
| **NEEDS_MORE_INFORMATION** | Yes, continues automatically. | Amber banner. "Pause" always visible and always allowed — this state is explicitly *not* a hard gate anywhere else in the system (Sprint 54.1's `RequirementsDraftPanel` lets generation proceed here with just a soft warning), so Interview Mode shouldn't be stricter than the rest of the pipeline. |
| **INSUFFICIENT_INFORMATION** | Yes, continues automatically, more assertively (prioritize highest-weight missing dimensions first — there are likely several). | Red/critical banner. If the user tries to leave, show a *soft* confirmation ("You can continue later — the little you've shared is saved.") — informational, never blocking, mirroring the acknowledgement-checkbox pattern already built for generation-while-insufficient rather than inventing a new blocking pattern. |

**"Ask the customer whether to continue" — when?**
Only at natural checkpoints, not every turn: after every ~5–7 questions, or whenever `decision.state` improves by a full tier (e.g. `INSUFFICIENT_INFORMATION` → `NEEDS_MORE_INFORMATION`). A short, skippable prompt: *"We've covered the basics — want to keep going and get to Ready, or pick this up later?"* Never ask this every single turn; that itself becomes annoying.

---

## 8. Resume

Customer leaves mid-interview, returns a week later.

**Resume sequence:**
1. Load the existing `'interview'`-mode `RequirementsSession` (same `getLatestRequirementsSession` call the Form already uses — Interview Mode doesn't need a new lookup).
2. Load `BusinessUnderstandingModel` + current `DiscoveryDecision` — this is already a complete "what we know" snapshot; no replay of raw messages needed to reconstruct state.
3. **Show a short recap, don't replay the transcript.** A 2–3 sentence AI-generated summary ("Last time, we covered your business vision and target users. We still need to talk about payments and integrations.") — generated from the `BusinessUnderstandingModel` + `missingAreas`, not from re-reading old messages.
4. **Continue immediately after the recap** — go straight to the next planned question rather than asking "ready to continue?" as a separate gate. The recap itself is the re-orientation; don't add friction on top of it.
5. Visually, the `BusinessDiscoveryCard` side panel (if the UI recommendation in §9 is adopted) already shows current missing/partial topics on load — so "show missing topics" is satisfied by an existing component, not new UI.

**Explicitly not doing:** replaying the full conversation, or making the user re-answer anything. Everything durable is already in `BusinessUnderstandingModel`; resume is cheap by construction because the state (not the transcript) is authoritative for "what's next."

---

## 9. User Experience

**Recommendation: Chat + Business Discovery panel.**

```
┌───────────────────────────────┬─────────────────────────────┐
│                                │   Business Discovery          │
│   Discovery Agent:             │   ┌─────────────────────┐    │
│   "Tell me about who this      │   │ NEEDS_MORE_INFO       │    │
│    product is for."            │   │ Completeness: 49%     │    │
│                                │   └─────────────────────┘    │
│   You:                         │   Missing: Target Users,      │
│   "Local shop owners in        │   Integrations, Tech Prefs    │
│    Coimbatore."                │   Partial: Core Features       │
│                                │                                │
│   Discovery Agent:              │   [live-updates every turn]   │
│   "Got it. What are the core   │                                │
│    features they'll need?"     │                                │
│                                │                                │
│  [Pause]  [Switch to Form]     │                                │
└───────────────────────────────┴─────────────────────────────┘
```

**Why not the alternatives:**
- **Pure chat (no side panel):** hides progress entirely. The user has no idea how close they are to done, which invites either premature abandonment or an interview that feels endless. Sprint 54.1 already solved "show discovery progress clearly" — not reusing it here would be a regression.
- **Wizard (fixed steps):** directly contradicts "adapt dynamically" and "avoid unnecessary questions" — a wizard implies a fixed sequence, which is the opposite of a decision-driven planner.
- **Progress timeline:** worth a small addition (a thin progress bar reusing the existing `CompletenessBar` component from `BusinessDiscoveryCard`), but not a replacement for showing the actual missing/partial areas — a bare percentage doesn't tell the user *what's* missing.

**"Live completeness updates? Live Business Assessment?"** Yes to both — and both already exist as working, tested components (`BusinessDiscoveryCard`, `useDiscoveryIntelligence`). The panel should literally be the same card, just re-fetched with a shorter refresh cadence (every turn, via the same refresh-signal pattern Sprint 54.1 built for the Form) instead of only after a Form save.

**One more UX requirement:** always show a **"Switch to Form"** escape hatch. Interview Mode must never feel like a trap — the Form stays available at any point, and switching should read the interview's current `BusinessUnderstandingModel` into the Form's fields (not blank it out), since they share the same underlying model.

---

## 10. AI Strategy — Who Owns Interview Mode

**Recommendation: a new, dedicated Discovery Agent — not Business Analyst, not a generic Conversation Agent.**

| Candidate | Verdict | Why |
|---|---|---|
| Business Analyst (`businessAnalystEngine.ts`) | ❌ | Its job is *synthesizing* a `RequirementsDraft` from a complete Business Understanding Model at the end of discovery. Overloading it with real-time conversational Q&A conflates two very different responsibilities (synthesis vs. elicitation) and would make both harder to reason about and prompt correctly. |
| Generic "Conversation Agent" | ❌ | Too broad. "Conversation" isn't a responsibility — *discovery* is. A generically-named agent invites scope creep (support chat? sales chat?) that has nothing to do with this pipeline. |
| **New Discovery Agent** | ✅ | Single responsibility: turn unstructured input (chat answers today; documents/voice/websites later, per the closing recommendation) into `BusinessUnderstandingModelPatch`es, and decide what to ask next when the input is conversational. This is a distinct capability from "write a polished Requirements Draft," and naming it separately is what makes the future extensibility in §15 possible without re-touching Business Analyst. |

The Discovery Agent has exactly two jobs, matching the two LLM-touching pieces identified in §2 and §4: **(a) phrase the next question** for a given dimension, and **(b) extract structured facts** from a free-text answer. Both are narrow, well-scoped LLM tasks — not open-ended "have a conversation" tasks — which keeps prompts small and hallucination surface low, consistent with how Sprints 53/54 kept their engines deterministic wherever possible.

---

## 11. Prompt Strategy

**Two narrow prompts, not one open-ended "interview the user" prompt.**

**Prompt A — Question phrasing** (given: one target dimension, the current `BusinessUnderstandingModel` summary, last 2 turns):
> "Ask ONE question about {dimension}. Here is what's already known: {compact summary}. Do not ask about anything already known. Do not repeat a question already asked in this conversation: {list of prior questions}. Keep it to one sentence, conversational tone."

**Prompt B — Fact extraction** (given: the raw answer, the target dimension it was ostensibly about, the full current model):
> "Extract every fact from this answer that maps to one of these ten dimensions: {list}. Only extract what the user actually said — never infer beyond the text. Return a patch in this exact shape: {schema}. If the answer contradicts an existing confirmed fact, flag it instead of overwriting."

**Hallucination prevention:**
- The *decision* of what dimension to ask about is deterministic (§2) — the LLM never decides "what's missing," only phrases a question about a dimension it's told to ask about. This is the single biggest anti-hallucination lever, directly inherited from the same philosophy that made `businessAssessmentEngine`/`discoveryDecisionEngine` rule-based rather than AI-based.
- Fact extraction is **extractive, not generative** — the prompt explicitly forbids inferring beyond the literal text, same anti-hallucination posture as `buildInitialUnderstandingPatch`'s "lossless, zero-inference" mapping for the Form.
- Every extracted fact carries a `FactConfidence` of `'stated'` (directly said) — never `'confirmed'` from extraction alone; `'confirmed'` is reserved for the Confirmation-question flow (§3), which is a deliberate second LLM-free checkpoint (a yes/no from the user, not an LLM judgment).

**Duplicate question avoidance:** guaranteed structurally, not by the LLM remembering — the Question Planner (§2) already excludes any dimension not currently in `missingAreas`/`partialAreas`, and passes the list of already-asked questions into Prompt A explicitly as a hard constraint.

**Context size:** bounded by design — the model summary is already compact (it's a small structured object, not a transcript), and only 2–3 raw turns plus the rolling digest (§5) are included, regardless of how long the interview has run.

---

## 12. Traceability

**Every interview answer must remain explainable — this is free, by construction, because Interview Mode reuses the exact same `TraceabilityReference` mechanism Sprint 52 built.**

- Every question/answer pair is a `RequirementsSessionMessage` with a `sequenceNumber` — this **already is** "Interview Question 14," no new ID scheme needed. `sequenceNumber` is the addressable identifier.
- Every extracted fact produces a `TraceabilityReference` with `source: { type: 'session_message', id: <that message's id> }` and `target: { type: 'business_understanding_section', id: <dimension> }`, `transformation: 'interview_fact_extraction'` — same shape Sprint 52's `buildTraceabilityForFormSubmission` and Sprint 53's `makeEvidence` already use, just a new `transformation` label.
- **Yes — "This came from Interview Question 14" is directly answerable**: look up the `TraceabilityReference` whose `source.id` matches message #14's id, and its `target.id` names the requirement/dimension it fed.
- No new provenance types are needed — `session_message` already covers a conversational turn just as well as a form submission.

---

## 13. Edge Cases

| Case | Handling |
|---|---|
| **Very short answers** ("yes", "idk") | Fact Extraction may return an empty/near-empty patch. Question Planner detects "no progress made" and either rephrases (simpler/more concrete version of the same question) or offers a multiple-choice/example variant instead of open-ended, once, before moving on to a different dimension so the interview doesn't stall. |
| **Contradictory answers** | Handled in §5 — `confirmed` facts trigger a Clarification question rather than silent overwrite; `stated`/`inferred` facts are overwritten with a note in traceability. |
| **Customer changes mind** | Same as contradiction — the newer `stated` answer wins for anything not yet `confirmed`. |
| **Customer skips questions** | A visible "Skip" per question, recorded as an `OpenQuestion` (the type already exists, unused) with no answer — Question Planner treats a skipped dimension as still missing but deprioritizes re-asking it immediately (ask something else first, circle back later rather than looping). |
| **Customer writes paragraphs** | Fact Extraction (§11) is designed for this — one answer can populate multiple dimensions at once (same mechanism as §4's unprompted-info handling). No special case needed; it's the same code path. |
| **Customer uploads documents later** | Out of scope for the conversational MVP (Sprint 55/56 roadmap) but architecturally supported for free: a document is just another **Discovery Input Adapter** producing the same `BusinessUnderstandingModelPatch` contract (§15). No interview-specific handling needed once that adapter exists. |
| **Customer edits Requirements Form while Interview Mode is active** | Both read/write the same `BusinessUnderstandingModel` — last write wins, and the *next* interview turn simply recomputes `DiscoveryDecision` against whatever the Form just changed (same as §4's adaptation logic). No conflict resolution needed because there's no separate state to reconcile — it's one shared model, two input surfaces. |
| **Customer deletes information** | Not directly supported by Interview Mode itself today (no delete UI exists for the Form either) — flag as a **known gap**, not a Sprint 55/56 requirement. If added, it should go through the same `updateBusinessUnderstandingModel` patch mechanism, with a traceability entry marking the deletion's provenance too. |

---

## 14. Performance

- **One LLM call per turn**, ideally — combine phrasing-the-next-question and extracting-facts-from-the-previous-answer into a single call where possible (the extraction result is needed to compute the new decision *before* the next question is chosen, so these can't always merge, but a well-designed turn can often do "extract + decide next + phrase" in one round-trip with structured output).
- **Deterministic Question Planning costs nothing** — it's the same class of pure function as `discoveryDecisionEngine.ts`, no I/O, no LLM. This is the majority of "what should we ask" logic, and it's essentially free.
- **Context stays bounded** (§5, §11): compact model summary + 2–3 raw turns + a periodically-recompacted digest, never the full transcript. Recommend capping raw turns in context at **6** (3 question/answer pairs) — enough for pronoun/follow-up coherence, small enough to never dominate the prompt regardless of interview length.
- **Assessment/decision recompute is cheap** — confirmed pure, synchronous, in-memory in Sprints 53/54; recomputing every turn is not a performance concern.

---

## 15. Future Extensibility — Interview Mode as a Discovery Agent, Not a Screen

This is the most important structural decision in this document, directly per the closing recommendation: **build Interview Mode as an agent with a chat UI as its first surface, not as a chat feature with some AI behind it.**

```
                    ┌─────────────────────────────┐
                    │       Discovery Agent         │
                    │  (Fact Extraction + Question  │
                    │   Planning, dimension-aware)  │
                    └───────────────┬───────────────┘
                                    │
                     produces BusinessUnderstandingModelPatch
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
     ┌────────▼───────┐   ┌─────────▼────────┐   ┌────────▼────────┐
     │  Chat Adapter    │   │  Document Adapter │   │  Voice Adapter   │
     │  (Sprint 55/56)  │   │  (future)         │   │  (future)        │
     │  conversational   │   │  PDF/website       │   │  transcript      │
     │  turn-by-turn     │   │  ingestion,        │   │  ingestion,      │
     │  Q&A              │   │  single-shot        │   │  turn-by-turn    │
     │                   │   │  extraction         │   │  like chat       │
     └───────────────────┘   └────────────────────┘   └──────────────────┘
```

- **Every adapter produces the same `BusinessUnderstandingModelPatch` shape.** This is the contract that already exists and is already fully wired to assessment/decision/UI/traceability. A Document Adapter doesn't need its own scoring engine, its own decision states, or its own UI card — it plugs into everything Sprint 53–54.1 already built, the same way Interview Mode itself does.
- **Multiple participants / team collaboration:** the `RequirementsSessionMessage.role` field already distinguishes `user`/`assistant`/`system` — extending to multiple distinct users is a matter of adding a `userId` to messages (schema-additive, not a redesign) and letting the Discovery Agent's fact extraction be participant-agnostic (it already extracts from raw text regardless of who said it).
- **Live co-editing:** naturally follows from the shared-model architecture already established in §13's "Form + Interview both write the same model" — a second interview participant is just a third writer to the same `BusinessUnderstandingModel`, with the same last-write-wins + recompute semantics.
- **Voice conversations:** architecturally identical to the Chat Adapter (turn-by-turn, same Fact Extraction prompt) with speech-to-text as a preprocessing step before the same pipeline — no new discovery logic required.

**Practical implication for Sprint 55/56 naming:** call the new module `discoveryAgent`, not `interviewMode`, in the actual codebase when implementation begins — the chat UI is `InterviewChatPanel` or similar, but the *engine* underneath should be named for what it durably is, not for its first UI.

---

## 16. Implementation Roadmap

Sequenced so each sprint ships something independently verifiable (same discipline as Sprints 50–54.1), and so the deterministic/cheap pieces land before the LLM-dependent ones:

| Sprint | Title | Scope |
|---|---|---|
| **56** | **Discovery Agent Skeleton & Session Plumbing** | Wire up `'interview'`-mode `RequirementsSession` creation/resume (reusing existing repositories). Define `recordInterviewAnswer` orchestrator function mirroring `recordRequirementsFormSubmission`. No LLM yet — a stubbed/manual patch for testing the full turn cycle (append message → patch → assessment → decision → persist) end-to-end. |
| **57** | **Deterministic Question Planner** | Implement the dimension-selection algorithm from §2 as a pure, testable function (`selectNextDimension(decision, history) → DiscoveryDimension \| null`), following the exact same rule-based, unit-tested pattern as `discoveryDecisionEngine.ts`. Still no LLM — questions can be simple templates per dimension to prove the loop chooses correctly and stops at READY. |
| **58** | **Discovery Agent — AI Question Phrasing & Fact Extraction** | Wire the two narrow LLM prompts from §11. Add `FactConfidence` handling and contradiction detection (§5, §13). This is where hallucination-safety tests matter most. |
| **59** | **Interview UI — Chat + Business Discovery Panel** | Build the chat surface, reusing `BusinessDiscoveryCard`/`useDiscoveryIntelligence` as the live side panel (§9). Pause/resume controls, "Switch to Form" escape hatch, recap-on-resume (§8). |
| **60** | **Traceability & Edge-Case Hardening** | Formalize interview provenance (§12), implement skip/contradiction/short-answer handling (§13) with tests for each, and verify Form↔Interview shared-model consistency live. |
| **61** | **Document Discovery Adapter** | First proof of the Discovery Agent architecture from §15 — a PDF/website ingestion path producing the same `BusinessUnderstandingModelPatch`, no interview-specific code touched. |
| **62** | **Voice Discovery Adapter** | Speech-to-text preprocessing feeding the same Chat Adapter pipeline from Sprint 58–59, unchanged. |

Sprints 56–57 deliberately ship **zero LLM dependency** — this de-risks the hardest part (does the deterministic planner correctly drive toward READY without repeating or skipping?) before spending any effort on prompt engineering, mirroring exactly how Sprint 53/54 proved deterministic scoring before Sprint 54.1 touched UI.

---

## Risks & Recommendations Summary

| Risk | Mitigation (already designed above) |
|---|---|
| LLM invents missing-area detection, drifts from the trusted decision engine | Question selection is 100% deterministic (§2); LLM only phrases and extracts, never decides. |
| Interview never converges / user fatigue | Hard stop at READY (§1, §7), visible pause always available, checkpoint-based "continue?" prompts every 5–7 turns, not every turn. |
| Duplicate/repeated questions | Structurally impossible by design — Question Planner only ever selects from currently-missing dimensions (§2), and Prompt A is given the explicit list of prior questions as a hard constraint (§11). |
| Context/cost blowup on long interviews | Bounded context by design (§5, §14) — compact model summary + capped recent turns + periodic digest, never full transcript. |
| Interview Mode becomes a second, divergent source of truth from the Form | Both write the *same* `BusinessUnderstandingModel` via the *same* patch contract (§0, §13) — there is structurally only one model, not two. |
| Building this as "a chat screen" forecloses future document/voice support | Explicitly designed as a Discovery Agent with pluggable input adapters (§15) from day one, even though only the Chat Adapter ships first. |

**This is an architecture document only.** No code, migrations, or tests were written or modified as part of Sprint 55.
