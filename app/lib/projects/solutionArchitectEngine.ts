import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import { isRequirementsCaptured, type ProjectKnowledge } from './knowledge';
import { ARTIFACT_TYPES, createArtifact, getApprovedArtifactContent, type ProjectArtifact } from './artifacts';
import { parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
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
import {
  ARCHITECTURE_DRAFT_FIELDS,
  buildArchitectureUserPrompt,
  SOLUTION_ARCHITECT_SYSTEM_PROMPT,
  type ArchitectureDraft,
} from './prompts/architecture';
import type { RequirementsDraft } from './prompts/requirements';

/**
 * Solution Architect Engine — Sprint 14, built on the Sprint 13 Business
 * Analyst pattern.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst -> Solution Architect Engine (this file)
 *         -> AI Generation
 *
 * Same shape as app/lib/projects/businessAnalystEngine.ts: pure
 * orchestration (context gathering, prompt building, parsing) with no LLM
 * call and no knowledge of which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts and app/routes/api.generate-text.ts for
 * that (both reused unchanged from Sprint 13). Unlike the Business Analyst,
 * approving an Architecture Draft never mutates Project Knowledge or any
 * database/frontend/backend artifact — it only marks this artifact
 * approved. No React, no UI, no prompt strings inlined here — those live in
 * app/lib/projects/prompts/architecture.ts.
 */

export interface ArchitectureContext {
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

  /** Sprint 32 — the approved Business Analyst output in full: the Solution Architect is the immediately-next role, so this is directly relevant rather than summarized. */
  requirementsDraft: RequirementsDraft | undefined;

  /** Sprint 32 — every upstream role's "Engineering Notes For Next Engineer" gathered so far (just Business Analyst, at this point in the chain). See collaborationContext.ts. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. See collaborationContext.ts. */
  aiDecisions: AIDecisionEntry[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingArtifacts: { title: string; type: string; status: string }[];
  existingNotes: string;
}

export type ParsedArchitectureDraft = ParsedDraftResult<ArchitectureDraft>;

const GENERATOR_NAME = 'AI Solution Architect';
const ARTIFACT_TYPE = ARTIFACT_TYPES.ARCHITECTURE_DRAFT;

/**
 * Requirements/Project Knowledge is the only precondition for generating an
 * architecture draft — same check the Project Dashboard already uses to
 * show "Requirements captured"/"Requirements missing" (Sprint 9). No new
 * concept introduced here; the Architecture panel gates on this.
 */
function canGenerateArchitecture(project: Project): boolean {
  return isRequirementsCaptured(getProjectKnowledge(project));
}

/**
 * Every blueprint's task registry guarantees a `requirements` task exists
 * (see app/lib/projects/taskRegistry.ts) — no blueprint has a universal
 * "architecture" task id, so architecture artifacts anchor to the same
 * `requirements` task id the Requirements Draft artifact uses (both are
 * project-level deliverables, not task-specific ones).
 */
const ARTIFACT_TASK_ID = 'requirements';

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * Roadmap + Current Tasks + existing Artifacts + Notes into one structured
 * context object — same pattern as
 * businessAnalystEngine.buildRequirementsContext.
 */
function buildArchitectureContext(project: Project): ArchitectureContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const requirementsDraft = getApprovedArtifactContent<RequirementsDraft>(artifacts, ARTIFACT_TYPES.REQUIREMENTS_DRAFT);

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
    requirementsDraft,
    engineeringNotes: gatherEngineeringNotes(artifacts, 'Solution Architect'),
    aiDecisions: gatherAIDecisions(artifacts, 'Solution Architect'),
    roadmap,
    tasks,
    existingArtifacts,
    existingNotes,
  };
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/architecture.ts — no prompt strings live here. */
function buildArchitecturePrompt(context: ArchitectureContext): { system: string; prompt: string } {
  return {
    system: SOLUTION_ARCHITECT_SYSTEM_PROMPT,
    prompt: buildArchitectureUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into an `ArchitectureDraft` via the
 * shared generic parser (app/lib/projects/draftParsing.ts), validated
 * field-by-field against ARCHITECTURE_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedArchitectureDraft {
  return parseStructuredDraft<ArchitectureDraft>(rawText, ARCHITECTURE_DRAFT_FIELDS);
}

/**
 * Builds an Architecture Draft artifact holding the parsed draft as JSON.
 * Approving this artifact only ever changes its own `status` — it never
 * mutates Project Knowledge or any database/frontend/backend artifact.
 */
function createDraftArtifact(draft: ArchitectureDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Architecture Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

export const solutionArchitectEngine = {
  canGenerateArchitecture,
  buildArchitectureContext,
  buildArchitecturePrompt,
  parseDraft,
  createDraftArtifact,
};
