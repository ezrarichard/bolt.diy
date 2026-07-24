import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → Solution Architect Projection — Sprint 65 (Blueprint-Aware Solution
 * Architecture).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (Sprint 63) and
 * `blueprintProductOwnerProjection.ts` (Sprint 64), deliberately a SEPARATE, dedicated
 * projection rather than a reuse of either — the Solution Architect needs neither the
 * Business Analyst's domain/customer framing nor the Product Owner's MVP-planning material
 * (which features are standard vs optional, typical customer journeys); it needs the
 * ARCHITECTURALLY relevant slice of the same 24-section `BlueprintContent` (Sprint 60): the
 * shape of the system, not the shape of the business plan.
 *
 * The Sprint 65 brief's requested topics map onto `BlueprintContent` sections as follows —
 * two of them (`External Systems`, `Non-functional Requirements`) have no dedicated section
 * of their own, so rather than adding new `BlueprintContent` fields ("no new schema unless
 * genuinely required" — this sprint's own brief), they're satisfied by sections that already
 * carry that information:
 *   - Business Domain            -> businessDomain
 *   - Functional Modules         -> functionalModules
 *   - User Roles                 -> userRoles
 *   - Integrations               -> integrations
 *   - Business Rules             -> businessRules
 *   - Security Expectations      -> security
 *   - Performance Expectations   -> performanceExpectations
 *   - Deployment Considerations  -> deploymentConsiderations
 *   - Data Entities (high level) -> dataEntities (formatted name+description only — see
 *     `formatSolutionArchitectBlueprintGuidanceSection` below; the Database Engineer, not this
 *     role, still owns full field/relationship-level schema design)
 *   - External Systems           -> integrations (a Blueprint "integration" IS an external
 *     system this kind of product typically talks to; no separate section exists)
 *   - Non-functional Requirements -> security + performanceExpectations +
 *     deploymentConsiderations together (NFRs, by definition, span exactly these three
 *     Blueprint sections; there is no single dedicated "NFR" section to project instead)
 *   - `compliance` is also included — compliance constraints (data residency, regulatory
 *     retention, etc.) directly shape deployment/security architecture, even though the
 *     section itself isn't named in the Sprint 65 brief's example list.
 *
 * Explicitly excluded: every Business-Analyst-only section (executiveSummary,
 * businessDomain's customer-facing siblings typicalCustomers/customerPersonas),
 * every planning-only section (businessGoals, standardFeatures, optionalFeatures,
 * coreBusinessProcesses, futureEnhancements), and every UI-specific section (uiPatterns,
 * navigation, dashboardSuggestions, reports, notifications, testingScenarios) — per the
 * Sprint 65 brief's "Exclude planning-only sections. Exclude UI-specific sections."
 *
 * `resolveEffectiveBlueprintSelection` is intentionally NOT redefined here — imported from
 * the Sprint 63 module because it's genuinely role-agnostic ("which Blueprint id, from which
 * source"), and the Sprint 65 brief explicitly calls out avoiding duplicate Blueprint lookup
 * logic, exactly as Sprint 64 already did.
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
 * The Solution Architect's focused view of a Blueprint's structured content —
 * architecture-relevant material only. Every field is optional, mirroring `BlueprintContent`
 * itself: a Blueprint with sparse content (most of the current registry has none at all yet)
 * still produces a valid, mostly-empty projection rather than an error.
 */
export interface SolutionArchitectBlueprintContext {
  businessDomain?: BlueprintContent['businessDomain'];
  functionalModules?: BlueprintContent['functionalModules'];
  userRoles?: BlueprintContent['userRoles'];
  businessRules?: BlueprintContent['businessRules'];
  integrations?: BlueprintContent['integrations'];
  compliance?: BlueprintContent['compliance'];

  /** High-level only — see this file's header comment. Formatted as name+description; keyFields/relationships are intentionally never surfaced to this role. */
  dataEntities?: BlueprintContent['dataEntities'];
  security?: BlueprintContent['security'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
  deploymentConsiderations?: BlueprintContent['deploymentConsiderations'];
}

/** Every key `SolutionArchitectBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'businessDomain',
  'functionalModules',
  'userRoles',
  'businessRules',
  'integrations',
  'compliance',
  'dataEntities',
  'security',
  'performanceExpectations',
  'deploymentConsiderations',
] as const satisfies readonly (keyof SolutionArchitectBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the Solution Architect's 10 architecture-relevant sections.
 * Deterministic: the same input always produces the same output, and a section absent from
 * the source is simply absent here too (never invented).
 */
export function projectBlueprintForSolutionArchitect(
  content: BlueprintContent | undefined,
): SolutionArchitectBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: SolutionArchitectBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasSolutionArchitectBlueprintContent(
  projection: SolutionArchitectBlueprintContext | undefined,
): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 65 traceability requirement ("Sections supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: SolutionArchitectBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Solution
 * Architect's context (see `buildersDbContextProvider.ts`'s
 * `buildSolutionArchitectBlueprintGuidance`). Carries its own short "how to use this"
 * instruction — architecture-specific: this is architectural GUIDANCE for this kind of
 * product (module boundaries, integration surface, security/performance/deployment
 * patterns), never a way to expand the approved MVP. The approved Business Analysis and
 * Engineering Handoff (Product Owner) remain the scope boundary; Blueprint knowledge only
 * ever improves HOW that already-approved scope is architected, never WHAT is built.
 */
export function formatSolutionArchitectBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: SolutionArchitectBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for Solution Architecture (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Architectural reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis and the Engineering Handoff from the AI Product Owner (in-scope features, out-of-scope boundary) govern WHAT is built — this section only informs HOW to architect it well: module decomposition, service boundaries, integration planning, security posture, performance targets, and deployment strategy. Never design for a capability this Blueprint mentions but the approved MVP does not include. If Blueprint guidance conflicts with the approved Business Analysis or Engineering Handoff, the approved outputs win — note the conflict in openQuestions rather than resolving it silently.';

  if (!hasSolutionArchitectBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.businessDomain) {
    sections.push(
      `Business domain: ${projection.businessDomain.industry} — ${projection.businessDomain.category}\n${projection.businessDomain.description}`,
    );
  }

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for module/service boundaries):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs authentication/authorization design): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Common business rules with architectural weight:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations / external systems:\n${projection.integrations.map((integration) => `- ${integration.name} (${integration.required ? 'commonly required' : 'optional'}): ${integration.purpose}`).join('\n')}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(
      `Compliance constraints (may shape deployment region/security architecture): ${formatList(projection.compliance.map((item) => item.name))}`,
    );
  }

  if (projection?.dataEntities?.length) {
    sections.push(
      `Typical data entities, high level only (the Database Engineer owns full schema/field design — use this only to inform module/data boundaries): ${formatList(projection.dataEntities.map((entity) => entity.name))}`,
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
