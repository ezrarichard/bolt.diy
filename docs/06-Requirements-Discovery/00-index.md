# 06 — Requirements Discovery

Index for everything related to Builders' Requirements Discovery pipeline: the durable
foundation (Sprints 50–54.1, implemented and shipped), Interview Mode's foundation and its
Discovery AI Engine (Sprints 56–57, implemented and shipped — session plumbing, chat UI,
question pipeline, and real LLM-backed fact extraction/validation/normalization/confidence/
contradiction-detection/evidence/patch generation), Sprint 57.1's real-provider verification &
hardening (live-verified end-to-end against a real authenticated session, real BuildersDB, and
a real Anthropic call; fixed a Generation Profile model-resolution gap that caused a 401; added
extraction-failure handling so a real provider outage no longer silently advances the
conversation), and the remaining Interview Mode / Discovery Experience design series (Sprint 58
onward — **not yet implemented**).

## Implemented

| Doc | Sprint(s) | Status |
|---|---|---|
| [01 — Durable Foundation](./01-sprint-50-durable-foundation.md) | Sprint 50 | Implemented (foundation only) |
| [02 — Sprint 55: Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) | Sprints 56–57.1 (of the sections listed below) | Foundation + Discovery AI Engine implemented and real-provider verified — see the "Sprint 56"/"Sprint 57"/"Sprint 57.1 implementation status" notes in that doc |

Sprints 51–54.1 (Requirements Form Integration, Traceability & Provenance, Business Assessment
Engine, Discovery Decision Engine, Discovery Intelligence UI) shipped directly to the codebase
without a corresponding written design doc — their behavior is documented in-code (see
`app/lib/projects/requirementsSession.ts`, `businessAssessmentEngine.ts`,
`discoveryDecisionEngine.ts`, and `app/components/sidebar/BusinessDiscoveryCard.tsx`) and in
their respective commit messages on `builders-v2`.

Sprint 56 (Interview Mode Foundation) shipped directly to the codebase against docs 02 and 03
below — see `app/lib/projects/discoveryAgent.ts`, the `startOrResumeInterview`/
`recordInterviewAnswer` additions to `requirementsSessionOrchestrator.ts`,
`app/lib/hooks/useInterviewSession.ts`, and `app/components/sidebar/InterviewChatDialog.tsx`.
Doc 03 is unchanged, since Sprint 56 followed its UX layout/chat-experience sections but did not
yet implement Question types/chips (§5), the Question Queue (§6), tablet/mobile layouts
(§2/§13), or accessibility polish (§12) — those remain "approved, not yet implemented" per that
doc.

Sprint 57 (Discovery AI Engine Architecture & Foundation) also shipped directly to the codebase
against doc 02 — see `app/lib/projects/discoveryAiEngine/` (Context Builder, Fact Extractor,
Fact Validator, Fact Normalizer, Confidence Scorer, Contradiction Detector, Evidence Tracker,
Patch Generator, and the `runDiscoveryAiEngine` orchestrator), `app/lib/projects/prompts/
discoveryFactExtraction.ts`, and `recordInterviewAnswer`'s refactor to call the engine instead of
Sprint 56's `buildInterviewPatch` mock. Doc 02 carries a short Sprint 57 implementation-status
note (its specification is unchanged).

Sprint 57.1 (Discovery AI Engine Real-Provider Verification & Hardening) live-verified Sprint
57's pipeline against a real authenticated session, real BuildersDB, and a real Anthropic call;
found and fixed a Generation Profile model-resolution gap (`app/lib/generation-profiles/
defaultProfiles.ts` — registered `discovery-agent`, mirroring the Sprint 46D `product-owner-draft`
fix; `useInterviewSession.ts` now calls `getRoleGenerateOptions`) that was causing a 401
unrelated to authentication; and hardened extraction-failure handling
(`discoveryAiEngine/factExtractor.ts`'s `ExtractionOutcome`, `recordInterviewAnswer`'s
`extractionError` branch, `InterviewChatDialog.tsx`'s Retry chip) so a genuine provider failure
no longer silently advances the conversation. Doc 02 carries a detailed Sprint 57.1
implementation-status note (its specification is unchanged).

## Design & Architecture (approved, not yet implemented beyond Sprints 56–57's foundation)

| Doc | Scope | Status |
|---|---|---|
| [02 — Sprint 55: Interview Mode Architecture](./02-sprint-55-interview-mode-architecture.md) | Conversation lifecycle, question selection/types, memory, traceability, prompt strategy, edge cases, performance, and the Discovery Agent extensibility model for AI Business Interview Mode. | Session plumbing + deterministic question loop (Sprint 56) and real LLM-backed fact extraction/the Discovery AI Engine (Sprint 57) implemented; §2 topic-locality refinement, §5 rolling digest/full confidence-tier tracking, §11 Prompt A (AI question phrasing), and §13's Clarification-question UI not yet implemented |
| [03 — Sprint 55.1: Interview Mode UX Specification](./03-sprint-55.1-interview-mode-ux-specification.md) | Complete customer-facing UX for Interview Mode: page layout, chat experience, Business Discovery panel behavior, question UI, pause/resume, accessibility, responsive design, and implementation order. | Milestones M1/M2/M5 (desktop chat shell, live panel, pause/resume) implemented per Sprint 56; M3/M4/M8/M9/M10/M11 not yet implemented |
| [04 — Builders Discovery Experience (BDE): Master Product & UX Specification](./04-builders-discovery-experience-master-spec.md) | The full Discovery Layer across every method (Form, Interview, Document, Website, Template, Voice, Meeting, and future sources) — Discovery Home, unified pipeline, Discovery Dashboard, Discovery Agent, memory, intelligence, timeline, quality, report, handoff, future AI integrations, information architecture, user journeys, roadmap, competitive differentiation, and long-term vision. | §5's Discovery Agent responsibilities (fact extraction contract, evidence tagging) are now real for the Interview/Chat Adapter via the Sprint 57 Discovery AI Engine — everything else (Discovery Home, Discovery Dashboard v2, Document/Website/Voice/Meeting/CRM adapters, Discovery Report, Discovery Timeline) remains unimplemented |

## Reading order

For implementers picking this up: **01 → 02 → 03 → 04**. 01 is what already exists in the
codebase; 02 and 03 design Interview Mode specifically (conversation + UX) — 02's session
plumbing, deterministic question loop, and Discovery AI Engine (fact extraction, validation,
normalization, confidence, contradiction detection, evidence, patch generation) are now
implemented (Sprints 56–57); 04 is the umbrella document that generalizes 02/03's ideas to every
discovery method Builders will eventually support, and is the source of truth for anything that
isn't specific to conversational interview (Discovery Home, Discovery Dashboard, Discovery
Report, etc.) — still entirely unimplemented, though the Discovery AI Engine's `DiscoveryContext`/
`DiscoverySourceType` types already anticipate document/website/voice/meeting/CRM sources per
04 §6/§12 without requiring changes to the engine itself once those adapters are built.

Sprint 58 onward (AI question phrasing — architecture doc §11 Prompt A, topic-locality
refinement, Clarification-question UI for surfacing contradictions, richer question types,
per-field confidence-tier tracking, traceability/edge-case hardening, and every discovery method
beyond conversational Interview) remain unimplemented per the roadmaps in docs 02 and 04.
