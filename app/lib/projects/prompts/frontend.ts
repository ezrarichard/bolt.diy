import type { FrontendContext } from '~/lib/projects/frontendEngineerEngine';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
import { DATABASE_DRAFT_FIELDS } from './database';
import { UIUX_DRAFT_FIELDS } from './uiux';
import { BACKEND_DRAFT_FIELDS } from './backend';
import { formatDraftFields, formatList, formatProjectKnowledge } from './shared';

/**
 * Frontend Engineer prompt — Sprint 20.
 *
 * The only place the Frontend Engineer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/backend.ts and
 * prompts/uiux.ts. app/lib/projects/frontendEngineerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `FRONTEND_DRAFT_FIELDS` from here rather than re-describing the shape.
 * Nothing in this file calls an LLM, generates React/Next.js/Remix/Vue/
 * Angular/Flutter/SwiftUI/Jetpack Compose code, generates HTML/CSS/
 * Tailwind, or talks to a store — it only builds strings and describes a
 * JSON shape.
 */

export interface FrontendDraft {
  frontendOverview?: string;
  applicationStructure?: string;
  routingStrategy?: string;
  pageHierarchy?: string[];
  navigationFlow?: string;
  layoutStrategy?: string;
  componentHierarchy?: string[];
  sharedComponents?: string[];
  pageComponents?: string[];
  stateManagement?: string;
  apiIntegrationStrategy?: string;
  dataFetchingStrategy?: string;
  formStrategy?: string;
  validationUX?: string;
  authenticationUX?: string;
  authorizationUX?: string;
  loadingStates?: string[];
  errorStates?: string[];
  emptyStates?: string[];
  responsiveStrategy?: string;
  accessibilityGuidelines?: string[];
  animationStrategy?: string;
  themeStrategy?: string;
  designTokensUsage?: string;
  performanceStrategy?: string;
  seoStrategy?: string;
  browserSupport?: string[];
  frontendFolderStructure?: string[];
  testingStrategy?: string;
  recommendedNextSteps?: string[];
}

export interface FrontendDraftFieldConfig {
  key: keyof FrontendDraft;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, frontendEngineerEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const FRONTEND_DRAFT_FIELDS: FrontendDraftFieldConfig[] = [
  { key: 'frontendOverview', label: 'Frontend Overview', kind: 'text' },
  { key: 'applicationStructure', label: 'Application Structure', kind: 'text' },
  { key: 'routingStrategy', label: 'Routing Strategy', kind: 'text' },
  { key: 'pageHierarchy', label: 'Page Hierarchy', kind: 'list' },
  { key: 'navigationFlow', label: 'Navigation Flow', kind: 'text' },
  { key: 'layoutStrategy', label: 'Layout Strategy', kind: 'text' },
  { key: 'componentHierarchy', label: 'Component Hierarchy', kind: 'list' },
  { key: 'sharedComponents', label: 'Shared Components', kind: 'list' },
  { key: 'pageComponents', label: 'Page Components', kind: 'list' },
  { key: 'stateManagement', label: 'State Management', kind: 'text' },
  { key: 'apiIntegrationStrategy', label: 'API Integration Strategy', kind: 'text' },
  { key: 'dataFetchingStrategy', label: 'Data Fetching Strategy', kind: 'text' },
  { key: 'formStrategy', label: 'Form Strategy', kind: 'text' },
  { key: 'validationUX', label: 'Validation UX', kind: 'text' },
  { key: 'authenticationUX', label: 'Authentication UX', kind: 'text' },
  { key: 'authorizationUX', label: 'Authorization UX', kind: 'text' },
  { key: 'loadingStates', label: 'Loading States', kind: 'list' },
  { key: 'errorStates', label: 'Error States', kind: 'list' },
  { key: 'emptyStates', label: 'Empty States', kind: 'list' },
  { key: 'responsiveStrategy', label: 'Responsive Strategy', kind: 'text' },
  { key: 'accessibilityGuidelines', label: 'Accessibility Guidelines', kind: 'list' },
  { key: 'animationStrategy', label: 'Animation Strategy', kind: 'text' },
  { key: 'themeStrategy', label: 'Theme Strategy', kind: 'text' },
  { key: 'designTokensUsage', label: 'Design Tokens Usage', kind: 'text' },
  { key: 'performanceStrategy', label: 'Performance Strategy', kind: 'text' },
  { key: 'seoStrategy', label: 'SEO Strategy', kind: 'text' },
  { key: 'browserSupport', label: 'Browser Support', kind: 'list' },
  { key: 'frontendFolderStructure', label: 'Frontend Folder Structure', kind: 'list' },
  { key: 'testingStrategy', label: 'Testing Strategy', kind: 'text' },
  { key: 'recommendedNextSteps', label: 'Recommended Next Steps', kind: 'list' },
];

export const FRONTEND_ENGINEER_SYSTEM_PROMPT = `You are a Senior Frontend Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the frontend for the product described in the project context, based on requirements, architecture, database design, UI/UX design, and backend design that have already been gathered and approved. You are not a business analyst, solution architect, database designer, UI/UX designer, or backend engineer, and you are not an implementer:
- Do NOT write or generate frontend code in any framework (React, Next.js, Remix, Vue, Angular, Flutter, SwiftUI, Jetpack Compose, or any other).
- Do NOT write or generate HTML, CSS, or Tailwind classes.
- Do NOT generate actual components, files, or a Figma design.
- Do NOT connect to GitHub or deploy anything.
- Only DESCRIBE the intended frontend design in prose/lists: application structure, routing, page/component hierarchy, state management, API integration, and so on — never actual code, markup, or stylesheets.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, builds, or deploys automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, approved UI/UX design, approved backend design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- The Architecture Draft, Database Design Draft, UI/UX Draft, and Backend Draft have already been approved — treat their module boundaries, data model, user flows, and API design as settled constraints your frontend design must support, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level frontend design specification, not a full implementation: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${FRONTEND_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered FrontendContext
 * (see frontendEngineerEngine.buildFrontendContext). This function never
 * fetches or gathers data itself — it only formats what it's given into
 * text.
 */
export function buildFrontendUserPrompt(context: FrontendContext): string {
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

Approved Backend Draft:
${formatDraftFields(context.backend, BACKEND_DRAFT_FIELDS)}

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
