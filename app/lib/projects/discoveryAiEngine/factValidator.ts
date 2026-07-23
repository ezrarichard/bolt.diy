import { DISCOVERY_DIMENSION_ORDER } from '~/lib/projects/discoveryAgent';
import type { DiscoveryDimension } from '~/lib/projects/requirementsSession';
import type { CandidateFact, RejectedFact } from './types';

/**
 * Fact Validator — Sprint 57, Part 4.
 *
 * Runs BEFORE normalization/confidence scoring — a candidate that fails validation never reaches
 * the rest of the pipeline. Pure, synchronous, no I/O, trivially unit-testable, following the
 * same discipline `businessAssessmentEngine.ts`/`discoveryDecisionEngine.ts` already established
 * for every deterministic stage in this pipeline.
 */

const KNOWN_DIMENSIONS = new Set<string>(DISCOVERY_DIMENSION_ORDER);

function isKnownDimension(dimension: string): dimension is DiscoveryDimension {
  return KNOWN_DIMENSIONS.has(dimension);
}

export interface ValidationResult {
  valid: CandidateFact[];
  rejected: RejectedFact[];
}

/**
 * Rejects a candidate for any of: an unsupported/invalid dimension name (the LLM hallucinated a
 * dimension outside the fixed ten), an empty/whitespace-only value, or a duplicate
 * (dimension, value) pair already seen earlier in the same batch — an LLM response that lists
 * the same fact twice should not produce two identical patch entries or two traceability rows.
 */
export function validateCandidateFacts(candidates: CandidateFact[]): ValidationResult {
  const valid: CandidateFact[] = [];
  const rejected: RejectedFact[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!isKnownDimension(candidate.dimension)) {
      rejected.push({ candidate, reason: 'unsupported_dimension' });
      continue;
    }

    const trimmedValue = candidate.value.trim();

    if (trimmedValue.length === 0) {
      rejected.push({ candidate, reason: 'empty_value' });
      continue;
    }

    const dedupeKey = `${candidate.dimension}::${trimmedValue.toLowerCase()}`;

    if (seen.has(dedupeKey)) {
      rejected.push({ candidate, reason: 'duplicate' });
      continue;
    }

    seen.add(dedupeKey);
    valid.push({ dimension: candidate.dimension, value: trimmedValue });
  }

  return { valid, rejected };
}
