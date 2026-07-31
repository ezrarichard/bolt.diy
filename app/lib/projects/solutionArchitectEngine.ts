import { blueprintEngine } from '~/lib/blueprints';
import { executionEngine } from './executionEngine';
import { projectKnowledgeEngine } from './projectKnowledgeEngine';
import { isRequirementsCaptured, type ProjectKnowledge } from './knowledge';
import {
  ARTIFACT_TYPES,
  createArtifact,
  getApprovedArtifactContent,
  getLatestApprovedArtifact,
  type ProjectArtifact,
} from './artifacts';
import { hasLegacyEngineeringProgress } from './productOwnerEngine';
import type { EngineeringHandoff, ProductOwnerDraft } from './prompts/productOwner';
import { extractJsonPayload, parseStructuredDraft, type ParsedDraftResult } from './draftParsing';
import {
  EMPTY_TAS,
  parseTechnicalArchitectureSpec,
  type TechnicalArchitectureSpecification,
} from '~/lib/technical-architecture/tasTypes';
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

  /**
   * Sprint 46B — the AI Product Owner's structured, MVP-scoped handoff (scope, constraints,
   * architecture goals, success/acceptance criteria, feature priorities, out-of-scope
   * features, dependencies) — NOT the Product Owner's full narrative artifact (Product
   * Vision, roadmap, etc.), which Architecture doesn't need. Undefined for legacy projects
   * that progressed before the Product Owner role existed (see
   * productOwnerEngine.hasLegacyEngineeringProgress). See
   * docs/05-AI-Product-Owner/04-engineering-handoff.md.
   */
  engineeringHandoff: EngineeringHandoff | undefined;

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
 * Requirements/Project Knowledge is the substantive precondition for generating an
 * architecture draft — same check the Project Dashboard already uses to show "Requirements
 * captured"/"Requirements missing" (Sprint 9).
 *
 * Sprint 46B — Engineering must never begin before Gate A (Roadmap/Scope Approval): also
 * requires an approved Product Owner draft, UNLESS this is a legacy project that already has
 * engineering progress from before the Product Owner role existed
 * (productOwnerEngine.hasLegacyEngineeringProgress) — that backward-compatibility rule
 * mirrors autoEngineeringEngine.ts's identical `isProjectDefinitionApproved` pattern, so an
 * existing project already past this point is never retroactively blocked.
 */
function canGenerateArchitecture(project: Project): boolean {
  if (!isRequirementsCaptured(getProjectKnowledge(project))) {
    return false;
  }

  if (hasLegacyEngineeringProgress(project)) {
    return true;
  }

  const artifacts = getProjectArtifacts(project);

  return getLatestApprovedArtifact(artifacts, ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT) !== undefined;
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
  const productOwnerDraft = getApprovedArtifactContent<ProductOwnerDraft>(
    artifacts,
    ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
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
    engineeringHandoff: productOwnerDraft?.currentMvp?.engineeringHandoff,
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
 * field-by-field against ARCHITECTURE_DRAFT_FIELDS, PLUS (Sprint 100B) the
 * separate `technicalArchitecture` block from the SAME JSON response,
 * validated via `parseTechnicalArchitectureSpec` (which never throws/fails —
 * malformed or missing input just degrades to `EMPTY_TAS`, so a pre-100B-shape
 * response never breaks the narrative draft's approval flow).
 *
 * Deliberately identical in shape to databaseDesignerEngine.parseDraft's
 * Sprint 75 handling of `structuredSchema`: one LLM call, one JSON payload,
 * two independently-parsed outputs. The AI is never asked twice.
 */
function parseDraft(rawText: string): ParsedArchitectureDraft {
  const result = parseStructuredDraft<ArchitectureDraft>(rawText, ARCHITECTURE_DRAFT_FIELDS);

  if (!result.ok) {
    return result;
  }

  let rawTas: unknown;

  try {
    rawTas = (JSON.parse(extractJsonPayload(rawText)) as Record<string, unknown>).technicalArchitecture;
  } catch {
    rawTas = undefined;
  }

  return { ok: true, draft: { ...result.draft, technicalArchitecture: parseTechnicalArchitectureSpec(rawTas) } };
}

/**
 * Builds an Architecture Draft artifact holding the parsed NARRATIVE draft as
 * JSON — `technicalArchitecture` is deliberately stripped here (it is persisted
 * separately via `createTechnicalArchitectureArtifact` below) so this artifact's
 * shape never changes size/content because of Sprint 100B's addition. That
 * stripping is what makes the change invisible to every existing reader of this
 * artifact. Approving it only ever changes its own `status` — it never mutates
 * Project Knowledge or any database/frontend/backend artifact.
 */
function createDraftArtifact(draft: ArchitectureDraft, version: number): ProjectArtifact {
  const { technicalArchitecture: _technicalArchitecture, ...narrative } = draft;

  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Architecture Draft v${version}`,
    type: ARTIFACT_TYPE,
    content: JSON.stringify(narrative, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

/**
 * Sprint 100B — builds the paired, machine-readable
 * TECHNICAL_ARCHITECTURE_SPEC artifact from the same parsed draft's
 * `technicalArchitecture` field. Passed to useDraftPanel.ts as
 * `createPairedArtifact` so it is created/approved/discarded in lockstep with
 * `createDraftArtifact` above, always at the exact same version — never a
 * separate action, and never reachable through an entry point that could move
 * one without the other.
 */
function createTechnicalArchitectureArtifact(draft: ArchitectureDraft, version: number): ProjectArtifact {
  const tas: TechnicalArchitectureSpecification = draft.technicalArchitecture ?? EMPTY_TAS;

  return createArtifact({
    taskId: ARTIFACT_TASK_ID,
    title: `Technical Architecture Specification v${version}`,
    type: ARTIFACT_TYPES.TECHNICAL_ARCHITECTURE_SPEC,
    content: JSON.stringify(tas, null, 2),
    status: 'draft',
    generatedBy: GENERATOR_NAME,
    version,
  });
}

/**
 * Reads the latest approved TECHNICAL_ARCHITECTURE_SPEC artifact, or `undefined`
 * for any project that has none — which is every project created before Sprint
 * 100B, and is a permanently valid state rather than an error.
 *
 * NO CALLER IN SPRINT 100B. Provided so Sprint 100C's consumers have one
 * retrieval path rather than each re-deriving artifact lookup, exactly as
 * `databaseDesignerEngine.getApprovedStructuredSchema` does for the schema pair.
 * Returns the parsed spec (not raw content) so a stored artifact written by an
 * older shape still reads as a valid, if empty, spec.
 */
function getApprovedTechnicalArchitecture(project: Project): TechnicalArchitectureSpecification | undefined {
  const raw = getApprovedArtifactContent<unknown>(
    getProjectArtifacts(project),
    ARTIFACT_TYPES.TECHNICAL_ARCHITECTURE_SPEC,
  );

  return raw === undefined ? undefined : parseTechnicalArchitectureSpec(raw);
}

export const solutionArchitectEngine = {
  canGenerateArchitecture,
  buildArchitectureContext,
  buildArchitecturePrompt,
  parseDraft,
  createDraftArtifact,
  createTechnicalArchitectureArtifact,
  getApprovedTechnicalArchitecture,
};
