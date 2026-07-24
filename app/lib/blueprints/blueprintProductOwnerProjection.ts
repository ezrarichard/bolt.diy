import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → Product Owner Projection — Sprint 64 (Blueprint-Aware Product Ownership).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (Sprint 63), deliberately a SEPARATE,
 * dedicated projection rather than a reuse of the Business Analyst one — the two roles need
 * different sections of the same 24-section `BlueprintContent` (Sprint 60): the Business
 * Analyst needs domain/customer framing (executiveSummary, businessDomain, typicalCustomers,
 * customerPersonas, ...), the Product Owner needs MVP-planning material (which features are
 * standard vs optional, what a typical customer journey through this kind of business looks
 * like, what roadmap-relevant capabilities exist) — see this file's `PROJECTED_SECTION_KEYS`
 * for the exact 12-section list the Sprint 64 brief calls for.
 *
 * `resolveEffectiveBlueprintSelection` is intentionally NOT redefined here — it's imported from
 * the Sprint 63 module because it's genuinely role-agnostic (just "which Blueprint id, from
 * which source"), and the Sprint 64 brief explicitly calls out avoiding duplicate Blueprint
 * lookup logic. Importing a pure function from a sibling file is a read-only dependency — it
 * does not modify, and is not a redesign of, the Business Analyst engine or its projection.
 *
 * Pure, synchronous, side-effect-free — same rationale as blueprintBusinessAnalystProjection.ts's
 * own header comment: `buildersDbContextProvider.ts` (the orchestration layer) does the actual
 * `getLatestBlueprintResolution`/`blueprintEngine.getBlueprint` lookups; this file only shapes
 * and formats what it's given.
 */

export {
  resolveEffectiveBlueprintSelection,
  type EffectiveBlueprintSelectionInput,
  type EffectiveBlueprintSelection,
} from './blueprintBusinessAnalystProjection';

/**
 * The Product Owner's focused view of a Blueprint's structured content — MVP-planning material
 * only. Every field is optional, mirroring `BlueprintContent` itself: a Blueprint with sparse
 * content (6 of the current 9 have none at all yet) still produces a valid, mostly-empty
 * projection rather than an error.
 */
export interface ProductOwnerBlueprintContext {
  businessGoals?: BlueprintContent['businessGoals'];
  functionalModules?: BlueprintContent['functionalModules'];
  standardFeatures?: BlueprintContent['standardFeatures'];
  optionalFeatures?: BlueprintContent['optionalFeatures'];
  userRoles?: BlueprintContent['userRoles'];
  businessRules?: BlueprintContent['businessRules'];

  /** "Typical Customer Journeys" per the Sprint 64 brief — `BlueprintContent.coreBusinessProcesses` is the closest existing section (name/description/steps a customer or the business walks through). */
  coreBusinessProcesses?: BlueprintContent['coreBusinessProcesses'];
  compliance?: BlueprintContent['compliance'];
  integrations?: BlueprintContent['integrations'];
  reports?: BlueprintContent['reports'];
  notifications?: BlueprintContent['notifications'];
  futureEnhancements?: BlueprintContent['futureEnhancements'];
}

/** Every key `ProductOwnerBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'businessGoals',
  'functionalModules',
  'standardFeatures',
  'optionalFeatures',
  'userRoles',
  'businessRules',
  'coreBusinessProcesses',
  'compliance',
  'integrations',
  'reports',
  'notifications',
  'futureEnhancements',
] as const satisfies readonly (keyof ProductOwnerBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the Product Owner's 12 MVP-planning-relevant sections. Deterministic:
 * the same input always produces the same output, and a section absent from the source is
 * simply absent here too (never invented).
 */
export function projectBlueprintForProductOwner(
  content: BlueprintContent | undefined,
): ProductOwnerBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: ProductOwnerBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasProductOwnerBlueprintContent(projection: ProductOwnerBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 64 traceability requirement ("Sections supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: ProductOwnerBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Product Owner's
 * context (see `buildersDbContextProvider.ts`'s `buildProductOwnerBlueprintGuidance`). Carries
 * its own short "how to use this" instruction — MVP-planning specific: Blueprint standard/
 * optional features distinguish what's typically mandatory vs nice-to-have for this kind of
 * business, but the approved Requirements (already gathered from the customer, and already
 * Blueprint-informed via the Business Analyst — see Sprint 63) still govern what's actually in
 * scope for THIS MVP.
 */
export function formatProductOwnerBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: ProductOwnerBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for Product Planning (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'MVP-planning reference material for this kind of business, NOT confirmed scope. The approved Requirements (already gathered from this customer) govern productScope and currentMvp — never add a Blueprint-only feature into currentMvp.features merely because it appears here. Standard features below are common baseline expectations for this industry; optional features and future enhancements are candidates for "Consider adding..." / "Industry best practice..." notes (futureEnhancements or openQuestions), never automatic scope. If a Blueprint business rule or typical process conflicts with what the customer actually asked for, flag the conflict rather than resolving it silently — the customer wins.';

  if (!hasProductOwnerBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.businessGoals?.length) {
    sections.push(
      `Typical business goals for this kind of product:\n${projection.businessGoals.map((goal) => `- ${goal.goal} (${goal.priority}): ${goal.description}`).join('\n')}`,
    );
  }

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules:\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.standardFeatures?.length) {
    sections.push(
      `Standard (commonly baseline) features for this industry: ${formatList(projection.standardFeatures.map((f) => f.name))}`,
    );
  }

  if (projection?.optionalFeatures?.length) {
    sections.push(
      `Optional features — recommend, never auto-scope: ${formatList(projection.optionalFeatures.map((f) => f.name))}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(`Typical user roles: ${formatList(projection.userRoles.map((role) => role.name))}`);
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Common business rules:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.coreBusinessProcesses?.length) {
    sections.push(
      `Typical customer/business journeys:\n${projection.coreBusinessProcesses.map((process) => `- ${process.name}: ${process.description}${process.steps.length > 0 ? ` (${process.steps.join(' → ')})` : ''}`).join('\n')}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(`Compliance considerations: ${formatList(projection.compliance.map((item) => item.name))}`);
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations: ${formatList(projection.integrations.map((integration) => integration.name))}`,
    );
  }

  if (projection?.reports?.length) {
    sections.push(`Typical reports: ${formatList(projection.reports.map((report) => report.name))}`);
  }

  if (projection?.notifications?.length) {
    sections.push(`Typical notifications: ${formatList(projection.notifications.map((n) => n.name))}`);
  }

  if (projection?.futureEnhancements?.length) {
    sections.push(
      `Future enhancement ideas (roadmap candidates, not this MVP): ${formatList(projection.futureEnhancements.map((f) => f.idea))}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
