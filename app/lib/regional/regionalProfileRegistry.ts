import type { RegionalProfile, RegionCode } from './regionalProfileTypes';

/**
 * Regional Profile Registry (Sprint 71, Regional Intelligence Foundation).
 *
 * Typed, code-based seed profiles — mirrors `app/lib/blueprints/registry.ts`'s own pattern
 * (a hardcoded, strongly-typed catalog, not a database table) rather than the Blueprint
 * Resolution system's append-only-history table. That distinction is deliberate, not an
 * oversight: Blueprint Resolution needs a table because it records the *scoring engine's*
 * output per Business Understanding update (a genuinely per-project, evolving computation).
 * A Regional Profile is closer to a Blueprint's own *content* — a small, curated, versioned
 * catalog of reference knowledge that doesn't change per project, doesn't need an admin UI at
 * this stage (PART 13 of the Sprint 71 brief explicitly rules that out), and every generation
 * call should be able to read synchronously without a network round trip.
 *
 * PART 13 also asks for the "simplest versionable approach that ... does not make every
 * generation call depend on a remote lookup if avoidable" — a code-based catalog satisfies
 * that directly: `getRegionalProfile` never awaits anything.
 *
 * Every profile's guidance is written per this sprint's "Factual Safety" and "No
 * Legal-Automation Claims" requirements: implementation guidance, never legal advice, never a
 * mutable rate/threshold/deadline, never a compliance guarantee. `regionalProfileRegistry.spec.ts`
 * enforces this with a scan for banned phrases across every seed profile.
 */

const SOURCE_METADATA = {
  lastReviewed: '2026-07-25',
  disclaimer:
    'This guidance is implementation-focused, not legal advice. Validate current requirements with a qualified local adviser — applicable rules may depend on industry, state/emirate/nation, and customer type. Only apply a section where the corresponding capability already exists in approved product scope.',
};

const INDIA_PROFILE: RegionalProfile = {
  id: 'region-in',
  code: 'IN',
  name: 'India',
  countryCode: 'IN',
  version: 1,
  status: 'active',
  locale: 'en-IN',
  defaultCurrency: 'INR',
  defaultTimezone: 'Asia/Kolkata',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  phoneCountryCode: '+91',
  addressFormat:
    'Consider India-typical address fields: flat/house number, street, locality, city, state, and a 6-digit PIN code. State is commonly a required field, not free text.',
  taxTerminology: 'GST (Goods and Services Tax)',
  taxGuidance: [
    'Where invoicing or commerce already exists in approved scope, GST is the terminology customers expect (not "sales tax" or "VAT").',
    'GSTIN (GST Identification Number) is a common business-customer field — only add it if invoicing/commerce is already approved, and validate current requirements with a qualified local adviser rather than assuming a fixed format is exhaustive.',
  ],
  invoiceGuidance: [
    'Only relevant where invoicing is already approved in scope: Indian invoices commonly show GSTIN, HSN/SAC codes, and a CGST/SGST or IGST breakdown depending on intra-state vs inter-state supply — confirm current requirements with a qualified local adviser before implementing calculation logic.',
  ],
  privacyGuidance: [
    "Consider India's Digital Personal Data Protection Act (DPDPA) as a relevant reference point when the approved product collects personal data — validate current obligations with a qualified local adviser rather than assuming this guidance is exhaustive.",
  ],
  dataProtectionGuidance: [
    'Where user accounts or personal data collection are already approved, consider consent-capture and data-minimization practices consistent with DPDPA principles — implementation guidance only, not a compliance guarantee.',
  ],
  accessibilityGuidance: [
    'Consider WCAG 2.1 AA as a reasonable general baseline; India does not have a single universally-mandated web accessibility standard for all product types, so confirm sector-specific expectations where relevant.',
  ],
  consumerProtectionGuidance: [
    'Where e-commerce is already approved, consider clear return/refund/cancellation terminology consistent with Indian consumer-protection expectations — validate current requirements with a qualified local adviser.',
  ],
  paymentGuidance: [
    "Only relevant where payments are already approved in scope: UPI is a widely expected payment method alongside cards in the Indian market — this is a market-convention observation, not an instruction to add a payment integration that isn't already approved.",
  ],
  commerceGuidance: [
    'Where commerce is approved, INR pricing should be displayed with the ₹ symbol and Indian digit grouping (e.g. 1,00,000) rather than Western grouping, as a formatting-only consideration.',
  ],
  dataResidencyGuidance: [
    'Some sectors (e.g. payments data under RBI guidance) have data-localization expectations in India — this is advisory only and never authorizes new infrastructure scope by itself; confirm applicability with a qualified local adviser and the approved architecture.',
  ],
  deploymentGuidance: [
    'If low latency for Indian users is already a stated non-functional requirement in the approved architecture, a nearby hosting region is a reasonable technical consideration — this guidance never adds a new infrastructure requirement on its own.',
  ],
  complianceNotes: [
    'Applicable requirements depend on industry, business size, and customer type. This profile is compliance-aware reference material, not a certification of compliance.',
  ],
  sourceMetadata: SOURCE_METADATA,
};

