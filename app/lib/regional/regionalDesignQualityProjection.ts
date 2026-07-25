import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

/**
 * Regional Profile → Design/Quality Projection — Sprint 71 (Regional Intelligence Foundation).
 *
 * Role family: UI/UX Designer, QA Engineer. Sibling of `regionalBusinessProductProjection.ts`
 * and `regionalArchitectureEngineeringProjection.ts` — a separate projection covering
 * date/time/currency FORMATTING, address/phone FORM design, accessibility expectations, and
 * privacy-messaging/consumer-expectation reminders relevant to design and test coverage.
 *
 * Explicitly excluded: market-facing business terminology (tax/invoice terminology) that
 * belongs to the Business/Product family, and engineering-level data-residency/deployment
 * concerns that belong to the Architecture/Engineering family.
 *
 * Pure, synchronous, side-effect-free — see `regionalBusinessProductProjection.ts`'s own header
 * comment for the full discipline this mirrors.
 */

export interface DesignQualityRegionalContext {
  locale?: RegionalProfile['locale'];
  dateFormat?: RegionalProfile['dateFormat'];
  timeFormat?: RegionalProfile['timeFormat'];
  defaultCurrency?: RegionalProfile['defaultCurrency'];
  addressFormat?: RegionalProfile['addressFormat'];
  phoneCountryCode?: RegionalProfile['phoneCountryCode'];
  accessibilityGuidance?: RegionalProfile['accessibilityGuidance'];
  privacyGuidance?: RegionalProfile['privacyGuidance'];
  consumerProtectionGuidance?: RegionalProfile['consumerProtectionGuidance'];
  complianceNotes?: RegionalProfile['complianceNotes'];
}

const PROJECTED_SECTION_KEYS = [
  'locale',
  'dateFormat',
  'timeFormat',
  'defaultCurrency',
  'addressFormat',
  'phoneCountryCode',
  'accessibilityGuidance',
  'privacyGuidance',
  'consumerProtectionGuidance',
  'complianceNotes',
] as const satisfies readonly (keyof DesignQualityRegionalContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

export function projectRegionalProfileForDesignQuality(
  profile: RegionalProfile | undefined,
): DesignQualityRegionalContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: DesignQualityRegionalContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasDesignQualityRegionalContent(projection: DesignQualityRegionalContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeSuppliedSections(projection: DesignQualityRegionalContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

export function formatDesignQualityRegionalGuidanceSection(
  profileName: string,
  resolution: RegionalResolutionResult,
  projection: DesignQualityRegionalContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override'
      ? 'manually selected by the user'
      : resolution.selectionSource === 'business_discovery'
        ? 'from Business Discovery'
        : resolution.selectionSource;

  const header = `### Regional Guidance (Advisory) — ${profileName} (${selectionLabel})`;

  const instruction =
    'Regional Guidance informs date/time/currency formatting, address/phone form design, accessibility expectations, and validation scenarios for the approved scope in this market. It never authorizes new screens, flows, consent interactions, or test scope beyond what the approved UI/UX and Product Owner outputs already include. This is implementation guidance, not legal advice.';

  if (!hasDesignQualityRegionalContent(projection)) {
    return [header, instruction, 'No structured Regional Guidance is available for this market yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.dateFormat || projection?.timeFormat) {
    sections.push(
      `Date/time formatting: ${projection.dateFormat ?? 'unspecified date format'}, ${projection.timeFormat ?? 'unspecified time format'}.`,
    );
  }

  if (projection?.defaultCurrency) {
    sections.push(
      `Currency formatting: ${projection.defaultCurrency} — only relevant where pricing/commerce is already approved.`,
    );
  }

  if (projection?.addressFormat) {
    sections.push(`Address form design: ${projection.addressFormat}`);
  }

  if (projection?.phoneCountryCode) {
    sections.push(
      `Phone form design: default to country code ${projection.phoneCountryCode} for phone inputs/validation.`,
    );
  }

  if (projection?.accessibilityGuidance?.length) {
    sections.push(`Accessibility expectations:\n${projection.accessibilityGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.privacyGuidance?.length) {
    sections.push(`Privacy-messaging reminders:\n${projection.privacyGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.consumerProtectionGuidance?.length) {
    sections.push(
      `Consumer-expectation / validation-scenario reminders (only where relevant capability is approved):\n${projection.consumerProtectionGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.complianceNotes?.length) {
    sections.push(`Compliance notes:\n${projection.complianceNotes.map((g) => `- ${g}`).join('\n')}`);
  }

  return [header, instruction, ...sections].join('\n\n');
}
