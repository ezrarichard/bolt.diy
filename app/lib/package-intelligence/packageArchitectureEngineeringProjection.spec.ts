import { describe, expect, it } from 'vitest';
import { packageEngine } from './packageProfileRegistry';
import {
  projectPackageProfileForArchitectureEngineering,
  hasArchitectureEngineeringPackageContent,
  describeArchitectureEngineeringPackageSuppliedSections,
  formatArchitectureEngineeringPackageGuidanceSection,
} from './packageArchitectureEngineeringProjection';
import type { PackageResolutionResult } from './packageResolutionTypes';

function makeResolution(overrides: Partial<PackageResolutionResult> = {}): PackageResolutionResult {
  return {
    packageProfileId: 'package-premium',
    packageProfileCode: 'PREMIUM',
    packageProfileVersion: 1,
    selectionSource: 'manual_override',
    sourceValue: 'PREMIUM',
    resolvedAt: '2026-07-25T00:00:00.000Z',
    contentAvailable: true,
    ...overrides,
  };
}

describe('packageArchitectureEngineeringProjection — Sprint 73', () => {
  it('projects technical-maturity-relevant fields', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForArchitectureEngineering(profile);

    expect(projection?.architectureGuidance?.length).toBeGreaterThan(0);
    expect(projection?.securityGuidance?.length).toBeGreaterThan(0);
    expect(projection?.scalabilityGuidance?.length).toBeGreaterThan(0);
    expect(projection?.observabilityGuidance?.length).toBeGreaterThan(0);
    expect(projection?.deploymentGuidance?.length).toBeGreaterThan(0);
  });

  it('returns undefined for an undefined profile', () => {
    expect(projectPackageProfileForArchitectureEngineering(undefined)).toBeUndefined();
    expect(hasArchitectureEngineeringPackageContent(undefined)).toBe(false);
    expect(describeArchitectureEngineeringPackageSuppliedSections(undefined)).toEqual([]);
  });

  it('does not mutate the source profile', () => {
    const profile = packageEngine.getPackageProfile('STARTER')!;
    const before = JSON.stringify(profile);
    projectPackageProfileForArchitectureEngineering(profile);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('output is deterministic', () => {
    const profile = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const first = projectPackageProfileForArchitectureEngineering(profile);
    const second = projectPackageProfileForArchitectureEngineering(profile);
    expect(first).toEqual(second);
  });

  it('the formatted section retains the scope-control instruction and quality floor', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForArchitectureEngineering(profile);
    const text = formatArchitectureEngineeringPackageGuidanceSection(profile, makeResolution(), projection);

    expect(text).toContain('does not authorize new features');
    expect(text).toContain('Minimum quality floor');
  });

  it('Premium guidance does not automatically require enterprise-only technology', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForArchitectureEngineering(profile);
    const text = formatArchitectureEngineeringPackageGuidanceSection(
      profile,
      makeResolution(),
      projection,
    ).toLowerCase();

    expect(text).toMatch(/does not automatically require microservices|does not automatically require kubernetes/);
  });

  it('Premium guidance is stronger than Professional (more architecture/security guidance)', () => {
    const professional = packageEngine.getPackageProfile('PROFESSIONAL')!;
    const premium = packageEngine.getPackageProfile('PREMIUM')!;

    expect(premium.securityGuidance?.length ?? 0).toBeGreaterThanOrEqual(professional.securityGuidance?.length ?? 0);
    expect(premium.observabilityGuidance?.length ?? 0).toBeGreaterThanOrEqual(
      professional.observabilityGuidance?.length ?? 0,
    );
  });

  it('no cross-family leakage — uiQualityGuidance/qaExitCriteria are not part of this projection type', () => {
    const profile = packageEngine.getPackageProfile('PREMIUM')!;
    const projection = projectPackageProfileForArchitectureEngineering(profile);

    expect((projection as unknown as Record<string, unknown>).uiQualityGuidance).toBeUndefined();
    expect((projection as unknown as Record<string, unknown>).qaExitCriteria).toBeUndefined();
  });
});
