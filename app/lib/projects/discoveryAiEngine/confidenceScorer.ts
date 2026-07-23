import type { DiscoveryDimension } from '~/lib/projects/requirementsSession';
import type { CandidateFact, DiscoveryContext, ExtractedFact } from './types';

/**
 * Confidence Scorer — Sprint 57, Part 6.
 *
 * Turns a validated + normalized `CandidateFact` into an `ExtractedFact` — attaching the four
 * things Part 6 requires every extracted fact to carry: confidence, source, timestamp, reason.
 *
 * Confidence is always `'stated'` (never `'confirmed'`) — reusing `FactConfidence` from the
 * frozen Business Analyst Intelligence Architecture (`requirementsSession.ts`, reserved since
 * Sprint 50), and matching the architecture doc §11 rule verbatim: `'confirmed'` is reserved
 * for the Confirmation-question flow (a deliberate second, LLM-free checkpoint — a yes/no from
 * the user, not an LLM's own claim about how certain it is), which is not implemented yet
 * (Sprint 55.1 UX spec §5's Confirmation question type remains future scope). Extraction can
 * never promote itself to `'confirmed'`, no matter how unambiguous the source text looks.
 */
export function scoreConfidence(candidate: CandidateFact, context: DiscoveryContext): ExtractedFact {
  return {
    dimension: candidate.dimension as DiscoveryDimension,
    value: candidate.value,
    confidence: 'stated',
    source: context.sourceRef,
    recordedAt: new Date().toISOString(),
    reason: `${context.sourceType}_fact_extraction`,
  };
}

export function scoreConfidenceForAll(candidates: CandidateFact[], context: DiscoveryContext): ExtractedFact[] {
  return candidates.map((candidate) => scoreConfidence(candidate, context));
}
