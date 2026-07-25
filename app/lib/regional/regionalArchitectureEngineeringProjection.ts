import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

/**
 * Regional Profile → Architecture/Engineering Projection — Sprint 71 (Regional Intelligence
 * Foundation).
 *
 * Role family: Solution Architect, Database Engineer, Backend Engineer, Frontend Engineer,
 * DevOps Engineer. Sibling of `regionalBusinessProductProjection.ts` and
 * `regionalDesignQualityProjection.ts` — a separate projection covering locale/currency/
 * timezone HANDLING (how to model/store/represent, not market terminology), address/phone
 * modeling, and the audit/data-retention/security/data-residency/deployment considerations an
 * engineering role needs.
 *
 * Explicitly excluded: market-facing terminology (tax terminology, invoice/consumer wording)
 * that belongs to the Business/Product family, and UI-facing formatting/accessibility detail
 * that belongs to the Design/Quality family.
 *
 * Pure, synchronous, side-effect-free — see `regionalBusinessProductProjection.ts`'s own header
 * comment for the full discipline this mirrors.
 */

export interface ArchitectureEngineeringRegionalContext {
  locale?: RegionalProfile['locale'];
  defaultCurrency?: RegionalProfile['defaultCurrency'];
  defaultTimezone?: RegionalProfile['defaultTimezone'];
  addressFormat?: RegionalProfile['addressFormat'];
  phoneCountryCode?: RegionalProfile['phoneCountryCode'];
  privacyGuidance?: RegionalProfile['privacyGuidance'];
  dataProtectionGuidance?: RegionalProfile['dataProtectionGuidance'];
  dataResidencyGuidance?: RegionalProfile['dataResidencyGuidance'];
  deploymentGuidance?: RegionalProfile['deploymentGuidance'];
  complianceNotes?: RegionalProfile['complianceNotes'];
}

const PROJECTED_SECTION_KEYS = [
  'locale',
  'defaultCurrency',
  'defaultTimezone',
  'addressFormat',
  'phoneCountryCode',
  'privacyGuidance',
  'dataProtectionGuidance',
  'dataResidencyGuidance',
  'deploymentGuidance',
  'complianceNotes',
] as const satisfies readonly (keyof ArchitectureEngineeringRegionalContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

export function projectRegionalProfileForArchitectureEngineering(
  profile: RegionalProfile | undefined,
): ArchitectureEngineeringRegionalContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: ArchitectureEngineeringRegionalContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasArchitectureEngineeringRegionalContent(
  projection: ArchitectureEngineeringRegionalContext | undefined,
): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeSuppliedSections(projection: ArchitectureEngineeringRegionalContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

export function formatArchitectureEngineeringRegionalGuidanceSection(
  profileName: string,
  resolution: RegionalResolutionResult,
  projection: ArchitectureEngineeringRegionalContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override'
      ? 'manually selected by the user'
      : resolution.selectionSource === 'business_discovery'
        ? 'from Business Discovery'
        : resolution.selectionSource;

  const header = `### Regional Guidance (Advisory) — ${profileName} (${selectionLabel})`;

  const instruction =
    'Regional Guidance informs HOW to implement approved scope for this market — locale/currency/timezone handling, address/phone modeling, and data-protection/residency/deployment considerations. It never authorizes new infrastructure, data residency requirements, or integrations beyond the approved Architecture and Database Design. This is implementation guidance, not legal advice; validate current requirements with a qualified local adviser.';

  if (!hasArchitectureEngineeringRegionalContent(projection)) {
    return [header, instruction, 'No structured Regional Guidance is available for this market yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.locale || projection?.defaultCurrency) {
    sections.push(
      `Locale/currency representation: ${projection.locale ?? 'unspecified'}${projection.defaultCurrency ? `, ${projection.defaultCurrency}` : ''}.`,
    );
  }

  if (projection?.defaultTimezone) {
    sections.push(`Default timezone for this market: ${projection.defaultTimezone}.`);
  } else {
    sections.push(
      'Timezone strategy: this market has no single default timezone in this profile — confirm the project-specific operating timezone(s) with the customer rather than assuming one.',
    );
  }

  if (projection?.addressFormat) {
    sections.push(`Address modeling considerations: ${projection.addressFormat}`);
  }

  if (projection?.phoneCountryCode) {
    sections.push(
      `Phone modeling: validate/format numbers with country code ${projection.phoneCountryCode} as the default.`,
    );
  }

  if (projection?.privacyGuidance?.length) {
    sections.push(`Privacy/data-protection reminders:\n${projection.privacyGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.dataProtectionGuidance?.length) {
    sections.push(
      `Data-protection implementation considerations:\n${projection.dataProtectionGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.dataResidencyGuidance?.length) {
    sections.push(
      `Data-residency considerations (advisory only — never authorizes new hosting infrastructure by itself):\n${projection.dataResidencyGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.deploymentGuidance?.length) {
    sections.push(`Deployment considerations:\n${projection.deploymentGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.complianceNotes?.length) {
    sections.push(`Compliance notes:\n${projection.complianceNotes.map((g) => `- ${g}`).join('\n')}`);
  }

  return [header, instruction, ...sections].join('\n\n');
}
