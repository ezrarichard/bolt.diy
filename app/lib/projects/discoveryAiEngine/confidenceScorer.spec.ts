import { describe, expect, it } from 'vitest';
import { scoreConfidence, scoreConfidenceForAll } from './confidenceScorer';
import type { DiscoveryContext } from './types';
import { emptyModel } from './testFixtures';

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    sourceType: 'interview',
    sourceRef: { type: 'session_message', id: 'msg-1' },
    projectId: 'proj-1',
    sessionId: 'session-1',
    currentModel: emptyModel(),
    rawText: 'Shop owners in Coimbatore',
    ...overrides,
  };
}

describe('scoreConfidence', () => {
  it('always assigns stated confidence, never confirmed', () => {
    const fact = scoreConfidence({ dimension: 'targetUsers', value: 'Shop owners' }, context());
    expect(fact.confidence).toBe('stated');
  });

  it('attaches the context source as provenance', () => {
    const fact = scoreConfidence(
      { dimension: 'targetUsers', value: 'Shop owners' },
      context({ sourceRef: { type: 'session_message', id: 'msg-42' } }),
    );
    expect(fact.source).toEqual({ type: 'session_message', id: 'msg-42' });
  });

  it('tags the reason with the source type', () => {
    const fact = scoreConfidence(
      { dimension: 'targetUsers', value: 'Shop owners' },
      context({ sourceType: 'document' }),
    );
    expect(fact.reason).toBe('document_fact_extraction');
  });

  it('attaches an ISO timestamp', () => {
    const fact = scoreConfidence({ dimension: 'targetUsers', value: 'Shop owners' }, context());
    expect(() => new Date(fact.recordedAt).toISOString()).not.toThrow();
  });

  it('scoreConfidenceForAll scores every candidate in a batch', () => {
    const facts = scoreConfidenceForAll(
      [
        { dimension: 'targetUsers', value: 'Shop owners' },
        { dimension: 'coreFeatures', value: 'Online booking' },
      ],
      context(),
    );

    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.dimension)).toEqual(['targetUsers', 'coreFeatures']);
  });
});
