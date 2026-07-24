import {
  BLUEPRINT_CONTENT_SECTION_KEYS,
  SUPPORTED_BLUEPRINT_CONTENT_SCHEMA_VERSIONS,
  type BlueprintContent,
  type BlueprintContentSectionKey,
} from './blueprintContentTypes';

/**
 * Blueprint Content Validation — Sprint 60 (Blueprint Knowledge Foundation).
 *
 * Pure, dependency-free validation over `BlueprintContent` objects — no BuildersDB access, no AI
 * call, no UI. Used today only by this sprint's own verification (confirming the three
 * production blueprints are actually complete) and by `blueprintPortability.ts`'s import path;
 * nothing in the existing Builders pipeline calls this yet.
 */

/**
 * A minimum bar for a blueprint to be considered "reference quality" — the Sprint 60 brief's own
 * curated subset of the full section list, not every section. A blueprint missing an optional
 * section (e.g. `futureEnhancements`) is still valid; missing one of these is not.
 */
export const REQUIRED_BLUEPRINT_CONTENT_SECTIONS: readonly BlueprintContentSectionKey[] = [
  'executiveSummary',
  'businessDomain',
  'typicalCustomers',
  'businessGoals',
  'functionalModules',
  'standardFeatures',
  'userRoles',
  'dataEntities',
];

export interface BlueprintContentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];

  /** 0-100 — proportion of ALL known sections (not just the required ones) that are populated. */
  completeness: number;

  /** Which of `BLUEPRINT_CONTENT_SECTION_KEYS` actually have content. */
  populatedSections: BlueprintContentSectionKey[];

  /** Which of `REQUIRED_BLUEPRINT_CONTENT_SECTIONS` are missing or empty. */
  missingRequiredSections: BlueprintContentSectionKey[];
}

export function isSupportedBlueprintContentSchemaVersion(version: number): boolean {
  return SUPPORTED_BLUEPRINT_CONTENT_SCHEMA_VERSIONS.includes(version);
}

/** Whether a section's value counts as "populated" — a non-empty array, or a non-null object with at least one truthy string field. */
function isSectionPopulated(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((field) =>
      typeof field === 'string' ? field.trim().length > 0 : field !== undefined && field !== null,
    );
  }

  return false;
}

/**
 * Shape-level checks for one populated array-of-objects section — every item must be a plain
 * object (never a bare string/number, which the type system already prevents at compile time,
 * but content loaded from BuildersDB is untyped `jsonb` at the boundary, so this is the runtime
 * equivalent of that compile-time guarantee).
 */
/** The one section that's an array of plain strings rather than an array of objects — see `BlueprintContent.typicalCustomers`. */
const STRING_ARRAY_SECTION_KEYS: readonly BlueprintContentSectionKey[] = ['typicalCustomers'];

function validateArraySectionShape(sectionKey: BlueprintContentSectionKey, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  const expectString = STRING_ARRAY_SECTION_KEYS.includes(sectionKey);

  value.forEach((item, index) => {
    const isValid = expectString
      ? typeof item === 'string' && item.trim().length > 0
      : item !== null && typeof item === 'object' && !Array.isArray(item);

    if (!isValid) {
      errors.push(`"${sectionKey}[${index}]" must be ${expectString ? 'a non-empty string' : 'an object'}.`);
    }
  });
}

/**
 * Validates one `BlueprintContent` object: schema-version compatibility, presence of every
 * required section (per `REQUIRED_BLUEPRINT_CONTENT_SECTIONS`), basic per-item shape, and an
 * overall completeness score across every known section. Never throws — a malformed `content`
 * blob produces `valid: false` with explanatory `errors`, matching every other validator/parser
 * convention already used in this codebase (e.g. `draftParsing.ts`).
 */
export function validateBlueprintContent(content: BlueprintContent | undefined): BlueprintContentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content) {
    return {
      valid: false,
      errors: ['Blueprint has no content.'],
      warnings: [],
      completeness: 0,
      populatedSections: [],
      missingRequiredSections: [...REQUIRED_BLUEPRINT_CONTENT_SECTIONS],
    };
  }

  if (typeof content.schemaVersion !== 'number') {
    errors.push('content.schemaVersion is required and must be a number.');
  } else if (!isSupportedBlueprintContentSchemaVersion(content.schemaVersion)) {
    errors.push(
      `content.schemaVersion ${content.schemaVersion} is not supported (supported: ${SUPPORTED_BLUEPRINT_CONTENT_SCHEMA_VERSIONS.join(', ')}).`,
    );
  }

  const populatedSections: BlueprintContentSectionKey[] = [];

  for (const sectionKey of BLUEPRINT_CONTENT_SECTION_KEYS) {
    const value = content[sectionKey];

    if (isSectionPopulated(value)) {
      populatedSections.push(sectionKey);
      validateArraySectionShape(sectionKey, value, errors);
    }
  }

  const missingRequiredSections = REQUIRED_BLUEPRINT_CONTENT_SECTIONS.filter(
    (sectionKey) => !populatedSections.includes(sectionKey),
  );

  for (const sectionKey of missingRequiredSections) {
    errors.push(`Missing required section: "${sectionKey}".`);
  }

  const optionalSectionCount = BLUEPRINT_CONTENT_SECTION_KEYS.length - REQUIRED_BLUEPRINT_CONTENT_SECTIONS.length;
  const populatedOptionalCount = populatedSections.filter(
    (sectionKey) => !REQUIRED_BLUEPRINT_CONTENT_SECTIONS.includes(sectionKey),
  ).length;

  if (optionalSectionCount > 0 && populatedOptionalCount < optionalSectionCount) {
    warnings.push(
      `${optionalSectionCount - populatedOptionalCount} optional section(s) are not yet populated — content is valid but not maximally complete.`,
    );
  }

  const completeness = Math.round((populatedSections.length / BLUEPRINT_CONTENT_SECTION_KEYS.length) * 100);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    completeness,
    populatedSections,
    missingRequiredSections,
  };
}
