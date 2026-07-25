import { describe, expect, it } from 'vitest';
import {
  projectRegionalProfileForDesignQuality,
  hasDesignQualityRegionalContent,
  describeSuppliedSections,
  formatDesignQualityRegionalGuidanceSection,
} from './regionalDesignQualityProjection';
import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

const FULL_PROFILE: RegionalProfile = {
  id: 'region-gb',
  code: 'GB',
  name: 'United Kingdom',
  countryCode: 'GB',
  version: 1,
  status: 'active',
  locale: 'en-GB',
  defaultCurrency: 'GBP',
  defaultTimezone: 'Europe/London',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  phoneCountryCode: '+44',
  addressFormat: 'Line 1/2, town/city, county optional, postcode.',
  taxTerminology: 'VAT',
  taxGuidance: ['VAT applies where relevant.'],
  invoiceGuidance: ['Show VAT number.'],
  privacyGuidance: ['UK GDPR / DPA 2018.'],
  dataProtectionGuidance: ['Lawful basis and consent.'],
  accessibilityGuidance: ['WCAG 2.1 AA — PSBAR reference.'],
  consumerProtectionGuidance: ['Consumer Rights Act 2015.'],
  paymentGuidance: ['Cards and open banking.'],
  commerceGuidance: ['VAT-inclusive display common.'],
  dataResidencyGuidance: ['International transfer considerations.'],
  deploymentGuidance: ['UK/EU hosting if latency matters.'],
  complianceNotes: ['Cookie/consent (PECR) only if relevant.'],
  sourceMetadata: { lastReviewed: '2026-07-25', disclaimer: 'Not legal advice.' },
};

const RESOLUTION: RegionalResolutionResult = {
  regionalProfileId: 'region-gb',
  regionalProfileCode: 'GB',
  regionalProfileVersion: 1,
  selectionSource: 'manual_override',
  sourceValue: 'GB',
  matchedCountry: 'United Kingdom',
  resolvedAt: '2026-07-25T00:00:00.000Z',
  contentAvailable: true,
};

describe('projectRegionalProfileForDesignQuality', () => {
  it('returns undefined for an undefined profile', () => {
    expect(projectRegionalProfileForDesignQuality(undefined)).toBeUndefined();
  });

  it('includes only the 10 Design/Quality-relevant fields, excluding business/engineering-only ones', () => {
    const projection = projectRegionalProfileForDesignQuality(FULL_PROFILE);

    expect(projection?.dateFormat).toBe('DD/MM/YYYY');
    expect(projection?.timeFormat).toBe('24h');
    expect(projection?.defaultCurrency).toBe('GBP');
    expect(projection?.addressFormat).toBe(FULL_PROFILE.addressFormat);
    expect(projection?.phoneCountryCode).toBe('+44');
    expect(projection?.accessibilityGuidance).toEqual(FULL_PROFILE.accessibilityGuidance);
    expect(projection?.privacyGuidance).toEqual(FULL_PROFILE.privacyGuidance);
    expect(projection?.consumerProtectionGuidance).toEqual(FULL_PROFILE.consumerProtectionGuidance);
    expect(projection?.complianceNotes).toEqual(FULL_PROFILE.complianceNotes);

    // Business/engineering-only fields must never appear
    expect((projection as Record<string, unknown>).taxTerminology).toBeUndefined();
    expect((projection as Record<string, unknown>).taxGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).invoiceGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).defaultTimezone).toBeUndefined();
    expect((projection as Record<string, unknown>).dataResidencyGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentGuidance).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: RegionalProfile = { ...FULL_PROFILE, accessibilityGuidance: [] };
    const projection = projectRegionalProfileForDesignQuality(sparse);
    expect(projection?.accessibilityGuidance).toBeUndefined();
  });

  it('does not mutate the source profile', () => {
    const copy = JSON.parse(JSON.stringify(FULL_PROFILE));
    projectRegionalProfileForDesignQuality(FULL_PROFILE);
    expect(FULL_PROFILE).toEqual(copy);
  });

  it('is deterministic', () => {
    const first = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    const second = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    expect(first).toEqual(second);
  });
});

describe('hasDesignQualityRegionalContent / describeSuppliedSections', () => {
  it('is false/empty for undefined', () => {
    expect(hasDesignQualityRegionalContent(undefined)).toBe(false);
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });

  it('is true once populated', () => {
    const projection = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    expect(hasDesignQualityRegionalContent(projection)).toBe(true);
  });
});

describe('formatDesignQualityRegionalGuidanceSection', () => {
  it('always states the scope-control instruction and legal-safety wording', () => {
    const text = formatDesignQualityRegionalGuidanceSection('United Kingdom', RESOLUTION, undefined);
    expect(text).toContain('never authorizes new screens, flows, consent interactions');
    expect(text).toContain('not legal advice');
  });

  it('includes date/time/currency formatting', () => {
    const projection = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    const text = formatDesignQualityRegionalGuidanceSection('United Kingdom', RESOLUTION, projection);

    expect(text).toContain('DD/MM/YYYY');
    expect(text).toContain('GBP');
  });

  it('includes accessibility guidance', () => {
    const projection = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    const text = formatDesignQualityRegionalGuidanceSection('United Kingdom', RESOLUTION, projection);

    expect(text).toContain('WCAG 2.1 AA');
  });

  it('gates consumer/consent guidance behind "only where relevant capability is approved"', () => {
    const projection = projectRegionalProfileForDesignQuality(FULL_PROFILE);
    const text = formatDesignQualityRegionalGuidanceSection('United Kingdom', RESOLUTION, projection);

    expect(text).toContain('only where relevant capability is approved');
  });
});
