import { describe, expect, it } from 'vitest';
import { buildInterviewDiscoveryContext } from './contextBuilder';
import { emptyModel } from './testFixtures';

describe('buildInterviewDiscoveryContext', () => {
  it('produces a DiscoveryContext sourced from the answer message', () => {
    const model = emptyModel();
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model,
      dimension: 'targetUsers',
      answerMessageId: 'msg-42',
      answerText: 'Local shop owners in Coimbatore',
    });

    expect(context).toMatchObject({
      sourceType: 'interview',
      sourceRef: { type: 'session_message', id: 'msg-42' },
      projectId: 'proj-1',
      sessionId: 'session-1',
      currentModel: model,
      rawText: 'Local shop owners in Coimbatore',
      askedDimension: 'targetUsers',
    });
  });

  it('includes the templated question text for the asked dimension, for prompt context', () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'coreFeatures',
      answerMessageId: 'msg-1',
      answerText: 'Online booking',
    });

    expect(context.questionText).toBe('What are the core features your customers will need?');
  });
});
