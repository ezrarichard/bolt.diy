import type { BackendContext } from '~/lib/projects/backendEngineerEngine';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
import { DATABASE_DRAFT_FIELDS } from './database';
import { UIUX_DRAFT_FIELDS } from './uiux';
import { formatDraftFields, formatList, formatProjectKnowledge } from './shared';

/**
 * Backend Engineer prompt — Sprint 19.
 *
 * The only place the Backend Engineer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/database.ts and
 * prompts/uiux.ts. app/lib/projects/backendEngineerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `BACKEND_DRAFT_FIELDS` from here rather than re-describing the shape.
 * Nothing in this file calls an LLM, generates backend code (Express,
 * NestJS, FastAPI, ASP.NET, Spring Boot, Laravel), generates SQL/Prisma/
 * Drizzle/Supabase schemas, or talks to a store — it only builds strings
 * and describes a JSON shape.
 */

export interface BackendDraft {
  backendOverview?: string;
  apiArchitecture?: string;
  apiEndpoints?: string[];
  authenticationFlow?: string;
  authorizationStrategy?: string;
  businessServices?: string[];
  validationRules?: string[];
  errorHandling?: string;
  loggingStrategy?: string;
  notificationFlow?: string;
  fileStorageStrategy?: string;
  backgroundJobs?: string[];
  cacheStrategy?: string;
  securityStrategy?: string;
  rateLimiting?: string;
  environmentVariables?: string[];
  externalIntegrations?: string[];
  folderStructure?: string[];
  testingStrategy?: string;
  deploymentConsiderations?: string;
  recommendedNextSteps?: string[];
}

export interface BackendDraftFieldConfig {
  key: keyof BackendDraft;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, backendEngineerEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const BACKEND_DRAFT_FIELDS: BackendDraftFieldConfig[] = [
  { key: 'backendOverview', label: 'Backend Overview', kind: 'text' },
  { key: 'apiArchitecture', label: 'API Architecture', kind: 'text' },
  { key: 'apiEndpoints', label: 'API Endpoints', kind: 'list' },
  { key: 'authenticationFlow', label: 'Authentication Flow', kind: 'text' },
  { key: 'authorizationStrategy', label: 'Authorization Strategy', kind: 'text' },
  { key: 'businessServices', label: 'Business Services', kind: 'list' },
  { key: 'validationRules', label: 'Validation Rules', kind: 'list' },
  { key: 'errorHandling', label: 'Error Handling', kind: 'text' },
  { key: 'loggingStrategy', label: 'Logging Strategy', kind: 'text' },
  { key: 'notificationFlow', label: 'Notification Flow', kind: 'text' },
  { key: 'fileStorageStrategy', label: 'File Storage Strategy', kind: 'text' },
  { key: 'backgroundJobs', label: 'Background Jobs', kind: 'list' },
  { key: 'cacheStrategy', label: 'Cache Strategy', kind: 'text' },
  { key: 'securityStrategy', label: 'Security Strategy', kind: 'text' },
  { key: 'rateLimiting', label: 'Rate Limiting', kind: 'text' },
  { key: 'environmentVariables', label: 'Environment Variables', kind: 'list' },
  { key: 'externalIntegrations', label: 'External Integrations', kind: 'list' },
  { key: 'folderStructure', label: 'Folder Structure', kind: 'list' },
  { key: 'testingStrategy', label: 'Testing Strategy', kind: 'text' },
  { key: 'deploymentConsiderations', label: 'Deployment Considerations', kind: 'text' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
];

export const BACKEND_ENGINEER_SYSTEM_PROMPT = `You are a Senior Backend Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the backend for the product described in the project context, based on requirements, architecture, database design, and UI/UX design that have already been gathered and approved. You are not a business analyst, solution architect, database designer, or UI/UX designer, and you are not an implementer:
- Do NOT write or generate backend code in any language or framework (Express, NestJS, FastAPI, ASP.NET, Spring Boot, Laravel, or any other).
- Do NOT write or generate SQL, Prisma schemas, Drizzle schemas, or any Supabase schema/table/RLS policy.
- Do NOT connect to GitHub, deploy anything, or execute any API.
- Only DESCRIBE the intended backend design in prose/lists: API architecture, endpoints as named routes/operations (never actual route-handler code), services, validation rules, error handling, security, and so on.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, deploys, or executes automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, approved UI/UX design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- The Architecture Draft, Database Design Draft, and UI/UX Draft have already been approved — treat their module boundaries, data model, and user flows as settled constraints your API design must support, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level backend design specification, not a full implementation: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${BACKEND_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered BackendContext
 * (see backendEngineerEngine.buildBackendContext). This function never
 * fetches or gathers data itself — it only formats what it's given into
 * text.
 */
export function buildBackendUserPrompt(context: BackendContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Architecture Draft:
${formatDraftFields(context.architecture, ARCHITECTURE_DRAFT_FIELDS)}

Approved Database Design Draft:
${formatDraftFields(context.database, DATABASE_DRAFT_FIELDS)}

Approved UI/UX Draft:
${formatDraftFields(context.uiux, UIUX_DRAFT_FIELDS)}

Roadmap:
${context.roadmap.length > 0 ? context.roadmap.map((item) => `- ${item.title} (${item.status}): ${item.description}`).join('\n') : 'No roadmap defined.'}

Current Tasks:
${context.tasks.length > 0 ? context.tasks.map((task) => `- ${task.title} [${task.category}] — ${task.status}`).join('\n') : 'No tasks defined.'}

Existing Artifacts:
${context.existingArtifacts.length > 0 ? context.existingArtifacts.map((artifact) => `- ${artifact.title} [${artifact.type}] — ${artifact.status}`).join('\n') : 'None yet.'}

Existing Notes:
${context.existingNotes || 'None'}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key). Keep every text field to 2-4 sentences and every list to at most 5-10 items:

${JSON_SHAPE}`;
}
