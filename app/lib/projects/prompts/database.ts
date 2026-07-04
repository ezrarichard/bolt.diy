import type { DatabaseContext } from '~/lib/projects/databaseDesignerEngine';
import { ARCHITECTURE_DRAFT_FIELDS } from './architecture';
import { formatDraftFields, formatList, formatProjectKnowledge } from './shared';

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
}

export interface DatabaseDraftFieldConfig {
  key: keyof DatabaseDraft;
  label: string;
  kind: 'text' | 'list';
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
- The Architecture Draft has already been approved — treat its database/backend/integration decisions as settled constraints, not open questions.
- Where information is missing, make a reasonable, clearly-scoped assumption rather than leaving a field empty.
- Be concise. This is a high-level database design overview, not a full schema: each text field must be at most 2-4 sentences (a short paragraph), and each list field must contain at most 5-10 of the most important items — pick the ones that matter most rather than trying to be exhaustive.
- Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${DATABASE_DRAFT_FIELDS.map((field) => `  "${field.key}": ${field.kind === 'list' ? 'string[]' : 'string'}`).join(',\n')}
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

Approved Architecture Draft:
${formatDraftFields(context.architecture, ARCHITECTURE_DRAFT_FIELDS)}

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
