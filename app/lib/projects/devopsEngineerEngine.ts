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
import type { UIUXDraft } from './prompts/uiux';
import type { BackendDraft } from './prompts/backend';
import type { FrontendDraft } from './prompts/frontend';
import type { QADraft } from './prompts/qa';
import {
  gatherAIDecisions,
  gatherEngineeringNotes,
  type AIDecisionEntry,
  type EngineeringNoteEntry,
} from './collaborationContext';
import {
  buildDevOpsUserPrompt,
  DEVOPS_DRAFT_FIELDS,
  DEVOPS_ENGINEER_SYSTEM_PROMPT,
  type DevOpsDraft,
} from './prompts/devops';

/**
 * DevOps Engineer Engine — Sprint 22, built on the Sprint 21 QA Engineer
 * pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect -> Database Designer
 *         -> UI/UX Designer -> Backend Engineer -> Frontend Engineer
 *           -> QA Engineer -> DevOps Engineer Engine (this file)
 *             -> AI Generation
 *
 * Same shape as app/lib/projects/qaEngineerEngine.ts: pure orchestration
 * (context gathering, prompt building, parsing) with no LLM call and no
 * knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged). Approving a DevOps Draft never generates a
 * Dockerfile, GitHub Actions workflow, Kubernetes manifest, Terraform
 * configuration, or shell script, never deploys or provisions anything, and
 * never mutates Project Knowledge, the Architecture Draft, the Database
 * Design Draft, the UI/UX Draft, the Backend Draft, the Frontend Draft, or
 * the QA Draft — it only marks this artifact approved. No React, no UI, no
 * prompt strings inlined here — those live in
 * app/lib/projects/prompts/devops.ts.
 */

export interface DevOpsContext {
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

  /** Sprint 32 — DevOps reads every upstream role (per spec: "reads EVERYTHING"); everything but QA is carried as a summary, QA in full (the immediately preceding role) — see prompts/devops.ts for that split. */
  architecture: ArchitectureDraft | undefined;
  database: DatabaseDraft | undefined;
  uiux: UIUXDraft | undefined;
  backend: BackendDraft | undefined;
  frontend: FrontendDraft | undefined;
  qa: QADraft | undefined;

  /** Sprint 32 — every upstream role's Engineering Notes gathered so far. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. */
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedDevOpsDraft = ParsedDraftResult<DevOpsDraft>;

const GENERATOR_NAME = 'AI DevOps Engineer';
const ARTIFACT_TYPE = ARTIFACT_TYPES.DEVOPS_DRAFT;

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — same anchor Requirements Draft,
 * Architecture Draft, Database Design Draft, UI/UX Draft, Backend Draft,
 * Frontend Draft, and QA Draft artifacts use, since all eight are
 * project-level deliverables rather than task-specific ones.
 */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * DevOps Strategy can only be generated once the QA Draft has been approved
 * — the DevOps Draft Panel gates on this and explains why the button is
 * disabled otherwise.
 */
function canGenerateDevOps(project: Project): boolean {
  return getApprovedArtifactContent<QADraft>(getProjectArtifacts(project), ARTIFACT_TYPES.QA_DRAFT) !== undefined;
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + approved Database Design Draft + approved
 * UI/UX Draft + approved Backend Draft + approved Frontend Draft + approved
 * QA Draft + Roadmap + Current Tasks + existing Artifacts + Notes into one
 * structured context object — same pattern as
 * qaEngineerEngine.buildQAContext.
 */
function buildDevOpsContext(project: Project): DevOpsContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const database = getApprovedArtifactContent<DatabaseDraft>(artifacts, ARTIFACT_TYPES.DATABASE_DRAFT);
  const uiux = getApprovedArtifactContent<UIUXDraft>(artifacts, ARTIFACT_TYPES.UIUX_DRAFT);
  const backend = getApprovedArtifactContent<BackendDraft>(artifacts, ARTIFACT_TYPES.BACKEND_DRAFT);
  const frontend = getApprovedArtifactContent<FrontendDraft>(artifacts, ARTIFACT_TYPES.FRONTEND_DRAFT);
  const qa = getApprovedArtifactContent<QADraft>(artifacts, ARTIFACT_TYPES.QA_DRAFT);

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
    uiux,
    backend,
    frontend,
    qa,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'DevOps Engineer'),
    aiDecisions: gatherAIDecisions(artifacts, 'DevOps Engineer'),
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/devops.ts — no prompt strings live here. */
function buildDevOpsPrompt(context: DevOpsContext): { system: string; prompt: string } {
  return {
    system: DEVOPS_ENGINEER_SYSTEM_PROMPT,
    prompt: buildDevOpsUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `DevOpsDraft` via the shared
 * generic parser (app/lib/projects/draftParsing.ts), validated field-by-field
 * against DEVOPS_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedDevOpsDraft {
  return parseStructuredDraft<DevOpsDraft>(rawText, DEVOPS_DRAFT_FIELDS);
}

/**
 * Builds a DevOps Draft artifact holding the parsed draft as JSON.
 * Approving this artifact only ever changes its own `status` — it never
 * generates a Dockerfile, GitHub Actions workflow, Kubernetes manifest,
 * Terraform configuration, or shell script, never deploys or provisions
 * anything, and never mutates Project Knowledge, the Architecture Draft,
 * the Database Design Draft, the UI/UX Draft, the Backend Draft, the
 * Frontend Draft, or the QA Draft.
 */
function createDraftArtifact(draft: DevOpsDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `DevOps Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const devopsEngineerEngine = {
  canGenerateDevOps,
  buildDevOpsContext,
  buildDevOpsPrompt,
  parseDraft,
  createDraftArtifact,
};
