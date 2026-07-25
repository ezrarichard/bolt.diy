import { describe, expect, it } from 'vitest';
import { packageEngine } from './packageProfileRegistry';
import {
  projectPackageProfileForDesignQuality,
  hasDesignQualityPackageContent,
  describeDesignQualityPackageSuppliedSections,
  formatDesignQualityPackageGuidanceSection,
} from './packageDesignQualityProjection';
import type { PackageResolutionResult } from './packageResolutionTypes';

function makeResolution(overrides: Partial<PackageResolutionResult> = {}): PackageResolutionResult {
  return {
    packageProfileId: 'package-starter',
    packageProfileCode: 'STARTER',
    packageProfileVersion: 1,
    selectionSource: 'manual_override',
    sourceValue: 'STARTER',
    resolvedAt: '2026-07-25T00:00:00.000Z',
    contentAvailable: true,
    ...overrides,
  };
}

describe('packageDesignQualityProjection — Sprint 73', () => {
  it('projects UI/testing-depth-relevant fields', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const projection = projectPackageProfileForDesignQuality(profile);

    expect(projection?.uiQualityGuidance?.length).toBeGreaterThan(0);
    expect(projection?.testingGuidance?.length).toBeGreaterThan(0);
    expect(projection?.qaExitCriteria?.length).toBeGreaterThan(0);
  });

  it('returns undefined for an undefined profile', () => {
    expect(projectPackageProfileForDesignQuality(undefined)).toBeUndefined();
    expect(hasDesignQualityPackageContent(undefined)).toBe(false);
    expect(describeDesignQualityPackageSuppliedSections(undefined)).toEqual([]);
  });

  it('does not mutate the source profile', () => {
    const profile = packageEngine.getPackageProfile('STARTER')!;
    const before = JSON.stringify(profile);
    projectPackageProfileForDesignQuality(profile);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('output is deterministic', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const first = projectPackageProfileForDesignQuality(profile);
    const second = projectPackageProfileForDesignQuality(profile);
    expect(first).toEqual(second);
  });

  it('Starter guidance is proportionate — still passes the quality floor', () => {
    const profile = packageEngine.getPackageProfile('STARTER')!;
    const projection = projectPackageProfileForDesignQuality(profile);
    const text = formatDesignQualityPackageGuidanceSection(profile, makeResolution(), projection);

    expect(text).toContain('Minimum quality floor');
    expect(text).toContain('accessibility fundamentals');
  });

  it('Premium testing depth is stronger than Starter', () => {
    const starter = packageEngine.getPackageProfile('STARTER')!;
    const premium = packageEngine.getPackageProfile('PREMIUM')!;

    expect(premium.testingGuidance?.length ?? 0).toBeGreaterThanOrEqual(starter.testingGuidance?.length ?? 0);
  });

  it('the formatted section retains the package version/name context', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const projection = projectPackageProfileForDesignQuality(profile);
    const text = formatDesignQualityPackageGuidanceSection(
      profile,
      makeResolution({ packageProfileCode: 'PROFESSIONAL' }),
      projection,
    );

    expect(text).toContain('Professional');
  });

  it('no cross-family leakage — architectureGuidance/documentationGuidance are not part of this projection type', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForDesignQuality(profile);

    expect((projection as unknown as Record<string, unknown>).architectureGuidance).toBeUndefined();
    expect((projection as unknown as Record<string, unknown>).documentationGuidance).toBeUndefined();
  });
});
