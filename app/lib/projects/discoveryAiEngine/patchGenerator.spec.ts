import { describe, expect, it } from 'vitest';
import { generatePatch } from './patchGenerator';
import type { ExtractedFact } from './types';
import { emptyModel } from './testFixtures';

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

describe('generatePatch', () => {
  it('writes a businessVision fact into businessIdentity.vision', () => {
    const patch = generatePatch(emptyModel(), [fact({ dimension: 'businessVision', value: 'A retail storefront' })]);
    expect(patch.businessIdentity).toMatchObject({ vision: 'A retail storefront' });
  });

  it('appends (never replaces) a targetUsers fact onto the existing list', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'] });
    const patch = generatePatch(model, [fact({ dimension: 'targetUsers', value: 'Wholesale buyers' })]);
    expect(patch.targetUsers).toEqual(['Shop owners', 'Wholesale buyers']);
  });

  it('applies multiple facts from a single turn across different dimensions in one patch', () => {
    const patch = generatePatch(emptyModel(), [
      fact({ dimension: 'targetUsers', value: 'Shop owners' }),
      fact({ dimension: 'coreFeatures', value: 'Online booking' }),
      fact({ dimension: 'industry', value: 'Retail' }),
    ]);

    expect(patch.targetUsers).toEqual(['Shop owners']);
    expect(patch.functionalRequirements).toEqual(['Online booking']);
    expect(patch.businessIdentity).toMatchObject({ industry: 'Retail' });
  });

  it('folds a projectType fact additively into businessIdentity.vision', () => {
    const model = emptyModel({ businessIdentity: { vision: 'A simple online store' } });
    const patch = generatePatch(model, [fact({ dimension: 'projectType', value: 'Marketplace' })]);
    expect(patch.businessIdentity).toMatchObject({ vision: 'A simple online store Marketplace' });
  });

  it('writes technicalPreferences into businessIdentity.formSnapshot.technicalPreferences', () => {
    const patch = generatePatch(emptyModel(), [
      fact({ dimension: 'technicalPreferences', value: 'Prefer React and Postgres' }),
    ]);
    expect(patch.businessIdentity).toMatchObject({
      formSnapshot: { technicalPreferences: 'Prefer React and Postgres' },
    });
  });

  it('routes integrations onto the same currentSystems field as currentSystems', () => {
    const model = emptyModel({ currentSystems: ['Existing POS'] });
    const patch = generatePatch(model, [fact({ dimension: 'integrations', value: 'WhatsApp notifications' })]);
    expect(patch.currentSystems).toEqual(['Existing POS', 'WhatsApp notifications']);
  });

  it('never mutates the model it was given', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'] });
    generatePatch(model, [fact({ dimension: 'targetUsers', value: 'Wholesale buyers' })]);
    expect(model.targetUsers).toEqual(['Shop owners']);
  });

  it('returns the unchanged current state when given no accepted facts', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'], businessIdentity: { industry: 'Retail' } });
    const patch = generatePatch(model, []);
    expect(patch.targetUsers).toEqual(['Shop owners']);
    expect(patch.businessIdentity).toMatchObject({ industry: 'Retail' });
  });
});
