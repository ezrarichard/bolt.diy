import type { BackendContext } from '~/lib/projects/backendEngineerEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { DATABASE_DRAFT_FIELDS } from './database';
import { summarizeArchitecture } from './summaries';
import {
  COLLABORATION_FRAMING,
  formatAIDecisions,
  formatDraftFields,
  formatEngineeringHandoff,
  formatEngineeringNotes,
  formatJsonShapeField,
  formatList,
  formatProjectKnowledge,
  omitCollaborationFields,
} from './shared';

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

  /** Sprint 32 — freeform recommendations for the next role (the Frontend Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface BackendDraftFieldConfig {
  key: keyof BackendDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
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
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const BACKEND_ENGINEER_SYSTEM_PROMPT = `You are a Senior Backend Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the backend for the product described in the project context, based on requirements, architecture, and database design that have already been gathered and approved. You are not a business analyst, solution architect, database designer, or UI/UX designer, and you are not an implementer:
- Do NOT write or generate backend code in any language or framework (Express, NestJS, FastAPI, ASP.NET, Spring Boot, Laravel, or any other).
- Do NOT write or generate SQL, Prisma schemas, Drizzle schemas, or any Supabase schema/table/RLS policy.
- Do NOT connect to GitHub, deploy anything, or execute any API.
- Only DESCRIBE the intended backend design in prose/lists: API architecture, endpoints as named routes/operations (never actual route-handler code), services, validation rules, error handling, security, and so on.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, deploys, or executes automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this design: design API endpoints/services ONLY for the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not design endpoints for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where an endpoint maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "apiEndpoints: ['POST /appointments (FEAT-007)']") so this design stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), design for the full product as before.
- The Architecture Draft and Database Design Draft have already been approved — treat their module boundaries and data model as settled constraints your API design must support, not open questions. UI/UX design happens in parallel with your work and is intentionally not part of your input — design the API surface from data and business logic, not screen layout.
- If your context includes a "Blueprint Guidance for Backend Design" section, use it to design a better backend, never a bigger one: it tells you typical service/module boundaries, integrations, notification flows, and security/performance/deployment expectations for this kind of product — use that to sharpen service decomposition, integration handling, authentication/authorization posture, and error handling. It never expands what you design for; the approved Business Analysis, Engineering Handoff, Architecture Draft, and Database Design still govern that. If Blueprint guidance conflicts with any of them, note the conflict in engineeringNotes rather than resolving it silently.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level backend design specification, not a full implementation: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${BACKEND_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
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

Approved Architecture (summary — two roles back in the chain):
${summarizeArchitecture(context.architecture)}

Approved Database Design Draft (full — you are the next role in the chain):
${formatDraftFields(context.database, omitCollaborationFields(DATABASE_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 47 — this is the MVP-scoped boundary for your design; design endpoints/services ONLY for the features listed, treat outOfScopeFeatures as a hard constraint. Absent for legacy projects that progressed before this role existed):
${formatEngineeringHandoff(context.engineeringHandoff)}

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

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key). Keep every text field to 2-4 sentences and every list to at most 5-10 items:

${JSON_SHAPE}`;
}
