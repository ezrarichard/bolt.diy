import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → UI/UX Designer Projection — Sprint 67 (Blueprint-Aware UI/UX & Frontend
 * Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), `blueprintSolutionArchitectProjection.ts` (65), `blueprintDatabaseProjection.ts` (66),
 * and `blueprintBackendProjection.ts` (66) — deliberately a SEPARATE, dedicated projection
 * rather than a reuse of any of them. The UI/UX Designer needs the journey/screen/interaction-
 * relevant slice of the same 24-section `BlueprintContent` (Sprint 60): typical user roles and
 * journeys, the screens/patterns/navigation this kind of product usually needs, and the
 * business rules/compliance considerations that shape those flows — not the data-modeling,
 * service, or deployment detail other projections own.
 *
 * The Sprint 67 brief's requested topics map onto `BlueprintContent` sections as follows:
 *   - User Roles                        -> userRoles
 *   - Functional Modules                -> functionalModules (drives information architecture)
 *   - Core Business Processes           -> coreBusinessProcesses (drives user journeys)
 *   - Standard Features                 -> standardFeatures (drives which screens exist)
 *   - UI Patterns                       -> uiPatterns
 *   - Navigation                        -> navigation
 *   - Dashboard Suggestions             -> dashboardSuggestions
 *   - Reports                           -> reports
 *   - Notifications                     -> notifications
 *   - Business Rules affecting flows    -> businessRules
 *   - Compliance-related UX considerations -> compliance
 *   - Industry terminology              -> businessDomain (industry/category naming; no
 *     dedicated "terminology" section exists in `BlueprintContent`)
 *
 * Explicitly excluded: data-modeling detail (dataEntities), service/API/deployment detail
 * (integrations, security, performanceExpectations, deploymentConsiderations — these inform
 * Backend design, not UI/UX), MVP-planning-only sections not needed at the UX level
 * (optionalFeatures, futureEnhancements), BA-only domain/customer sections beyond businessDomain
 * (executiveSummary, typicalCustomers, customerPersonas, businessGoals), and QA's
 * testingScenarios — per the Sprint 67 brief's exclusion list ("Detailed database schema",
 * "Backend service decomposition", "Deployment architecture", "Infrastructure details",
 * "Testing scenarios", "Full business planning").
 *
 * `resolveEffectiveBlueprintSelection` is intentionally NOT redefined here — imported from the
 * Sprint 63 module because it's genuinely role-agnostic ("which Blueprint id, from which
 * source"), and the Sprint 67 brief explicitly calls out reusing existing Blueprint resolution
 * logic rather than duplicating it, exactly as Sprints 64/65/66 already did.
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
 * The UI/UX Designer's focused view of a Blueprint's structured content — journey/screen/
 * interaction-relevant material only. Every field is optional, mirroring `BlueprintContent`
 * itself: a Blueprint with sparse content (most of the current registry has none at all yet)
 * still produces a valid, mostly-empty projection rather than an error.
 */
export interface UiUxBlueprintContext {
  userRoles?: BlueprintContent['userRoles'];
  functionalModules?: BlueprintContent['functionalModules'];
  coreBusinessProcesses?: BlueprintContent['coreBusinessProcesses'];
  standardFeatures?: BlueprintContent['standardFeatures'];
  uiPatterns?: BlueprintContent['uiPatterns'];
  navigation?: BlueprintContent['navigation'];
  dashboardSuggestions?: BlueprintContent['dashboardSuggestions'];
  reports?: BlueprintContent['reports'];
  notifications?: BlueprintContent['notifications'];
  businessRules?: BlueprintContent['businessRules'];
  compliance?: BlueprintContent['compliance'];
  businessDomain?: BlueprintContent['businessDomain'];
}

