import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';
import type { BlueprintSelectionSource } from './blueprintBusinessAnalystProjection';

/**
 * Blueprint → QA Engineer Projection — Sprint 68 (Blueprint-Aware QA & DevOps Engineering).
 *
 * Sibling of `blueprintBusinessAnalystProjection.ts` (63), `blueprintProductOwnerProjection.ts`
 * (64), `blueprintSolutionArchitectProjection.ts` (65), `blueprintDatabaseProjection.ts` (66),
 * `blueprintBackendProjection.ts` (66), `blueprintUiUxProjection.ts` (67), and
 * `blueprintFrontendProjection.ts` (67) — deliberately a SEPARATE, dedicated projection rather
 * than a reuse of any of them. The QA Engineer needs the coverage/risk-relevant slice of the
 * same 24-section `BlueprintContent` (Sprint 60): what modules/processes/rules/roles/
 * integrations exist to test, what industry-typical failure risks and testing scenarios apply,
 * and what compliance/security/performance expectations must be validated — not the
 * implementation detail other projections own.
 *
 * The Sprint 68 brief's requested topics map onto `BlueprintContent` sections as follows:
 *   - Functional Modules              -> functionalModules
 *   - Core Business Processes         -> coreBusinessProcesses
 *   - Standard Features               -> standardFeatures (only relevant where already approved)
 *   - Business Rules                  -> businessRules
 *   - User Roles                      -> userRoles (role/permission testing)
 *   - Integrations                    -> integrations
 *   - Notifications                   -> notifications
 *   - Reports                         -> reports (only relevant where already approved)
 *   - Compliance                      -> compliance
 *   - Security                        -> security
 *   - Performance Expectations        -> performanceExpectations
 *   - Testing Scenarios               -> testingScenarios
 *   - Industry-specific failure risks -> testingScenarios (a Blueprint testing scenario IS an
 *     industry-typical failure risk framed as a test case; no separate "risk" section exists)
 *   - Data-related validation expectations, high level -> dataEntities, but formatted as names
 *     only (never keyFields/relationships — that's the Database Engineer's schema detail, not
 *     QA's; same "high level only" trimming `blueprintSolutionArchitectProjection.ts` already
 *     applies to this same section)
 *
 * Explicitly excluded: full database schema detail (dataEntities beyond entity names), backend
 * service decomposition, deployment implementation (deploymentConsiderations — the DevOps
 * Engineer's concern), UI design recommendations (uiPatterns, navigation, dashboardSuggestions),
 * MVP-planning-only sections not needed at the QA level (optionalFeatures, futureEnhancements),
 * and BA-only domain/customer sections (executiveSummary, businessDomain, typicalCustomers,
 * customerPersonas, businessGoals) — per the Sprint 68 brief's exclusion list.
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
 * The QA Engineer's focused view of a Blueprint's structured content — coverage/risk-relevant
 * material only. Every field is optional, mirroring `BlueprintContent` itself: a Blueprint with
 * sparse content (most of the current registry has none at all yet) still produces a valid,
 * mostly-empty projection rather than an error.
 */
export interface QaBlueprintContext {
  functionalModules?: BlueprintContent['functionalModules'];
  coreBusinessProcesses?: BlueprintContent['coreBusinessProcesses'];
  standardFeatures?: BlueprintContent['standardFeatures'];
  businessRules?: BlueprintContent['businessRules'];
  userRoles?: BlueprintContent['userRoles'];
  integrations?: BlueprintContent['integrations'];
  notifications?: BlueprintContent['notifications'];
  reports?: BlueprintContent['reports'];
  compliance?: BlueprintContent['compliance'];
  security?: BlueprintContent['security'];
  performanceExpectations?: BlueprintContent['performanceExpectations'];
  testingScenarios?: BlueprintContent['testingScenarios'];
  dataEntities?: BlueprintContent['dataEntities'];
}

/** Every key `QaBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'functionalModules',
  'coreBusinessProcesses',
  'standardFeatures',
  'businessRules',
  'userRoles',
  'integrations',
  'notifications',
  'reports',
  'compliance',
  'security',
  'performanceExpectations',
  'testingScenarios',
  'dataEntities',
] as const satisfies readonly (keyof QaBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet) down to the QA Engineer's 13 coverage/risk-relevant sections. Deterministic: the
 * same input always produces the same output, and a section absent from the source is simply
 * absent here too (never invented).
 */
