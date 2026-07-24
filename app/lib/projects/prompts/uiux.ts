import type { UIUXContext } from '~/lib/projects/uiuxDesignerEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
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
 * UI/UX Designer prompt — Sprint 16.
 *
 * The only place the UI/UX Designer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/architecture.ts and
 * prompts/database.ts. app/lib/projects/uiuxDesignerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `UIUX_DRAFT_FIELDS` from here rather than re-describing the shape.
 * Nothing in this file calls an LLM, generates HTML/CSS/React/Tailwind/
 * Figma, or talks to a store — it only builds strings and describes a JSON
 * shape.
 */

export interface UIUXDraft {
  designVision?: string;
  designPrinciples?: string[];
  userFlows?: string[];
  screenHierarchy?: string[];
  navigationStructure?: string;
  pageLayouts?: string[];
  componentLibrary?: string[];
  forms?: string[];
  tables?: string[];
  cards?: string[];
  dashboardLayout?: string;
  mobileExperience?: string;
  tabletExperience?: string;
  desktopExperience?: string;
  accessibilityGuidelines?: string[];
  colorStrategy?: string;
  typographyStrategy?: string;
  spacingSystem?: string;
  iconography?: string;
  animations?: string[];
  emptyStates?: string[];
  loadingStates?: string[];
  errorStates?: string[];
  notifications?: string[];
  designTokens?: string[];
  futureEnhancements?: string[];

  /** Sprint 32 — freeform recommendations for the next role (the Backend Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface UIUXDraftFieldConfig {
  key: keyof UIUXDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, uiuxDesignerEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const UIUX_DRAFT_FIELDS: UIUXDraftFieldConfig[] = [
  { key: 'designVision', label: 'Design Vision', kind: 'text' },
  { key: 'designPrinciples', label: 'Design Principles', kind: 'list' },
  { key: 'userFlows', label: 'User Flows', kind: 'list' },
  { key: 'screenHierarchy', label: 'Screen Hierarchy', kind: 'list' },
  { key: 'navigationStructure', label: 'Navigation Structure', kind: 'text' },
  { key: 'pageLayouts', label: 'Page Layouts', kind: 'list' },
  { key: 'componentLibrary', label: 'Component Library', kind: 'list' },
  { key: 'forms', label: 'Forms', kind: 'list' },
  { key: 'tables', label: 'Tables', kind: 'list' },
  { key: 'cards', label: 'Cards', kind: 'list' },
  { key: 'dashboardLayout', label: 'Dashboard Layout', kind: 'text' },
  { key: 'mobileExperience', label: 'Mobile Experience', kind: 'text' },
  { key: 'tabletExperience', label: 'Tablet Experience', kind: 'text' },
  { key: 'desktopExperience', label: 'Desktop Experience', kind: 'text' },
  { key: 'accessibilityGuidelines', label: 'Accessibility Guidelines', kind: 'list' },
  { key: 'colorStrategy', label: 'Color Strategy', kind: 'text' },
  { key: 'typographyStrategy', label: 'Typography Strategy', kind: 'text' },
  { key: 'spacingSystem', label: 'Spacing System', kind: 'text' },
  { key: 'iconography', label: 'Iconography', kind: 'text' },
  { key: 'animations', label: 'Animations', kind: 'list' },
  { key: 'emptyStates', label: 'Empty States', kind: 'list' },
  { key: 'loadingStates', label: 'Loading States', kind: 'list' },
  { key: 'errorStates', label: 'Error States', kind: 'list' },
  { key: 'notifications', label: 'Notifications', kind: 'list' },
  { key: 'designTokens', label: 'Design Tokens', kind: 'list' },
  { key: 'futureEnhancements', label: 'Future Enhancements', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const UIUX_DESIGNER_SYSTEM_PROMPT = `You are a Senior UI/UX Product Designer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to produce a structured, conceptual UI/UX design specification for the product described in the project context, based on requirements and architecture that have already been gathered and approved. You are not a business analyst, not a solution architect, not a database designer, and not an implementer:
- Do NOT write or generate HTML, CSS, Tailwind classes, React/Vue/Svelte/Angular components, Figma files, or images.
- Do NOT produce any code in any language or framework.
- Do NOT create databases, tables, migrations, or modify the approved Architecture — treat it as a settled constraint, not an open question.
- Only DESCRIBE the intended design in prose/lists: vision, principles, flows, screen hierarchy, layouts, component inventory, states, and design tokens as named concepts (e.g. "primary-500", "space-4"), never as actual CSS/JS values or stylesheets.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, renders, or deploys automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this design: design screens/flows ONLY for the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not design screens for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where a screen/flow maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "screenHierarchy: ['Book Appointment screen (FEAT-006, FEAT-007)']") so this design stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), design for the full product as before.
- The Architecture Draft has already been approved — treat its module boundaries as a settled constraint your screens and flows must reflect, not an open question. The Database Design happens in parallel with your work and is intentionally not part of your input — design at the product/screen level, not the data-model level.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- If Blueprint guidance is present in your context, it informs HOW to design already-approved screens, journeys, and interactions well (industry-typical information architecture, navigation, patterns, and terminology) — it never authorizes a new screen or flow beyond what the Business Analysis, Product Owner, and Architecture have already approved.
- Be concise. This is a high-level design specification, not a full design system: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${UIUX_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered UIUXContext
 * (see uiuxDesignerEngine.buildUIUXContext). This function never fetches or
 * gathers data itself — it only formats what it's given into text.
 */
export function buildUIUXUserPrompt(context: UIUXContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Architecture Draft (full — you are a directly-downstream role):
${formatDraftFields(context.architecture, omitCollaborationFields(ARCHITECTURE_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 47 — this is the MVP-scoped boundary for your design; design screens/flows ONLY for the features listed, treat outOfScopeFeatures as a hard constraint. Absent for legacy projects that progressed before this role existed):
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
