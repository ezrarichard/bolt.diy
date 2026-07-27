import { describe, expect, it } from 'vitest';
import { classifyChangeRequest, type ClassificationInput } from './changeClassification';
import type { ChangeRequest } from './changeRequestTypes';

function input(
  request: Partial<
    Pick<ChangeRequest, 'title' | 'description' | 'businessReason' | 'category' | 'declaredAreas' | 'scope'>
  > = {},
  overrides: Partial<ClassificationInput> = {},
): ClassificationInput {
  return {
    request: {
      title: '',
      description: '',
      category: 'unknown',
      declaredAreas: [],
      scope: 'unknown',
      ...request,
    },
    matchedFeatureCount: 0,
    affectedSectionCount: 0,
    touchesDatabase: false,
    ...overrides,
  };
}

describe('classifyChangeRequest', () => {
  it('always honours a declared category over any inference', () => {
    const result = classifyChangeRequest(
      input({ category: 'compliance', description: 'The booking page is broken and crashes with an error.' }),
    );

    expect(result).toMatchObject({ category: 'compliance', source: 'declared', confidence: 'high' });
    expect(result.alternatives).toEqual([]);
  });

  it('infers a bug fix from failure wording', () => {
    const result = classifyChangeRequest(
      input({ title: 'Booking broken', description: 'It fails with an error and crashes.' }),
    );

    expect(result).toMatchObject({ category: 'bug_fix', source: 'inferred' });
  });

  it('infers security from authentication wording', () => {
    expect(
      classifyChangeRequest(input({ description: 'Add role-based permissions so unauthorized users cannot log in.' }))
        .category,
    ).toBe('security');
  });

  it('infers compliance from regulatory wording', () => {
    expect(
      classifyChangeRequest(input({ description: 'We need GDPR consent and a data retention policy.' })).category,
    ).toBe('compliance');
  });

  it('infers performance from speed wording', () => {
    expect(
      classifyChangeRequest(input({ description: 'The dashboard is slow — improve latency and add caching.' }))
        .category,
    ).toBe('performance');
  });

  it('infers a major expansion from breadth, independent of wording', () => {
    const result = classifyChangeRequest(input({ description: 'Small tweak.' }, { matchedFeatureCount: 5 }));

    expect(result.category).toBe('major_expansion');
    expect(result.reasoning).toMatch(/5 features matched/);
  });

  it('infers a major expansion from a declared cross-cutting scope', () => {
    expect(classifyChangeRequest(input({ description: 'Tweak.', scope: 'cross_cutting' })).category).toBe(
      'major_expansion',
    );
  });

  it('lets a declared area contribute a signal', () => {
    const result = classifyChangeRequest(
      input({ description: 'Please change this.', declaredAreas: ['authentication'] }),
    );

    expect(result.category).toBe('security');
    expect(result.reasoning).toMatch(/declared area "authentication"/);
  });

  it('returns unknown rather than guessing when no signal exists', () => {
    const result = classifyChangeRequest(input({ title: 'Zzz', description: 'Qqq.' }));

    expect(result).toMatchObject({ category: 'unknown', source: 'inferred', confidence: 'low' });
    expect(result.reasoning).toMatch(/Classify it manually/);
  });

  it('reports close alternatives so a human can see what it nearly chose', () => {
    const result = classifyChangeRequest(
      input({ description: 'The layout is broken and the colours are wrong on mobile view.' }),
    );

    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('never claims high confidence for an inference', () => {
    const result = classifyChangeRequest(
      input({ description: 'Broken, fails, errors, crash, incorrect, wrong, fix it.' }),
    );

    expect(result.source).toBe('inferred');
    expect(result.confidence).not.toBe('high');
    expect(result.reasoning).toMatch(/heuristic/);
  });

  it('is deterministic', () => {
    const run = () => classifyChangeRequest(input({ description: 'Add a new booking option.' }));

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