export function projectBlueprintForQa(content: BlueprintContent | undefined): QaBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: QaBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section. */
export function hasQaBlueprintContent(projection: QaBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 68 traceability requirement ("Sections Supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: QaBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the QA Engineer's context
 * (see `buildersDbContextProvider.ts`'s `buildQaBlueprintGuidance`). Carries its own short "how
 * to use this" instruction — coverage-specific: this is testing reference knowledge for this
 * kind of product (typical modules, processes, rules, roles, integrations, and industry-typical
 * failure risks/testing scenarios to consider), never a way to test a feature the approved MVP
 * doesn't include. The approved Business Analysis, Engineering Handoff (Product Owner),
 * Architecture Draft, Database Design, Backend Design, UI/UX Design, and Frontend Design remain
 * the scope boundary.
 */
export function formatQaBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: QaBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance for QA Testing (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'Testing reference knowledge for this kind of product, NOT a scope change. The approved Business Analysis, the Engineering Handoff from the AI Product Owner (in-scope/out-of-scope features), the approved Architecture Draft, Database Design, Backend Design, UI/UX Design, and Frontend Design govern WHAT was built and therefore WHAT must be tested — this section only informs HOW to test it well: business-rule validation, role/permission testing, integration testing, industry-typical edge cases and failure risks, and compliance/security/performance validation typical for this kind of product. Never add a test case for a feature this Blueprint mentions but the approved MVP does not include — treat any such observation as an optional future-risk note, not a required acceptance criterion. If Blueprint guidance conflicts with the approved outputs, they win — note the conflict in engineeringNotes rather than resolving it silently.';

  if (!hasQaBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.functionalModules?.length) {
    sections.push(
      `Typical functional modules (a starting point for functional test coverage):\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.coreBusinessProcesses?.length) {
    sections.push(
      `Typical core business processes (informs end-to-end/system test coverage):\n${projection.coreBusinessProcesses.map((process) => `- ${process.name}: ${process.description}`).join('\n')}`,
    );
  }

  if (projection?.standardFeatures?.length) {
    sections.push(
      `Standard features for this kind of product (only relevant where already approved in the MVP):\n${projection.standardFeatures.map((feature) => `- ${feature.name}: ${feature.description}`).join('\n')}`,
    );
  }

  if (projection?.businessRules?.length) {
    sections.push(
      `Business rules to validate:\n${projection.businessRules.map((rule) => `- ${rule.rule} (${rule.rationale})`).join('\n')}`,
    );
  }

  if (projection?.userRoles?.length) {
    sections.push(
      `Typical user roles (informs role and permission testing): ${formatList(projection.userRoles.map((role) => role.name))}`,
    );
  }

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations / external systems to test:\n${projection.integrations.map((integration) => `- ${integration.name} (${integration.required ? 'commonly required' : 'optional'}): ${integration.purpose}`).join('\n')}`,
    );
  }

  if (projection?.notifications?.length) {
    sections.push(
      `Typical notifications (informs notification testing):\n${projection.notifications.map((n) => `- ${n.name} — triggered by ${n.trigger}, via ${n.channel}`).join('\n')}`,
    );
  }

  if (projection?.reports?.length) {
    sections.push(
      `Typical reports (only relevant where reporting is already approved in the MVP):\n${projection.reports.map((report) => `- ${report.name} (for ${report.audience}): ${report.description}`).join('\n')}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(
      `Compliance considerations to validate:\n${projection.compliance.map((item) => `- ${item.name}${item.region ? ` (${item.region})` : ''}: ${item.description}`).join('\n')}`,
    );
  }

  if (projection?.security?.length) {
    sections.push(
      `Security expectations to validate:\n${projection.security.map((item) => `- ${item.concern}: ${item.mitigation}`).join('\n')}`,
    );
  }

  if (projection?.performanceExpectations?.length) {
    sections.push(
      `Performance expectations to validate:\n${projection.performanceExpectations.map((item) => `- ${item.metric}: ${item.target}`).join('\n')}`,
    );
  }

  if (projection?.testingScenarios?.length) {
    sections.push(
      `Industry-typical testing scenarios / failure risks:\n${projection.testingScenarios.map((scenario) => `- ${scenario.scenario} → expected: ${scenario.expectedOutcome}`).join('\n')}`,
    );
  }

  if (projection?.dataEntities?.length) {
    sections.push(
      `Typical data entities, high level only (informs data-related validation — the Database Engineer owns full schema/field design): ${formatList(projection.dataEntities.map((entity) => entity.name))}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
