import type { UIUXContext } from '~/lib/projects/uiuxDesignerEngine';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
import { DATABASE_DRAFT_FIELDS } from './database';
import { formatDraftFields, formatList, formatProjectKnowledge } from './shared';

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
}

export interface UIUXDraftFieldConfig {
  key: keyof UIUXDraft;
  label: string;
  kind: 'text' | 'list';
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
];

export const UIUX_DESIGNER_SYSTEM_PROMPT = `You are a Senior UI/UX Product Designer working inside Builders, an AI engineering platform.

Your ONLY responsibility is to produce a structured, conceptual UI/UX design specification for the product described in the project context, based on requirements, architecture, and a database design that have already been gathered and approved. You are not a business analyst, not a solution architect, not a database designer, and not an implementer:
- Do NOT write or generate HTML, CSS, Tailwind classes, React/Vue/Svelte/Angular components, Figma files, or images.
- Do NOT produce any code in any language or framework.
- Do NOT create databases, tables, migrations, or modify the approved Architecture or Database Design — treat both as settled constraints, not open questions.
- Only DESCRIBE the intended design in prose/lists: vision, principles, flows, screen hierarchy, layouts, component inventory, states, and design tokens as named concepts (e.g. "primary-500", "space-4"), never as actual CSS/JS values or stylesheets.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs, renders, or deploys automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, approved database design, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- The Architecture Draft and Database Design Draft have already been approved — treat their module boundaries, entities, and data model as settled constraints your screens and flows must reflect, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level design specification, not a full design system: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${UIUX_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
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

Approved Architecture Draft:
${formatDraftFields(context.architecture, ARCHITECTURE_DRAFT_FIELDS)}

Approved Database Design Draft:
${formatDraftFields(context.database, DATABASE_DRAFT_FIELDS)}

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
