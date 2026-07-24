import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → DevOps Engineer Projection — Sprint 68 (Blueprint-Aware QA & DevOps Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), `blueprintSolutionArchitectProjection.ts` (65), `blueprintDatabaseProjection.ts` (66),
 * `blueprintBackendProjection.ts` (66), `blueprintUiUxProjection.ts` (67),
 * `blueprintFrontendProjection.ts` (67), and `blueprintQaProjection.ts` (68) — deliberately a
 * SEPARATE, dedicated projection rather than a reuse of any of them (in particular, NOT a reuse
 * of the Solution Architect or Backend projections, even though all three touch
 * `integrations`/`security`/`performanceExpectations`/`deploymentConsiderations`). The DevOps
 * Engineer needs the operationally-relevant slice: what to deploy and operate, what needs
 * monitoring/alerting, what access/administrative roles need operational support, and what
 * compliance/security/reliability expectations shape operations — not the design-time
 * architecture or implementation detail other projections own.
 *
 * The Sprint 68 brief's requested topics map onto `BlueprintContent` sections as follows:
 *   - Integrations                          -> integrations
 *   - Security                              -> security
 *   - Compliance                            -> compliance
 *   - Performance Expectations              -> performanceExpectations
 *   - Deployment Considerations              -> deploymentConsiderations
 *   - Notifications (operational alerting)  -> notifications
 *   - Functional Modules (deployment boundaries) -> functionalModules
 *   - User Roles (access/admin operations)  -> userRoles
 *   - Business Rules (operational reliability) -> businessRules
 *   - Availability expectations              -> performanceExpectations +
 *     deploymentConsiderations together (no dedicated "availability" section exists; an
 *     availability target is either a performance metric or a deployment consideration
 *     depending on how a given Blueprint author phrased it)
 *   - Backup/recovery expectations           -> deploymentConsiderations, when a Blueprint's
 *     entries happen to describe them (no dedicated "backup" section exists; never invented
 *     when absent)
 *   - Data retention considerations          -> compliance + security, when represented there
 *     (no dedicated "data retention" section exists)
 *
 * Explicitly excluded: every UI-specific section (uiPatterns, navigation,
 * dashboardSuggestions), reports (a UI/UX-level product decision, not an operational input —
 * per the Sprint 68 brief's "Reports excluded unless operationally relevant", and no Blueprint
 * section distinguishes an operational report from a product one), detailed database schema
 * (dataEntities — the Database Engineer's concern), MVP-planning-only sections
 * (businessGoals, standardFeatures, optionalFeatures, coreBusinessProcesses,
 * futureEnhancements), BA-only domain/customer sections (executiveSummary, businessDomain,
 * typicalCustomers, customerPersonas), and QA's testingScenarios — per the Sprint 68 brief's
 * exclusion list.
 *
 * `resolveEffectiveBlueprintSelection` is intentionally NOT redefined here — imported from the
 * Sprint 63 module because it's genuinely role-agnostic ("which Blueprint id, from which
 * source"), and the Sprint 68 brief explicitly calls out reusing existing Blueprint resolution
 * logic rather than duplicating it, exactly as every prior Blueprint-aware sprint already did.
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
 * The DevOps Engineer's focused view of a Blueprint's structured content — operationally
 * relevant material only. Every field is optional, mirroring `BlueprintContent` itself: a
 * Blueprint with sparse content (most of the current registry has none at all yet) still
 * produces a valid, mostly-empty projection rather than an error.
 */
export interface DevOpsBlueprintContext {
  integrations?: BlueprintContent['integrations'];
  security?: BlueprintContent['security'];
  compliance?: BlueprintContent['compliance'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
  deploymentConsiderations?: BlueprintContent['deploymentConsiderations'];
  notifications?: BlueprintContent['notifications'];
  functionalModules?: BlueprintContent['functionalModules'];
  userRoles?: BlueprintContent['userRoles'];
  businessRules?: BlueprintContent['businessRules'];
}

/** Every key `DevOpsBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'integrations',
  'security',
  'compliance',
  'performanceExpectations',
  'deploymentConsiderations',
  'notifications',
  'functionalModules',
  'userRoles',
  'businessRules',
] as const satisfies readonly (keyof DevOpsBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the DevOps Engineer's 9 operationally-relevant sections. Deterministic:
 * the same input always produces the same output, and a section absent from the source is
 * simply absent here too (never invented).
 */
export function projectBlueprintForDevOps(content: BlueprintContent | undefined): DevOpsBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: DevOpsBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasDevOpsBlueprintContent(projection: DevOpsBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 68 traceability requirement ("Sections Supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: DevOpsBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the DevOps Engineer's
 * context (see `buildersDbContextProvider.ts`'s `buildDevOpsBlueprintGuidance`). Carries its
 * own short "how to use this" instruction — operations-specific: this is deployment/operations
 * reference knowledge for this kind of product (typical deployment boundaries, integrations,
 * operational alerting, access/admin roles, and security/compliance/performance expectations),
 * never a reason to add infrastructure, services, or regions the approved architecture and
 * scale don't need.
 */
export function formatDevOpsBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: DevOpsBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for DevOps Operations (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Deployment/operations reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), the approved Architecture Draft, Database Design, Backend Design, UI/UX Design, Frontend Design, and QA Draft govern WHAT was built and therefore WHAT must be operated — this section only informs HOW to operate it well: deployment boundaries, integration/notification operations, access/administrative role support, and security/compliance/performance/availability posture typical for this kind of product. Never add infrastructure, a service, a region, or a monitoring/authentication provider this Blueprint mentions as typical but the approved architecture and scale do not justify — prefer the simplest production-appropriate deployment that satisfies the approved MVP. If Blueprint guidance conflicts with the approved outputs, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasDevOpsBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations / external systems to operate:\n${projection.integrations.map((integration) => `- ${integration.name} (${integration.required ? 'commonly required' : 'optional'}): ${integration.purpose}`).join('\n')}`,
    );
  }

  if (projection?.security?.length) {
    sections.push(
      `Security expectations for this kind of product (informs security hardening):\n${projection.security.map((item) => `- ${item.concern}: ${item.mitigation}`).join('\n')}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(
      `Compliance considerations (informs compliance-aware operations and data retention):\n${projection.compliance.map((item) => `- ${item.name}${item.region ? ` (${item.region})` : ''}: ${item.description}`).join('\n')}`,
    );
  }

  if (projection?.performanceExpectations?.length) {
    sections.push(
      `Performance expectations (informs scaling and availability planning):\n${projection.performanceExpectations.map((item) => `- ${item.metric}: ${item.target}`).join('\n')}`,
    );
  }

  if (projection?.deploymentConsiderations?.length) {
    sections.push(
      `Deployment considerations (informs deployment architecture, availability, and backup/recovery where represented):\n${projection.deploymentConsiderations.map((item) => `- ${item.consideration}: ${item.detail}`).join('\n')}`,
    );
  }

  if (projection?.notifications?.length) {
    sections.push(
      `Typical notifications (informs operational alerting design):\n${projection.notifications.map((n) => `- ${n.name} — triggered by ${n.trigger}, via ${n.channel}`).join('\n')}`,
    );
  }

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for deployment boundaries):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs access control and administrative operations): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules with operational-reliability implications:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
