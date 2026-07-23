import { describe, expect, it } from 'vitest';
import { buildEvidenceForFacts } from './evidenceTracker';
import type { ExtractedFact } from './types';

function fact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
  return {
    dimension: 'targetUsers',
    value: 'Shop owners',
    confidence: 'stated',
    source: { type: 'session_message', id: 'msg-1' },
    recordedAt: '2026-01-01T00:00:00.000Z',
    reason: 'interview_fact_extraction',
    ...overrides,
  };
}

describe('buildEvidenceForFacts', () => {
  it('produces one TraceabilityReference per fact, pointing at the fact source and target section', () => {
    const evidence = buildEvidenceForFacts([fact()]);

    expect(evidence).toEqual([
      {
        source: { type: 'session_message', id: 'msg-1' },
        target: { type: 'business_understanding_section', id: 'targetUsers' },
        transformation: 'interview_fact_extraction',
        recordedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('maps each dimension to its correct target section', () => {
    const evidence = buildEvidenceForFacts([
      fact({ dimension: 'coreFeatures' }),
      fact({ dimension: 'businessVision' }),
      fact({ dimension: 'integrations' }),
    ]);

    expect(evidence.map((e) => e.target.id)).toEqual(['functionalRequirements', 'businessIdentity', 'currentSystems']);
  });

  it('carries the reason through as the transformation label, generalizing across source types', () => {
    const evidence = buildEvidenceForFacts([fact({ reason: 'document_fact_extraction' })]);
    expect(evidence[0].transformation).toBe('document_fact_extraction');
  });

  it('returns an empty array for an empty fact list', () => {
    expect(buildEvidenceForFacts([])).toEqual([]);
  });
});
