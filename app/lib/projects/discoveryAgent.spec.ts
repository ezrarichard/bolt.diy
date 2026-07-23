import { describe, expect, it } from 'vitest';
import { buildInterviewPatch, DISCOVERY_DIMENSION_ORDER, selectNextDimension } from './discoveryAgent';
import type { BusinessUnderstandingModel, DiscoveryDecision } from './requirementsSession';

function emptyModel(overrides: Partial<BusinessUnderstandingModel> = {}): BusinessUnderstandingModel {
  return {
    id: 'model-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    assessment: {},
    decision: {},
    businessIdentity: {},
    businessGoals: [],
    processes: [],
    targetUsers: [],
    painPoints: [],
    businessConstraints: [],
    currentSystems: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    openQuestions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectNextDimension', () => {
  it('returns the highest-weight dimension when nothing has been assessed yet', () => {
    expect(selectNextDimension({}, [])).toBe('businessVision');
  });

  it('returns null once the decision is READY, regardless of partialAreas', () => {
    const decision: DiscoveryDecision = { state: 'READY', partialAreas: ['technicalPreferences'] };
    expect(selectNextDimension(decision, [])).toBeNull();
  });

  it('prioritizes missingAreas over partialAreas, in weight order', () => {
    const decision: DiscoveryDecision = {
      state: 'NEEDS_MORE_INFORMATION',
      missingAreas: ['technicalPreferences', 'coreFeatures'],
      partialAreas: ['businessVision'],
    };
    expect(selectNextDimension(decision, [])).toBe('coreFeatures');
  });

  it('falls back to partialAreas once missingAreas is empty', () => {
    const decision: DiscoveryDecision = {
      state: 'NEEDS_MORE_INFORMATION',
      missingAreas: [],
      partialAreas: ['technicalPreferences', 'targetUsers'],
    };
    expect(selectNextDimension(decision, [])).toBe('targetUsers');
  });

  it('never re-selects a dimension already asked this session when an unasked one remains', () => {
    const decision: DiscoveryDecision = {
      state: 'NEEDS_MORE_INFORMATION',
      missingAreas: ['businessVision', 'coreFeatures'],
    };
    expect(selectNextDimension(decision, ['businessVision'])).toBe('coreFeatures');
  });

  it('falls back to re-asking rather than stalling when every candidate has already been asked', () => {
    const decision: DiscoveryDecision = { state: 'NEEDS_MORE_INFORMATION', missingAreas: ['businessVision'] };
    expect(selectNextDimension(decision, ['businessVision'])).toBe('businessVision');
  });

  it('returns null when there is nothing left to ask about', () => {
    const decision: DiscoveryDecision = { state: 'NEEDS_MORE_INFORMATION', missingAreas: [], partialAreas: [] };
    expect(selectNextDimension(decision, [])).toBeNull();
  });

  it('DISCOVERY_DIMENSION_ORDER contains every dimension exactly once', () => {
    expect(new Set(DISCOVERY_DIMENSION_ORDER).size).toBe(DISCOVERY_DIMENSION_ORDER.length);
    expect(DISCOVERY_DIMENSION_ORDER).toHaveLength(10);
  });
});

describe('buildInterviewPatch', () => {
  it('writes a businessVision answer into businessIdentity.vision', () => {
    const patch = buildInterviewPatch(emptyModel(), 'businessVision', '  A booking app for dental clinics  ');
    expect(patch.businessIdentity).toMatchObject({ vision: 'A booking app for dental clinics' });
  });

  it('appends (never replaces) a targetUsers answer onto the existing list', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'] });
    const patch = buildInterviewPatch(model, 'targetUsers', 'Wholesale buyers');
    expect(patch.targetUsers).toEqual(['Shop owners', 'Wholesale buyers']);
  });

  it('appends a coreFeatures answer onto functionalRequirements', () => {
    const model = emptyModel({ functionalRequirements: ['Product catalog'] });
    const patch = buildInterviewPatch(model, 'coreFeatures', 'Online checkout');
    expect(patch.functionalRequirements).toEqual(['Product catalog', 'Online checkout']);
  });

  it('routes integrations onto the same currentSystems field as currentSystems', () => {
    const model = emptyModel({ currentSystems: ['Existing POS'] });
    const patch = buildInterviewPatch(model, 'integrations', 'WhatsApp order notifications');
    expect(patch.currentSystems).toEqual(['Existing POS', 'WhatsApp order notifications']);
  });

  it('writes technicalPreferences into businessIdentity.formSnapshot.technicalPreferences', () => {
    const patch = buildInterviewPatch(emptyModel(), 'technicalPreferences', 'Prefer React and Postgres');

    expect(patch.businessIdentity).toMatchObject({
      formSnapshot: { technicalPreferences: 'Prefer React and Postgres' },
    });
  });

  it('never mutates the model it was given', () => {
    const model = emptyModel({ targetUsers: ['Shop owners'] });
    buildInterviewPatch(model, 'targetUsers', 'Wholesale buyers');
    expect(model.targetUsers).toEqual(['Shop owners']);
  });

  it('preserves prior businessIdentity fields when a different dimension is answered', () => {
    const model = emptyModel({ businessIdentity: { vision: 'A retail storefront' } });
    const patch = buildInterviewPatch(model, 'industry', 'Retail');
    expect(patch.businessIdentity).toMatchObject({ vision: 'A retail storefront', industry: 'Retail' });
  });
});
