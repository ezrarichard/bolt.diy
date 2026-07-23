import { isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import {
  createRequirementsSession,
  getLatestRequirementsSession,
  updateRequirementsSession,
} from '~/lib/builders-db/repositories/requirementsSessionRepository';
import { appendRequirementsSessionMessage } from '~/lib/builders-db/repositories/requirementsSessionMessageRepository';
import {
  initializeBusinessUnderstandingModel,
  updateBusinessUnderstandingModel,
} from '~/lib/builders-db/repositories/businessUnderstandingRepository';
import { runBusinessAssessment } from '~/lib/projects/businessAssessmentEngine';
import { runDiscoveryDecision } from '~/lib/projects/discoveryDecisionEngine';
import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { TraceabilityReference } from '~/lib/projects/requirementsSession';

/**
 * Sprint 51 — Form Mode Integration. Sprint 52 — Requirements Traceability & Provenance.
 * Sprint 53 — Business Assessment Engine.
 *
 * Wires the existing Requirements Form flow into the Sprint 50 durable foundation
 * (Requirements Sessions, Session Messages, Business Understanding Model) WITHOUT changing
 * the customer experience or the existing RequirementsDraft/Business Analyst/Approval/
 * Product Owner/Engineering pipeline in any way. Every function here is fire-and-forget and
 * best-effort, mirroring the exact convention `mirrorToBuildersDb()` already uses in
 * `stores/projects.ts`: a failure here is logged and swallowed, never surfaced to the UI or
 * allowed to block a save/close action.
 *
 * Deliberately excluded from these sprints (see the Sprint 51/52/53 briefs): Fact Extraction,
 * Interview Mode, Discovery Strategy, Recommendation/Assumption/Completeness engines, Open
 * Questions, Document Mode. The Business Understanding Model bootstrap below is a plain,
 * lossless, zero-inference copy of the existing form fields — never an AI call, never an
 * invented categorization. Richer field-by-field categorization is Fact Extraction's job (a
 * later sprint), not this one's.
 *
 * Sprint 52 adds provenance for the ONE hop this module owns (Session Message → Business
 * Understanding Model section) by populating the model's existing `traceability` field — a
 * lightweight reference (message id + section name), never a copy of the message content
 * itself, which already lives durably in `builders_requirements_session_messages`. The other
 * hop this sprint covers (Business Understanding → RequirementsDraft) is recorded separately,
 * by extending the existing Sprint 36 context-trace mechanism — see
 * app/lib/ai/context/buildersDbContextProvider.ts.
 *
 * Sprint 53 runs the deterministic Business Assessment Engine (`businessAssessmentEngine.ts`)
 * automatically, immediately after the same form-save that already updates the Business
 * Understanding Model — no separate user action, no AI call. Its evidence is appended to the
 * exact same `traceability` array Sprint 52 introduced, and its overall confidence is stored on
 * `RequirementsSession.assessmentConfidence`, a field Sprint 50 already reserved for this.
 *
 * Sprint 54 runs the deterministic Discovery Decision Engine (`discoveryDecisionEngine.ts`)
 * immediately after the Business Assessment Engine, in the same update — deciding whether
 * enough business knowledge exists to continue (READY / NEEDS_MORE_INFORMATION /
 * INSUFFICIENT_INFORMATION), never asking a question or generating a recommendation itself. Its
 * result is persisted on `BusinessUnderstandingModel.decision`, and its evidence is appended to
 * the same `traceability` array Sprints 52/53 already write to. It does not change how or when
 * RequirementsDraft generation runs — that pipeline still reads `project.projectKnowledge`
 * exactly as it does today.
 */

function runFireAndForget(label: string, work: () => Promise<unknown>): void {
  if (!isBuildersDbAvailable()) {
    return;
  }

  work().catch((error) => console.error(`[RequirementsSessionOrchestrator] ${label} failed:`, error));
}

/**
 * Sprint 54.1 — same best-effort contract as `runFireAndForget` (BuildersDB unavailable is a
 * silent no-op, a mid-write failure is logged and swallowed, never thrown to the caller), but
 * returns the settled promise instead of discarding it. Existing callers that don't await it
 * keep today's fire-and-forget behavior unchanged; `ProjectRequirementsDialog.tsx` awaits it
 * purely to know when it's safe to re-fetch the Discovery Intelligence it just wrote — never to
 * block the dialog's own close/toast, which still happen synchronously beforehand.
 */
function runAwaitable(label: string, work: () => Promise<unknown>): Promise<void> {
  if (!isBuildersDbAvailable()) {
    return Promise.resolve();
  }

  return work()
    .then(() => undefined)
    .catch((error) => console.error(`[RequirementsSessionOrchestrator] ${label} failed:`, error));
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

/** Whether a Business Understanding Model section (as produced by `buildInitialUnderstandingPatch`) actually has content worth tracing — an empty list/object shouldn't generate a provenance entry pointing at nothing. */
function isSectionPopulated(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return Boolean(value);
}

/**
 * Sprint 52 — one traceability entry per non-empty section the form submission populated,
 * each pointing at the same source message (the whole form was one message; the Business
 * Understanding Model's sections are the transformation's targets). Appended to whatever
 * traceability already existed for this session — never replaces prior entries, since a
 * project may save the Requirements form more than once over its lifetime.
 */
function buildTraceabilityForFormSubmission(
  messageId: string,
  patch: BusinessUnderstandingModelPatch,
  existingTraceability: TraceabilityReference[],
): TraceabilityReference[] {
  const recordedAt = new Date().toISOString();

  const newEntries: TraceabilityReference[] = (Object.keys(patch) as (keyof BusinessUnderstandingModelPatch)[])
    .filter((sectionKey) => isSectionPopulated(patch[sectionKey]))
    .map((sectionKey) => ({
      source: { type: 'session_message', id: messageId },
      target: { type: 'business_understanding_section', id: sectionKey },
      transformation: 'form_field_mapping',
      recordedAt,
    }));

  return [...existingTraceability, ...newEntries];
}

/**
 * Called from `ProjectRequirementsDialog.tsx`'s `handleSave()`, alongside (not instead of) the
 * existing `updateProjectKnowledge()` call. Ensures a session exists (defensively creating one
 * for a legacy pre-Sprint-51 project that has none yet — see the Sprint 51 legacy-compatibility
 * requirement), appends the submitted form as one durable `form_submission` message, updates
 * the Business Understanding Model from it (recording, per Sprint 52, which message produced
 * which section), then (Sprint 53) runs the deterministic Business Assessment Engine against
 * that same update and persists its result + evidence in the same write. None of this feeds
 * into or changes the existing RequirementsDraft generation, which continues reading
 * `project.projectKnowledge` exactly as it does today.
 *
 * Sprint 54.1 — returns a `Promise<void>` (never rejects — see `runAwaitable`) rather than
 * `void`, so `ProjectRequirementsDialog.tsx` can await BuildersDB's write finishing before
 * signaling `ProjectDashboard` to re-fetch Discovery Intelligence. This is purely an additive
 * return-type change: every existing caller that ignores the return value keeps its identical
 * fire-and-forget behavior.
 */
export function recordRequirementsFormSubmission(projectId: string, knowledge: ProjectKnowledge): Promise<void> {
  return runAwaitable('recordRequirementsFormSubmission', async () => {
    const session =
      (await getLatestRequirementsSession(projectId)) ?? (await createRequirementsSession(projectId, 'form'));

    if (!session) {
      throw new Error(`no Requirements Session available for project ${projectId}`);
    }

    const message = await appendRequirementsSessionMessage(session.id, projectId, {
      role: 'user',
      messageType: 'form_submission',
      content: JSON.stringify(knowledge),
    });

    if (!message) {
      throw new Error(`failed to append Requirements Session message for session ${session.id}`);
    }

    const model = await initializeBusinessUnderstandingModel(session.id, projectId);
    const patch = buildInitialUnderstandingPatch(knowledge);
    const traceability = buildTraceabilityForFormSubmission(message.id, patch, model?.traceability ?? []);

    const assessmentResult = runBusinessAssessment(patch);
    const { assessment, evidence, overallConfidence } = assessmentResult;

    const { decision, evidence: decisionEvidence } = runDiscoveryDecision(patch, assessmentResult);

    await updateBusinessUnderstandingModel(session.id, {
      ...patch,
      assessment,
      decision,
      traceability: [...traceability, ...evidence, ...decisionEvidence],
    });

    await updateRequirementsSession(session.id, { assessmentConfidence: overallConfidence });
  });
}

export const requirementsSessionOrchestrator = {
  createRequirementsSessionForNewProject,
  recordRequirementsFormSubmission,
};