/** Every key `UiUxBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'userRoles',
  'functionalModules',
  'coreBusinessProcesses',
  'standardFeatures',
  'uiPatterns',
  'navigation',
  'dashboardSuggestions',
  'reports',
  'notifications',
  'businessRules',
  'compliance',
  'businessDomain',
] as const satisfies readonly (keyof UiUxBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the UI/UX Designer's 12 journey/screen-relevant sections.
 * Deterministic: the same input always produces the same output, and a section absent from the
 * source is simply absent here too (never invented).
 */
export function projectBlueprintForUiUx(content: BlueprintContent | undefined): UiUxBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: UiUxBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasUiUxBlueprintContent(projection: UiUxBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 67 traceability requirement ("Sections Supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: UiUxBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the UI/UX Designer's
 * context (see `buildersDbContextProvider.ts`'s `buildUIUXBlueprintGuidance`). Carries its own
 * short "how to use this" instruction — journey/screen-specific: this is UX reference knowledge
 * for this kind of product (typical roles, journeys, screens, navigation, dashboards, reports,
 * notification patterns), never a way to add screens or flows the approved MVP doesn't need.
 * The approved Business Analysis, Engineering Handoff (Product Owner), Architecture Draft, and
 * Database Design remain the scope boundary.
 */
export function formatUiUxBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: UiUxBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for UI/UX Design (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'UX-design reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), the approved Architecture Draft, and the approved Database Design govern WHAT is built — this section only informs HOW to design approved screens, journeys, and interactions well: information architecture, page hierarchy, navigation, role-specific experiences, forms, dashboards, reports, and notification/feedback patterns typical for this kind of product. Never add a screen, journey, or flow for a capability this Blueprint mentions but the approved MVP does not include. If Blueprint guidance conflicts with the approved outputs, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasUiUxBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs role-specific experiences and navigation): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for information architecture):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.coreBusinessProcesses?.length) {
    sections.push(
      `Typical core business processes (informs user journeys):\n${projection.coreBusinessProcesses.map((process) => `- ${process.name}: ${process.description}`).join('\n')}`,
    );
  }

  if (projection?.standardFeatures?.length) {
    sections.push(
      `Standard features for this kind of product (only relevant where already approved in the MVP):\n${projection.standardFeatures.map((feature) => `- ${feature.name}: ${feature.description}`).join('\n')}`,
    );
  }

  if (projection?.uiPatterns?.length) {
    sections.push(
      `Typical UI patterns:\n${projection.uiPatterns.map((pattern) => `- ${pattern.name}: ${pattern.description}`).join('\n')}`,
    );
  }

  if (projection?.navigation?.length) {
    sections.push(
      `Typical navigation structure:\n${projection.navigation.map((item) => `- ${item.label}: ${item.description}`).join('\n')}`,
    );
  }

  if (projection?.dashboardSuggestions?.length) {
    sections.push(
      `Typical dashboard suggestions (only relevant where a dashboard is already approved in the MVP):\n${projection.dashboardSuggestions.map((dashboard) => `- ${dashboard.name}: ${dashboard.description}`).join('\n')}`,
    );
  }

  if (projection?.reports?.length) {
    sections.push(
      `Typical reports (only relevant where reporting is already approved in the MVP):\n${projection.reports.map((report) => `- ${report.name} (for ${report.audience}): ${report.description}`).join('\n')}`,
    );
  }

  if (projection?.notifications?.length) {
    sections.push(
      `Typical notifications (informs notification/feedback UX patterns):\n${projection.notifications.map((n) => `- ${n.name} — triggered by ${n.trigger}, via ${n.channel}`).join('\n')}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules with user-flow implications:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(
      `Compliance considerations that may affect the UX:\n${projection.compliance.map((item) => `- ${item.name}${item.region ? ` (${item.region})` : ''}: ${item.description}`).join('\n')}`,
    );
  }

  if (projection?.businessDomain) {
    sections.push(
      `Industry context (informs terminology): ${projection.businessDomain.industry} — ${projection.businessDomain.category}. ${projection.businessDomain.description}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
