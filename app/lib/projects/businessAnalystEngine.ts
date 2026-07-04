import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import type { ProjectKnowledge } from './knowledge';
import { ARTIFACT_TYPES, createArtifact, type ProjectArtifact } from './artifacts';
import { getProjectKnowledge, getRoadmapItemStatus, getTaskNotes, type Project } from '~/lib/stores/projects';
import { parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import {
  BUSINESS_ANALYST_SYSTEM_PROMPT,
  buildRequirementsUserPrompt,
  REQUIREMENTS_DRAFT_FIELDS,
  type RequirementsDraft,
} from './prompts/requirements';

/**
 * Business Analyst Engine — Sprint 13 (first AI capability, reference
 * implementation for every future AI role).
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap -> Tasks
 *     -> Execution -> Review -> Approval -> Artifacts
 *       -> Business Analyst Engine (this file) -> AI Generation
 *
 * This file is pure orchestration: it gathers context, builds a prompt,
 * and parses/converts the AI's structured response. It does NOT call an
 * LLM and does NOT know which provider/model is in use — see
 * app/lib/hooks/useGenerateText.ts (client-side plumbing) and
 * app/routes/api.generate-text.ts (the generic, provider-agnostic server
 * bridge into app/lib/modules/llm/). That separation is the whole point:
 * swapping Claude for GPT or Gemini never touches this file, and every
 * future AI role (Solution Architect, Database Designer, UI Designer,
 * Backend Engineer) can reuse the exact same route + hook, only supplying
 * their own prompts/*.ts + engine file following this pattern.
 *
 * No React. No UI. No prompt strings inlined here — those live in
 * app/lib/projects/prompts/requirements.ts.
 */

export interface RequirementsContext {
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
  missingInformation: string[];
  roadmap: { title: string; description: string; status: string }[];
  tasks: { title: string; category: string; status: string }[];
  existingNotes: string;
}

export type ParsedDraft = ParsedDraftResult<RequirementsDraft>;

const GENERATOR_NAME = 'AI Business Analyst';
const ARTIFACT_TYPE = ARTIFACT_TYPES.REQUIREMENTS_DRAFT;
const ARTIFACT_TASK_ID = 'requirements';

/**
 * Gathers Blueprint + Project Knowledge + Requirements completion + Roadmap
 * + Current Tasks + existing Notes + a live summary into one structured
 * context object. Every future AI call should build its context through a
 * function like this rather than re-assembling pieces inline.
 */
function buildRequirementsContext(project: Project): RequirementsContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();
  const knowledge = getProjectKnowledge(project);

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
    missingInformation: getMissingBusinessInformation(project),
    roadmap,
    tasks,
    existingNotes,
  };
}

/** Recommended-but-still-empty Project Knowledge fields — told to the AI so it knows what to focus on, and usable as a UI hint. */
function getMissingBusinessInformation(project: Project): string[] {
  return projectKnowledgeEngine
    .getMissingFields(getProjectKnowledge(project), project.blueprintId)
    .map((field) => field.label);
}

/** Builds the system+user prompt pair from an already-gathered context. Delegates all prompt text to prompts/requirements.ts — no prompt strings live here. */
function buildBusinessPrompt(context: RequirementsContext): { system: string; prompt: string } {
  return {
    system: BUSINESS_ANALYST_SYSTEM_PROMPT,
    prompt: buildRequirementsUserPrompt(context),
  };
}

/**
 * Parses the AI's raw text response into a `RequirementsDraft` via the
 * shared generic parser (app/lib/projects/draftParsing.ts), validated
 * field-by-field against REQUIREMENTS_DRAFT_FIELDS.
 */
function parseDraft(rawText: string): ParsedDraft {
  return parseStructuredDraft<RequirementsDraft>(rawText, REQUIREMENTS_DRAFT_FIELDS);
}

/** Builds a Requirements Draft artifact holding the parsed draft as JSON. Never overwrites Project Knowledge — that only happens on explicit approval. */
function createDraftArtifact(draft: RequirementsDraft, version: number): ProjectArtifact {
  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Requirements Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(draft, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

/**
 * Converts an approved draft into the partial `ProjectKnowledge` update to
 * apply. Only fields the draft actually populated are included (so
 * approving never silently blanks out unrelated fields the user already
 * filled in, like Brand Tone or Region). Fields with no direct
 * ProjectKnowledge counterpart (Business Rules, Risks, Future
 * Enhancements, Success Metrics, Open Questions) are folded into `notes`,
 * appended after whatever notes already exist rather than replacing them.
 */
function summarizeRequirements(
  draft: RequirementsDraft,
  existingKnowledge?: ProjectKnowledge,
): Partial<ProjectKnowledge> {
  const partial: Partial<ProjectKnowledge> = {};

  if (draft.businessVision) {
    partial.projectVision = draft.businessVision;
  }

  if (draft.targetAudience) {
    partial.targetUsers = draft.targetAudience;
  }

  if (draft.businessModel) {
    partial.businessModel = draft.businessModel;
  }

  if (draft.coreFeatures?.length) {
    partial.coreFeatures = draft.coreFeatures;
  }

  if (draft.pages?.length) {
    partial.pagesOrScreens = draft.pages;
  }

  if (draft.userRoles?.length) {
    partial.userRoles = draft.userRoles;
  }

  if (draft.compliance?.length) {
    partial.complianceNeeds = draft.compliance;
  }

  if (draft.payments?.length) {
    partial.paymentNeeds = draft.payments;
  }

  if (draft.shipping?.length) {
    partial.shippingNeeds = draft.shipping;
  }

  if (draft.languages?.length) {
    partial.languages = draft.languages;
  }

  if (draft.technologyRecommendations?.length) {
    partial.technicalPreferences = draft.technologyRecommendations.join(', ');
  }

  const extraNotesSections: string[] = [];
  const addNoteSection = (label: string, items: string[] | undefined) => {
    if (items?.length) {
      extraNotesSections.push(`${label}:\n${items.map((item) => `- ${item}`).join('\n')}`);
    }
  };

  addNoteSection('Business Rules', draft.businessRules);
  addNoteSection('Risks', draft.risks);
  addNoteSection('Future Enhancements', draft.futureEnhancements);
  addNoteSection('Success Metrics', draft.successMetrics);
  addNoteSection('Open Questions', draft.openQuestions);

  if (extraNotesSections.length > 0) {
    const aiNotes = `From ${GENERATOR_NAME}:\n\n${extraNotesSections.join('\n\n')}`;
    partial.notes = existingKnowledge?.notes ? `${existingKnowledge.notes}\n\n---\n\n${aiNotes}` : aiNotes;
  }

  return partial;
}

export const businessAnalystEngine = {
  buildRequirementsContext,
  buildBusinessPrompt,
  parseDraft,
  createDraftArtifact,
  summarizeRequirements,
  getMissingBusinessInformation,
};
