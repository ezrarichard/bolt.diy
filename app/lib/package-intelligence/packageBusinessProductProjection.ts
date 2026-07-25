import type { PackageProfile } from './packageProfileTypes';
import type { PackageResolutionResult } from './packageResolutionTypes';

/**
 * Package Profile → Business/Product Projection — Sprint 73 (Package Intelligence Foundation).
 *
 * Role family: Business Analyst, Product Owner. Sibling of
 * `packageArchitectureEngineeringProjection.ts` and `packageDesignQualityProjection.ts` —
 * deliberately a SEPARATE, dedicated projection rather than injecting the full `PackageProfile`
 * into every role (PART 7 of the Sprint 73 brief). This family cares about delivery positioning,
 * scope discipline, documentation expectations, operational maturity, acceptance depth, and
 * maintainability expectations a business/product role needs to write scope correctly.
 *
 * Explicitly excluded: engineering-level depth (architecture, security, scalability,
 * observability, deployment) that belongs to the Architecture/Engineering family, and UI/testing
 * depth that belongs to the Design/Quality family — per PART 7's "ensure each role receives only
 * relevant guidance."
 *
 * Pure, synchronous, side-effect-free — `buildersDbContextProvider.ts` (the orchestration layer)
 * does the actual `getEffectivePackageSelection`/`packageEngine.getPackageProfile` lookups; this
 * file only shapes and formats what it's given.
 */

export interface BusinessProductPackageContext {
  documentationGuidance?: PackageProfile['documentationGuidance'];
  maintainabilityGuidance?: PackageProfile['maintainabilityGuidance'];
  supportGuidance?: PackageProfile['supportGuidance'];
  qaExitCriteria?: PackageProfile['qaExitCriteria'];
}

const PROJECTED_SECTION_KEYS = [
  'documentationGuidance',
  'maintainabilityGuidance',
  'supportGuidance',
  'qaExitCriteria',
] as const satisfies readonly (keyof BusinessProductPackageContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Projects the full `PackageProfile` (or `undefined`) down to the Business/Product-relevant fields. Deterministic and non-mutating — a section absent from the source is simply absent here too. */
export function projectPackageProfileForBusinessProduct(
  profile: PackageProfile | undefined,
): BusinessProductPackageContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: BusinessProductPackageContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasBusinessProductPackageContent(projection: BusinessProductPackageContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeBusinessProductPackageSuppliedSections(
  projection: BusinessProductPackageContext | undefined,
): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready "### Package Guidance" text block (see
 * `buildersDbContextProvider.ts`'s `buildPackageGuidance`). Always carries the scope-control
 * instruction, the package's delivery positioning, its explicit exclusions, and the shared
 * minimum quality floor (PART 8/15/16) — never conditional on whether family-specific sections
 * happen to be populated.
 */
export function formatBusinessProductPackageGuidanceSection(
  profile: PackageProfile,
  resolution: PackageResolutionResult,
  projection: BusinessProductPackageContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override' ? 'manually selected by the user' : resolution.selectionSource;

  const header = `### Package Guidance (Advisory) — ${profile.name} (${selectionLabel})`;

  const instruction =
    'Package Guidance controls implementation depth and delivery maturity for already-approved product scope. It does not authorize new features, integrations, roles, or infrastructure beyond approved upstream decisions — apply it only to scope that is already approved.';

  const positioning = `Delivery positioning: ${profile.deliveryPositioning}`;

  const sections: string[] = [positioning];

  if (projection?.documentationGuidance?.length) {
    sections.push(`Documentation expectations:\n${projection.documentationGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.maintainabilityGuidance?.length) {
    sections.push(
      `Maintainability expectations:\n${projection.maintainabilityGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.supportGuidance?.length) {
    sections.push(`Operational maturity expectations:\n${projection.supportGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.qaExitCriteria?.length) {
    sections.push(`Acceptance depth expectations:\n${projection.qaExitCriteria.map((g) => `- ${g}`).join('\n')}`);
  }

  const qualityFloor = `Minimum quality floor (applies to every package, including Starter):\n${profile.qualityFloor.map((g) => `- ${g}`).join('\n')}`;

  const exclusions = `This package explicitly does not authorize:\n${profile.exclusions.map((g) => `- ${g}`).join('\n')}`;

  return [header, instruction, ...sections, qualityFloor, exclusions].join('\n\n');
}
