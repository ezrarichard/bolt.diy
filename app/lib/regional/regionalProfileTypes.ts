/**
 * Regional Intelligence — Regional Profile model (Sprint 71, Regional Intelligence Foundation).
 *
 * A `RegionalProfile` answers "how should approved product scope behave in this market?" — it
 * never answers "what additional product features should be added?" (see this file's own
 * `RegionalProfile.sourceMetadata.disclaimer` and every guidance array's own wording
 * discipline, enforced by `regionalProfileRegistry.spec.ts`). Deliberately a SEPARATE system
 * from Blueprint Intelligence (`app/lib/blueprints/`) — a Blueprint answers "what does this
 * kind of product typically need," a Regional Profile answers "how does this market expect
 * that product to behave" (currency, tax terminology, address/phone conventions, privacy
 * reminders, ...). The two are combined at the context-provider layer
 * (`app/lib/ai/context/buildersDbContextProvider.ts`) as two clearly separate sections, never
 * merged into one.
 *
 * Modeled on `BlueprintContent`'s own design principles
 * (`app/lib/blueprints/blueprintContentTypes.ts`): every guidance field is optional except the
 * small set of identity/locale fields every real profile needs, so a sparse or future profile
 * never breaks. Deliberately a SMALL, coherent model — fields were added only where the Sprint
 * 71 brief's four seed regions (India, UAE, UK, US) actually needed them, not because a larger
 * suggested field list existed. Not included from that larger suggested list:
 * `industryOverrides` (no seed profile needs per-industry variants yet — add only when a real
 * need appears), `effectiveFrom`/`deprecatedAt` (this sprint's `version`/`status` pair is
 * sufficient lifecycle tracking for 4 code-based profiles; a full temporal-validity model can
 * be added later without breaking this shape, since every new field here would be optional).
 */

/**
 * The initial supported region codes (Sprint 71) — ISO 3166-1 alpha-2. Adding a new region
 * later means adding a code here and a matching profile in `regionalProfileRegistry.ts`; no
 * other file needs to change (see that file's own header comment and
 * `docs/regional-intelligence/Regional-Intelligence.md`'s "Adding a new region" section).
 */
export type RegionCode = 'IN' | 'AE' | 'GB' | 'US';

export type RegionalProfileStatus = 'active' | 'deprecated';

/**
 * `sourceMetadata` is intentionally NOT "where in the world this customer is" (no IP, no
 * device, no browser locale is ever recorded here or anywhere in Regional Intelligence — see
 * `regionalResolutionService.ts`'s own header comment) — it's provenance/safety metadata about
 * the PROFILE CONTENT itself: when it was last reviewed and the standing legal-safety
 * disclaimer every consumer of this profile must carry forward.
 */
export interface RegionalProfileSourceMetadata {
  /** ISO date string — when this profile's guidance text was last reviewed for accuracy. */
  lastReviewed: string;

  /**
   * The standing disclaimer every formatted guidance section must include verbatim or in
   * substance — see PART 14 of the Sprint 71 brief ("No Legal-Automation Claims"). Never
   * "fully compliant" / "legally compliant" / "meets all X laws" language.
   */
  disclaimer: string;
}

/**
 * The full structured content shape for one Regional Profile. Every field beyond the
 * identity/locale core is optional — a profile is never required to fill guidance it doesn't
 * yet have well-reviewed content for (same "never invent missing content" discipline
 * `blueprintContentTypes.ts` documents for `BlueprintContent`).
 */
export interface RegionalProfile {
  /** Stable id, e.g. "region-in" — never reused even if a profile is later deprecated. */
  id: string;

  code: RegionCode;
  name: string;

  /** ISO 3166-1 alpha-2 — identical to `code` for every Sprint 71 seed profile (no sub-national variants exist yet). Kept as its own field, not merged with `code`, so a future region-variant profile (e.g. a hypothetical India-Maharashtra profile) can share one `countryCode` while having its own `code`/`regionCode` pair — see `regionCode` below. */
  countryCode: string;

  /** Sub-national/regional variant code, e.g. a future state/emirate-specific profile. No Sprint 71 seed profile sets this (PART 13's "do not begin state-by-state/emirate-specific catalogs" applies) — present only so the type shape doesn't need to change when that work happens later. */
  regionCode?: string;

  /** Content version — bump when this profile's guidance text meaningfully changes. Independent of any BuildersDB row version (there is none for these code-based profiles — see regionalProfileRegistry.ts's own header comment on why). */
  version: number;

  status: RegionalProfileStatus;

  /** BCP 47 locale tag, e.g. "en-IN". */
  locale: string;

  /** ISO 4217 currency code, e.g. "INR". Absent only when genuinely ambiguous at the profile level (no Sprint 71 seed profile omits this — even the US profile has a clear national currency; it's the US *timezone* that's ambiguous, not its currency). */
  defaultCurrency?: string;

  /** IANA timezone, e.g. "Asia/Kolkata". Deliberately absent for the US profile — PART 3 of the Sprint 71 brief requires the US profile to never assume one national timezone; see that profile's own comment in regionalProfileRegistry.ts. */
  defaultTimezone?: string;

  /** Short structural guidance, e.g. "DD/MM/YYYY". */
  dateFormat: string;
  timeFormat: string;

  /** E.164 calling code, e.g. "+91". */
  phoneCountryCode: string;

  /** One short paragraph of structural (never legal) guidance on how addresses are typically formatted/labeled in this market. */
  addressFormat: string;

  /** e.g. "GST" / "VAT" / "Sales tax (state-dependent)" — the term this market uses, not a rate. */
  taxTerminology: string;

  /** Structural guidance only — never a rate, threshold, or filing deadline (PART "Factual Safety"/PART 14). */
  taxGuidance: string[];
  invoiceGuidance: string[];
  privacyGuidance: string[];
  dataProtectionGuidance: string[];
  accessibilityGuidance: string[];
  consumerProtectionGuidance: string[];
  paymentGuidance: string[];
  commerceGuidance: string[];
  dataResidencyGuidance: string[];
  deploymentGuidance: string[];
  complianceNotes: string[];

  sourceMetadata: RegionalProfileSourceMetadata;
}

/**
 * Every section key a role-family projection may draw from, excluding the identity/locale core
 * (`id`/`code`/`name`/`countryCode`/`regionCode`/`version`/`status`/`sourceMetadata`) which
 * every projection always carries as context, not as a "supplied section." Mirrors
 * `BLUEPRINT_CONTENT_SECTION_KEYS`'s role as the one place new guidance sections get added.
 */
export const REGIONAL_PROFILE_GUIDANCE_SECTION_KEYS = [
  'locale',
  'defaultCurrency',
  'defaultTimezone',
  'dateFormat',
  'timeFormat',
  'phoneCountryCode',
  'addressFormat',
  'taxTerminology',
  'taxGuidance',
  'invoiceGuidance',
  'privacyGuidance',
  'dataProtectionGuidance',
  'accessibilityGuidance',
  'consumerProtectionGuidance',
  'paymentGuidance',
  'commerceGuidance',
  'dataResidencyGuidance',
  'deploymentGuidance',
  'complianceNotes',
] as const satisfies readonly (keyof Omit<
  RegionalProfile,
  'id' | 'code' | 'name' | 'countryCode' | 'regionCode' | 'version' | 'status' | 'sourceMetadata'
>)[];

export type RegionalProfileGuidanceSectionKey = (typeof REGIONAL_PROFILE_GUIDANCE_SECTION_KEYS)[number];
