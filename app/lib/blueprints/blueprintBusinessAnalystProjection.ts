import type { BlueprintContent } from './blueprintContentTypes';
import { formatList } from '~/lib/projects/prompts/shared';

/**
 * Blueprint → Business Analyst Projection — Sprint 63 (Blueprint-Aware Business Analysis).
 *
 * Two responsibilities, kept together because they're both small, pure, and only meaningful in
 * relation to each other:
 *
 *  1. `resolveEffectiveBlueprintSelection` — the Sprint 63 brief's "which Blueprint should the
 *     Business Analyst use" rule: the resolution's own `selectedBlueprintId` (which already
 *     defaults to `recommendedBlueprintId` at creation — see blueprintResolutionEngine.ts's own
 *     header comment — and only diverges after a manual override), or nothing at all when no
 *     resolution has ever been recorded for the project. Never reads or writes
 *     `project.blueprintId` — that field belongs to a different system entirely (Sprint 3's
 *     per-project default, read by every engineering role's context builder) and this sprint
 *     must not touch it.
 *
 *  2. `projectBlueprintForBusinessAnalyst` — the "focused adapter" the brief calls for: a
 *     16-section subset of the full 24-section `BlueprintContent` (Sprint 60), deliberately
 *     excluding the engineering-heavy sections (dataEntities, uiPatterns, navigation,
 *     dashboardSuggestions, security, performanceExpectations, testingScenarios,
 *     deploymentConsiderations) that belong to later roles (Database Designer, UI/UX, DevOps,
 *     QA), none of which this sprint touches.
 *
 * Both are pure, synchronous, and side-effect-free — no repository calls, no I/O, trivially
 * unit-testable — so `buildersDbContextProvider.ts` (the orchestration layer, where the actual
 * `getLatestBlueprintResolution`/`blueprintEngine.getBlueprint` lookups happen) can stay thin
 * and this file never needs a mock to test.
 */

export type BlueprintSelectionSource = 'recommendation' | 'manual_override';

/** The minimal shape this module needs from a `BlueprintResolution` — kept narrow so callers don't need to import the full repository type just to call this function. */
export interface EffectiveBlueprintSelectionInput {
  recommendedBlueprintId: string;
  selectedBlueprintId: string;
}

export interface EffectiveBlueprintSelection {
  blueprintId: string;
  selectionSource: BlueprintSelectionSource;
}

/**
 * Sprint 63 objective 1's rule, applied: `selectedBlueprintId` when a resolution exists (it's
 * never empty once a resolution has been recorded — see the type comment above), otherwise no
 * Blueprint context at all. `selectionSource` is derived by comparing the two ids already on the
 * resolution — never a separate lookup, never guessed.
 */
export function resolveEffectiveBlueprintSelection(
  resolution: EffectiveBlueprintSelectionInput | null | undefined,
): EffectiveBlueprintSelection | undefined {
  if (!resolution) {
    return undefined;
  }

  return {
    blueprintId: resolution.selectedBlueprintId,
    selectionSource:
      resolution.selectedBlueprintId === resolution.recommendedBlueprintId ? 'recommendation' : 'manual_override',
  };
}

/**
 * The Business Analyst's focused view of a Blueprint's structured content — see this file's
 * header comment for why these 16 sections and not the other 8. Every field is optional,
 * mirroring `BlueprintContent` itself: a Blueprint with sparse content (6 of the current 9 have
 * none at all yet — see registry.ts) still produces a valid, mostly-empty projection rather than
 * an error.
 */
export interface BusinessAnalystBlueprintContext {
  executiveSummary?: BlueprintContent['executiveSummary'];
  businessDomain?: BlueprintContent['businessDomain'];
  typicalCustomers?: BlueprintContent['typicalCustomers'];
  customerPersonas?: BlueprintContent['customerPersonas'];
  businessGoals?: BlueprintContent['businessGoals'];
  coreBusinessProcesses?: BlueprintContent['coreBusinessProcesses'];
  functionalModules?: BlueprintContent['functionalModules'];
  standardFeatures?: BlueprintContent['standardFeatures'];
  optionalFeatures?: BlueprintContent['optionalFeatures'];
  userRoles?: BlueprintContent['userRoles'];
  businessRules?: BlueprintContent['businessRules'];
  integrations?: BlueprintContent['integrations'];
  compliance?: BlueprintContent['compliance'];
  reports?: BlueprintContent['reports'];
  notifications?: BlueprintContent['notifications'];
  futureEnhancements?: BlueprintContent['futureEnhancements'];
}

/** Every key `BusinessAnalystBlueprintContext` projects — the single place adding/removing a supplied section needs to change (also drives `describeSuppliedSections` for traceability). */
const PROJECTED_SECTION_KEYS = [
  'executiveSummary',
  'businessDomain',
  'typicalCustomers',
  'customerPersonas',
  'businessGoals',
  'coreBusinessProcesses',
  'functionalModules',
  'standardFeatures',
  'optionalFeatures',
  'userRoles',
  'businessRules',
  'integrations',
  'compliance',
  'reports',
  'notifications',
  'futureEnhancements',
] as const satisfies readonly (keyof BusinessAnalystBlueprintContext)[];

