import { describe, expect, it } from 'vitest';
import { packageEngine } from './packageProfileRegistry';
import {
  projectPackageProfileForBusinessProduct,
  hasBusinessProductPackageContent,
  describeBusinessProductPackageSuppliedSections,
  formatBusinessProductPackageGuidanceSection,
} from './packageBusinessProductProjection';
import type { PackageResolutionResult } from './packageResolutionTypes';

function makeResolution(overrides: Partial<PackageResolutionResult> = {}): PackageResolutionResult {
  return {
    packageProfileId: 'package-professional',
    packageProfileCode: 'PROFESSIONAL',
    packageProfileVersion: 1,
    selectionSource: 'manual_override',
    sourceValue: 'PROFESSIONAL',
    resolvedAt: '2026-07-25T00:00:00.000Z',
    contentAvailable: true,
    ...overrides,
  };
}

describe('packageBusinessProductProjection — Sprint 73', () => {
  it('projects delivery-positioning-relevant fields only', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const projection = projectPackageProfileForBusinessProduct(profile);

    expect(projection?.documentationGuidance?.length).toBeGreaterThan(0);
    expect(projection?.maintainabilityGuidance?.length).toBeGreaterThan(0);
    expect(projection?.supportGuidance?.length).toBeGreaterThan(0);
    expect(projection?.qaExitCriteria?.length).toBeGreaterThan(0);
  });

  it('returns undefined for an undefined profile', () => {
    expect(projectPackageProfileForBusinessProduct(undefined)).toBeUndefined();
    expect(hasBusinessProductPackageContent(undefined)).toBe(false);
    expect(describeBusinessProductPackageSuppliedSections(undefined)).toEqual([]);
  });

  it('does not mutate the source profile', () => {
    const profile = packageEngine.getPackageProfile('STARTER')!;
    const before = JSON.stringify(profile);
    projectPackageProfileForBusinessProduct(profile);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('output is deterministic', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const first = projectPackageProfileForBusinessProduct(profile);
    const second = projectPackageProfileForBusinessProduct(profile);
    expect(first).toEqual(second);
  });

  it('the formatted section always retains the scope-control instruction', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const projection = projectPackageProfileForBusinessProduct(profile);
    const text = formatBusinessProductPackageGuidanceSection(profile, makeResolution(), projection);

    expect(text).toContain('does not authorize new features, integrations, roles, or infrastructure');
  });

  it('the formatted section always retains the minimum quality floor', () => {
    const profile = packageEngine.getPackageProfile('STARTER')!;
    const projection = projectPackageProfileForBusinessProduct(profile);
    const text = formatBusinessProductPackageGuidanceSection(
      profile,
      makeResolution({ packageProfileCode: 'STARTER' }),
      projection,
    );

    expect(text).toContain('Minimum quality floor');

    for (const item of profile.qualityFloor) {
      expect(text).toContain(item);
    }
  });

  it('the formatted section always retains the package version context (via profile identity)', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForBusinessProduct(profile);
    const text = formatBusinessProductPackageGuidanceSection(
      profile,
      makeResolution({ packageProfileCode: 'PREMIUM' }),
      projection,
    );

    expect(text).toContain(profile.name);
  });

  it('renders "### Package Guidance" heading, never merged with Blueprint/Regional headings', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const projection = projectPackageProfileForBusinessProduct(profile);
    const text = formatBusinessProductPackageGuidanceSection(profile, makeResolution(), projection);

    expect(text).toContain('### Package Guidance');
    expect(text).not.toContain('### Blueprint Guidance');
    expect(text).not.toContain('### Regional Guidance');
  });

  it('Professional guidance is stronger/more numerous than Starter', () => {
    const starter = packageEngine.getPackageProfile('STARTER')!;
    const professional = packageEngine.getPackageProfile('PROFESSIONAL')!;

    expect(professional.documentationGuidance?.length ?? 0).toBeGreaterThanOrEqual(
      starter.documentationGuidance?.length ?? 0,
    );
  });

  it('no cross-family leakage — architecture/security fields are not part of this projection type', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForBusinessProduct(profile);

    expect((projection as unknown as Record<string, unknown>).architectureGuidance).toBeUndefined();
    expect((projection as unknown as Record<string, unknown>).securityGuidance).toBeUndefined();
  });
});
