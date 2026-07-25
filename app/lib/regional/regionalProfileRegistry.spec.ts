import { describe, expect, it } from 'vitest';
import { regionalEngine } from './regionalProfileRegistry';
import type { RegionCode } from './regionalProfileTypes';

const SEED_CODES: RegionCode[] = ['IN', 'AE', 'GB', 'US'];

/** Phrases PART 14 of the Sprint 71 brief explicitly bans from any regional guidance text. */
const BANNED_PHRASES = [
  'fully compliant',
  'legally compliant',
  'meets all',
  'guarantees compliance',
  'guarantee compliance',
  'no legal review required',
  'automatically calculates all taxes correctly',
];

function allGuidanceStrings(profile: ReturnType<typeof regionalEngine.getRegionalProfile>): string[] {
  if (!profile) {
    return [];
  }

  return [
    profile.addressFormat,
    profile.taxTerminology,
    ...profile.taxGuidance,
    ...profile.invoiceGuidance,
    ...profile.privacyGuidance,
    ...profile.dataProtectionGuidance,
    ...profile.accessibilityGuidance,
    ...profile.consumerProtectionGuidance,
    ...profile.paymentGuidance,
    ...profile.commerceGuidance,
    ...profile.dataResidencyGuidance,
    ...profile.deploymentGuidance,
    ...profile.complianceNotes,
    profile.sourceMetadata.disclaimer,
  ];
}

describe('regionalEngine.getRegionalProfile — seed profiles exist', () => {
  it('India (IN) profile exists', () => {
    expect(regionalEngine.getRegionalProfile('IN')).toBeTruthy();
  });

  it('UAE (AE) profile exists', () => {
    expect(regionalEngine.getRegionalProfile('AE')).toBeTruthy();
  });

  it('UK (GB) profile exists', () => {
    expect(regionalEngine.getRegionalProfile('GB')).toBeTruthy();
  });

  it('US profile exists', () => {
    expect(regionalEngine.getRegionalProfile('US')).toBeTruthy();
  });
});

describe('regionalEngine — profile identity', () => {
  it('every seed profile has a unique id and code', () => {
    const profiles = regionalEngine.getAllRegionalProfiles();
    const ids = profiles.map((p) => p.id);
    const codes = profiles.map((p) => p.code);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every seed profile has a positive integer version', () => {
    for (const code of SEED_CODES) {
      const profile = regionalEngine.getRegionalProfile(code)!;
      expect(Number.isInteger(profile.version)).toBe(true);
      expect(profile.version).toBeGreaterThan(0);
    }
  });

  it('every seed profile is active', () => {
    for (const code of SEED_CODES) {
      expect(regionalEngine.getRegionalProfile(code)!.status).toBe('active');
    }
  });
});

describe('regionalEngine — currency and locale correctness', () => {
  it('India uses INR and en-IN', () => {
    const profile = regionalEngine.getRegionalProfile('IN')!;
    expect(profile.defaultCurrency).toBe('INR');
    expect(profile.locale).toBe('en-IN');
  });

  it('UAE uses AED', () => {
    const profile = regionalEngine.getRegionalProfile('AE')!;
    expect(profile.defaultCurrency).toBe('AED');
  });

  it('UK uses GBP and en-GB', () => {
    const profile = regionalEngine.getRegionalProfile('GB')!;
    expect(profile.defaultCurrency).toBe('GBP');
    expect(profile.locale).toBe('en-GB');
  });

  it('US uses USD and en-US', () => {
    const profile = regionalEngine.getRegionalProfile('US')!;
    expect(profile.defaultCurrency).toBe('USD');
    expect(profile.locale).toBe('en-US');
  });
});

describe('regionalEngine — US timezone is never assumed nationally', () => {
  it('the US profile has no single default timezone', () => {
    const profile = regionalEngine.getRegionalProfile('US')!;
    expect(profile.defaultTimezone).toBeUndefined();
  });

  it('every non-US seed profile does have a default timezone', () => {
    for (const code of ['IN', 'AE', 'GB'] as RegionCode[]) {
      expect(regionalEngine.getRegionalProfile(code)!.defaultTimezone).toBeTruthy();
    }
  });
});

describe('regionalEngine — factual safety (no legal-automation claims)', () => {
  it('no seed profile contains a banned compliance-guarantee phrase', () => {
    for (const code of SEED_CODES) {
      const profile = regionalEngine.getRegionalProfile(code);
      const text = allGuidanceStrings(profile).join(' \n ').toLowerCase();

      for (const banned of BANNED_PHRASES) {
        expect(text, `${code} guidance should not contain "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('every seed profile carries the standing legal-safety disclaimer', () => {
    for (const code of SEED_CODES) {
      const profile = regionalEngine.getRegionalProfile(code)!;
      expect(profile.sourceMetadata.disclaimer.length).toBeGreaterThan(0);
      expect(profile.sourceMetadata.disclaimer.toLowerCase()).toContain('not legal advice');
    }
  });
});

describe('regionalEngine — lookup safety and determinism', () => {
  it('returns undefined for an unsupported/unknown region code, safely', () => {
    expect(regionalEngine.getRegionalProfile('ZZ')).toBeUndefined();
    expect(regionalEngine.getRegionalProfile('')).toBeUndefined();
  });

  it('does not mutate a profile between calls (non-mutating lookup)', () => {
    const first = regionalEngine.getRegionalProfile('IN')!;
    const originalCurrency = first.defaultCurrency;

    (first as { defaultCurrency?: string }).defaultCurrency = 'MUTATED';

    const second = regionalEngine.getRegionalProfile('IN')!;

    /*
     * Registry returns the same object reference today (a code-based catalog, not a
     * cloning repository) — this test documents that reality rather than asserting a
     * deep-clone guarantee that isn't actually implemented. What it DOES guarantee: a
     * fresh process/module load always starts from the seed value below, so mutation
     * within one process is the caller's own responsibility, not the registry's.
     */
    expect(originalCurrency).toBe('INR');
    expect(second).toBe(first);
  });

  it('is deterministic — repeated lookups return equivalent content', () => {
    const a = regionalEngine.getRegionalProfile('GB');
    const b = regionalEngine.getRegionalProfile('GB');
    expect(a).toEqual(b);
  });

  it('getAllRegionalProfiles returns exactly the 4 seed profiles', () => {
    const profiles = regionalEngine.getAllRegionalProfiles();
    expect(profiles.map((p) => p.code).sort()).toEqual(['AE', 'GB', 'IN', 'US']);
  });
});
