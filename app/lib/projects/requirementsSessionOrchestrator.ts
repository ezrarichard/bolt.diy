import { isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import {
  createRequirementsSession,
  getLatestRequirementsSession,
} from '~/lib/builders-db/repositories/requirementsSessionRepository';
import { appendRequirementsSessionMessage } from '~/lib/builders-db/repositories/requirementsSessionMessageRepository';
import {
  initializeBusinessUnderstandingModel,
  updateBusinessUnderstandingModel,
} from '~/lib/builders-db/repositories/businessUnderstandingRepository';
import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';

/**
 * Sprint 51 — Form Mode Integration.
 *
 * Wires the existing Requirements Form flow into the Sprint 50 durable foundation
 * (Requirements Sessions, Session Messages, Business Understanding Model) WITHOUT changing
 * the customer experience or the existing RequirementsDraft/Business Analyst/Approval/
 * Product Owner/Engineering pipeline in any way. Every function here is fire-and-forget and
 * best-effort, mirroring the exact convention `mirrorToBuildersDb()` already uses in
 * `stores/projects.ts`: a failure here is logged and swallowed, never surfaced to the UI or
 * allowed to block a save/close action.
 *
 * Deliberately excluded from this sprint (see the Sprint 51 brief): Fact Extraction, Business
 * Assessment, Discovery Strategy, Recommendation/Assumption/Completeness engines, Open
 * Questions, Interview/Document Mode. The Business Understanding Model bootstrap below is a
 * plain, lossless, zero-inference copy of the existing form fields — never an AI call, never
 * an invented categorization. Richer field-by-field categorization is Fact Extraction's job
 * (a later sprint), not this one's.
 */

function runFireAndForget(label: string, work: () => Promise<unknown>): void {
  if (!isBuildersDbAvailable()) {
    return;
  }

  work().catch((error) => console.error(`[RequirementsSessionOrchestrator] ${label} failed:`, error));
}

/**
 * Creates the project's Requirements Session at project-creation time (see `addProject()` in
 * stores/projects.ts, its only caller). Every new guided-engineering project gets exactly one
 * 'form'-mode session from the moment it exists — the Requirements Form later just appends to
 * whichever session `getLatestRequirementsSession` finds, rather than needing its own
 * lazy-creation branch.
 */
export function createRequirementsSessionForNewProject(projectId: string): void {
  runFireAndForget('createRequirementsSessionForNewProject', () => createRequirementsSession(projectId, 'form'));
}

/** Plain, lossless, zero-inference mapping from the existing 17-field form into the Business Understanding Model's sections. Only fields with an unambiguous destination are copied out individually; everything else is preserved verbatim in `businessIdentity.formSnapshot` so no data is lost even though full categorization isn't attempted here. */
function buildInitialUnderstandingPatch(knowledge: ProjectKnowledge): BusinessUnderstandingModelPatch {
  const businessIdentity: Record<string, unknown> = { formSnapshot: knowledge };

  if (knowledge.projectVision) {
    businessIdentity.vision = knowledge.projectVision;
  }

  if (knowledge.industry) {
    businessIdentity.industry = knowledge.industry;
  }

  if (knowledge.businessModel) {
    businessIdentity.businessModel = knowledge.businessModel;
  }

  if (knowledge.location) {
    businessIdentity.location = knowledge.location;
  }

  return {
    businessIdentity,
    targetUsers: knowledge.targetUsers ? [knowledge.targetUsers] : [],
    functionalRequirements: knowledge.coreFeatures ?? [],
    currentSystems: knowledge.integrations ?? [],
    businessConstraints: [
      ...(knowledge.complianceNeeds ?? []),
      ...(knowledge.paymentNeeds ?? []),
      ...(knowledge.shippingNeeds ?? []),
    ],
  };
}

/**
 * Called from `ProjectRequirementsDialog.tsx`'s `handleSave()`, alongside (not instead of) the
 * existing `updateProjectKnowledge()` call. Ensures a session exists (defensively creating one
 * for a legacy pre-Sprint-51 project that has none yet — see the Sprint 51 legacy-compatibility
 * requirement), appends the submitted form as one durable `form_submission` message, and
 * bootstraps/updates the Business Understanding Model from it. None of this feeds into or
 * changes the existing RequirementsDraft generation, which continues reading
 * `project.projectKnowledge` exactly as it does today.
 */
export function recordRequirementsFormSubmission(projectId: string, knowledge: ProjectKnowledge): void {
  runFireAndForget('recordRequirementsFormSubmission', async () => {
    const session =
      (await getLatestRequirementsSession(projectId)) ?? (await createRequirementsSession(projectId, 'form'));

    if (!session) {
      throw new Error(`no Requirements Session available for project ${projectId}`);
    }

    await appendRequirementsSessionMessage(session.id, projectId, {
      role: 'user',
      messageType: 'form_submission',
      content: JSON.stringify(knowledge),
    });

    await initializeBusinessUnderstandingModel(session.id, projectId);
    await updateBusinessUnderstandingModel(session.id, buildInitialUnderstandingPatch(knowledge));
  });
}

export const requirementsSessionOrchestrator = {
  createRequirementsSessionForNewProject,
  recordRequirementsFormSubmission,
};
