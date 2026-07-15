import { ARTIFACT_TYPES, type ProjectArtifact } from './artifacts';
import type { ProjectKnowledge } from './knowledge';
import type { RequirementsDraft } from './prompts/requirements';

/**
 * Sprint 46.2 — bridges the two Requirements concepts (see the Sprint 46.2 diagnosis report):
 * manually-captured `ProjectKnowledge` (the actual, always-authoritative source of truth) and
 * the optional, AI-generated `requirements-draft` artifact that `projectManagerEngine.ts`
 * treats like every other engineering stage (an approved artifact means "done"). Saving the
 * manual Requirements & Knowledge dialog never created that artifact, so a project whose
 * Requirements were only ever captured manually looked "not generated" everywhere that reads
 * artifacts, even though the pipeline itself (`isRequirementsCaptured`) already considered it
 * complete.
 *
 * This is a leaf module — no dependency on `~/lib/stores/projects` — specifically so
 * `app/lib/stores/projects.ts` can import it without a circular import (businessAnalystEngine.ts,
 * the other natural home for this logic, already imports FROM stores/projects.ts).
 */

const ARTIFACT_TYPE = ARTIFACT_TYPES.REQUIREMENTS_DRAFT;
const ARTIFACT_TASK_ID = 'requirements';

/** Distinguishes a locally-synthesized artifact from a real AI Business Analyst draft (see isSyncedRequirementsArtifact). */
const SYNCED_GENERATED_BY = 'Project Knowledge';

/** Deterministic — the SAME id every time for a given project, so re-deriving this artifact (on every knowledge save, and once during hydration self-heal) always targets the same (artifact_id, version) row rather than minting a new one. */
export function syncedRequirementsArtifactId(projectId: string): string {
  return `requirements-synced-${projectId}`;
}

/** Whether `artifact` is the locally-synthesized marker (as opposed to a real AI-generated Requirements Draft, which has its own independently-minted id and must never be overwritten by the sync). */
export function isSyncedRequirementsArtifact(artifact: Pick<ProjectArtifact, 'id'>, projectId: string): boolean {
  return artifact.id === syncedRequirementsArtifactId(projectId);
}

/**
 * The inverse of businessAnalystEngine.ts's `summarizeRequirements` — maps captured
 * `ProjectKnowledge` fields back into a `RequirementsDraft` shape, entirely locally (no LLM,
 * no network call). Fields with no direct `RequirementsDraft` counterpart (industry, location,
 * brand tone, design preferences, free-form notes) are folded into `engineeringNotes` rather
 * than dropped, so context-building code that reads an approved Requirements Draft (e.g.
 * solutionArchitectEngine.buildArchitectureContext) still sees them.
 */
export function deriveRequirementsDraftFromKnowledge(knowledge: ProjectKnowledge): RequirementsDraft {
  const notesParts: string[] = [];

  if (knowledge.industry) {
    notesParts.push(`Industry: ${knowledge.industry}`);
  }

  if (knowledge.location) {
    notesParts.push(`Location/region: ${knowledge.location}`);
  }

  if (knowledge.brandTone) {
    notesParts.push(`Brand tone: ${knowledge.brandTone}`);
  }

  if (knowledge.designPreferences) {
    notesParts.push(`Design preferences: ${knowledge.designPreferences}`);
  }

  if (knowledge.notes) {
    notesParts.push(knowledge.notes);
  }

  return {
    businessVision: knowledge.projectVision,
    targetAudience: knowledge.targetUsers,
    businessModel: knowledge.businessModel,
    coreFeatures: knowledge.coreFeatures,
    pages: knowledge.pagesOrScreens,
    userRoles: knowledge.userRoles,
    compliance: knowledge.complianceNeeds,
    payments: knowledge.paymentNeeds,
    shipping: knowledge.shippingNeeds,
    languages: knowledge.languages,
    technologyRecommendations: knowledge.technicalPreferences ? [knowledge.technicalPreferences] : undefined,
    engineeringNotes: notesParts.length > 0 ? notesParts.join('\n') : undefined,
  };
}

/**
 * Builds the locally-synthesized Requirements artifact for a project's currently-captured
 * knowledge. Always version 1, always `approved` — this mirrors current knowledge rather than
 * recording AI generation history, so it is never meant to accumulate versions the way a real
 * draft does.
 */
export function createSyncedRequirementsArtifact(projectId: string, knowledge: ProjectKnowledge): ProjectArtifact {
  const draft = deriveRequirementsDraftFromKnowledge(knowledge);
  const now = new Date().toISOString();

  return {
    id: syncedRequirementsArtifactId(projectId),
    taskId: ARTIFACT_TASK_ID,
    title: 'Requirements Draft (from Project Knowledge)',
    type: ARTIFACT_TYPE,
    createdAt: now,
    updatedAt: now,
    status: 'approved',
    content: JSON.stringify(draft, null, 2),
    generatedBy: SYNCED_GENERATED_BY,
    version: 1,
  };
}
