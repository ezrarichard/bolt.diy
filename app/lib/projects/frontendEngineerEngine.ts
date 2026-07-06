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
import type { UIUXDraft } from './prompts/uiux';
import type { BackendDraft } from './prompts/backend';
import {
  buildFrontendUserPrompt,
  FRONTEND_DRAFT_FIELDS,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  type FrontendDraft,
} from './prompts/frontend';

/**
 * Frontend Engineer Engine — Sprint 20, built on the Sprint 19 Backend
 * Engineer pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer
 *         -> UI/UX Designer -> Backend Engineer -> Frontend Engineer Engine
 *           (this file) -> AI Generation
 *
 * Same shape as app/lib/projects/backendEngineerEngine.ts: pure
 * orchestration (context gathering, prompt building, parsing) with no LLM
 * call and no knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged). Approving a Frontend Draft never generates
 * React/Next.js/Remix/Vue/Angular/Flutter/SwiftUI/Jetpack Compose code,
 * HTML, CSS, or Tailwind, connects to GitHub, or deploys anything, and
 * never mutates Project Knowledge, the Architecture Draft, the UI/UX Draft,
 * or the Backend Draft — it only marks this artifact approved. No React, no
 * UI, no prompt strings inlined here — those live in
 * app/lib/projects/prompts/frontend.ts.
 *
 * Sprint 32 — Frontend Engineer's curated input is Business Analyst +
 * Architecture + UX + Backend (not Database directly): frontend
 * implementation follows screens and APIs, not the schema underneath them.
 * Architecture is carried as a summary; UX and Backend are carried in full
 * (both directly relevant — see prompts/frontend.ts for where that
 * full-vs-summary split happens).
 */

export interface FrontendContext {
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

  /** Full content — both directly relevant upstream roles per Sprint 32's curated dependency map (Database is deliberately excluded here). */
  uiux: UIUXDraft | undefined;
  backend: BackendDraft | undefined;

  /** Sprint 32 — every upstream role's Engineering Notes gathered so far. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. */
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedFrontendDraft = ParsedDraftResult<FrontendDraft>;

const GENERATOR_NAME = 'AI Frontend Engineer';
const ARTIFACT_TYPE = ARTIFACT_TYPES.FRONTEND_DRAFT;

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — same anchor Requirements Draft,
 * Architecture Draft, Database Design Draft, UI/UX Draft, and Backend Draft
 * artifacts use, since all six are project-level deliverables rather than
 * task-specific ones.
 */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * Frontend Design can only be generated once the Backend Draft has been
 * approved — the Frontend Design Panel gates on this and explains why the
 * button is disabled otherwise.
 */
function canGenerateFrontend(project: Project): boolean {
  return (
    getApprovedArtifactContent<BackendDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.BACKEND_DRAFT) !== undefined
  );
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + approved Database Design Draft + approved
 * UI/UX Draft + approved Backend Draft + Roadmap + Current Tasks + existing
 * Artifacts + Notes into one structured context object — same pattern as
 * backendEngineerEngine.buildBackendContext.
 */
function buildFrontendContext(project: Project): FrontendContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const uiux = getApprovedArtifactContent<UIUXDraft>(artifacts, ARTIFACT_TYPES.UIUX_DRAFT);
  const backend = getApprovedArtifactContent<BackendDraft>(artifacts, ARTIFACT_TYPES.BACKEND_DRAFT);

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
    uiux,
    backend,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'Frontend Engineer'),
    aiDecisions: gatherAIDecisions(artifacts, 'Frontend Engineer'),
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/frontend.ts — no prompt strings live here. */
function buildFrontendPrompt(context: FrontendContext): { system: string; prompt: string } {
  return {
    system: FRONTEND_ENGINEER_SYSTEM_PROMPT,
    prompt: buildFrontendUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `FrontendDraft` via the shared
 * generic parser (app/lib/projects/draftParsing.ts), validated field-by-field
 * against FRONTEND_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedFrontendDraft {
  return parseStructuredDraft<FrontendDraft>(rawText, FRONTEND_DRAFT_FIELDS);
}

/**
 * Builds a Frontend Draft artifact holding the parsed draft as JSON.
 * Approving this artifact only ever changes its own `status` — it never
 * generates React/Next.js/Remix/Vue/Angular/Flutter/SwiftUI/Jetpack Compose
 * code, HTML, CSS, or Tailwind, connects to GitHub, or deploys anything, and
 * never mutates Project Knowledge, the Architecture Draft, the Database
 * Design Draft, the UI/UX Draft, or the Backend Draft.
 */
function createDraftArtifact(draft: FrontendDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Frontend Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const frontendEngineerEngine = {
  canGenerateFrontend,
  buildFrontendContext,
  buildFrontendPrompt,
  parseDraft,
  createDraftArtifact,
};
