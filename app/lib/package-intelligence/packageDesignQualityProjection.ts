import type { PackageProfile } from './packageProfileTypes';
import type { PackageResolutionResult } from './packageResolutionTypes';

/**
 * Package Profile → Design/Quality Projection — Sprint 73 (Package Intelligence Foundation).
 *
 * Role family: UI/UX Designer, QA Engineer. Sibling of `packageBusinessProductProjection.ts` and
 * `packageArchitectureEngineeringProjection.ts` — this family cares about UI polish/accessibility
 * depth, testing depth, and QA exit criteria.
 *
 * Explicitly excluded: engineering-level concerns (architecture, scalability, deployment) that
 * belong to the Architecture/Engineering family, and delivery-positioning/documentation-for-
 * stakeholders concerns that belong to the Business/Product family.
 *
 * Pure, synchronous, side-effect-free — `buildersDbContextProvider.ts` does the actual
 * `getEffectivePackageSelection`/`packageEngine.getPackageProfile` lookups; this file only
 * shapes and formats what it's given.
 */

export interface DesignQualityPackageContext {
  uiQualityGuidance?: PackageProfile['uiQualityGuidance'];
  testingGuidance?: PackageProfile['testingGuidance'];
  qaExitCriteria?: PackageProfile['qaExitCriteria'];
}

const PROJECTED_SECTION_KEYS = [
  'uiQualityGuidance',
  'testingGuidance',
  'qaExitCriteria',
] as const satisfies readonly (keyof DesignQualityPackageContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Projects the full `PackageProfile` (or `undefined`) down to the Design/Quality-relevant fields. Deterministic and non-mutating. */
export function projectPackageProfileForDesignQuality(
  profile: PackageProfile | undefined,
): DesignQualityPackageContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: DesignQualityPackageContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasDesignQualityPackageContent(projection: DesignQualityPackageContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeDesignQualityPackageSuppliedSections(
  projection: DesignQualityPackageContext | undefined,
): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready "### Package Guidance" text block. Always carries
 * the scope-control instruction, delivery positioning, explicit exclusions, and the shared
 * minimum quality floor — never conditional on which family-specific sections happen to be
 * populated.
 */
export function formatDesignQualityPackageGuidanceSection(
  profile: PackageProfile,
  resolution: PackageResolutionResult,
  projection: DesignQualityPackageContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override' ? 'manually selected by the user' : resolution.selectionSource;

  const header = `### Package Guidance (Advisory) — ${profile.name} (${selectionLabel})`;

  const instruction =
    'Package Guidance controls implementation depth and delivery maturity for already-approved product scope. It does not authorize new features, integrations, roles, or infrastructure beyond approved upstream decisions — apply it only to scope that is already approved.';

  const positioning = `Delivery positioning: ${profile.deliveryPositioning}`;

  const sections: string[] = [positioning];

  if (projection?.uiQualityGuidance?.length) {
    sections.push(
      `UI polish and accessibility depth:\n${projection.uiQualityGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.testingGuidance?.length) {
    sections.push(`Testing depth:\n${projection.testingGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.qaExitCriteria?.length) {
    sections.push(`QA exit criteria:\n${projection.qaExitCriteria.map((g) => `- ${g}`).join('\n')}`);
  }

  const qualityFloor = `Minimum quality floor (applies to every package, including Starter):\n${profile.qualityFloor.map((g) => `- ${g}`).join('\n')}`;

  const exclusions = `This package explicitly does not authorize:\n${profile.exclusions.map((g) => `- ${g}`).join('\n')}`;

  return [header, instruction, ...sections, qualityFloor, exclusions].join('\n\n');
}
