import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → Backend Engineer Projection — Sprint 66 (Blueprint-Aware Database & Backend
 * Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), `blueprintSolutionArchitectProjection.ts` (65), and `blueprintDatabaseProjection.ts`
 * (66) — deliberately a SEPARATE, dedicated projection rather than a reuse of any of them. The
 * Backend Engineer needs the SERVICE/API-relevant slice of the same 24-section
 * `BlueprintContent` (Sprint 60): module/service boundaries, the external systems it talks to,
 * the rules its business logic must enforce, and the security/performance/deployment
 * expectations that shape API design — not the data-modeling detail Sprint 66's Database
 * projection owns, and not the domain/customer framing earlier projections own.
 *
 * The Sprint 66 brief's requested topics map onto `BlueprintContent` sections as follows — two
 * of them (`API expectations`, `Authentication expectations`) have no dedicated section of
 * their own, so rather than adding new `BlueprintContent` fields ("no new schema unless
 * genuinely required" — this sprint's own brief), they're satisfied by sections that already
 * carry that information:
 *   - Functional Modules          -> functionalModules (a service boundary starting point)
 *   - Business Rules              -> businessRules
 *   - Integrations                -> integrations
 *   - External Systems            -> integrations (same reasoning as Sprint 65's Solution
 *     Architect projection: a Blueprint "integration" IS an external system this kind of
 *     product typically talks to; no separate section exists)
 *   - Notifications                -> notifications
 *   - Security                    -> security
 *   - API expectations            -> functionalModules + integrations together (the shape of
 *     the API surface follows directly from what modules/services and what integrations exist;
 *     there is no single dedicated "API" section to project instead)
 *   - Authentication expectations -> userRoles + security together (roles inform
 *     authorization design, security concerns inform authentication posture; no separate
 *     "authentication" section exists)
 *   - Performance                 -> performanceExpectations
 *   - Deployment considerations   -> deploymentConsiderations
 *
 * Explicitly excluded: every UI-planning section (uiPatterns, navigation,
 * dashboardSuggestions, reports), every MVP-planning-only section (businessGoals,
 * standardFeatures, optionalFeatures, coreBusinessProcesses, futureEnhancements), every
 * BA-only domain/customer section (executiveSummary, businessDomain, typicalCustomers,
 * customerPersonas), and the data-modeling detail (dataEntities, compliance) that
 * `blueprintDatabaseProjection.ts` already owns — per the Sprint 66 brief's "Do not expose
 * irrelevant Blueprint sections."
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
 * The Backend Engineer's focused view of a Blueprint's structured content — service/API-
 * relevant material only. Every field is optional, mirroring `BlueprintContent` itself: a
 * Blueprint with sparse content (most of the current registry has none at all yet) still
 * produces a valid, mostly-empty projection rather than an error.
 */
export interface BackendBlueprintContext {
  functionalModules?: BlueprintContent['functionalModules'];
  businessRules?: BlueprintContent['businessRules'];
  integrations?: BlueprintContent['integrations'];
  notifications?: BlueprintContent['notifications'];
  userRoles?: BlueprintContent['userRoles'];
  security?: BlueprintContent['security'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
  deploymentConsiderations?: BlueprintContent['deploymentConsiderations'];
}

/** Every key `BackendBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'functionalModules',
  'businessRules',
  'integrations',
  'notifications',
  'userRoles',
  'security',
  'performanceExpectations',
  'deploymentConsiderations',
] as const satisfies readonly (keyof BackendBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the Backend Engineer's 8 service/API-relevant sections. Deterministic:
 * the same input always produces the same output, and a section absent from the source is
 * simply absent here too (never invented).
 */
export function projectBlueprintForBackend(content: BlueprintContent | undefined): BackendBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: BackendBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasBackendBlueprintContent(projection: BackendBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 66 traceability requirement ("Sections supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: BackendBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Backend Engineer's
 * context (see `buildersDbContextProvider.ts`'s `buildBackendBlueprintGuidance`). Carries its
 * own short "how to use this" instruction — service/API-specific: this is backend-design
 * reference knowledge for this kind of product (typical service boundaries, integrations,
 * notification flows, security/performance/deployment patterns), never a way to add
 * endpoints/services the approved MVP doesn't need. The approved Business Analysis, Engineering
 * Handoff (Product Owner), Architecture Draft, and Database Design remain the scope boundary.
 */
export function formatBackendBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: BackendBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for Backend Design (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Service/API-design reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), the approved Architecture Draft, and the approved Database Design govern WHAT is built — this section only informs HOW to design the backend well: service decomposition, integration/notification handling, authentication/authorization posture, and security/performance/deployment patterns. Never add an endpoint, service, or integration for a capability this Blueprint mentions but the approved MVP does not include. If Blueprint guidance conflicts with the approved outputs, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasBackendBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for service/API boundaries):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules with service-logic implications:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations / external systems:\n${projection.integrations.map((integration) => `- ${integration.name} (${integration.required ? 'commonly required' : 'optional'}): ${integration.purpose}`).join('\n')}`,
    );
  }

  if (projection?.notifications?.length) {
    sections.push(
      `Typical notifications (informs notification service/queue design):\n${projection.notifications.map((n) => `- ${n.name} — triggered by ${n.trigger}, via ${n.channel}`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs authentication/authorization design): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.security?.length) {
    sections.push(
      `Security expectations for this kind of product:\n${projection.security.map((item) => `- ${item.concern}: ${item.mitigation}`).join('\n')}`,
    );
  }

  if (projection?.performanceExpectations?.length) {
    sections.push(
      `Performance expectations:\n${projection.performanceExpectations.map((item) => `- ${item.metric}: ${item.target}`).join('\n')}`,
    );
  }

  if (projection?.deploymentConsiderations?.length) {
    sections.push(
      `Deployment considerations:\n${projection.deploymentConsiderations.map((item) => `- ${item.consideration}: ${item.detail}`).join('\n')}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
