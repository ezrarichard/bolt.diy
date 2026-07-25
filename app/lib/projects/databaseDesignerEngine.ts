import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import type { ProjectKnowledge } from './knowledge';
import { ARTIFACT_TYPES, createArtifact, getApprovedArtifactContent, type ProjectArtifact } from './artifacts';
import { extractJsonPayload, parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import {
  EMPTY_STRUCTURED_SCHEMA,
  parseStructuredDatabaseSchema,
  type StructuredDatabaseSchema,
} from '~/lib/database-activation/schemaTypes';
import {
  gatherAIDecisions,
  gatherEngineeringNotes,
  type AIDecisionEntry,
  type EngineeringNoteEntry,
} from './collaborationContext';
import {
  getProjectArtifacts,
  getProjectKnowledge,
  getRoadmapItemStatus,
  getTaskNotes,
  type Project,
} from '~/lib/stores/projects';
import type { ArchitectureDraft } from './prompts/architecture';
import type { EngineeringHandoff, ProductOwnerDraft } from './prompts/productOwner';
import {
  buildDatabaseUserPrompt,
  DATABASE_DESIGNER_SYSTEM_PROMPT,
  DATABASE_DRAFT_FIELDS,
  type DatabaseDraft,
} from './prompts/database';

/**
 * Database Designer Engine — Sprint 15, built on the Sprint 14 Solution
 * Architect pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer Engine (this file)
 *         -> AI Generation
 *
 * Same shape as app/lib/projects/solutionArchitectEngine.ts: pure
 * orchestration (context gathering, prompt building, parsing) with no LLM
 * call and no knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged). Approving a Database Design Draft never
 * generates SQL, never connects to Supabase, never creates a database or
 * table, and never mutates Project Knowledge or the Architecture Draft — it
 * only marks this artifact approved. No React, no UI, no prompt strings
 * inlined here — those live in app/lib/projects/prompts/database.ts.
 */

export interface DatabaseContext {
  project: { name: string; description?: string; icon: string };
  blueprint: {
    id: string;
    name: string;
    category: string;
    productType?: string;
    recommendedStack: string[];
    recommendedIntegrations: string[];
  };
  knowledge: ProjectKnowledge | undefined;
  knowledgeCompletion: number;

  /** Full content — Database Engineer is the immediately-next role after Solution Architect, so this is directly relevant rather than summarized. */
  architecture: ArchitectureDraft | undefined;

  /**
   * Sprint 47 — the AI Product Owner's structured, MVP-scoped handoff (scope, constraints,
   * feature IDs, out-of-scope boundary, dependencies) — the single source of truth for which
   * features this MVP actually needs a database schema for. Undefined for legacy projects
   * that progressed before the Product Owner role existed. See
   * docs/05-AI-Product-Owner/04-engineering-handoff.md.
   */
  engineeringHandoff: EngineeringHandoff | undefined;

  /** Sprint 32 — every upstream role's Engineering Notes gathered so far (Business Analyst, Solution Architect). See collaborationContext.ts. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. */
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedDatabaseDraft = ParsedDraftResult<DatabaseDraft>;

const GENERATOR_NAME = 'AI Database Designer';
const ARTIFACT_TYPE = ARTIFACT_TYPES.DATABASE_DRAFT;

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — same anchor Requirements Draft
 * and Architecture Draft artifacts use, since all three are project-level
 * deliverables rather than task-specific ones.
 */
const ARTIFACT_TASK_ID = 'requirements';

/** Reads the latest Architecture Draft artifact and returns its parsed content only if it has been approved — undefined otherwise. */
function getApprovedArchitecture(project: Project): ArchitectureDraft | undefined {
  return getApprovedArtifactContent<ArchitectureDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
}

/**
 * Database Design can only be generated once the Architecture Draft has
 * been approved — the Database Design Panel gates on this and explains why
 * the button is disabled otherwise.
 */
function canGenerateDatabase(project: Project): boolean {
  return getApprovedArchitecture(project) !== undefined;
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + Roadmap + Current Tasks + existing
 * Artifacts + Notes into one structured context object — same pattern as
 * solutionArchitectEngine.buildArchitectureContext.
 */
function buildDatabaseContext(project: Project): DatabaseContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const architecture = getApprovedArchitecture(project);
  const artifacts = getProjectArtifacts(project);
  const engineeringHandoff = getApprovedArtifactContent<ProductOwnerDraft>(
    artifacts,
    ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
  )?.currentMvp?.engineeringHandoff;

  const roadmap = blueprintEngine.getRoadmap(blueprint.id).map((item) => ({
    title: item.title,
    description: item.description,
    status: getRoadmapItemStatus(project, item.key),
  }));

  const tasks = executionEngine.getExecutionTasks(project).map((task) => ({
    title: task.title,
    category: task.category,
    status: task.status,
  }));

  const existingArtifacts = artifacts.map((artifact) => ({
    title: artifact.title,
    type: artifact.type,
    status: artifact.status,
  }));

  const existingNotes = [knowledge?.notes, getTaskNotes(project, ARTIFACT_TASK_ID)].filter(Boolean).join('\n\n');

  return {
    project: { name: project.name, description: project.description, icon: project.icon },
    blueprint: {
      id: blueprint.id,
      name: blueprint.name,
      category: blueprint.category,
      productType: blueprint.productType,
      recommendedStack: blueprintEngine.getRecommendedStack(blueprint.id),
      recommendedIntegrations: blueprintEngine.getRecommendedIntegrations(blueprint.id),
    },
    knowledge,
    knowledgeCompletion: projectKnowledgeEngine.getCompletion(knowledge).overall,
    architecture,
    engineeringHandoff,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'Database Engineer'),
    aiDecisions: gatherAIDecisions(artifacts, 'Database Engineer'),
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/database.ts — no prompt strings live here. */
function buildDatabasePrompt(context: DatabaseContext): { system: string; prompt: string } {
  return {
    system: DATABASE_DESIGNER_SYSTEM_PROMPT,
    prompt: buildDatabaseUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `DatabaseDraft` via the shared
 * generic parser (app/lib/projects/draftParsing.ts), validated field-by-field
 * against DATABASE_DRAFT_FIELDS, PLUS (Sprint 75) the separate
 * `structuredSchema` block from the same JSON response, validated via
 * `parseStructuredDatabaseSchema` (which never throws/fails — malformed or
 * missing input just degrades to `EMPTY_STRUCTURED_SCHEMA`, so an old-shape
 * response never breaks the narrative draft's approval flow).
 */
function parseDraft(rawText: string): ParsedDatabaseDraft {
  const result = parseStructuredDraft<DatabaseDraft>(rawText, DATABASE_DRAFT_FIELDS);

  if (!result.ok) {
    return result;
  }

  let rawSchema: unknown;

  try {
    rawSchema = (JSON.parse(extractJsonPayload(rawText)) as Record<string, unknown>).structuredSchema;
  } catch {
    rawSchema = undefined;
  }

  return { ok: true, draft: { ...result.draft, structuredSchema: parseStructuredDatabaseSchema(rawSchema) } };
}

/**
 * Builds a Database Design Draft artifact holding the parsed NARRATIVE draft
 * as JSON — `structuredSchema` is deliberately stripped here (it is
 * persisted separately via `createSchemaArtifact` below) so this artifact's
 * shape never changes size/content based on Sprint 75's addition. Approving
 * this artifact only ever changes its own `status` — it never generates SQL,
 * never connects to Supabase, and never mutates Project Knowledge or the
 * Architecture Draft.
 */
function createDraftArtifact(draft: DatabaseDraft, version: number): ProjectArtifact {
  const { structuredSchema: _structuredSchema, ...narrative } = draft;

  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Database Design Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(narrative, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

/**
 * Sprint 75 — builds the paired, machine-readable DATABASE_SCHEMA artifact
 * from the same parsed draft's `structuredSchema` field. Passed to
 * useDraftPanel.ts as `createPairedArtifact` so it's created/approved/
 * discarded in lockstep with `createDraftArtifact` above, always at the
 * exact same version — never a separate action.
 */
function createSchemaArtifact(draft: DatabaseDraft, version: number): ProjectArtifact {
  const schema: StructuredDatabaseSchema = draft.structuredSchema ?? EMPTY_STRUCTURED_SCHEMA;

  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Database Schema v${version}`,
    type: ARTIFACT_TYPES.DATABASE_SCHEMA,
    content: JSON.stringify(schema, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

/** Reads the latest approved DATABASE_SCHEMA artifact — undefined content parses to EMPTY_STRUCTURED_SCHEMA's shape (zero tables) rather than undefined, so callers can always check `schema.tables.length`. */
function getApprovedStructuredSchema(project: Project): StructuredDatabaseSchema | undefined {
  return getApprovedArtifactContent<StructuredDatabaseSchema>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.DATABASE_SCHEMA,
  );
}

export const databaseDesignerEngine = {
  canGenerateDatabase,
  buildDatabaseContext,
  buildDatabasePrompt,
  parseDraft,
  createDraftArtifact,
  createSchemaArtifact,
  getApprovedStructuredSchema,
};