const UAE_PROFILE: RegionalProfile = {
  id: 'region-ae',
  code: 'AE',
  name: 'United Arab Emirates',
  countryCode: 'AE',
  version: 1,
  status: 'active',
  locale: 'en-AE',
  defaultCurrency: 'AED',
  defaultTimezone: 'Asia/Dubai',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  phoneCountryCode: '+971',
  addressFormat:
    'UAE addresses commonly reference emirate, city/area, and a building/PO Box rather than a Western-style postal code — most of the UAE does not use postal codes the way US/UK/India do.',
  taxTerminology: 'VAT (Value Added Tax)',
  taxGuidance: [
    'Where invoicing or commerce already exists in approved scope, VAT is the terminology customers expect. A UAE Tax Registration Number (TRN) is a common business-customer field — only add it if invoicing/commerce is already approved.',
  ],
  invoiceGuidance: [
    "Only relevant where invoicing is already approved: UAE tax invoices commonly show the supplier's TRN and a VAT breakdown — validate current requirements with a qualified local adviser before implementing calculation logic.",
  ],
  privacyGuidance: [
    'Consider UAE Federal Decree-Law No. 45 of 2021 (Personal Data Protection Law) as a relevant reference point when the approved product collects personal data, alongside any free-zone-specific regime (e.g. DIFC, ADGM) that may apply depending on where the business is registered — validate current obligations with a qualified local adviser.',
  ],
  dataProtectionGuidance: [
    'Where user accounts or personal data collection are already approved, consider consent-capture practices appropriate to the applicable UAE or free-zone data protection regime — implementation guidance only.',
  ],
  accessibilityGuidance: ['Consider WCAG 2.1 AA as a reasonable general baseline for UAE digital products.'],
  consumerProtectionGuidance: [
    'Where e-commerce is already approved, consider clear return/refund/cancellation terminology consistent with UAE consumer-protection expectations.',
  ],
  paymentGuidance: [
    "Only relevant where payments are already approved: cards are the dominant online payment method in the UAE market; this is a market-convention observation, not an instruction to add payments that aren't already approved.",
  ],
  commerceGuidance: [
    'Where commerce is approved, AED pricing formatting and Western digit grouping are the market norm.',
  ],
  dataResidencyGuidance: [
    'Some regulated sectors in the UAE (e.g. certain government or financial services) have data-residency expectations — this is advisory only and never automatically authorizes new hosting infrastructure; confirm applicability with a qualified local adviser and the approved architecture.',
  ],
  deploymentGuidance: [
    'If low latency for UAE/GCC users is already a stated non-functional requirement in the approved architecture, a nearby hosting region is a reasonable technical consideration — this never adds a new infrastructure requirement on its own.',
  ],
  complianceNotes: [
    'Applicable requirements depend on emirate, free zone vs. mainland registration, industry, and customer type. This profile is compliance-aware reference material, not a certification of compliance.',
    'Arabic localization is a UAE market observation, not an automatic scope addition — only implement it if multi-language support is already approved.',
  ],
  sourceMetadata: SOURCE_METADATA,
};

