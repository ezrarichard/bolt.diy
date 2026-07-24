import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → Database Engineer Projection — Sprint 66 (Blueprint-Aware Database & Backend
 * Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), and `blueprintSolutionArchitectProjection.ts` (65) — deliberately a SEPARATE, dedicated
 * projection rather than a reuse of any of them. The Database Engineer needs the DATA-MODELING
 * relevant slice of the same 24-section `BlueprintContent` (Sprint 60): entities and their
 * relationships, the rules and roles that constrain them, and the compliance/security/
 * performance expectations that shape schema decisions (audit fields, retention, indexing).
 *
 * The Sprint 66 brief's requested topics map onto `BlueprintContent` sections as follows —
 * two of them (`Relationships`, `Audit requirements`) have no section of their own, so rather
 * than adding new `BlueprintContent` fields ("no new schema unless genuinely required" — this
 * sprint's own brief), they're satisfied by sections/fields that already carry that information:
 *   - Data Entities             -> dataEntities (kept FULL here — including keyFields and
 *     relationships — unlike Sprint 65's Solution Architect projection, which deliberately
 *     trims dataEntities to name+description "high level only". The Database Engineer is the
 *     role that actually owns schema/field/relationship-level design, so this is exactly where
 *     that detail belongs.)
 *   - Relationships             -> dataEntities[].relationships (each entity's own field; no
 *     separate top-level section exists)
 *   - Business Rules            -> businessRules
 *   - User Roles                -> userRoles
 *   - Integrations              -> integrations
 *   - Compliance                -> compliance
 *   - Audit requirements        -> compliance (audit trail / data-retention obligations are
 *     compliance concerns; no separate "audit" section exists) + security (mitigations
 *     sometimes describe audit logging directly)
 *   - Security expectations     -> security
 *   - Performance expectations  -> performanceExpectations
 *
 * Explicitly excluded: every UI-planning section (uiPatterns, navigation,
 * dashboardSuggestions, reports), every MVP-planning-only section (businessGoals,
 * standardFeatures, optionalFeatures, coreBusinessProcesses, futureEnhancements), and every
 * architecture-only-reasoning section this role doesn't need directly (executiveSummary,
 * businessDomain, typicalCustomers, customerPersonas, functionalModules,
 * deploymentConsiderations, notifications, testingScenarios) — per the Sprint 66 brief's
 * "Do NOT include UI planning. Do NOT include MVP planning. Do NOT include architecture-only
 * reasoning."
 *
 * `resolveEffectiveBlueprintSelection` is intentionally NOT redefined here — imported from the
 * Sprint 63 module because it's genuinely role-agnostic ("which Blueprint id, from which
 * source"), and the Sprint 66 brief explicitly calls out avoiding duplicate Blueprint lookup
 * logic, exactly as Sprint 64/65 already did.
 *
 * Pure, synchronous, side-effect-free — `buildersDbContextProvider.ts` (the orchestration
 * layer) does the actual `getLatestBlueprintResolution`/`blueprintEngine.getBlueprint`
 * lookups; this file only shapes and formats what it's given.
 */

export {
  resolveEffectiveBlueprintSelection,
  type EffectiveBlueprintSelectionInput,
  type EffectiveBlueprintSelection,
} from './blueprintBusinessAnalystProjection';

/**
 * The Database Engineer's focused view of a Blueprint's structured content — data-modeling
 * relevant material only. Every field is optional, mirroring `BlueprintContent` itself: a
 * Blueprint with sparse content (most of the current registry has none at all yet) still
 * produces a valid, mostly-empty projection rather than an error.
 */
export interface DatabaseBlueprintContext {
  /** Full detail (keyFields + relationships included) — see this file's header comment for why this differs from Sprint 65's Solution Architect projection. */
  dataEntities?: BlueprintContent['dataEntities'];
  businessRules?: BlueprintContent['businessRules'];
  userRoles?: BlueprintContent['userRoles'];
  integrations?: BlueprintContent['integrations'];
  compliance?: BlueprintContent['compliance'];
  security?: BlueprintContent['security'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
}

/** Every key `DatabaseBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'dataEntities',
  'businessRules',
  'userRoles',
  'integrations',
  'compliance',
  'security',
  'performanceExpectations',
] as const satisfies readonly (keyof DatabaseBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the Database Engineer's 7 data-modeling-relevant sections.
 * Deterministic: the same input always produces the same output, and a section absent from
 * the source is simply absent here too (never invented).
 */
export function projectBlueprintForDatabase(
  content: BlueprintContent | undefined,
): DatabaseBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: DatabaseBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasDatabaseBlueprintContent(projection: DatabaseBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 66 traceability requirement ("Sections supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: DatabaseBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Database Engineer's
 * context (see `buildersDbContextProvider.ts`'s `buildDatabaseBlueprintGuidance`). Carries its
 * own short "how to use this" instruction — schema-specific: this is data-modeling reference
 * knowledge for this kind of product (typical entities, relationships, audit/compliance/
 * security expectations that shape schema decisions), never a way to add tables/entities the
 * approved MVP doesn't need. The approved Business Analysis, Engineering Handoff (Product
 * Owner), and Architecture Draft remain the scope boundary.
 */
export function formatDatabaseBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: DatabaseBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for Database Design (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Data-modeling reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), and the approved Architecture Draft govern WHAT is built — this section only informs HOW to design the schema well: entity/relationship shape, useful indexes and constraints, audit fields, compliance-driven retention, and security-driven access patterns. Never add a table, entity, or field for a capability this Blueprint mentions but the approved MVP does not include. If Blueprint guidance conflicts with the approved outputs, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasDatabaseBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.dataEntities?.length) {
    sections.push(
      `Typical data entities for this kind of product (name, description, key fields, relationships):\n${projection.dataEntities
        .map(
          (entity) =>
            `- ${entity.name}: ${entity.description}${entity.keyFields.length > 0 ? ` | Key fields: ${entity.keyFields.join(', ')}` : ''}${entity.relationships.length > 0 ? ` | Relates to: ${entity.relationships.join(', ')}` : ''}`,
        )
        .join('\n')}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules with schema implications (constraints, validation logic):\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs row-level access patterns / ownership fields): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations (may need their own reference/lookup tables or external-id columns): ${formatList(projection.integrations.map((integration) => integration.name))}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(
      `Compliance considerations (may drive audit fields, retention policy, or soft-delete strategy): ${formatList(projection.compliance.map((item) => item.name))}`,
    );
  }

  if (projection?.security?.length) {
    sections.push(
      `Security expectations for this kind of product:\n${projection.security.map((item) => `- ${item.concern}: ${item.mitigation}`).join('\n')}`,
    );
  }

  if (projection?.performanceExpectations?.length) {
    sections.push(
      `Performance expectations (may inform indexing/caching decisions):\n${projection.performanceExpectations.map((item) => `- ${item.metric}: ${item.target}`).join('\n')}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
