import type { RequirementsContext } from '~/lib/projects/businessAnalystEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { formatJsonShapeField, formatList, formatProjectKnowledge } from './shared';

/**
 * Business Analyst prompt — Sprint 13.
 *
 * The only place the Business Analyst's system prompt, JSON contract, and
 * user-prompt assembly live. app/lib/projects/businessAnalystEngine.ts
 * (pure orchestration — context gathering, parsing, artifact/knowledge
 * conversion) and any UI that renders a draft both import
 * `REQUIREMENTS_DRAFT_FIELDS` from here rather than re-describing the
 * shape, so there is exactly one definition of "what a Requirements Draft
 * looks like." Nothing in this file calls an LLM, generates code, or talks
 * to a store — it only builds strings and describes a JSON shape. Every
 * future AI role (Solution Architect, Database Designer, UI Designer,
 * Backend Engineer) gets its own sibling file here following this same
 * pattern: types + field list + system prompt + user-prompt builder.
 */

export interface RequirementsDraft {
  businessVision?: string;
  businessGoals?: string[];
  targetAudience?: string;
  businessModel?: string;
  personas?: string[];
  coreFeatures?: string[];
  pages?: string[];
  userFlows?: string[];
  userRoles?: string[];
  businessRules?: string[];
  functionalRequirements?: string[];
  nonFunctionalRequirements?: string[];
  technicalConstraints?: string[];
  assumptions?: string[];
  outOfScope?: string[];
  acceptanceCriteria?: string[];
  compliance?: string[];
  payments?: string[];
  shipping?: string[];
  languages?: string[];
  risks?: string[];
  futureEnhancements?: string[];
  successMetrics?: string[];
  technologyRecommendations?: string[];
  openQuestions?: string[];

  /** Sprint 32 — freeform recommendations for whichever engineer picks up next (the Solution Architect). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role via collaborationContext.ts. */
  aiDecisions?: AIDecision[];

  /**
   * Project Definition workflow — set programmatically by businessAnalystEngine.ts's
   * `createRevisedDraftArtifact`, never populated by the AI itself (deliberately absent
   * from `REQUIREMENTS_DRAFT_FIELDS` below, so it's never part of the JSON contract the AI
   * is asked to fill in). Carries per-version bookkeeping the Project Definition workspace's
   * Version History reads directly off the artifact's own content — no schema change needed
   * to store "revision request"/"change summary"/"model used" per version.
   */
  versionMeta?: {
    revisionRequest?: string;
    changeSummary?: string;
    modelUsed?: string;

    /** Field keys the AI Project Manager determined were affected by this revision (see prompts/projectManagerRevision.ts) — drives the "N sections updated" hint in Version History / the Summary panel. */
    affectedSections?: string[];
  };
}

export interface RequirementsDraftFieldConfig {
  key: keyof RequirementsDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, businessAnalystEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list. Add a
 * field here once and every consumer picks it up automatically.
 */
export const REQUIREMENTS_DRAFT_FIELDS: RequirementsDraftFieldConfig[] = [
  { key: 'businessVision', label: 'Business Overview', kind: 'text' },
  { key: 'businessGoals', label: 'Business Goals', kind: 'list' },
  { key: 'targetAudience', label: 'Target Users', kind: 'text' },
  { key: 'businessModel', label: 'Business Model', kind: 'text' },
  { key: 'personas', label: 'Personas', kind: 'list' },
  { key: 'coreFeatures', label: 'Modules', kind: 'list' },
  { key: 'pages', label: 'Pages', kind: 'list' },
  { key: 'userFlows', label: 'User Flows', kind: 'list' },
  { key: 'userRoles', label: 'User Roles', kind: 'list' },
  { key: 'businessRules', label: 'Business Rules', kind: 'list' },
  { key: 'functionalRequirements', label: 'Functional Requirements', kind: 'list' },
  { key: 'nonFunctionalRequirements', label: 'Non-Functional Requirements', kind: 'list' },
  { key: 'technicalConstraints', label: 'Technical Constraints', kind: 'list' },
  { key: 'assumptions', label: 'Assumptions', kind: 'list' },
  { key: 'outOfScope', label: 'Out of Scope', kind: 'list' },
  { key: 'acceptanceCriteria', label: 'Acceptance Criteria', kind: 'list' },
  { key: 'compliance', label: 'Compliance', kind: 'list' },
  { key: 'payments', label: 'Payments', kind: 'list' },
  { key: 'shipping', label: 'Shipping', kind: 'list' },
  { key: 'languages', label: 'Languages', kind: 'list' },
  { key: 'risks', label: 'Risks', kind: 'list' },
  { key: 'futureEnhancements', label: 'Future Enhancements', kind: 'list' },
  { key: 'successMetrics', label: 'Success Metrics', kind: 'list' },
  { key: 'technologyRecommendations', label: 'Technology Recommendations', kind: 'list' },
  { key: 'openQuestions', label: 'Open Questions', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const BUSINESS_ANALYST_SYSTEM_PROMPT = `You are a Senior Business Analyst working inside Builders, an AI engineering platform.

Your ONLY responsibility is to understand the business being built and produce a structured requirements document. You are not a software architect or engineer:
- Do NOT write or suggest code.
- Do NOT design a database schema, API, or file structure.
- "Technology Recommendations" should stay at the level of a business analyst's suggestion (e.g. "a subscription billing provider", "a chat-based support widget"), not implementation detail.

Rules:
- Think like an experienced business analyst gathering requirements for a real client engagement.
- Base your answer strictly on the project context you are given (blueprint, existing knowledge, roadmap, tasks, notes). Do not invent unrelated features or industries.
- If your context includes a "Blueprint Guidance (Advisory)" section, treat it exactly as labeled: reference domain knowledge, never a requirement. Explicit customer inputs and confirmed Business Understanding always outrank it — never let it add scope, override customer terminology, or resolve a conflict silently; note the conflict instead.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty — but list genuine uncertainties under "openQuestions" instead of guessing wildly.
- You are the first engineer on this project — there is no prior work to build on, but the Solution Architect who works from your output next has nothing else to go on. Use "engineeringNotes" to flag anything they specifically need to design around (e.g. "this will likely need multi-tenant support later — keep data structures extensible"). Use "aiDecisions" for the handful of real judgment calls you made (e.g. choosing a business model interpretation, scoping a feature in or out) — each entry needs a "decision" and a "reason" at minimum.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${REQUIREMENTS_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered
 * RequirementsContext (see businessAnalystEngine.buildRequirementsContext).
 * This function never fetches or gathers data itself — it only formats
 * what it's given into text.
 */
export function buildRequirementsUserPrompt(context: RequirementsContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Existing Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Recommended fields still missing: ${formatList(context.missingInformation, 'None')}

Roadmap:
${context.roadmap.length > 0 ? context.roadmap.map((item) => `- ${item.title} (${item.status}): ${item.description}`).join('\n') : 'No roadmap defined.'}

Current Tasks:
${context.tasks.length > 0 ? context.tasks.map((task) => `- ${task.title} [${task.category}] — ${task.status}`).join('\n') : 'No tasks defined.'}

Existing Notes:
${context.existingNotes || 'None'}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key):

${JSON_SHAPE}`;
}
