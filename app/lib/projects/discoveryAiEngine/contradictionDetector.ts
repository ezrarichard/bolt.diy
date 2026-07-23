import type { BusinessUnderstandingModel, DiscoveryDimension } from '~/lib/projects/requirementsSession';
import type { Contradiction, ExtractedFact } from './types';

/**
 * Contradiction Detector — Sprint 57, Part 8.
 *
 * Dimensions whose model field holds a single, replaceable value — the only ones a new answer
 * can meaningfully *contradict* (a new list entry can't contradict an old one; it's additive by
 * construction, exactly as Sprint 56 already treated `targetUsers`/`coreFeatures`/etc.).
 * `projectType` is excluded even though `businessAssessmentEngine.ts`'s keyword rules key off
 * text mentioning it, because the Patch Generator folds a `projectType` answer into
 * `businessIdentity.vision` as an addition (see `patchGenerator.ts`) rather than a replacement —
 * there's nothing singular to compare against.
 */
const SINGULAR_DIMENSIONS: ReadonlySet<DiscoveryDimension> = new Set([
  'businessVision',
  'industry',
  'businessAssessment',
  'technicalPreferences',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Reads the current single-value field a singular dimension's answer would overwrite. Mirrors
 * exactly where `patchGenerator.ts` writes each of these dimensions, so the two can never read/
 * write different locations.
 */
function existingSingularValue(model: BusinessUnderstandingModel, dimension: DiscoveryDimension): string {
  const identity = asRecord(model.businessIdentity);

  if (dimension === 'businessVision' && typeof identity.vision === 'string') {
    return identity.vision;
  }

  if (dimension === 'industry' && typeof identity.industry === 'string') {
    return identity.industry;
  }

  if (dimension === 'businessAssessment' && typeof identity.businessModel === 'string') {
    return identity.businessModel;
  }

  if (dimension === 'technicalPreferences') {
    const formSnapshot = asRecord(identity.formSnapshot);

    if (typeof formSnapshot.technicalPreferences === 'string') {
      return formSnapshot.technicalPreferences;
    }
  }

  return '';
}

function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

export interface ContradictionDetectionResult {
  accepted: ExtractedFact[];
  contradictions: Contradiction[];
}

/**
 * Flags (rather than silently applies) a fact for a singular dimension whose model already holds
 * a different, non-empty value — architecture doc §8's "do NOT overwrite automatically". List-
 * shaped and `projectType` facts are always accepted (additive, never conflicting by
 * construction). A flagged contradiction is excluded from `accepted` and returned separately so
 * the caller can surface it — full Clarification-question UI (UX spec §5) is out of scope for
 * this foundation sprint; see the Sprint 57 implementation-status note in the architecture doc
 * for what's deferred.
 *
 * This is a foundation-level heuristic, not true `FactConfidence`-tier-aware contradiction
 * detection (architecture doc §5 distinguishes overwriting an `'inferred'`/`'stated'` fact from
 * overwriting a `'confirmed'` one) — the schema doesn't yet track a confidence tier per stored
 * value (only per-extraction, in `ExtractedFact`/evidence), so this compares against whatever
 * value is currently stored, regardless of how it got there. Documented as a known gap for a
 * future sprint once per-field confidence tracking exists in `BusinessUnderstandingModel` itself.
 */
export function detectContradictions(
  facts: ExtractedFact[],
  model: BusinessUnderstandingModel,
): ContradictionDetectionResult {
  const accepted: ExtractedFact[] = [];
  const contradictions: Contradiction[] = [];

  for (const fact of facts) {
    if (!SINGULAR_DIMENSIONS.has(fact.dimension)) {
      accepted.push(fact);
      continue;
    }

    const existingValue = existingSingularValue(model, fact.dimension);

    if (existingValue.length > 0 && normalizeForComparison(existingValue) !== normalizeForComparison(fact.value)) {
      contradictions.push({
        dimension: fact.dimension,
        existingValue,
        newValue: fact.value,
        newFact: fact,
        reason: `${fact.dimension} already has a different value on record`,
      });
      continue;
    }

    accepted.push(fact);
  }

  return { accepted, contradictions };
}
