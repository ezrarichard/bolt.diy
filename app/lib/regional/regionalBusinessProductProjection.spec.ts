import { describe, expect, it } from 'vitest';
import {
  projectRegionalProfileForBusinessProduct,
  hasBusinessProductRegionalContent,
  describeSuppliedSections,
  formatBusinessProductRegionalGuidanceSection,
} from './regionalBusinessProductProjection';
import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

const FULL_PROFILE: RegionalProfile = {
  id: 'region-in',
  code: 'IN',
  name: 'India',
  countryCode: 'IN',
  version: 1,
  status: 'active',
  locale: 'en-IN',
  defaultCurrency: 'INR',
  defaultTimezone: 'Asia/Kolkata',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  phoneCountryCode: '+91',
  addressFormat: 'Flat/house, street, locality, city, state, 6-digit PIN.',
  taxTerminology: 'GST',
  taxGuidance: ['GST applies to commerce/invoicing when already approved.'],
  invoiceGuidance: ['Include GSTIN when invoicing is approved.'],
  privacyGuidance: ['Consider DPDPA.'],
  dataProtectionGuidance: ['Consider consent capture.'],
  accessibilityGuidance: ['Consider WCAG 2.1 AA.'],
  consumerProtectionGuidance: ['Clear return/refund terminology.'],
  paymentGuidance: ['UPI alongside cards.'],
  commerceGuidance: ['Use ₹ and Indian digit grouping.'],
  dataResidencyGuidance: ['Some sectors have localization expectations.'],
  deploymentGuidance: ['Consider nearby hosting region.'],
  complianceNotes: ['Applicable requirements depend on industry and customer type.'],
  sourceMetadata: { lastReviewed: '2026-07-25', disclaimer: 'Not legal advice.' },
};

const RECOMMENDED_RESOLUTION: RegionalResolutionResult = {
  regionalProfileId: 'region-in',
  regionalProfileCode: 'IN',
  regionalProfileVersion: 1,
  selectionSource: 'manual_override',
  sourceValue: 'IN',
  matchedCountry: 'India',
  resolvedAt: '2026-07-25T00:00:00.000Z',
  contentAvailable: true,
};

describe('projectRegionalProfileForBusinessProduct', () => {
  it('returns undefined for an undefined profile', () => {
    expect(projectRegionalProfileForBusinessProduct(undefined)).toBeUndefined();
  });

  it('includes only the 12 Business/Product-relevant fields, excluding engineering/design-only ones', () => {
    const projection = projectRegionalProfileForBusinessProduct(FULL_PROFILE);

    expect(projection?.locale).toBe('en-IN');
    expect(projection?.defaultCurrency).toBe('INR');
    expect(projection?.addressFormat).toBe(FULL_PROFILE.addressFormat);
    expect(projection?.phoneCountryCode).toBe('+91');
    expect(projection?.taxTerminology).toBe('GST');
    expect(projection?.taxGuidance).toEqual(FULL_PROFILE.taxGuidance);
    expect(projection?.invoiceGuidance).toEqual(FULL_PROFILE.invoiceGuidance);
    expect(projection?.privacyGuidance).toEqual(FULL_PROFILE.privacyGuidance);
    expect(projection?.consumerProtectionGuidance).toEqual(FULL_PROFILE.consumerProtectionGuidance);
    expect(projection?.paymentGuidance).toEqual(FULL_PROFILE.paymentGuidance);
    expect(projection?.commerceGuidance).toEqual(FULL_PROFILE.commerceGuidance);
    expect(projection?.complianceNotes).toEqual(FULL_PROFILE.complianceNotes);

    // Engineering/design-only fields must never appear
    expect((projection as Record<string, unknown>).defaultTimezone).toBeUndefined();
    expect((projection as Record<string, unknown>).dataResidencyGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).deploymentGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).accessibilityGuidance).toBeUndefined();
    expect((projection as Record<string, unknown>).dateFormat).toBeUndefined();
    expect((projection as Record<string, unknown>).timeFormat).toBeUndefined();
  });

  it('omits empty/absent sections rather than including them as empty arrays', () => {
    const sparse: RegionalProfile = { ...FULL_PROFILE, taxGuidance: [], invoiceGuidance: [] };
    const projection = projectRegionalProfileForBusinessProduct(sparse);

    expect(projection?.taxGuidance).toBeUndefined();
    expect(projection?.invoiceGuidance).toBeUndefined();
    expect(projection?.taxTerminology).toBe('GST');
  });

  it('does not mutate the source profile', () => {
    const copy = JSON.parse(JSON.stringify(FULL_PROFILE));
    projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    expect(FULL_PROFILE).toEqual(copy);
  });

  it('is deterministic', () => {
    const first = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    const second = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    expect(first).toEqual(second);
  });
});

describe('hasBusinessProductRegionalContent / describeSuppliedSections', () => {
  it('is false/empty for undefined', () => {
    expect(hasBusinessProductRegionalContent(undefined)).toBe(false);
    expect(describeSuppliedSections(undefined)).toEqual([]);
  });

  it('is true and lists sections once populated', () => {
    const projection = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    expect(hasBusinessProductRegionalContent(projection)).toBe(true);
    expect(describeSuppliedSections(projection)).toContain('taxTerminology');
  });
});

describe('formatBusinessProductRegionalGuidanceSection', () => {
  it('always states the scope-control instruction and legal-safety disclaimer', () => {
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, undefined);
    expect(text).toContain('does not authorize new features');
    expect(text).toContain('not legal advice');
  });

  it('falls back safely when no content is available', () => {
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, undefined);
    expect(text).toContain('No structured Regional Guidance is available');
  });

  it('labels a manual override', () => {
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, undefined);
    expect(text).toContain('manually selected by the user');
  });

  it('includes tax terminology only where present, gated by "already approved" language', () => {
    const projection = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, projection);

    expect(text).toContain('GST');
    expect(text).toContain('already approved');
  });

  it('includes invoice and privacy guidance', () => {
    const projection = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, projection);

    expect(text).toContain('GSTIN');
    expect(text).toContain('DPDPA');
  });

  it('retains the profile version indirectly via the resolution passed in', () => {
    expect(RECOMMENDED_RESOLUTION.regionalProfileVersion).toBe(1);
  });

  it('surfaces payment/commerce conventions gated by "already approved" language (PART 12 e-commerce scenario)', () => {
    const projection = projectRegionalProfileForBusinessProduct(FULL_PROFILE);
    const text = formatBusinessProductRegionalGuidanceSection('India', RECOMMENDED_RESOLUTION, projection);

    expect(text).toContain('Payment-method conventions (only where payments are already approved)');
    expect(text).toContain('UPI alongside cards.');
    expect(text).toContain('Commerce/pricing-display conventions (only where commerce is already approved)');
    expect(text).toContain('Indian digit grouping');
  });
});
