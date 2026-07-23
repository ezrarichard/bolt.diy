import { describe, expect, it } from 'vitest';
import { formatDimensionLabel, resolveBusinessDiscoveryDisplay } from './businessDiscoveryDisplay';
import type { DiscoveryIntelligenceState } from '~/lib/hooks/useDiscoveryIntelligence';
import type { BusinessUnderstandingModel, RequirementsSession } from '~/lib/projects/requirementsSession';

function readyState(
  modelOverrides: Partial<BusinessUnderstandingModel> = {},
  sessionOverrides: Partial<RequirementsSession> = {},
): DiscoveryIntelligenceState {
  return {
    status: 'ready',
    session: { id: 'session-1', assessmentConfidence: 'high', ...sessionOverrides } as RequirementsSession,
    model: {
      id: 'model-1',
      assessment: {},
      decision: {},
      ...modelOverrides,
    } as BusinessUnderstandingModel,
  };
}

describe('formatDimensionLabel', () => {
  it('maps every Sprint 54 dimension to its exact requested human-readable label', () => {
    expect(formatDimensionLabel('targetUsers')).toBe('Target Users');
    expect(formatDimensionLabel('coreFeatures')).toBe('Core Features');
    expect(formatDimensionLabel('currentSystems')).toBe('Current Systems');
    expect(formatDimensionLabel('businessVision')).toBe('Business Vision');
    expect(formatDimensionLabel('industry')).toBe('Industry');
    expect(formatDimensionLabel('businessAssessment')).toBe('Business Assessment');
    expect(formatDimensionLabel('projectType')).toBe('Project Type');
    expect(formatDimensionLabel('businessConstraints')).toBe('Business Constraints');
    expect(formatDimensionLabel('integrations')).toBe('Integrations');
    expect(formatDimensionLabel('technicalPreferences')).toBe('Technical Preferences');
  });

  it('falls back to a generic camelCase splitter for an unrecognized dimension', () => {
    expect(formatDimensionLabel('someNewDimension')).toBe('Some New Dimension');
  });
});

describe('resolveBusinessDiscoveryDisplay', () => {
  it('hides the card entirely when BuildersDB is unavailable', () => {
    expect(resolveBusinessDiscoveryDisplay({ status: 'unavailable' })).toEqual({ kind: 'hidden' });
  });

  it('shows a loading state while fetching', () => {
    expect(resolveBusinessDiscoveryDisplay({ status: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('shows the neutral legacy message for no-session, no-model, and error alike — never an error', () => {
    const expected = {
      kind: 'empty',
      message: 'Discovery intelligence will be available after the Requirements form is saved.',
    };

    expect(resolveBusinessDiscoveryDisplay({ status: 'no-session' })).toEqual(expected);
    expect(resolveBusinessDiscoveryDisplay({ status: 'no-model' })).toEqual(expected);
    expect(resolveBusinessDiscoveryDisplay({ status: 'error', message: 'network down' })).toEqual(expected);
  });

  it('shows the empty-decision message when the model exists but decision has not been computed', () => {
    expect(resolveBusinessDiscoveryDisplay(readyState({ decision: {} }))).toEqual({
      kind: 'empty',
      message: 'Discovery decision has not been calculated yet.',
    });
  });

  it('maps READY to the "Ready" label/badge with a 100% score and Yes for ready-for-draft', () => {
    const display = resolveBusinessDiscoveryDisplay(
      readyState({
        assessment: {
          classification: 'Hospital',
          industry: 'Hospital',
          maturity: 'Growing Digital',
          projectType: 'Portal',
        },
        decision: {
          state: 'READY',
          completenessScore: 100,
          overallConfidence: 'high',
          readyForRequirementsDraft: true,
          missingAreas: [],
          partialAreas: [],
        },
      }),
    );

    expect(display.kind).toBe('ready');

    if (display.kind === 'ready') {
      expect(display.stateMeta.label).toBe('Ready');
      expect(display.completenessScore).toBe(100);
      expect(display.overallConfidence?.label).toBe('High');
      expect(display.readyForRequirementsDraft.label).toBe('Yes');
      expect(display.classification).toBe('Hospital');
      expect(display.maturity).toBe('Growing Digital');
      expect(display.projectType).toBe('Portal');
      expect(display.missingAreaLabels).toEqual([]);
      expect(display.partialAreaLabels).toEqual([]);
    }
  });

  it('maps NEEDS_MORE_INFORMATION to "Needs More Information" with human-readable missing/partial area labels', () => {
    const display = resolveBusinessDiscoveryDisplay(
      readyState({
        decision: {
          state: 'NEEDS_MORE_INFORMATION',
          completenessScore: 29,
          overallConfidence: 'low',
          readyForRequirementsDraft: false,
          missingAreas: ['businessVision', 'currentSystems'],
          partialAreas: ['targetUsers', 'coreFeatures'],
        },
      }),
    );

    expect(display.kind).toBe('ready');

    if (display.kind === 'ready') {
      expect(display.stateMeta.label).toBe('Needs More Information');
      expect(display.completenessScore).toBe(29);
      expect(display.readyForRequirementsDraft.label).toBe('No');
      expect(display.missingAreaLabels).toEqual(['Business Vision', 'Current Systems']);
      expect(display.partialAreaLabels).toEqual(['Target Users', 'Core Features']);
    }
  });

  it('maps INSUFFICIENT_INFORMATION to "Insufficient Information" with a 0% score', () => {
    const display = resolveBusinessDiscoveryDisplay(
      readyState({
        decision: {
          state: 'INSUFFICIENT_INFORMATION',
          completenessScore: 0,
          overallConfidence: 'low',
          readyForRequirementsDraft: false,
          missingAreas: ['businessVision', 'targetUsers', 'coreFeatures'],
          partialAreas: [],
        },
      }),
    );

    expect(display.kind).toBe('ready');

    if (display.kind === 'ready') {
      expect(display.stateMeta.label).toBe('Insufficient Information');
      expect(display.completenessScore).toBe(0);
      expect(display.missingAreaLabels).toHaveLength(3);
    }
  });

  it('leaves an assessment field undefined (never fabricated) when the model has no value for it', () => {
    const display = resolveBusinessDiscoveryDisplay(
      readyState({
        assessment: {},
        decision: { state: 'NEEDS_MORE_INFORMATION', completenessScore: 25, missingAreas: [], partialAreas: [] },
      }),
    );

    expect(display.kind).toBe('ready');

    if (display.kind === 'ready') {
      expect(display.classification).toBeUndefined();
      expect(display.industry).toBeUndefined();
      expect(display.maturity).toBeUndefined();
      expect(display.projectType).toBeUndefined();
    }
  });

  it("reads Assessment Confidence from the session, distinct from Discovery Decision's Overall Confidence", () => {
    const display = resolveBusinessDiscoveryDisplay(
      readyState(
        { decision: { state: 'READY', overallConfidence: 'high', missingAreas: [], partialAreas: [] } },
        { assessmentConfidence: 'medium' },
      ),
    );

    expect(display.kind).toBe('ready');

    if (display.kind === 'ready') {
      expect(display.assessmentConfidence?.label).toBe('Medium');
      expect(display.overallConfidence?.label).toBe('High');
    }
  });
});
