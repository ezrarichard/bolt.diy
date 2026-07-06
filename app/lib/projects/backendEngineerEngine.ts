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
import {
  gatherAIDecisions,
  gatherEngineeringNotes,
  type AIDecisionEntry,
  type EngineeringNoteEntry,
} from './collaborationContext';
import type { ArchitectureDraft } from './prompts/architecture';
import type { DatabaseDraft } from './prompts/database';
import {
  BACKEND_DRAFT_FIELDS,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
  buildBackendUserPrompt,
  type BackendDraft,
} from './prompts/backend';

/**
 * Backend Engineer Engine — Sprint 19, built on the Sprint 16 UI/UX
 * Designer pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer
 *         -> UI/UX Designer -> Backend Engineer Engine (this file)
 *           -> AI Generation
 *
 * Same shape as app/lib/projects/uiuxDesignerEngine.ts: pure orchestration
 * (context gathering, prompt building, parsing) with no LLM call and no
 * knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged). Approving a Backend Draft never generates
 * backend code, SQL, Prisma/Drizzle/Supabase schemas, connects to GitHub,
 * or deploys anything, and never mutates Project Knowledge, the
 * Architecture Draft, or the Database Design Draft — it
 * only marks this artifact approved. No React, no UI, no prompt strings
 * inlined here — those live in app/lib/projects/prompts/backend.ts.
 *
 * Sprint 32 — Backend Engineer's curated input is Business Analyst +
 * Architecture + Database (not UI/UX): backend design flows from data model
 * and system boundaries, not screen layout. Architecture is carried as a
 * summary (two roles back) and Database in full (the immediately preceding
 * role) — see prompts/backend.ts for where that full-vs-summary split
 * happens.
 */

export interface BackendContext {
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

  /** Full content — Backend Engineer's directly relevant upstream role (UI/UX is deliberately excluded per Sprint 32's curated dependency map). */
  database: DatabaseDraft | undefined;

  /** Sprint 32 — every upstream role's Engineering Notes gathered so far. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. */
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedBackendDraft = ParsedDraftResult<BackendDraft>;

const GENERATOR_NAME = 'AI Backend Engineer';
const ARTIFACT_TYPE = ARTIFACT_TYPES.BACKEND_DRAFT;

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — same anchor Requirements Draft,
 * Architecture Draft, Database Design Draft, and UI/UX Draft artifacts use,
 * since all five are project-level deliverables rather than task-specific
 * ones.
 */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * Backend Design can only be generated once the Database Design Draft has
 * been approved — the Backend Design Panel gates on this and explains why
 * the button is disabled otherwise. Sprint 32 — narrowed from requiring
 * UI/UX (Backend's curated input is Business Analyst + Architecture +
 * Database only); the autonomous pipeline still runs UX Engineer before
 * Backend Engineer via array order in autoEngineeringEngine.ts regardless
 * of this gate.
 */
function canGenerateBackend(project: Project): boolean {
  return (
    getApprovedArtifactContent<DatabaseDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.DATABASE_DRAFT) !== undefined
  );
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + approved Database Design Draft + Engineering
 * Notes/AI Decisions so far + Roadmap + Current Tasks + existing Artifacts +
 * Notes into one structured context object — same pattern as
 * uiuxDesignerEngine.buildUIUXContext.
 */
function buildBackendContext(project: Project): BackendContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const database = getApprovedArtifactContent<DatabaseDraft>(artifacts, ARTIFACT_TYPES.DATABASE_DRAFT);

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
    database,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'Backend Engineer'),
    aiDecisions: gatherAIDecisions(artifacts, 'Backend Engineer'),
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/backend.ts — no prompt strings live here. */
function buildBackendPrompt(context: BackendContext): { system: string; prompt: string } {
  return {
    system: BACKEND_ENGINEER_SYSTEM_PROMPT,
    prompt: buildBackendUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `BackendDraft` via the shared
 * generic parser (app/lib/projects/draftParsing.ts), validated field-by-field
 * against BACKEND_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedBackendDraft {
  return parseStructuredDraft<BackendDraft>(rawText, BACKEND_DRAFT_FIELDS);
}

/**
 * Builds a Backend Draft artifact holding the parsed draft as JSON.
 * Approving this artifact only ever changes its own `status` — it never
 * generates backend code, SQL, Prisma/Drizzle/Supabase schemas, connects to
 * GitHub, or deploys anything, and never mutates Project Knowledge, the
 * Architecture Draft, the Database Design Draft, or the UI/UX Draft.
 */
function createDraftArtifact(draft: BackendDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Backend Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const backendEngineerEngine = {
  canGenerateBackend,
  buildBackendContext,
  buildBackendPrompt,
  parseDraft,
  createDraftArtifact,
};
