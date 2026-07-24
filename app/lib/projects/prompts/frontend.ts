import type { FrontendContext } from '~/lib/projects/frontendEngineerEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { UIUX_DRAFT_FIELDS } from './uiux';
import { BACKEND_DRAFT_FIELDS } from './backend';
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

  /** Sprint 32 — freeform recommendations for the next role (the QA Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface FrontendDraftFieldConfig {
  key: keyof FrontendDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
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
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const FRONTEND_ENGINEER_SYSTEM_PROMPT = `You are a Senior Frontend Engineer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design the frontend for the product described in the project context, based on requirements, architecture, UI/UX design, and backend design that have already been gathered and approved. You are not a business analyst, solution architect, database designer, UI/UX designer, or backend engineer, and you are not an implementer:
- Do NOT write or generate frontend code in any framework (React, Next.js, Remix, Vue, Angular, Flutter, SwiftUI, Jetpack Compose, or any other).
- Do NOT write or generate HTML, CSS, or Tailwind classes.
- Do NOT generate actual components, files, or a Figma design.
- Do NOT connect to GitHub or deploy anything.
- Only DESCRIBE the intended frontend design in prose/lists: application structure, routing, page/component hierarchy, state management, API integration, and so on — never actual code, markup, or stylesheets.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, builds, or deploys automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved UI/UX design, approved backend design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this design: design pages/components ONLY for the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not design pages for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where a page/component maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "pageComponents: ['BookAppointmentForm (FEAT-007)']") so this design stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), design for the full product as before.
- The UI/UX Draft and Backend Draft have already been approved — treat their screens/flows and API design as settled constraints your frontend design must support, not open questions. Database design is intentionally not part of your input — you consume the backend's API, not the schema underneath it.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- If Blueprint guidance is present in your context, it informs HOW to implement the already-approved UI/UX and frontend scope well (industry-typical component/route decomposition, state handling, validation, and performance/security patterns) — it never authorizes a new route, feature, or business functionality beyond what the approved UI/UX Draft and Backend Draft already include.
- Be concise. This is a high-level frontend design specification, not a full implementation: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${FRONTEND_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
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

Approved Architecture (summary):
${summarizeArchitecture(context.architecture)}

Approved UI/UX Draft (full — directly relevant to your role):
${formatDraftFields(context.uiux, omitCollaborationFields(UIUX_DRAFT_FIELDS))}

Approved Backend Draft (full — you are the next role in the chain):
${formatDraftFields(context.backend, omitCollaborationFields(BACKEND_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 47 — this is the MVP-scoped boundary for your design; design pages/components ONLY for the features listed, treat outOfScopeFeatures as a hard constraint. Absent for legacy projects that progressed before this role existed):
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
