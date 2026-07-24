import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → Frontend Engineer Projection — Sprint 67 (Blueprint-Aware UI/UX & Frontend
 * Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), `blueprintSolutionArchitectProjection.ts` (65), `blueprintDatabaseProjection.ts` (66),
 * `blueprintBackendProjection.ts` (66), and `blueprintUiUxProjection.ts` (67) — deliberately a
 * SEPARATE, dedicated projection rather than a reuse of any of them (in particular, NOT a reuse
 * of the UI/UX projection directly, even though both draw from `BlueprintContent`). The
 * Frontend Engineer needs the implementation-relevant slice: functional modules, roles,
 * navigation/UI patterns, notifications/reports (to shape component and state design),
 * validation-relevant business rules, browser-relevant security, performance expectations, and
 * approved integration expectations — not the data-modeling, service-internals, or deployment
 * detail other projections own.
 *
 * The Sprint 67 brief's requested topics map onto `BlueprintContent` sections as follows:
 *   - Functional Modules                      -> functionalModules (component/route decomposition)
 *   - User Roles                               -> userRoles (access-control handling)
 *   - UI Patterns                               -> uiPatterns
 *   - Navigation                                -> navigation (route structure)
 *   - Notifications                             -> notifications
 *   - Reports                                   -> reports (only relevant where already approved)
 *   - Performance Expectations                  -> performanceExpectations
 *   - Security considerations relevant to browser -> security (client-facing subset, e.g. XSS/
 *     input handling, is naturally what a Blueprint's `security` entries tend to describe;
 *     there is no separate "browser security" section)
 *   - Business Rules affecting validation/interaction -> businessRules
 *   - Responsive expectations                   -> no dedicated section exists; the brief's
 *     "responsive implementation" guidance instead comes from the approved UI/UX Draft
 *     (mobile/tablet/desktop experience fields), not from Blueprint content — intentionally NOT
 *     invented as a new `BlueprintContent` field per this sprint's "no new schema" constraint
 *   - Industry terminology                      -> not projected here; the UI/UX Designer
 *     already surfaces `businessDomain` for terminology, and the Frontend Engineer receives the
 *     approved UI/UX Draft (which will already use that terminology) as its own upstream input
 *   - Approved frontend integration expectations -> integrations (what the frontend needs to
 *     present/wire up for, e.g. a payment button — never a reason to add an integration the
 *     approved Backend Design doesn't already implement)
 *
 * Explicitly excluded: data-modeling detail (dataEntities), deployment-only detail
 * (deploymentConsiderations), MVP-planning-only sections (businessGoals, standardFeatures,
 * optionalFeatures, coreBusinessProcesses, futureEnhancements), BA-only domain/customer
 * sections (executiveSummary, businessDomain, typicalCustomers, customerPersonas), compliance
 * (a Database/Backend concern here, not a frontend-implementation one), dashboardSuggestions
 * (a UI/UX-level product decision, not a frontend-implementation input), and QA's
 * testingScenarios — per the Sprint 67 brief's exclusion list ("Detailed database entities",
 * "Backend internals", "Infrastructure implementation", "DevOps guidance", "QA scenarios",
 * "Planning-only content").
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
 * The Frontend Engineer's focused view of a Blueprint's structured content —
 * implementation-relevant material only. Every field is optional, mirroring `BlueprintContent`
 * itself: a Blueprint with sparse content (most of the current registry has none at all yet)
 * still produces a valid, mostly-empty projection rather than an error.
 */
export interface FrontendBlueprintContext {
  functionalModules?: BlueprintContent['functionalModules'];
  userRoles?: BlueprintContent['userRoles'];
  uiPatterns?: BlueprintContent['uiPatterns'];
  navigation?: BlueprintContent['navigation'];
  notifications?: BlueprintContent['notifications'];
  reports?: BlueprintContent['reports'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
  security?: BlueprintContent['security'];
  businessRules?: BlueprintContent['businessRules'];
  integrations?: BlueprintContent['integrations'];
}

/** Every key `FrontendBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'functionalModules',
  'userRoles',
  'uiPatterns',
  'navigation',
  'notifications',
  'reports',
  'performanceExpectations',
  'security',
  'businessRules',
  'integrations',
] as const satisfies readonly (keyof FrontendBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the Frontend Engineer's 10 implementation-relevant sections.
 * Deterministic: the same input always produces the same output, and a section absent from the
 * source is simply absent here too (never invented).
 */
export function projectBlueprintForFrontend(
  content: BlueprintContent | undefined,
): FrontendBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: FrontendBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasFrontendBlueprintContent(projection: FrontendBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 67 traceability requirement ("Sections Supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: FrontendBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Frontend Engineer's
 * context (see `buildersDbContextProvider.ts`'s `buildFrontendBlueprintGuidance`). Carries its
 * own short "how to use this" instruction — implementation-specific: this is frontend
 * reference knowledge for this kind of product (typical modules, roles, UI patterns,
 * navigation, notifications, reports, performance/security expectations, integration
 * expectations), never a way to add routes, features, or business functionality the approved
 * UI/UX and backend design don't already include.
 */
export function formatFrontendBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: FrontendBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for Frontend Implementation (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Frontend-implementation reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), the approved Architecture Draft, the approved Database Design, and — above all for this role — the approved UI/UX Design and Backend Design govern WHAT is built — this section only informs HOW to implement the approved frontend well: component decomposition, route structure, state management, form validation, access-control handling, notification/report rendering, and responsive/performance/security implementation. Never add a route, feature, authentication flow, payment flow, dashboard, or report the approved UI/UX Design and Backend Design do not already include, even when this Blueprint treats it as standard for the industry. If Blueprint guidance conflicts with the approved UI/UX or Backend Design, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasFrontendBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for component/route decomposition):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs access-control handling): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.uiPatterns?.length) {
    sections.push(
      `Typical UI patterns to implement:\n${projection.uiPatterns.map((pattern) => `- ${pattern.name}: ${pattern.description}`).join('\n')}`,
    );
  }

  if (projection?.navigation?.length) {
    sections.push(
      `Typical navigation / route structure:\n${projection.navigation.map((item) => `- ${item.label}: ${item.description}`).join('\n')}`,
    );
  }

  if (projection?.notifications?.length) {
    sections.push(
      `Typical notifications (informs client-side notification rendering):\n${projection.notifications.map((n) => `- ${n.name} — triggered by ${n.trigger}, via ${n.channel}`).join('\n')}`,
    );
  }

  if (projection?.reports?.length) {
    sections.push(
      `Typical reports (only relevant where reporting is already approved in the MVP):\n${projection.reports.map((report) => `- ${report.name} (for ${report.audience}): ${report.description}`).join('\n')}`,
    );
  }

  if (projection?.performanceExpectations?.length) {
    sections.push(
      `Performance expectations:\n${projection.performanceExpectations.map((item) => `- ${item.metric}: ${item.target}`).join('\n')}`,
    );
  }

  if (projection?.security?.length) {
    sections.push(
      `Browser-relevant security expectations:\n${projection.security.map((item) => `- ${item.concern}: ${item.mitigation}`).join('\n')}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules with validation/interaction implications:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations (only relevant where already implemented by the approved Backend Design):\n${projection.integrations.map((integration) => `- ${integration.name} (${integration.required ? 'commonly required' : 'optional'}): ${integration.purpose}`).join('\n')}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
