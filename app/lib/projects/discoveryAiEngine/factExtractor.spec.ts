import { describe, expect, it, vi } from 'vitest';
import { extractFacts } from './factExtractor';
import type { DiscoveryContext, GenerateTextFn } from './types';
import { emptyModel } from './testFixtures';

/**
 * No `ai` SDK or `fetch` mocking here — `extractFacts` never touches either directly (see this
 * module's own header comment). Tests inject a fake `GenerateTextFn` instead, exactly the
 * dependency-injection seam Part 3 requires — this is the new mocking convention for any future
 * Discovery AI Engine test that needs an LLM round trip, since no prior art for mocking the `ai`
 * package exists in this codebase (every other AI-adjacent engine tests pure prompt-building/
 * response-parsing functions in isolation instead).
 *
 * Sprint 57.1 — `extractFacts` now returns `{ candidates, error? }` instead of a bare array, so
 * a genuine extraction failure (network/auth/malformed response) can be told apart from a
 * legitimate "nothing extractable" result (Task 8: a real failure must not silently look like
 * an ordinary empty turn).
 */

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    sourceType: 'interview',
    sourceRef: { type: 'session_message', id: 'msg-1' },
    projectId: 'proj-1',
    sessionId: 'session-1',
    currentModel: emptyModel(),
    rawText: 'Local shop owners in Coimbatore',
    askedDimension: 'targetUsers',
    questionText: 'Tell me about who this product is for.',
    ...overrides,
  };
}

function fakeGenerateText(text: string): GenerateTextFn {
  return vi.fn().mockResolvedValue({ ok: true, text });
}

describe('extractFacts', () => {
  it('parses a well-formed JSON facts response', async () => {
    const generateText = fakeGenerateText('{"facts": [{"dimension": "targetUsers", "value": "Local shop owners"}]}');
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([{ dimension: 'targetUsers', value: 'Local shop owners' }]);
    expect(outcome.error).toBeUndefined();
  });

  it('tolerates a markdown-fenced JSON response', async () => {
    const generateText = fakeGenerateText(
      '```json\n{"facts": [{"dimension": "targetUsers", "value": "Local shop owners"}]}\n```',
    );
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([{ dimension: 'targetUsers', value: 'Local shop owners' }]);
    expect(outcome.error).toBeUndefined();
  });

  it('tolerates leading/trailing prose around the JSON payload', async () => {
    const generateText = fakeGenerateText(
      'Sure, here is what I found:\n{"facts": [{"dimension": "industry", "value": "Retail"}]}\nLet me know if you need anything else.',
    );
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([{ dimension: 'industry', value: 'Retail' }]);
    expect(outcome.error).toBeUndefined();
  });

  it('extracts multiple facts spanning multiple dimensions from one answer', async () => {
    const generateText = fakeGenerateText(
      '{"facts": [{"dimension": "targetUsers", "value": "Shop owners"}, {"dimension": "coreFeatures", "value": "Online booking"}]}',
    );
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates.map((f) => f.dimension)).toEqual(['targetUsers', 'coreFeatures']);
  });

  it('returns an empty, non-error outcome when the model legitimately reports nothing extractable', async () => {
    const generateText = fakeGenerateText('{"facts": []}');
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  it('reports an error (never throws) for a non-JSON / provider-refusal response', async () => {
    const generateText = fakeGenerateText("Sorry, I can't help with that.");
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toBeTruthy();
  });

  it('reports an error (never throws) for malformed/truncated JSON', async () => {
    const generateText = fakeGenerateText('{"facts": [{"dimension": "targetUsers"');
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toBeTruthy();
  });

  it('reports an error for a well-formed JSON object missing the facts array entirely', async () => {
    const generateText = fakeGenerateText('{"result": "no facts field at all"}');
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toBeTruthy();
  });

  it('ignores a facts entry missing a required field rather than failing the whole batch', async () => {
    const generateText = fakeGenerateText(
      '{"facts": [{"dimension": "targetUsers"}, {"dimension": "coreFeatures", "value": "Online booking"}]}',
    );
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([{ dimension: 'coreFeatures', value: 'Online booking' }]);
    expect(outcome.error).toBeUndefined();
  });

  it('reports the underlying error message when generateText itself fails (network/auth/provider)', async () => {
    const generateText: GenerateTextFn = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid or missing API key' });
    const outcome = await extractFacts(context(), generateText);

    expect(outcome.candidates).toEqual([]);
    expect(outcome.error).toBe('Invalid or missing API key');
  });

  it('passes the extraction system prompt and a built prompt to generateText', async () => {
    const generateText = vi.fn().mockResolvedValue({ ok: true, text: '{"facts": []}' });
    await extractFacts(context(), generateText);

    expect(generateText).toHaveBeenCalledTimes(1);

    const [system, prompt] = generateText.mock.calls[0];
    expect(system).toEqual(expect.stringContaining('fact-extraction'));
    expect(prompt).toEqual(expect.stringContaining('Local shop owners in Coimbatore'));
  });
});
