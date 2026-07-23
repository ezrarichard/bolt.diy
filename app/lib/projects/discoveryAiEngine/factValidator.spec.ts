import { describe, expect, it } from 'vitest';
import { validateCandidateFacts } from './factValidator';

describe('validateCandidateFacts', () => {
  it('accepts a well-formed candidate for a known dimension', () => {
    const { valid, rejected } = validateCandidateFacts([{ dimension: 'targetUsers', value: 'Shop owners' }]);

    expect(valid).toEqual([{ dimension: 'targetUsers', value: 'Shop owners' }]);
    expect(rejected).toEqual([]);
  });

  it('rejects a candidate for an unsupported/hallucinated dimension name', () => {
    const { valid, rejected } = validateCandidateFacts([{ dimension: 'favoriteColor', value: 'Blue' }]);

    expect(valid).toEqual([]);
    expect(rejected).toEqual([
      { candidate: { dimension: 'favoriteColor', value: 'Blue' }, reason: 'unsupported_dimension' },
    ]);
  });

  it('rejects an empty or whitespace-only value', () => {
    const { valid, rejected } = validateCandidateFacts([
      { dimension: 'industry', value: '' },
      { dimension: 'industry', value: '   ' },
    ]);

    expect(valid).toEqual([]);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === 'empty_value')).toBe(true);
  });

  it('rejects a duplicate (dimension, value) pair within the same batch, case-insensitively', () => {
    const { valid, rejected } = validateCandidateFacts([
      { dimension: 'industry', value: 'Retail' },
      { dimension: 'industry', value: 'retail' },
    ]);

    expect(valid).toEqual([{ dimension: 'industry', value: 'Retail' }]);
    expect(rejected).toEqual([{ candidate: { dimension: 'industry', value: 'retail' }, reason: 'duplicate' }]);
  });

  it('trims the value on the way through', () => {
    const { valid } = validateCandidateFacts([{ dimension: 'businessVision', value: '  A retail storefront  ' }]);

    expect(valid).toEqual([{ dimension: 'businessVision', value: 'A retail storefront' }]);
  });

  it('handles an empty candidate list without throwing', () => {
    expect(validateCandidateFacts([])).toEqual({ valid: [], rejected: [] });
  });

  it('accepts every one of the ten real dimensions', () => {
    const dimensions = [
      'businessVision',
      'targetUsers',
      'coreFeatures',
      'industry',
      'businessAssessment',
      'projectType',
      'businessConstraints',
      'currentSystems',
      'integrations',
      'technicalPreferences',
    ];

    const { valid, rejected } = validateCandidateFacts(dimensions.map((dimension) => ({ dimension, value: 'x' })));

    expect(valid).toHaveLength(dimensions.length);
    expect(rejected).toEqual([]);
  });
});
