import type { DatabaseContext } from '~/lib/projects/databaseDesignerEngine';
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
 * Database Designer prompt — Sprint 15.
 *
 * The only place the Database Designer's system prompt, JSON contract, and
 * user-prompt assembly live — same pattern as prompts/architecture.ts and
 * prompts/requirements.ts. app/lib/projects/databaseDesignerEngine.ts (pure
 * orchestration) and any UI that renders a draft both import
 * `DATABASE_DRAFT_FIELDS` from here rather than re-describing the shape.
 * Nothing in this file calls an LLM, generates SQL, connects to Supabase, or
 * talks to a store — it only builds strings and describes a JSON shape.
 */

export interface DatabaseDraft {
  databaseOverview?: string;
  entities?: string[];
  relationships?: string[];
  primaryKeys?: string[];
  foreignKeys?: string[];
  indexes?: string[];
  constraints?: string[];
  auditFields?: string[];
  softDeleteStrategy?: string;
  multiTenantStrategy?: string;
  cachingRecommendations?: string;
  backupStrategy?: string;
  securityModel?: string;
  dataRetention?: string;
  migrationStrategy?: string;
  futureExpansion?: string[];

  /** Sprint 32 — freeform recommendations for the next role (the UX Engineer). See app/lib/projects/collaborationContext.ts. */
  engineeringNotes?: string;

  /** Sprint 32 — structured decision log (see draftParsing.ts's `AIDecision`), carried forward to every later role. */
  aiDecisions?: AIDecision[];
}

export interface DatabaseDraftFieldConfig {
  key: keyof DatabaseDraft;
  label: string;
  kind: 'text' | 'list' | 'decisions';
}

/**
 * Single source of truth for the draft's shape — drives the JSON contract
 * described to the AI below, databaseDesignerEngine.parseDraft()'s
 * field-by-field extraction, and the preview UI's section list.
 */
export const DATABASE_DRAFT_FIELDS: DatabaseDraftFieldConfig[] = [
  { key: 'databaseOverview', label: 'Database Overview', kind: 'text' },
  { key: 'entities', label: 'Entities', kind: 'list' },
  { key: 'relationships', label: 'Relationships', kind: 'list' },
  { key: 'primaryKeys', label: 'Primary Keys', kind: 'list' },
  { key: 'foreignKeys', label: 'Foreign Keys', kind: 'list' },
  { key: 'indexes', label: 'Indexes', kind: 'list' },
  { key: 'constraints', label: 'Constraints', kind: 'list' },
  { key: 'auditFields', label: 'Audit Fields', kind: 'list' },
  { key: 'softDeleteStrategy', label: 'Soft Delete Strategy', kind: 'text' },
  { key: 'multiTenantStrategy', label: 'Multi-Tenant Strategy', kind: 'text' },
  { key: 'cachingRecommendations', label: 'Caching Recommendations', kind: 'text' },
  { key: 'backupStrategy', label: 'Backup Strategy', kind: 'text' },
  { key: 'securityModel', label: 'Security Model', kind: 'text' },
  { key: 'dataRetention', label: 'Data Retention', kind: 'text' },
  { key: 'migrationStrategy', label: 'Migration Strategy', kind: 'text' },
  { key: 'futureExpansion', label: 'Future Expansion', kind: 'list' },
  { key: 'engineeringNotes', label: 'Engineering Notes For Next Engineer', kind: 'text' },
  { key: 'aiDecisions', label: 'AI Decisions', kind: 'decisions' },
];

export const DATABASE_DESIGNER_SYSTEM_PROMPT = `You are a Senior Database Architect working inside Builders, an AI engineering platform.

Your ONLY responsibility is to design a structured, conceptual database design for the product described in the project context, based on requirements and architecture that have already been gathered and approved. You are not a business analyst, not a solution architect, and not an implementer:
- Do NOT write or generate SQL, migrations, ORM schemas (Prisma, Drizzle, Entity Framework, Hibernate, Django ORM), or any code.
- Do NOT connect to Supabase or any other database provider.
- Do NOT create databases, tables, or columns — only DESCRIBE the intended entities, relationships, and strategies in prose/lists.
- Do NOT propose specific GitHub repository actions or deployment steps to execute.
- This is a planning artifact only. Everything you produce is a draft for a human to review and approve — it never runs automatically.

Rules:
- Base your answer strictly on the project context you are given (blueprint, approved requirements/Project Knowledge, approved architecture, roadmap, tasks, existing artifacts, notes). Do not invent unrelated features or industries.
- If an Engineering Handoff from the AI Product Owner is present, it is the primary boundary for this design: design entities/relationships ONLY for the features it lists as in scope, and treat its "OUT OF SCOPE" list as a hard constraint — do not design tables or relationships for out-of-scope or future-MVP features even if the wider Requirements draft mentions them. Where an entity maps clearly to one or more specific features, cite their Feature ID(s) (e.g. "entities: ['Appointments table (FEAT-006, FEAT-007)']") so this design stays traceable back to the Product Owner's scope. If no handoff is present (a legacy project), design for the full product as before.
- The Architecture Draft has already been approved — treat its database/backend/integration decisions as settled constraints, not open questions.
- If your context includes a "Blueprint Guidance for Database Design" section, use it to design a better schema, never a bigger one: it tells you typical entities, relationships, business rules, and compliance/security/performance expectations for this kind of product — use that to sharpen entity/relationship design, indexes, constraints, and audit fields. It never expands what you design for; the approved Business Analysis, Engineering Handoff, and Architecture Draft still govern that. If Blueprint guidance conflicts with any of them, note the conflict in engineeringNotes rather than resolving it silently.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level database design overview, not a full schema: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.

${COLLABORATION_FRAMING}`;

const JSON_SHAPE = `{
${DATABASE_DRAFT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered
 * DatabaseContext (see databaseDesignerEngine.buildDatabaseContext). This
 * function never fetches or gathers data itself — it only formats what it's
 * given into text.
 */
export function buildDatabaseUserPrompt(context: DatabaseContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})
Recommended stack: ${formatList(context.blueprint.recommendedStack)}
Recommended integrations: ${formatList(context.blueprint.recommendedIntegrations)}

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Architecture Draft (full — you are the next role in the chain):
${formatDraftFields(context.architecture, omitCollaborationFields(ARCHITECTURE_DRAFT_FIELDS))}

Engineering Handoff from the AI Product Owner (Sprint 47 — this is the MVP-scoped boundary for your schema design; design tables/entities ONLY for the features listed, treat outOfScopeFeatures as a hard constraint. Absent for legacy projects that progressed before this role existed):
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
