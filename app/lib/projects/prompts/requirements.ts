import type { RequirementsContext } from '~/lib/projects/businessAnalystEngine';

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
  targetAudience?: string;
  businessModel?: string;
  coreFeatures?: string[];
  pages?: string[];
  userRoles?: string[];
  businessRules?: string[];
  compliance?: string[];
  payments?: string[];
  shipping?: string[];
  languages?: string[];
  risks?: string[];
  futureEnhancements?: string[];
  successMetrics?: string[];
  technologyRecommendations?: string[];
  openQuestions?: string[];
}

export interface RequirementsDraftFieldConfig {
  key: keyof RequirementsDraft;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, businessAnalystEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list. Add a
 * field here once and every consumer picks it up automatically.
 */
export const REQUIREMENTS_DRAFT_FIELDS: RequirementsDraftFieldConfig[] = [
  { key: 'businessVision', label: 'Business Vision', kind: 'text' },
  { key: 'targetAudience', label: 'Target Audience', kind: 'text' },
  { key: 'businessModel', label: 'Business Model', kind: 'text' },
  { key: 'coreFeatures', label: 'Core Features', kind: 'list' },
  { key: 'pages', label: 'Pages', kind: 'list' },
  { key: 'userRoles', label: 'User Roles', kind: 'list' },
  { key: 'businessRules', label: 'Business Rules', kind: 'list' },
  { key: 'compliance', label: 'Compliance', kind: 'list' },
  { key: 'payments', label: 'Payments', kind: 'list' },
  { key: 'shipping', label: 'Shipping', kind: 'list' },
  { key: 'languages', label: 'Languages', kind: 'list' },
  { key: 'risks', label: 'Risks', kind: 'list' },
  { key: 'futureEnhancements', label: 'Future Enhancements', kind: 'list' },
  { key: 'successMetrics', label: 'Success Metrics', kind: 'list' },
  { key: 'technologyRecommendations', label: 'Technology Recommendations', kind: 'list' },
  { key: 'openQuestions', label: 'Open Questions', kind: 'list' },
];

export const BUSINESS_ANALYST_SYSTEM_PROMPT = `You are a Senior Business Analyst working inside Builders, an AI engineering platform.

Your ONLY responsibility is to understand the business being built and produce a structured requirements document. You are not a software architect or engineer:
- Do NOT write or suggest code.
- Do NOT design a database schema, API, or file structure.
- "Technology Recommendations" should stay at the level of a business analyst's suggestion (e.g. "a subscription billing provider", "a chat-based support widget"), not implementation detail.

Rules:
- Think like an experienced business analyst gathering requirements for a real client engagement.
- Base your answer strictly on the project context you are given (blueprint, existing knowledge, roadmap, tasks, notes). Do not invent unrelated features or industries.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty — but list genuine uncertainties under "openQuestions" instead of guessing wildly.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

function formatList(items: string[] | undefined, fallback = 'None specified'): string {
  return items && items.length > 0 ? items.join(', ') : fallback;
}

function formatKnowledge(context: RequirementsContext): string {
  const knowledge = context.knowledge;

  if (!knowledge) {
    return 'Nothing captured yet.';
  }

  const lines = [
    knowledge.projectVision && `Vision: ${knowledge.projectVision}`,
    knowledge.industry && `Industry: ${knowledge.industry}`,
    knowledge.businessModel && `Business model: ${knowledge.businessModel}`,
    knowledge.targetUsers && `Target users: ${knowledge.targetUsers}`,
    knowledge.location && `Region: ${knowledge.location}`,
    knowledge.coreFeatures?.length && `Core features: ${formatList(knowledge.coreFeatures)}`,
    knowledge.pagesOrScreens?.length && `Pages/screens: ${formatList(knowledge.pagesOrScreens)}`,
    knowledge.userRoles?.length && `User roles: ${formatList(knowledge.userRoles)}`,
    knowledge.integrations?.length && `Integrations: ${formatList(knowledge.integrations)}`,
    knowledge.paymentNeeds?.length && `Payments: ${formatList(knowledge.paymentNeeds)}`,
    knowledge.complianceNeeds?.length && `Compliance: ${formatList(knowledge.complianceNeeds)}`,
    knowledge.shippingNeeds?.length && `Shipping: ${formatList(knowledge.shippingNeeds)}`,
    knowledge.languages?.length && `Languages: ${formatList(knowledge.languages)}`,
    knowledge.brandTone && `Brand tone: ${knowledge.brandTone}`,
    knowledge.technicalPreferences && `Technical preferences: ${knowledge.technicalPreferences}`,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : 'Nothing captured yet.';
}

const JSON_SHAPE = `{
${REQUIREMENTS_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
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
${formatKnowledge(context)}

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
