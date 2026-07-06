import type { ArchitectureContext } from '~/lib/projects/solutionArchitectEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { REQUIREMENTS_DRAFT_FIELDS } from './requirements';
import {
  COLLABORATION_FRAMING,
  formatAIDecisions,
  formatDraftFields,
  formatEngineeringNotes,
  formatJsonShapeField,
  formatList,
  formatProjectKnowledge,
  omitCollaborationFields,
} from './shared';

/**
 * Solution Architect prompt — Sprint 14.
 *
 * The only place the Solution Architect's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/requirements.ts.
 * app/lib/projects/solutionArchitectEngine.ts (pure orchestration) and any
 * UI that renders a draft both import `ARCHITECTURE_DRAFT_FIELDS` from here
 * rather than re-describing the shape. Nothing in this file calls an LLM,
 * generates code, or talks to a store — it only builds strings and
 * describes a JSON shape.
 */

export interface ArchitectureDraft {
  architectureSummary?: string;
  applicationModules?: string[];
  frontendArchitecture?: string;
  backendArchitecture?: string;
  databaseArchitecture?: string;
  authenticationStrategy?: string;
  authorizationRoles?: string[];
  integrations?: string[];
  paymentArchitecture?: string;
  complianceArchitecture?: string;
  deploymentArchitecture?: string;
  securityConsiderations?: string[];
  scalabilityPlan?: string;
  risks?: string[];
  openQuestions?: string[];
  recommendedNextSteps?: string[];

  /** Sprint 32 — freeform recommendations for the next role (the Database Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface ArchitectureDraftFieldConfig {
  key: keyof ArchitectureDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, solutionArchitectEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const ARCHITECTURE_DRAFT_FIELDS: ArchitectureDraftFieldConfig[] = [
  { key: 'architectureSummary', label: 'Architecture Summary', kind: 'text' },
  { key: 'applicationModules', label: 'Application Modules', kind: 'list' },
  { key: 'frontendArchitecture', label: 'Frontend Architecture', kind: 'text' },
  { key: 'backendArchitecture', label: 'Backend Architecture', kind: 'text' },
  { key: 'databaseArchitecture', label: 'Database Architecture', kind: 'text' },
  { key: 'authenticationStrategy', label: 'Authentication Strategy', kind: 'text' },
  { key: 'authorizationRoles', label: 'Authorization Roles', kind: 'list' },
  { key: 'integrations', label: 'Integrations', kind: 'list' },
  { key: 'paymentArchitecture', label: 'Payment Architecture', kind: 'text' },
  { key: 'complianceArchitecture', label: 'Compliance Architecture', kind: 'text' },
  { key: 'deploymentArchitecture', label: 'Deployment Architecture', kind: 'text' },
  { key: 'securityConsiderations', label: 'Security Considerations', kind: 'list' },
  { key: 'scalabilityPlan', label: 'Scalability Plan', kind: 'text' },
  { key: 'risks', label: 'Risks', kind: 'list' },
  { key: 'openQuestions', label: 'Open Questions', kind: 'list' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const SOLUTION_ARCHITECT_SYSTEM_PROMPT = `You are a Senior Solution Architect working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design a high-level technical architecture for the product described in the project context, based on requirements that have already been gathered and approved. You are not a business analyst and not an implementer:
- Do NOT write or generate code, file contents, or configuration files.
- Do NOT create, modify, or scaffold a database, backend, or frontend yourself — only DESCRIBE the intended architecture in prose/lists.
- Do NOT propose specific GitHub repository actions, Supabase project actions, or deployment steps to execute — "Deployment Architecture" should describe a strategy/target conceptually (e.g. "static frontend on a CDN, serverless API functions"), never an action to run.

India-specific expectations — use these as sensible defaults for India-focused products (infer from the project's blueprint/knowledge; do not force them onto a product that is clearly not India-focused):
- Payments: Razorpay and UPI. Never recommend Stripe as the default payment architecture for an India-focused product.
- Compliance: GST and invoice generation wherever the product involves commerce or billing.
- Notifications: WhatsApp notifications where relevant to the product's user communication needs.
- Shipping/logistics: Shiprocket or Delhivery where the product ships physical goods.
- Languages: consider Tamil, Malayalam, Hindi, and English support where relevant to the product's audience.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, the Business Analyst's approved draft, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty — but list genuine uncertainties under "openQuestions" instead of guessing wildly.
- Be concise. This is a high-level architecture overview, not a design document: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-8 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${ARCHITECTURE_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered
 * ArchitectureContext (see solutionArchitectEngine.buildArchitectureContext).
 * This function never fetches or gathers data itself — it only formats
 * what it's given into text.
 */
export function buildArchitectureUserPrompt(context: ArchitectureContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Business Analyst Output (full — you are the next role in the chain):
${formatDraftFields(context.requirementsDraft, omitCollaborationFields(REQUIREMENTS_DRAFT_FIELDS))}

Engineering Notes from previous engineers:
${formatEngineeringNotes(context.engineeringNotes)}

AI Decisions made so far:
${formatAIDecisions(context.aiDecisions)}

Roadmap:
${context.roadmap.length > 0 ? context.roadmap.map((item) => `- ${item.title} (${item.status}): ${item.description}`).join('\n') : 'No roadmap defined.'}

Current Tasks:
${context.tasks.length > 0 ? context.tasks.map((task) => `- ${task.title} [${task.category}] — ${task.status}`).join('\n') : 'No tasks defined.'}

Existing Artifacts:
${context.existingArtifacts.length > 0 ? context.existingArtifacts.map((artifact) => `- ${artifact.title} [${artifact.type}] — ${artifact.status}`).join('\n') : 'None yet.'}

Existing Notes:
${context.existingNotes || 'None'}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key). Keep every text field to 2-4 sentences and every list to at most 5-8 items:

${JSON_SHAPE}`;
}
