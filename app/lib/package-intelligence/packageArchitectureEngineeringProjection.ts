import type { PackageProfile } from './packageProfileTypes';
import type { PackageResolutionResult } from './packageResolutionTypes';

/**
 * Package Profile → Architecture/Engineering Projection — Sprint 73 (Package Intelligence
 * Foundation).
 *
 * Role family: Solution Architect, Database Engineer, Backend Engineer, Frontend Engineer,
 * DevOps Engineer. Sibling of `packageBusinessProductProjection.ts` and
 * `packageDesignQualityProjection.ts` — this family cares about architecture depth, security
 * depth, scalability proportionality, performance expectations, observability, deployment
 * maturity, backup/recovery, integration resilience, maintainability, and data governance.
 *
 * Explicitly excluded: delivery-positioning/documentation-for-stakeholders concerns that belong
 * to the Business/Product family, and UI/testing depth that belongs to the Design/Quality family.
 *
 * Pure, synchronous, side-effect-free — `buildersDbContextProvider.ts` does the actual
 * `getEffectivePackageSelection`/`packageEngine.getPackageProfile` lookups; this file only
 * shapes and formats what it's given.
 */

export interface ArchitectureEngineeringPackageContext {
  architectureGuidance?: PackageProfile['architectureGuidance'];
  securityGuidance?: PackageProfile['securityGuidance'];
  performanceGuidance?: PackageProfile['performanceGuidance'];
  scalabilityGuidance?: PackageProfile['scalabilityGuidance'];
  observabilityGuidance?: PackageProfile['observabilityGuidance'];
  deploymentGuidance?: PackageProfile['deploymentGuidance'];
  backupRecoveryGuidance?: PackageProfile['backupRecoveryGuidance'];
  integrationGuidance?: PackageProfile['integrationGuidance'];
  dataGovernanceGuidance?: PackageProfile['dataGovernanceGuidance'];
  maintainabilityGuidance?: PackageProfile['maintainabilityGuidance'];
}

const PROJECTED_SECTION_KEYS = [
  'architectureGuidance',
  'securityGuidance',
  'performanceGuidance',
  'scalabilityGuidance',
  'observabilityGuidance',
  'deploymentGuidance',
  'backupRecoveryGuidance',
  'integrationGuidance',
  'dataGovernanceGuidance',
  'maintainabilityGuidance',
] as const satisfies readonly (keyof ArchitectureEngineeringPackageContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Projects the full `PackageProfile` (or `undefined`) down to the Architecture/Engineering-relevant fields. Deterministic and non-mutating. */
export function projectPackageProfileForArchitectureEngineering(
  profile: PackageProfile | undefined,
): ArchitectureEngineeringPackageContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: ArchitectureEngineeringPackageContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasArchitectureEngineeringPackageContent(
  projection: ArchitectureEngineeringPackageContext | undefined,
): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeArchitectureEngineeringPackageSuppliedSections(
  projection: ArchitectureEngineeringPackageContext | undefined,
): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready "### Package Guidance" text block. Always
 * carries the scope-control instruction, delivery positioning, explicit exclusions, and the
 * shared minimum quality floor — never conditional on which family-specific sections happen to
 * be populated.
 */
export function formatArchitectureEngineeringPackageGuidanceSection(
  profile: PackageProfile,
  resolution: PackageResolutionResult,
  projection: ArchitectureEngineeringPackageContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override' ? 'manually selected by the user' : resolution.selectionSource;

  const header = `### Package Guidance (Advisory) — ${profile.name} (${selectionLabel})`;

  const instruction =
    'Package Guidance controls implementation depth and delivery maturity for already-approved product scope. It does not authorize new features, integrations, roles, or infrastructure beyond approved upstream decisions — apply it only to scope that is already approved. Scalability/performance guidance is proportional to justified demand, never a blanket assumption of scale.';

  const positioning = `Delivery positioning: ${profile.deliveryPositioning}`;

  const sections: string[] = [positioning];

  if (projection?.architectureGuidance?.length) {
    sections.push(`Architecture depth:\n${projection.architectureGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.securityGuidance?.length) {
    sections.push(`Security depth:\n${projection.securityGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.performanceGuidance?.length) {
    sections.push(`Performance expectations:\n${projection.performanceGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.scalabilityGuidance?.length) {
    sections.push(`Scalability proportionality:\n${projection.scalabilityGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.observabilityGuidance?.length) {
    sections.push(`Observability:\n${projection.observabilityGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.deploymentGuidance?.length) {
    sections.push(`Deployment maturity:\n${projection.deploymentGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.backupRecoveryGuidance?.length) {
    sections.push(`Backup/recovery:\n${projection.backupRecoveryGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.integrationGuidance?.length) {
    sections.push(
      `Integration resilience (only where integrations are already approved):\n${projection.integrationGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.dataGovernanceGuidance?.length) {
    sections.push(
      `Data governance (only where data handling is already approved):\n${projection.dataGovernanceGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.maintainabilityGuidance?.length) {
    sections.push(`Maintainability:\n${projection.maintainabilityGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  const qualityFloor = `Minimum quality floor (applies to every package, including Starter):\n${profile.qualityFloor.map((g) => `- ${g}`).join('\n')}`;

  const exclusions = `This package explicitly does not authorize:\n${profile.exclusions.map((g) => `- ${g}`).join('\n')}`;

  return [header, instruction, ...sections, qualityFloor, exclusions].join('\n\n');
}
