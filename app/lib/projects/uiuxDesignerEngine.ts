import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import type { ProjectKnowledge } from './knowledge';
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
import type { ArchitectureDraft } from './prompts/architecture';
import type { EngineeringHandoff, ProductOwnerDraft } from './prompts/productOwner';
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
 *
 * Sprint 32 — the UX Engineer's curated input is Business Analyst +
 * Architecture only (not Database): UX flows from product intent and
 * system boundaries, not schema detail, and the autonomous pipeline still
 * runs Database Engineer before UX Engineer (array order in
 * autoEngineeringEngine.ts), so this is a deliberate narrowing of *content*
 * relevance, not a change to execution order. See the "VERY IMPORTANT"
 * anti-duplication guidance this sprint added — every role reads only what
 * a real engineer in that role would actually need.
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

  /** Full content — UX Engineer's directly relevant upstream role per Sprint 32's curated dependency map (Database is deliberately excluded here). */
  architecture: ArchitectureDraft | undefined;

  /** Sprint 47 — the AI Product Owner's structured, MVP-scoped handoff — the boundary for which features this MVP's UI/UX actually needs to cover. Undefined for legacy projects. See docs/05-AI-Product-Owner/04-engineering-handoff.md. */
  engineeringHandoff: EngineeringHandoff | undefined;

  /** Sprint 32 — every upstream role's Engineering Notes gathered so far. See collaborationContext.ts. */
  engineeringNotes: EngineeringNoteEntry[];

  /** Sprint 32 — every upstream role's AI Decisions log gathered so far. */
  aiDecisions: AIDecisionEntry[];
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
 * UI/UX Design can only be generated once the Architecture Draft has been
 * approved — the UI/UX Design Panel gates on this and explains why the
 * button is disabled otherwise. Sprint 32 — narrowed from requiring Database
 * (UX's curated input is Business Analyst + Architecture only); the
 * autonomous pipeline still runs Database Engineer before UX Engineer via
 * array order in autoEngineeringEngine.ts regardless of this gate.
 */
function canGenerateUIUX(project: Project): boolean {
  return (
    getApprovedArtifactContent<ArchitectureDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.ARCHITECTURE_DRAFT) !==
    undefined
  );
}

/**
 * Gathers Project + Blueprint + approved Requirements/Project Knowledge +
 * approved Architecture Draft + Engineering Notes/AI Decisions so far +
 * Roadmap + Current Tasks + existing Artifacts + Notes into one structured
 * context object — same pattern as databaseDesignerEngine.buildDatabaseContext.
 */
function buildUIUXContext(project: Project): UIUXContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);
  const artifacts = getProjectArtifacts(project);
  const architecture = getApprovedArtifactContent<ArchitectureDraft>(artifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
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
    engineeringNotes: gatherEngineeringNotes(artifacts, 'UX Engineer'),
    aiDecisions: gatherAIDecisions(artifacts, 'UX Engineer'),
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