function isSectionPopulated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Projects the full `BlueprintContent` (or `undefined`, for a Blueprint with no structured
 * content yet — one of Sprint 60's six unenriched Blueprints) down to the Business Analyst's
 * 16 relevant sections. Deterministic: the same input always produces the same output, and a
 * section absent from the source is simply absent here too (never invented).
 */
export function projectBlueprintForBusinessAnalyst(
  content: BlueprintContent | undefined,
): BusinessAnalystBlueprintContext | undefined {
  if (!content) {
    return undefined;
  }

  const projection: BusinessAnalystBlueprintContext = {};

  for (const key of PROJECTED_SECTION_KEYS) {
    const value = content[key];

    if (isSectionPopulated(value)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }

  return projection;
}

/** True only when the projection actually has at least one populated section — an all-undefined projection is functionally the same as "no content" for prompt-building purposes. */
export function hasBusinessAnalystBlueprintContent(projection: BusinessAnalystBlueprintContext | undefined): boolean {
  if (!projection) {
    return false;
  }

  return PROJECTED_SECTION_KEYS.some((key) => isSectionPopulated(projection[key]));
}

/** The section keys actually supplied (populated) in a projection — used for the Sprint 63 traceability requirement ("Blueprint sections supplied"), never for prompt text itself. */
export function describeSuppliedSections(projection: BusinessAnalystBlueprintContext | undefined): string[] {
  if (!projection) {
    return [];
  }

  return PROJECTED_SECTION_KEYS.filter((key) => isSectionPopulated(projection[key]));
}

/**
 * Formats the projection into the prompt-ready text block appended to the Business Analyst's
 * context (see `buildersDbContextProvider.ts`'s `buildBlueprintGuidanceSection`). Carries its
 * own short "how to use this" instruction — the Sprint 63 priority principle (customer discovery
 * authoritative, Blueprint advisory) restated here because this section is the one place that
 * priority actually matters to the reader; `BUSINESS_ANALYST_SYSTEM_PROMPT` only needs the
 * one-line pointer to it (see prompts/requirements.ts).
 *
 * `blueprintName` and `selectionSource` are passed in rather than re-derived here — this
 * function only formats what it's given, exactly like every other `prompts/*.ts` formatter in
 * this codebase (see shared.ts's own header comment).
 */
export function formatBlueprintGuidanceSection(
  blueprintName: string,
  selectionSource: BlueprintSelectionSource,
  projection: BusinessAnalystBlueprintContext | undefined,
): string {
  const selectionLabel =
    selectionSource === 'manual_override' ? 'manually selected by the user' : 'the recommended match';

  const header = `### Blueprint Guidance (Advisory) — ${blueprintName} (${selectionLabel})`;

  const instruction =
    'This is reference domain knowledge for this kind of business, NOT a requirement. Customer discovery (Business Understanding, Project Knowledge, explicit customer inputs) always takes priority — never let Blueprint content override, contradict, or add scope beyond what discovery supports. Use it only to recognize well-established patterns, note genuinely useful suggestions separately from customer-confirmed requirements, and flag (rather than silently resolve) anything that conflicts with what the customer actually said.';

  if (!hasBusinessAnalystBlueprintContent(projection)) {
    return [header, instruction, 'No structured Blueprint knowledge is available for this Blueprint yet.'].join('\n\n');
  }

  const sections: string[] = [];

  if (projection?.executiveSummary) {
    sections.push(
      `Summary: ${projection.executiveSummary.summary}\nValue proposition: ${projection.executiveSummary.valueProposition}`,
    );
  }

  if (projection?.businessDomain) {
    sections.push(
      `Business domain: ${projection.businessDomain.industry} — ${projection.businessDomain.category}\n${projection.businessDomain.description}`,
    );
  }

  if (projection?.typicalCustomers?.length) {
    sections.push(`Typical customers: ${formatList(projection.typicalCustomers)}`);
  }

  if (projection?.customerPersonas?.length) {
    sections.push(
      `Customer personas:\n${projection.customerPersonas.map((persona) => `- ${persona.name} (${persona.role}): ${persona.description}`).join('\n')}`,
    );
  }

  if (projection?.businessGoals?.length) {
    sections.push(
      `Typical business goals:\n${projection.businessGoals.map((goal) => `- ${goal.goal} (${goal.priority}): ${goal.description}`).join('\n')}`,
    );
  }

  if (projection?.coreBusinessProcesses?.length) {
    sections.push(
      `Core business processes:\n${projection.coreBusinessProcesses.map((process) => `- ${process.name}: ${process.description}`).join('\n')}`,
    );
  }

  if (projection?.functionalModules?.length) {
    sections.push(
      `Functional modules:\n${projection.functionalModules.map((module) => `- ${module.name}: ${module.description}`).join('\n')}`,
    );
  }

  if (projection?.standardFeatures?.length) {
    sections.push(
      `Standard features for this kind of business: ${formatList(projection.standardFeatures.map((f) => f.name))}`,
    );
  }

  if (projection?.optionalFeatures?.length) {
    sections.push(
      `Optional features (only include if the customer's own requirements support them — do not add merely because they're listed here): ${formatList(projection.optionalFeatures.map((f) => f.name))}`,
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

  if (projection?.integrations?.length) {
    sections.push(
      `Typical integrations: ${formatList(projection.integrations.map((integration) => integration.name))}`,
    );
  }

  if (projection?.compliance?.length) {
    sections.push(`Compliance considerations: ${formatList(projection.compliance.map((item) => item.name))}`);
  }

  if (projection?.reports?.length) {
    sections.push(`Typical reports: ${formatList(projection.reports.map((report) => report.name))}`);
  }

  if (projection?.notifications?.length) {
    sections.push(`Typical notifications: ${formatList(projection.notifications.map((n) => n.name))}`);
  }

  if (projection?.futureEnhancements?.length) {
    sections.push(
      `Future enhancement ideas (do not scope into this MVP): ${formatList(projection.futureEnhancements.map((f) => f.idea))}`,
    );
  }

  return [header, instruction, ...sections].join('\n\n');
}
