import { describe, expect, it } from 'vitest';
import {
  projectRegionalProfileForArchitectureEngineering,
  hasArchitectureEngineeringRegionalContent,
  describeSuppliedSections,
  formatArchitectureEngineeringRegionalGuidanceSection,
} from './regionalArchitectureEngineeringProjection';
import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

const FULL_PROFILE: RegionalProfile = {
  id: 'region-us',
  code: 'US',
  name: 'United States',
  countryCode: 'US',
  version: 1,
  status: 'active',
  locale: 'en-US',
  defaultCurrency: 'USD',
  defaultTimezone: undefined,
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  phoneCountryCode: '+1',
  addressFormat: 'Street, city, 2-letter state, 5-digit ZIP.',
  taxTerminology: 'Sales tax (state-dependent)',
  taxGuidance: ['No single national rate.'],
  invoiceGuidance: ['Varies by state/industry.'],
  privacyGuidance: ['State- and sector-dependent.'],
  dataProtectionGuidance: ['Depends on states of operation.'],
  accessibilityGuidance: ['Consider WCAG 2.1 AA / ADA case law.'],
  consumerProtectionGuidance: ['State-dependent rules.'],
  paymentGuidance: ['Cards dominant.'],
  commerceGuidance: ['Tax-exclusive display common.'],
  dataResidencyGuidance: ['Sector-driven, not blanket.'],
  deploymentGuidance: ['Confirm project-specific timezone(s).'],
  complianceNotes: ['No single "US compliance" standard.'],
  sourceMetadata: { lastReviewed: '2026-07-25', disclaimer: 'Not legal advice.' },
};

const RESOLUTION: RegionalResolutionResult = {
  regionalProfileId: 'region-us',
  regionalProfileCode: 'US',
  regionalProfileVersion: 1,
  selectionSource: 'manual_override',
  sourceValue: 'US',
  matchedCountry: 'United States',
  resolvedAt: '2026-07-25T00:00:00.000Z',
  contentAvailable: true,
};

describe('projectRegionalProfileForArchitectureEngineering', () => {
  it('returns undefined for an undefined profile', () => {
    expect(projectRegionalProfileForArchitectureEngineering(undefined)).toBeUndefined();
  });

  it('includes only the 10 Architecture/Engineering-relevant fields, excluding business/design-only ones', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);

    expect(projection?.locale).toBe('en-US');
    expect(projection?.defaultCurrency).toBe('USD');
    expect(projection?.addressFormat).toBe(FULL_PROFILE.addressFormat);
    expect(projection?.phoneCountryCode).toBe('+1');
    expect(projection?.privacyGuidance).toEqual(FULL_PROFILE.privacyGuidance);
    expect(projection?.dataProtectionGuidance).toEqual(FULL_PROFILE.dataProtectionGuidance);
    expect(projection?.dataResidencyGuidance).toEqual(FULL_PROFILE.dataResidencyGuidance);
    expect(projection?.deploymentGuidance).toEqual(FULL_PROFILE.deploymentGuidance);
    expect(projection?.complianceNotes).toEqual(FULL_PROFILE.complianceNotes);

    // Business/design-only fields must never appear
    expect((projection as Record<string, unknown>).taxTerminology).toBeUndefined();
    expect((projection as Record<string, unknown>).taxGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).invoiceGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).dateFormat).toBeUndefined();
    expect((projection as Record<string, unknown>).timeFormat).toBeUndefined();
    expect((projection as Record<string, unknown>).accessibilityGuidance).toBeUndefined();
  });

  it('the US profile projects with no defaultTimezone (never assumed nationally)', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    expect(projection?.defaultTimezone).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: RegionalProfile = { ...FULL_PROFILE, deploymentGuidance: [] };
    const projection = projectRegionalProfileForArchitectureEngineering(sparse);
    expect(projection?.deploymentGuidance).toBeUndefined();
  });

  it('does not mutate the source profile', () => {
    const copy = JSON.parse(JSON.stringify(FULL_PROFILE));
    projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    expect(FULL_PROFILE).toEqual(copy);
  });

  it('is deterministic', () => {
    const first = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    const second = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    expect(first).toEqual(second);
  });
});

describe('hasArchitectureEngineeringRegionalContent / describeSuppliedSections', () => {
  it('is false/empty for undefined', () => {
    expect(hasArchitectureEngineeringRegionalContent(undefined)).toBe(false);
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });

  it('is true once populated', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    expect(hasArchitectureEngineeringRegionalContent(projection)).toBe(true);
  });
});

describe('formatArchitectureEngineeringRegionalGuidanceSection', () => {
  it('always states the scope-control instruction', () => {
    const text = formatArchitectureEngineeringRegionalGuidanceSection('United States', RESOLUTION, undefined);
    expect(text).toContain('never authorizes new infrastructure');
  });

  it('surfaces an explicit "confirm project-specific timezone" note when no default timezone exists', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    const text = formatArchitectureEngineeringRegionalGuidanceSection('United States', RESOLUTION, projection);

    expect(text).toContain('confirm the project-specific operating timezone');
  });

  it('frames data-residency guidance as advisory only', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    const text = formatArchitectureEngineeringRegionalGuidanceSection('United States', RESOLUTION, projection);

    expect(text).toContain('advisory only');
    expect(text).toContain('Sector-driven, not blanket.');
  });

  it('includes deployment considerations', () => {
    const projection = projectRegionalProfileForArchitectureEngineering(FULL_PROFILE);
    const text = formatArchitectureEngineeringRegionalGuidanceSection('United States', RESOLUTION, projection);

    expect(text).toContain('Deployment considerations');
  });
});
