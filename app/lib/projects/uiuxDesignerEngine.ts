import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import type { ProjectKnowledge } from './knowledge';
import { ARTIFACT_TYPES, createArtifact, getApprovedArtifactContent, type ProjectArtifact } from './artifacts';
import { parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import {
  getProjectArtifacts,
  getProjectKnowledge,
  getRoadmapItemStatus,
  getTaskNotes,
  type Project,
} from '~/lib/stores/projects';
import type { ArchitectureDraft } from './prompts/architecture';
import type { DatabaseDraft } from './prompts/database';
import { buildUIUXUserPrompt, UIUX_DESIGNER_SYSTEM_PROMPT, UIUX_DRAFT_FIELDS, type UIUXDraft } from './prompts/uiux';

/**
 * UI/UX Designer Engine — Sprint 16, built on the Sprint 15 Database
 * Designer pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer
 *         -> UI/UX Designer Engine (this file) -> AI Generation
 *
 * Same shape as app/lib/projects/databaseDesignerEngine.ts: pure
 * orchestration (context gathering, prompt building, parsing) with no LLM
 * call and no knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged). Approving a UI/UX Draft never generates
 * HTML, CSS, Tailwind, React, Figma files, or images, and never mutates
 * Project Knowledge, the Architecture Draft, or the Database Design Draft —
 * it only marks this artifact approved. No React, no UI, no prompt strings
 * inlined here — those live in app/lib/projects/prompts/uiux.ts.
 */

export interface UIUXContext {
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
  architecture: ArchitectureDraft | undefined;
  database: DatabaseDraft | undefined;
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedUIUXDraft = ParsedDraftResult<UIUXDraft>;

const GENERATOR_NAME = 'AI UI/UX Designer';
const ARTIFACT_TYPE = ARTIFACT_TYPES.UIUX_DRAFT;

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — same anchor Requirements Draft,
 * Architecture Draft, and Database Design Draft artifacts use, since all
 * four are project-level deliverables rather than task-specific ones.
 */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * UI/UX Design can only be generated once the Database Design Draft has
 * been approved — the UI/UX Design Panel gates on this and explains why the
 * button is disabled otherwise.
 */
function canGenerateUIUX(project: Project): boolean {
  return (
    getApprovedArtifactContent<DatabaseDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.DATABASE_DRAFT) !== undefined
  );
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + approved Database Design Draft + Roadmap +
 * Current Tasks + existing Artifacts + Notes into one structured context
 * object — same pattern as databaseDesignerEngine.buildDatabaseContext.
 */
function buildUIUXContext(project: Project): UIUXContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
  );
  const database = getApprovedArtifactContent<DatabaseDraft>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.DATABASE_DRAFT,
  );

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

  const existingArtifacts = getProjectArtifacts(project).map((artifact) => ({
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
    database,
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/uiux.ts — no prompt strings live here. */
function buildUIUXPrompt(context: UIUXContext): { system: string; prompt: string } {
  return {
    system: UIUX_DESIGNER_SYSTEM_PROMPT,
    prompt: buildUIUXUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `UIUXDraft` via the shared
 * generic parser (app/lib/projects/draftParsing.ts), validated field-by-field
 * against UIUX_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedUIUXDraft {
  return parseStructuredDraft<UIUXDraft>(rawText, UIUX_DRAFT_FIELDS);
}

/**
 * Builds a UI/UX Draft artifact holding the parsed draft as JSON. Approving
 * this artifact only ever changes its own `status` — it never generates
 * HTML, CSS, Tailwind, React, Figma files, or images, and never mutates
 * Project Knowledge, the Architecture Draft, or the Database Design Draft.
 */
function createDraftArtifact(draft: UIUXDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `UI/UX Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const uiuxDesignerEngine = {
  canGenerateUIUX,
  buildUIUXContext,
  buildUIUXPrompt,
  parseDraft,
  createDraftArtifact,
};