const UK_PROFILE: RegionalProfile = {
  id: 'region-gb',
  code: 'GB',
  name: 'United Kingdom',
  countryCode: 'GB',
  version: 1,
  status: 'active',
  locale: 'en-GB',
  defaultCurrency: 'GBP',
  defaultTimezone: 'Europe/London',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  phoneCountryCode: '+44',
  addressFormat:
    'UK addresses commonly use a line-based structure (address line 1/2, town/city, county optional, postcode) — postcode format is alphanumeric, distinct from US ZIP or Indian PIN formats.',
  taxTerminology: 'VAT (Value Added Tax)',
  taxGuidance: [
    'Where invoicing or commerce already exists in approved scope, VAT is the terminology customers expect. A UK VAT registration number is a common business-customer field — only add it if invoicing/commerce is already approved.',
  ],
  invoiceGuidance: [
    "Only relevant where invoicing is already approved: UK VAT invoices commonly show the seller's VAT number and a VAT rate/amount breakdown — validate current requirements with a qualified local adviser before implementing calculation logic.",
  ],
  privacyGuidance: [
    'Consider UK GDPR and the Data Protection Act 2018 as the relevant reference framework when the approved product collects personal data — validate current obligations with a qualified local adviser rather than assuming this guidance is exhaustive.',
  ],
  dataProtectionGuidance: [
    'Where user accounts or personal data collection are already approved, consider lawful-basis and consent-capture practices consistent with UK GDPR principles — implementation guidance only, not a compliance guarantee.',
  ],
  accessibilityGuidance: [
    'Consider WCAG 2.1 AA — the UK Public Sector Bodies Accessibility Regulations reference this standard, and it is a reasonable general baseline even for non-public-sector UK products.',
  ],
  consumerProtectionGuidance: [
    'Where e-commerce is already approved, consider the UK Consumer Rights Act 2015 and consumer-contract distance-selling expectations (e.g. clear cancellation-rights terminology) as a relevant reference point.',
  ],
  paymentGuidance: [
    "Only relevant where payments are already approved: cards and open-banking payment methods are common in the UK market; this is a market-convention observation, not an instruction to add payments that aren't already approved.",
  ],
  commerceGuidance: [
    'Where commerce is approved, GBP pricing should be displayed with the £ symbol and prices are commonly VAT-inclusive for consumer-facing display in the UK market.',
  ],
  dataResidencyGuidance: [
    'UK GDPR includes considerations for international data transfers — this is advisory only and never automatically authorizes new hosting infrastructure; confirm applicability with a qualified local adviser and the approved architecture.',
  ],
  deploymentGuidance: [
    'If low latency for UK/EU users is already a stated non-functional requirement in the approved architecture, a nearby hosting region is a reasonable technical consideration — this never adds a new infrastructure requirement on its own.',
  ],
  complianceNotes: [
    'Applicable requirements depend on industry, business size, and customer type. This profile is compliance-aware reference material, not a certification of compliance — Builders never guarantees UK legal compliance.',
    'Cookie/consent-banner guidance (PECR) is only relevant where the approved product already involves cookies/tracking requiring consent — never an automatic scope addition.',
  ],
  sourceMetadata: SOURCE_METADATA,
};

