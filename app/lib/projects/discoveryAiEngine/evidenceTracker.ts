import { DIMENSION_TARGET_SECTION } from '~/lib/projects/discoveryAgent';
import type { ExtractedFact } from './types';
import type { TraceabilityReference } from '~/lib/projects/requirementsSession';

/**
 * Evidence Tracker — Sprint 57, Part 7.
 *
 * Every accepted fact becomes exactly one `TraceabilityReference`, reusing the same mechanism
 * Sprint 52 introduced and Sprint 53/54/56 already reuse unchanged — no new provenance
 * infrastructure, just a generalized `transformation` label (`<sourceType>_fact_extraction`,
 * carried on `ExtractedFact.reason` by `confidenceScorer.ts`) so a document/website/voice fact
 * traces back to its source exactly as clearly as an interview answer already does. `source` is
 * whatever `DiscoveryContext.sourceRef` the caller supplied — a `session_message` id for a
 * conversational turn today; a `document_paragraph`/`website_section` id once those adapters
 * exist (`requirementsSession.ts`'s `ProvenanceEntityType`, extended this sprint).
 */
export function buildEvidenceForFacts(facts: ExtractedFact[]): TraceabilityReference[] {
  return facts.map((fact) => ({
    source: fact.source,
    target: { type: 'business_understanding_section', id: DIMENSION_TARGET_SECTION[fact.dimension] },
    transformation: fact.reason,
    recordedAt: fact.recordedAt,
  }));
}
