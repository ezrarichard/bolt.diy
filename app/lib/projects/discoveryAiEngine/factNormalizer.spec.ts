import { describe, expect, it } from 'vitest';
import { normalizeCandidateFact } from './factNormalizer';

describe('normalizeCandidateFact', () => {
  it.each([
    ['Clinic', 'Dental Clinic'],
    ['Dental Clinic', 'Dental Clinic'],
    ['dentist', 'Dental Clinic'],
    ['Hospital', 'Hospital'],
    ['shop', 'Retail'],
    ['boutique', 'Retail'],
    ['cafe', 'Restaurant'],
  ])('normalizes industry synonym %s -> %s', (raw, expected) => {
    expect(normalizeCandidateFact({ dimension: 'industry', value: raw })).toEqual({
      dimension: 'industry',
      value: expected,
    });
  });

  it('leaves an industry value with no known synonym untouched (beyond whitespace cleanup)', () => {
    expect(normalizeCandidateFact({ dimension: 'industry', value: '  Aerospace  Manufacturing ' })).toEqual({
      dimension: 'industry',
      value: 'Aerospace Manufacturing',
    });
  });

  it('applies only the default whitespace-collapse normalizer to dimensions with no synonym table', () => {
    expect(normalizeCandidateFact({ dimension: 'targetUsers', value: '  Shop   owners  ' })).toEqual({
      dimension: 'targetUsers',
      value: 'Shop owners',
    });
  });

  it('never mutates the input candidate', () => {
    const candidate = { dimension: 'industry', value: 'Clinic' };
    normalizeCandidateFact(candidate);
    expect(candidate.value).toBe('Clinic');
  });
});
