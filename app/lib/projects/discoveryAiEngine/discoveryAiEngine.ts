import { scoreConfidenceForAll } from './confidenceScorer';
import { detectContradictions } from './contradictionDetector';
import { buildEvidenceForFacts } from './evidenceTracker';
import { extractFacts } from './factExtractor';
import { normalizeCandidateFact } from './factNormalizer';
import { validateCandidateFacts } from './factValidator';
import { generatePatch } from './patchGenerator';
import type { DiscoveryAiEngineResult, DiscoveryContext, GenerateTextFn } from './types';

/**
 * Discovery AI Engine — Sprint 57.
 *
 * The single intelligence layer every Discovery method (Interview today; Document Upload,
 * Website Analysis, Voice, Meeting Transcript, CRM Import per the Builders Discovery Experience
 * master spec §2/§12) is meant to flow through, per this sprint's brief:
 *
 *   Discovery Source -> DiscoveryContext -> Discovery AI Engine -> BusinessUnderstandingModelPatch
 *                                              |
 *                        Context Builder -> Fact Extractor -> Fact Validator -> Fact Normalizer
 *                        -> Confidence Scorer -> Contradiction Detector -> Evidence Tracker
 *                        -> Patch Generator
 *
 * `runDiscoveryAiEngine` is the ONLY exported entry point most callers need — it wires the eight
 * pipeline stages above in order and returns everything a caller needs to persist a turn
 * (`patch`, `evidence`) plus everything useful for diagnostics/future UI (`acceptedFacts`,
 * `contradictions`, `rejectedFacts`). It knows nothing about Interview Mode, BuildersDB, React,
 * or any specific UI — see this module's own file for what it deliberately does NOT do:
 *
 * - Never calls `runBusinessAssessment`/`runDiscoveryDecision` itself (architecture doc §0: those
 *   stay the caller's job, run against this engine's `patch` output, unchanged).
 * - Never persists anything — no repository imports anywhere in this directory.
 * - Never imports the `ai` SDK — `factExtractor.ts` only calls the `generateText` its caller
 *   injects (Part 3's "the LLM should only return structured candidate facts" requirement).
 * - Never knows about `RequirementsSessionMessage`/`RequirementsSession` — only the generic
 *   `ProvenanceEntityRef` shape already used across every provenance record.
 *
 * This is what "remain independent from Interview Mode" (Part 1) means concretely: nothing in
 * this directory imports from `requirementsSessionOrchestrator.ts`, `useInterviewSession.ts`, or
 * any `Interview*` component — the dependency only ever points the other way.
 */
export async function runDiscoveryAiEngine(
  context: DiscoveryContext,
  deps: { generateText: GenerateTextFn },
): Promise<DiscoveryAiEngineResult> {
  const { candidates, error: extractionError } = await extractFacts(context, deps.generateText);
  const { valid, rejected } = validateCandidateFacts(candidates);
  const normalized = valid.map(normalizeCandidateFact);
  const scored = scoreConfidenceForAll(normalized, context);
  const { accepted, contradictions } = detectContradictions(scored, context.currentModel);
  const evidence = buildEvidenceForFacts(accepted);
  const patch = generatePatch(context.currentModel, accepted);

  return {
    patch,
    evidence,
    acceptedFacts: accepted,
    contradictions,
    rejectedFacts: rejected,
    ...(extractionError ? { extractionError } : {}),
  };
}
