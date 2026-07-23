import type { DiscoveryDimension } from '~/lib/projects/requirementsSession';
import type { CandidateFact } from './types';

/**
 * Fact Normalizer — Sprint 57, Part 5.
 *
 * Canonicalizes a *raw extracted value* into the string Builders actually stores, before it ever
 * reaches `businessIdentity`/`targetUsers`/etc. This is a DIFFERENT concern from
 * `businessAssessmentEngine.ts`'s classification (which reads the stored `businessIdentity.industry`
 * value and derives `assessment.classification`/`assessment.industry` from it via its own,
 * separate keyword rules) — normalization cleans up what gets *stored*; assessment classifies
 * *from* what's stored. Reusing/duplicating `businessAssessmentEngine.ts`'s private
 * `CLASSIFICATION_RULES` here would violate "do not duplicate logic" and blur that boundary, so
 * this module intentionally does NOT attempt full business classification — only surface-level
 * synonym collapsing for the one dimension (`industry`) where users describe the same thing with
 * wildly different words ("Clinic" / "Dental Clinic" / "Dentist").
 *
 * Only `industry` has a real synonym table as of Sprint 57 (Part 5's explicit example) — every
 * other dimension gets the same trim/whitespace-collapse default. Adding a dimension-specific
 * normalizer later is additive: extend `DIMENSION_NORMALIZERS`, nothing else changes (Part 11's
 * extensibility requirement, applied within the engine itself).
 */

type Normalizer = (value: string) => string;

/** A small, illustrative synonym table (Part 5's own brief: "do NOT implement every feature completely" — this is a foundation, not an exhaustive industry taxonomy). Matched case-insensitively against the whole trimmed value. */
const INDUSTRY_SYNONYMS: Record<string, string> = {
  clinic: 'Dental Clinic',
  'dental clinic': 'Dental Clinic',
  dentist: 'Dental Clinic',
  hospital: 'Hospital',
  'medical center': 'Hospital',
  shop: 'Retail',
  store: 'Retail',
  boutique: 'Retail',
  restaurant: 'Restaurant',
  cafe: 'Restaurant',
  café: 'Restaurant',
  church: 'Church',
  parish: 'Church',
  school: 'School',
  college: 'School',
};

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeIndustry(value: string): string {
  const cleaned = collapseWhitespace(value);
  const canonical = INDUSTRY_SYNONYMS[cleaned.toLowerCase()];

  return canonical ?? cleaned;
}

const DIMENSION_NORMALIZERS: Partial<Record<DiscoveryDimension, Normalizer>> = {
  industry: normalizeIndustry,
};

/** Applies the dimension-specific normalizer if one exists, otherwise the default trim/whitespace-collapse — every candidate passed in must already have a known `DiscoveryDimension` (guaranteed by `factValidator.ts` running first). */
export function normalizeCandidateFact(candidate: CandidateFact): CandidateFact {
  const normalize = DIMENSION_NORMALIZERS[candidate.dimension as DiscoveryDimension] ?? collapseWhitespace;

  return { dimension: candidate.dimension, value: normalize(candidate.value) };
}
