import { describe, expect, it, vi } from 'vitest';
import { runDiscoveryAiEngine } from './discoveryAiEngine';
import { buildInterviewDiscoveryContext } from './contextBuilder';
import type { GenerateTextFn } from './types';
import { emptyModel } from './testFixtures';

/**
 * End-to-end pipeline tests — real extractor/validator/normalizer/scorer/detector/tracker/
 * generator, only `generateText` faked (per the DI seam `types.ts`/`factExtractor.spec.ts`
 * establish). This is the regression suite for "does the whole Discovery AI Engine actually work
 * together," complementing each stage's own isolated unit tests.
 */
function fakeGenerateText(text: string): GenerateTextFn {
  return vi.fn().mockResolvedValue({ ok: true, text });
}

describe('runDiscoveryAiEngine', () => {
  it('produces a patch, evidence, and accepted facts from a single-dimension LLM response', async () => {
    const model = emptyModel();
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model,
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'Local shop owners in Coimbatore',
    });

    const generateText = fakeGenerateText(
      '{"facts": [{"dimension": "targetUsers", "value": "Local shop owners in Coimbatore"}]}',
    );

    const result = await runDiscoveryAiEngine(context, { generateText });

    expect(result.patch.targetUsers).toEqual(['Local shop owners in Coimbatore']);
    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.contradictions).toEqual([]);
    expect(result.rejectedFacts).toEqual([]);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        source: { type: 'session_message', id: 'msg-1' },
        target: { type: 'business_understanding_section', id: 'targetUsers' },
        transformation: 'interview_fact_extraction',
      }),
    ]);
  });

  it('extracts and applies multiple dimensions from one multi-topic answer (architecture doc §4)', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'coreFeatures',
      answerMessageId: 'msg-1',
      answerText: 'Online booking, and by the way we also need WhatsApp notifications',
    });

    const generateText = fakeGenerateText(
      '{"facts": [{"dimension": "coreFeatures", "value": "Online booking"}, {"dimension": "integrations", "value": "WhatsApp notifications"}]}',
    );

    const result = await runDiscoveryAiEngine(context, { generateText });

    expect(result.patch.functionalRequirements).toEqual(['Online booking']);
    expect(result.patch.currentSystems).toEqual(['WhatsApp notifications']);
    expect(result.acceptedFacts).toHaveLength(2);
  });

  it('normalizes an industry synonym end-to-end before it reaches the patch', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'industry',
      answerMessageId: 'msg-1',
      answerText: "We're a dental clinic",
    });

    const generateText = fakeGenerateText('{"facts": [{"dimension": "industry", "value": "Clinic"}]}');
    const result = await runDiscoveryAiEngine(context, { generateText });

    expect(result.patch.businessIdentity).toMatchObject({ industry: 'Dental Clinic' });
  });

  it('excludes a contradicting fact from the patch and reports it separately', async () => {
    const model = emptyModel({ businessIdentity: { industry: 'Hospital' } });
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model,
      dimension: 'industry',
      answerMessageId: 'msg-1',
      answerText: 'We sell clothes',
    });

    const generateText = fakeGenerateText('{"facts": [{"dimension": "industry", "value": "Retail"}]}');
    const result = await runDiscoveryAiEngine(context, { generateText });

    /*
     * The existing value is preserved (never overwritten) — contradiction detection excludes the
     * conflicting fact from `acceptedFacts`/the patch's *change*, but the patch still carries the
     * model's current state through, exactly like every other untouched section.
     */
    expect(result.patch.businessIdentity).toMatchObject({ industry: 'Hospital' });
    expect(result.acceptedFacts).toEqual([]);
    expect(result.contradictions).toEqual([
      expect.objectContaining({ dimension: 'industry', existingValue: 'Hospital', newValue: 'Retail' }),
    ]);
  });

  it('rejects a hallucinated dimension from the LLM without failing the whole turn', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'Shop owners, and I like the color blue',
    });

    const generateText = fakeGenerateText(
      '{"facts": [{"dimension": "targetUsers", "value": "Shop owners"}, {"dimension": "favoriteColor", "value": "Blue"}]}',
    );

    const result = await runDiscoveryAiEngine(context, { generateText });

    expect(result.patch.targetUsers).toEqual(['Shop owners']);
    expect(result.rejectedFacts).toEqual([
      expect.objectContaining({ candidate: { dimension: 'favoriteColor', value: 'Blue' } }),
    ]);
  });

  it('produces an unchanged patch (mirroring the current model) when the LLM extracts nothing', async () => {
    const model = emptyModel({ targetUsers: ['Existing users'] });
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model,
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'idk',
    });

    const generateText = fakeGenerateText('{"facts": []}');
    const result = await runDiscoveryAiEngine(context, { generateText });

    expect(result.patch.targetUsers).toEqual(['Existing users']);
    expect(result.acceptedFacts).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it('never throws when the underlying generateText call fails, and reports extractionError', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'Shop owners',
    });

    const generateText: GenerateTextFn = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });

    await expect(runDiscoveryAiEngine(context, { generateText })).resolves.toMatchObject({
      acceptedFacts: [],
      contradictions: [],
      rejectedFacts: [],
      extractionError: 'network down',
    });
  });

  it('does not set extractionError for a legitimate empty result', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'idk',
    });

    const result = await runDiscoveryAiEngine(context, { generateText: fakeGenerateText('{"facts": []}') });

    expect(result.extractionError).toBeUndefined();
  });

  it('sets extractionError for a malformed/unparseable provider response', async () => {
    const context = buildInterviewDiscoveryContext({
      projectId: 'proj-1',
      sessionId: 'session-1',
      model: emptyModel(),
      dimension: 'targetUsers',
      answerMessageId: 'msg-1',
      answerText: 'Shop owners',
    });

    const result = await runDiscoveryAiEngine(context, {
      generateText: fakeGenerateText("I'm not able to help with that request."),
    });

    expect(result.extractionError).toBeTruthy();
    expect(result.acceptedFacts).toEqual([]);
    expect(result.patch.targetUsers).toEqual([]);
  });
});
