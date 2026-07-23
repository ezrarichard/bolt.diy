import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type {
  BusinessUnderstandingModel,
  DiscoveryDimension,
  FactConfidence,
  ProvenanceEntityRef,
  TraceabilityReference,
} from '~/lib/projects/requirementsSession';

/**
 * Discovery AI Engine — Sprint 57. Shared type surface.
 *
 * See `app/lib/projects/discoveryAiEngine/discoveryAiEngine.ts` for the module's own header
 * comment (architecture, pipeline order, design rationale). This file exists only so every
 * pipeline stage (`factExtractor.ts`, `factValidator.ts`, ...) can depend on one shared vocabulary
 * without importing each other.
 */

/**
 * Every discovery method the Builders Discovery Experience master spec §2 names, plus 'crm' for
 * the future CRM Import adapter its §12 anticipates. Only `'interview'` has a real Context
 * Builder (`contextBuilder.ts`) and a real caller (`requirementsSessionOrchestrator.ts`) as of
 * Sprint 57 — the rest exist here so the Discovery AI Engine's own code never needs to change
 * when a future sprint adds their adapters (Part 11's extensibility requirement).
 */
export type DiscoverySourceType = 'interview' | 'document' | 'website' | 'voice' | 'meeting' | 'crm';

/**
 * The one input shape every Discovery Input Adapter must produce (architecture doc §15's
 * "every adapter produces the same contract" principle, applied one layer earlier — to the
 * Discovery AI Engine's own input, not just its output). `runDiscoveryAiEngine` never branches
 * on `sourceType` for its extraction/validation/normalization/confidence/contradiction/evidence
 * logic — it only affects prompt framing (see `prompts/discoveryFactExtraction.ts`) and the
 * `transformation` label attached to evidence.
 */
export interface DiscoveryContext {
  sourceType: DiscoverySourceType;

  /** What this content's evidence should point back to — e.g. `{ type: 'session_message', id: <answer message id> }` for a conversational turn. */
  sourceRef: ProvenanceEntityRef;

  projectId: string;
  sessionId: string;

  /** The model as it stands *before* this turn's facts are applied — required for merge-not-replace patch generation (`patchGenerator.ts`) and contradiction detection (`contradictionDetector.ts`). */
  currentModel: BusinessUnderstandingModel;

  /**
   * The raw text to extract facts from. For a conversational source (interview today; voice/
   * meeting once their adapters exist, per architecture doc §15) this is the user's answer;
   * `askedDimension`/`questionText` give the extractor the question that prompted it, for
   * context only — extraction is never limited to just that one dimension (architecture doc §4:
   * one answer can populate multiple dimensions at once).
   */
  rawText: string;

  /** The dimension the conversational turn's question targeted, if any — context for the prompt, not a hard constraint on what can be extracted. */
  askedDimension?: DiscoveryDimension;

  /** The question text that was asked, if any — included in the prompt so the model can resolve pronouns/ellipsis ("yes", "same as before"). */
  questionText?: string;
}

/** A raw fact as the LLM proposed it — extractive only, never yet validated, normalized, scored, or checked for contradictions. */
export interface CandidateFact {
  dimension: string;
  value: string;
}

export interface RejectedFact {
  candidate: CandidateFact;
  reason: string;
}

/** A candidate fact that passed validation and normalization and been assigned confidence/provenance metadata — still not yet checked for contradictions. */
export interface ExtractedFact {
  dimension: DiscoveryDimension;
  value: string;
  confidence: FactConfidence;
  source: ProvenanceEntityRef;
  recordedAt: string;

  /** Short, stable machine label for *why* this confidence tier was assigned — e.g. `'llm_extraction'` — mirrors `TraceabilityReference.transformation`'s convention of a stable, human-readable rule id. */
  reason: string;
}

/** An extracted fact that conflicts with a value the model already holds for the same dimension — excluded from the generated patch, never silently applied (architecture doc §8: "Do NOT overwrite automatically"). */
export interface Contradiction {
  dimension: DiscoveryDimension;
  existingValue: string;
  newValue: string;
  newFact: ExtractedFact;
  reason: string;
}

export interface DiscoveryAiEngineResult {
  patch: BusinessUnderstandingModelPatch;
  evidence: TraceabilityReference[];
  acceptedFacts: ExtractedFact[];
  contradictions: Contradiction[];
  rejectedFacts: RejectedFact[];

  /**
   * Sprint 57.1, Task 8 — set ONLY when the underlying `generateText` call itself failed (a
   * real infrastructure/provider/auth failure), never when it succeeded but legitimately found
   * nothing to extract (a short/irrelevant answer — architecture doc §13's edge case, not an
   * error). Callers must treat this distinctly from "no facts": `patch`/`evidence` are still
   * present but are always a no-op passthrough of `context.currentModel` in this case (see
   * `factExtractor.ts`), and the caller should NOT advance the conversation on this turn —
   * doing so would silently claim the answer was understood when it never reached the model at
   * all (Task 8: "must not falsely advance discovery progress").
   */
  extractionError?: string;
}

export type GenerateTextResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Dependency-injection point for Part 3's "use an LLM only for extraction, never let it write to
 * BuildersDB directly" requirement — `factExtractor.ts` never imports the `ai` SDK or fetches
 * anything itself; it only calls whatever function its caller supplies. Structurally compatible
 * with `useGenerateText()`'s `generate` (see `app/lib/hooks/useGenerateText.ts`) so a caller can
 * pass that hook's function straight through without an adapter.
 */
export type GenerateTextFn = (
  system: string | undefined,
  prompt: string,
  options?: { maxTokens?: number; temperature?: number },
) => Promise<GenerateTextResult>;