const US_PROFILE: RegionalProfile = {
  id: 'region-us',
  code: 'US',
  name: 'United States',
  countryCode: 'US',
  version: 1,
  status: 'active',
  locale: 'en-US',
  defaultCurrency: 'USD',

  /*
   * Deliberately omitted, per the Sprint 71 brief's explicit US baseline: "Timezone must not be
   * assumed nationally; require project-specific selection or mark unresolved." The US spans
   * 6 primary time zones — `regionalArchitectureEngineeringProjection.ts`'s format function
   * surfaces this as an explicit "confirm project-specific timezone" note rather than
   * defaulting to any one zone.
   */
  defaultTimezone: undefined,

  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  phoneCountryCode: '+1',
  addressFormat:
    'US addresses commonly use street address, city, a 2-letter state code, and a 5-digit (or ZIP+4) postal code — state is a required, enumerable field, not free text.',
  taxTerminology: 'Sales tax (state- and locality-dependent — no single national rate or rule)',
  taxGuidance: [
    'Unlike GST/VAT markets, the US has no single national sales tax — rates and rules vary by state and locality, and many US states have no state-level sales tax at all. Never assume one national rate applies.',
    'Where commerce/invoicing already exists in approved scope, treat sales-tax terminology and applicability as jurisdiction-dependent, not a fixed constant — validate current requirements with a qualified local adviser or tax-calculation provider before implementing calculation logic.',
  ],
  invoiceGuidance: [
    'Only relevant where invoicing is already approved: US invoices vary far more by industry/state than GST/VAT-market invoices — there is no single mandated national invoice format to follow.',
  ],
  privacyGuidance: [
    "The US has no single national privacy law; consider that applicable requirements are state- and sector-dependent (e.g. California's CCPA/CPRA, other state privacy laws, and sector rules like HIPAA for health data) — validate current obligations with a qualified local adviser rather than assuming one federal rule covers all states.",
  ],
  dataProtectionGuidance: [
    'Where user accounts or personal data collection are already approved, consider that data-protection obligations depend on the states a business operates in and the data/industry involved — implementation guidance only, never a nationwide compliance guarantee.',
  ],
  accessibilityGuidance: [
    'Consider WCAG 2.1 AA as a reasonable general baseline; the Americans with Disabilities Act (ADA) has been applied to websites in US case law, so accessibility is a genuine consideration even without one single detailed federal web-accessibility statute.',
  ],
  consumerProtectionGuidance: [
    'Where e-commerce is already approved, consider that consumer-protection rules (returns, cancellations, subscription/auto-renewal disclosures) vary by state — treat this as jurisdiction-dependent, not a fixed national rule.',
  ],
  paymentGuidance: [
    "Only relevant where payments are already approved: cards are the dominant US online payment method, with digital wallets increasingly common — this is a market-convention observation, not an instruction to add payments that aren't already approved.",
  ],
  commerceGuidance: [
    "Where commerce is approved, USD pricing is commonly displayed tax-exclusive with tax calculated at checkout based on the buyer's jurisdiction — a formatting/flow consideration, not an instruction to build a specific tax engine.",
  ],
  dataResidencyGuidance: [
    'Data-residency expectations in the US are typically sector-driven (e.g. certain government or healthcare contexts) rather than a blanket national rule — advisory only, never an automatic infrastructure requirement; confirm applicability with a qualified local adviser and the approved architecture.',
  ],
  deploymentGuidance: [
    "If low latency for US users is already a stated non-functional requirement in the approved architecture, a US hosting region is a reasonable technical consideration — this never adds a new infrastructure requirement on its own. Because the US spans multiple time zones, confirm the project's specific operating timezone(s) rather than assuming one.",
  ],
  complianceNotes: [
    'Applicable requirements depend heavily on state, industry, and customer type — there is no single "US compliance" standard. This profile is compliance-aware reference material, not a certification of compliance.',
  ],
  sourceMetadata: SOURCE_METADATA,
};

/** Every seed profile, keyed by `RegionCode` — the one place a new region gets added (plus `RegionCode` itself in `regionalProfileTypes.ts`). */
const REGIONAL_PROFILES: Record<RegionCode, RegionalProfile> = {
  IN: INDIA_PROFILE,
  AE: UAE_PROFILE,
  GB: UK_PROFILE,
  US: US_PROFILE,
};

/** Returns the profile for `code`, or `undefined` for an unsupported/unknown code — never throws, never guesses. */
function getRegionalProfile(code: string): RegionalProfile | undefined {
  return REGIONAL_PROFILES[code as RegionCode];
}

function getAllRegionalProfiles(): RegionalProfile[] {
  return Object.values(REGIONAL_PROFILES);
}

export const regionalEngine = {
  getRegionalProfile,
  getAllRegionalProfiles,
};
