import { describe, expect, it } from 'vitest';
import { detectContradictions } from './contradictionDetector';
import type { ExtractedFact } from './types';
import { emptyModel } from './testFixtures';

function fact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
  return {
    dimension: 'industry',
    value: 'Retail',
    confidence: 'stated',
    source: { type: 'session_message', id: 'msg-1' },
    recordedAt: '2026-01-01T00:00:00.000Z',
    reason: 'interview_fact_extraction',
    ...overrides,
  };
}

describe('detectContradictions', () => {
  it('accepts a singular-dimension fact when the model has no existing value yet', () => {
    const { accepted, contradictions } = detectContradictions([fact()], emptyModel());

    expect(accepted).toEqual([fact()]);
    expect(contradictions).toEqual([]);
  });

  it('accepts a singular-dimension fact that matches the existing value (case/whitespace-insensitive)', () => {
    const model = emptyModel({ businessIdentity: { industry: 'retail' } });
    const { accepted, contradictions } = detectContradictions([fact({ value: 'Retail' })], model);

    expect(accepted).toHaveLength(1);
    expect(contradictions).toEqual([]);
  });

  it('flags — and excludes from accepted — a singular-dimension fact that conflicts with an existing different value', () => {
    const model = emptyModel({ businessIdentity: { industry: 'Hospital' } });
    const { accepted, contradictions } = detectContradictions([fact({ value: 'Retail' })], model);

    expect(accepted).toEqual([]);
    expect(contradictions).toEqual([
      expect.objectContaining({ dimension: 'industry', existingValue: 'Hospital', newValue: 'Retail' }),
    ]);
  });

  it('flags a businessVision contradiction', () => {
    const model = emptyModel({ businessIdentity: { vision: 'A booking app for dental clinics' } });
    const { contradictions } = detectContradictions(
      [fact({ dimension: 'businessVision', value: 'A marketplace for used cars' })],
      model,
    );

    expect(contradictions).toHaveLength(1);
  });

  it('never flags a list-shaped dimension as contradicting — always additive', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'] });
    const { accepted, contradictions } = detectContradictions(
      [fact({ dimension: 'targetUsers', value: 'Wholesale buyers' })],
      model,
    );

    expect(accepted).toHaveLength(1);
    expect(contradictions).toEqual([]);
  });

  it('never flags projectType — folds additively into vision, nothing singular to compare', () => {
    const model = emptyModel({ businessIdentity: { vision: 'An existing vision statement' } });
    const { accepted, contradictions } = detectContradictions(
      [fact({ dimension: 'projectType', value: 'Marketplace' })],
      model,
    );

    expect(accepted).toHaveLength(1);
    expect(contradictions).toEqual([]);
  });

  it('reads technicalPreferences from businessIdentity.formSnapshot, matching where the patch generator writes it', () => {
    const model = emptyModel({
      businessIdentity: { formSnapshot: { technicalPreferences: 'React and Postgres' } },
    });
    const { contradictions } = detectContradictions(
      [fact({ dimension: 'technicalPreferences', value: 'Vue and MySQL' })],
      model,
    );

    expect(contradictions).toHaveLength(1);
  });

  it('processes a mixed batch, accepting non-conflicting facts and flagging only the conflicting one', () => {
    const model = emptyModel({ businessIdentity: { industry: 'Hospital' } });
    const { accepted, contradictions } = detectContradictions(
      [fact({ dimension: 'industry', value: 'Retail' }), fact({ dimension: 'targetUsers', value: 'Shoppers' })],
      model,
    );

    expect(accepted).toEqual([fact({ dimension: 'targetUsers', value: 'Shoppers' })]);
    expect(contradictions).toHaveLength(1);
  });
});
