import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult } from './regionalResolutionTypes';

/**
 * Regional Profile → Business/Product Projection — Sprint 71 (Regional Intelligence
 * Foundation).
 *
 * Role family: Business Analyst, Product Owner. Sibling of
 * `regionalArchitectureEngineeringProjection.ts` and `regionalDesignQualityProjection.ts` —
 * deliberately a SEPARATE, dedicated projection rather than injecting the full
 * `RegionalProfile` into every role (PART 7 of the Sprint 71 brief). This family cares about
 * market-facing terminology and expectations a business/product role needs to scope and write
 * about correctly: currency, tax terminology, consumer expectations, privacy/compliance
 * reminders, invoice conventions, and address/phone conventions.
 *
 * Explicitly excluded: engineering-level concerns (timezone strategy, data residency,
 * deployment) that belong to the Architecture/Engineering family, and formatting/validation/
 * accessibility detail that belongs to the Design/Quality family — per PART 7's "ensure each
 * role receives only relevant guidance."
 *
 * Pure, synchronous, side-effect-free — `buildersDbContextProvider.ts` (the orchestration
 * layer) does the actual `getEffectiveRegionalSelection`/`regionalEngine.getRegionalProfile`
 * lookups; this file only shapes and formats what it's given.
 */

export interface BusinessProductRegionalContext {
  locale?: RegionalProfile['locale'];
  defaultCurrency?: RegionalProfile['defaultCurrency'];
  addressFormat?: RegionalProfile['addressFormat'];
  phoneCountryCode?: RegionalProfile['phoneCountryCode'];
  taxTerminology?: RegionalProfile['taxTerminology'];
  taxGuidance?: RegionalProfile['taxGuidance'];
  invoiceGuidance?: RegionalProfile['invoiceGuidance'];
  privacyGuidance?: RegionalProfile['privacyGuidance'];
  consumerProtectionGuidance?: RegionalProfile['consumerProtectionGuidance'];

  /** PART 12's "E-COMMERCE WITH CHECKOUT APPROVED" example explicitly expects payment-method conventions to reach this family — only relevant where payments are already approved. */
  paymentGuidance?: RegionalProfile['paymentGuidance'];
  commerceGuidance?: RegionalProfile['commerceGuidance'];
  complianceNotes?: RegionalProfile['complianceNotes'];
}

const PROJECTED_SECTION_KEYS = [
  'locale',
  'defaultCurrency',
  'addressFormat',
  'phoneCountryCode',
  'taxTerminology',
  'taxGuidance',
  'invoiceGuidance',
  'privacyGuidance',
  'consumerProtectionGuidance',
  'paymentGuidance',
  'commerceGuidance',
  'complianceNotes',
] as const satisfies readonly (keyof BusinessProductRegionalContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Projects the full `RegionalProfile` (or `undefined`) down to the 12 Business/Product-relevant fields. Deterministic and non-mutating — a section absent from the source is simply absent here too. */
export function projectRegionalProfileForBusinessProduct(
  profile: RegionalProfile | undefined,
): BusinessProductRegionalContext | undefined {
  if (!profile) {
    return undefined;
  }

  const projection: BusinessProductRegionalContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = profile[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

export function hasBusinessProductRegionalContent(projection: BusinessProductRegionalContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

export function describeSuppliedSections(projection: BusinessProductRegionalContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready "### Regional Guidance" text block (see
 * `buildersDbContextProvider.ts`'s `buildRegionalGuidance`). Carries the scope-control
 * instruction every regional guidance section must carry (PART 9): this adapts approved scope
 * to the market, it never authorizes new features, legal conclusions, or infrastructure.
 */
export function formatBusinessProductRegionalGuidanceSection(
  profileName: string,
  resolution: RegionalResolutionResult,
  projection: BusinessProductRegionalContext | undefined,
): string {
  const selectionLabel =
    resolution.selectionSource === 'manual_override'
      ? 'manually selected by the user'
      : resolution.selectionSource === 'business_discovery'
        ? 'from Business Discovery'
        : resolution.selectionSource;

  const header = `### Regional Guidance (Advisory) — ${profileName} (${selectionLabel})`;

  const instruction =
    'Regional Guidance adapts approved product scope to the selected market. It does not authorize new features, legal conclusions, or infrastructure beyond approved upstream decisions — apply a section below only where the corresponding capability (invoicing, commerce, accounts, ...) already exists in the approved MVP scope. This is implementation guidance, not legal advice; validate current requirements with a qualified local adviser.';

  if (!hasBusinessProductRegionalContent(projection)) {
    return [header, instruction, 'No structured Regional Guidance is available for this market yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.locale || projection?.defaultCurrency) {
    sections.push(
      `Locale/currency: ${projection.locale ?? 'unspecified'}${projection.defaultCurrency ? `, ${projection.defaultCurrency}` : ''}.`,
    );
  }

  if (projection?.addressFormat) {
    sections.push(`Address conventions: ${projection.addressFormat}`);
  }

  if (projection?.phoneCountryCode) {
    sections.push(
      `Phone convention: numbers are typically shown/validated with country code ${projection.phoneCountryCode}.`,
    );
  }

  if (projection?.taxTerminology) {
    sections.push(
      `Tax terminology for this market: ${projection.taxTerminology} — only relevant where commerce/invoicing is already approved.`,
    );
  }

  if (projection?.taxGuidance?.length) {
    sections.push(
      `Tax-related guidance (only where already approved):\n${projection.taxGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.invoiceGuidance?.length) {
    sections.push(
      `Invoice conventions (only where invoicing is already approved):\n${projection.invoiceGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.privacyGuidance?.length) {
    sections.push(`Privacy reminders:\n${projection.privacyGuidance.map((g) => `- ${g}`).join('\n')}`);
  }

  if (projection?.consumerProtectionGuidance?.length) {
    sections.push(
      `Consumer-expectation reminders (only where relevant capability is approved):\n${projection.consumerProtectionGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.paymentGuidance?.length) {
    sections.push(
      `Payment-method conventions (only where payments are already approved):\n${projection.paymentGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.commerceGuidance?.length) {
    sections.push(
      `Commerce/pricing-display conventions (only where commerce is already approved):\n${projection.commerceGuidance.map((g) => `- ${g}`).join('\n')}`,
    );
  }

  if (projection?.complianceNotes?.length) {
    sections.push(`Compliance notes:\n${projection.complianceNotes.map((g) => `- ${g}`).join('\n')}`);
  }

  return [header, instruction, ...sections].join('\n\n');
}
