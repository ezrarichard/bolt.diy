import { isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import {
  createRequirementsSession,
  getLatestRequirementsSession,
  getRequirementsSession,
  updateRequirementsSession,
  updateRequirementsSessionStatus,
} from '~/lib/builders-db/repositories/requirementsSessionRepository';
import {
  appendRequirementsSessionMessage,
  listRequirementsSessionMessages,
} from '~/lib/builders-db/repositories/requirementsSessionMessageRepository';
import {
  getBusinessUnderstandingModel,
  initializeBusinessUnderstandingModel,
  updateBusinessUnderstandingModel,
} from '~/lib/builders-db/repositories/businessUnderstandingRepository';
import { runBusinessAssessment } from '~/lib/projects/businessAssessmentEngine';
import { runDiscoveryDecision } from '~/lib/projects/discoveryDecisionEngine';
import {
  buildInterviewGreeting,
  INTERVIEW_QUESTION_TEMPLATES,
  INTERVIEW_READY_MESSAGE,
  selectNextDimension,
} from '~/lib/projects/discoveryAgent';
import { buildInterviewDiscoveryContext, runDiscoveryAiEngine } from '~/lib/projects/discoveryAiEngine';
import type { GenerateTextFn } from '~/lib/projects/discoveryAiEngine';
import type { BusinessUnderstandingModelPatch } from '~/lib/builders-db/requirementsSessionDbTypes';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type {
  BusinessUnderstandingModel,
  DiscoveryDimension,
  RequirementsSession,
  RequirementsSessionMessage,
  TraceabilityReference,
} from '~/lib/projects/requirementsSession';

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

/**
 * Sprint 56 — Interview Mode Foundation.
 *
 * `startOrResumeInterview` and `recordInterviewAnswer` are Interview Mode's equivalent of
 * `recordRequirementsFormSubmission` above — same shape, same reuse of the Sprint 50-54 durable
 * foundation and the unchanged Sprint 53/54 engines, generalized (per the Sprint 55 architecture
 * doc §0's core design thesis) to a conversational, one-turn-at-a-time producer of the same
 * `BusinessUnderstandingModelPatch` contract instead of one bulk form submission. Unlike
 * `recordRequirementsFormSubmission`, these two functions return their result rather than
 * firing-and-forgetting it — a live conversational turn loop genuinely needs to know what
 * happened (the next question, or READY) to render the next thing, not just "safe to re-fetch".
 * Both still never throw; a failure or an unavailable BuildersDB resolves to `null`, which the
 * UI layer (`useInterviewSession`) treats as its own `'unavailable'`/`'error'` state, exactly the
 * two-layer convention `useDiscoveryIntelligence` already established.
 *
 * No AI call exists anywhere in this pair of functions — question phrasing and fact extraction
 * are both deterministic templates/mappings (`discoveryAgent.ts`), per Sprint 56's explicit
 * "No AI Logic Yet" scope. `runBusinessAssessment`/`runDiscoveryDecision` ARE real, already-
 * shipped deterministic engines (not AI), reused unchanged exactly as the architecture doc
 * requires — this is what makes the Business Discovery panel show genuinely live, correct
 * progress even though the "interview" behind it is fully scripted for now.
 */

export interface InterviewTurnResult {
  session: RequirementsSession;
  messages: RequirementsSessionMessage[];
  model: BusinessUnderstandingModel;

  /** The dimension the still-unanswered last assistant question targets, or `null` if the interview has reached READY (or has no more questions to ask). */
  pendingDimension: DiscoveryDimension | null;
}

/** Every dimension a question has already been asked about this session — read from message metadata (`RequirementsSessionMessage.metadata.dimension`), never a separately-tracked list, so it can never drift from the durable transcript. */
function extractAskedDimensions(messages: RequirementsSessionMessage[]): DiscoveryDimension[] {
  const dimensions: DiscoveryDimension[] = [];

  for (const message of messages) {
    const dimension = message.role === 'assistant' ? message.metadata?.dimension : undefined;

    if (typeof dimension === 'string') {
      dimensions.push(dimension as DiscoveryDimension);
    }
  }

  return dimensions;
}

/** The dimension of the last message, if it's an assistant question still awaiting an answer — `null` for a completion message, a user message, or an empty transcript. */
function derivePendingDimension(messages: RequirementsSessionMessage[]): DiscoveryDimension | null {
  const last = messages[messages.length - 1];
  const dimension = last?.role === 'assistant' ? last.metadata?.dimension : undefined;

  return typeof dimension === 'string' ? (dimension as DiscoveryDimension) : null;
}

/** Appends the next assistant turn — either the templated question for `nextDimension`, or the READY completion message when there's nothing left to ask. */
function appendNextAssistantTurn(
  sessionId: string,
  projectId: string,
  nextDimension: DiscoveryDimension | null,
): Promise<RequirementsSessionMessage | null> {
  return appendRequirementsSessionMessage(sessionId, projectId, {
    role: 'assistant',
    messageType: 'text',
    content: nextDimension ? INTERVIEW_QUESTION_TEMPLATES[nextDimension] : INTERVIEW_READY_MESSAGE,
    metadata: nextDimension ? { dimension: nextDimension } : { kind: 'completion' },
  });
}

/** Whether the transcript already ends in an interview turn the UI can show as-is (a pending question, or a completion message) — vs. one that needs `startOrResumeInterview` to post the next interview turn itself. */
function endsInInterviewTurn(messages: RequirementsSessionMessage[]): boolean {
  if (derivePendingDimension(messages) !== null) {
    return true;
  }

  const last = messages[messages.length - 1];

  return last?.role === 'assistant' && last.metadata?.kind === 'completion';
}

/**
 * Loads (or lazily creates) the project's Interview Mode session and posts the next interview
 * turn (greeting + first question for a brand-new session; just the next question for a session
 * that reuses a Form-only session's history — architecture doc §0: "Interview Mode never starts
 * from zero if the Form was used first") whenever the transcript doesn't already end in one
 * (`endsInInterviewTurn`). A session that already has a pending question or a completion message
 * at its tail is returned exactly as-is — no new messages are appended just because the dialog
 * was reopened (architecture doc §8: resume is "cheap by construction" because durable state,
 * not the transcript, is authoritative; the UI layer decides whether to show a "welcome back" cue
 * around this same data, see `useInterviewSession`).
 *
 * Reuses `getLatestRequirementsSession` — the exact same lookup `recordRequirementsFormSubmission`
 * already uses — so Interview Mode never starts from zero if the Form was used first (both write
 * the same session's `BusinessUnderstandingModel`, per architecture doc §0/§13).
 */
export async function startOrResumeInterview(
  projectId: string,
  projectName: string | undefined,
): Promise<InterviewTurnResult | null> {
  if (!isBuildersDbAvailable()) {
    return null;
  }

  try {
    const session =
      (await getLatestRequirementsSession(projectId)) ?? (await createRequirementsSession(projectId, 'interview'));

    if (!session) {
      return null;
    }

    const model = await initializeBusinessUnderstandingModel(session.id, projectId);

    if (!model) {
      return null;
    }

    if (session.status === 'created') {
      await updateRequirementsSessionStatus(session.id, 'active');
    }

    let messages = await listRequirementsSessionMessages(session.id);

    if (!endsInInterviewTurn(messages)) {
      if (messages.length === 0) {
        await appendRequirementsSessionMessage(session.id, projectId, {
          role: 'assistant',
          messageType: 'text',
          content: buildInterviewGreeting(projectName),
          metadata: { kind: 'greeting' },
        });
      }

      const nextDimension = selectNextDimension(model.decision ?? {}, extractAskedDimensions(messages));
      await appendNextAssistantTurn(session.id, projectId, nextDimension);

      messages = await listRequirementsSessionMessages(session.id);
    }

    const refreshedSession = (await getRequirementsSession(session.id)) ?? session;

    return { session: refreshedSession, messages, model, pendingDimension: derivePendingDimension(messages) };
  } catch (error) {
    console.error('[RequirementsSessionOrchestrator] startOrResumeInterview failed:', error);
    return null;
  }
}

/**
 * Records one interview turn: the user's answer to `dimension`'s question, real LLM-backed Fact
 * Extraction via the Discovery AI Engine (Sprint 57 — `runDiscoveryAiEngine`, replacing Sprint
 * 56's deterministic `buildInterviewPatch` mock) into a full merged patch, the same Business
 * Assessment/Discovery Decision recompute the Form triggers, then either the next question or the
 * READY completion message — architecture doc §6's per-turn update sequence, generalized from the
 * Form's one-shot version.
 *
 * Per Sprint 57 Part 10 ("Interview should become just another producer. It should contain NO
 * business extraction logic"), this function does not itself parse, validate, normalize, score,
 * or reconcile facts — it only builds a `DiscoveryContext` (`buildInterviewDiscoveryContext`) and
 * hands it to the engine; the engine's `patch`/`evidence` are used verbatim. The LLM call itself
 * is injected as `deps.generateText` (Part 3's "the LLM should only return structured candidate
 * facts, never update BuildersDB directly" — `generateText` only ever returns text to the engine;
 * this function is the only place in the whole call chain that persists anything).
 */
export async function recordInterviewAnswer(
  projectId: string,
  sessionId: string,
  dimension: DiscoveryDimension,
  answerText: string,
  deps: { generateText: GenerateTextFn },
): Promise<InterviewTurnResult | null> {
  if (!isBuildersDbAvailable()) {
    return null;
  }

  try {
    const userMessage = await appendRequirementsSessionMessage(sessionId, projectId, {
      role: 'user',
      messageType: 'text',
      content: answerText,
      metadata: { dimension },
    });

    if (!userMessage) {
      return null;
    }

    const model = await getBusinessUnderstandingModel(sessionId);

    if (!model) {
      return null;
    }

    const discoveryContext = buildInterviewDiscoveryContext({
      projectId,
      sessionId,
      model,
      dimension,
      answerMessageId: userMessage.id,
      answerText,
    });

    const { patch, evidence: factEvidence, extractionError } = await runDiscoveryAiEngine(discoveryContext, deps);

    /*
     * Sprint 57.1, Task 8 — a genuine extraction failure (network/auth/provider error, or an
     * unparseable response — see discoveryAiEngine/factExtractor.ts's `ExtractionOutcome`) must
     * not silently advance the conversation as though the answer were understood. No patch,
     * assessment, or decision write happens (nothing was actually learned this turn — Task 7's
     * "no partial factual patch when extraction fails"); the user's answer stays durably
     * persisted (already appended above), and a distinct, retryable assistant message is posted
     * instead of the next question. `pendingDimension` is returned as the SAME dimension just
     * answered, so the UI keeps prompting for it — retrying is just answering again.
     */
    if (extractionError) {
      await appendRequirementsSessionMessage(sessionId, projectId, {
        role: 'assistant',
        messageType: 'text',
        content: "I couldn't process that — mind trying again?",
        metadata: { kind: 'extraction_error', dimension },
      });

      const [session, messages] = await Promise.all([
        getRequirementsSession(sessionId),
        listRequirementsSessionMessages(sessionId),
      ]);

      if (!session) {
        return null;
      }

      return { session, messages, model, pendingDimension: dimension };
    }

    const assessmentResult = runBusinessAssessment(patch);
    const { assessment, evidence, overallConfidence } = assessmentResult;
    const { decision, evidence: decisionEvidence } = runDiscoveryDecision(patch, assessmentResult);

    const traceability: TraceabilityReference[] = [...model.traceability, ...factEvidence];

    await updateBusinessUnderstandingModel(sessionId, {
      ...patch,
      assessment,
      decision,
      traceability: [...traceability, ...evidence, ...decisionEvidence],
    });

    await updateRequirementsSession(sessionId, { assessmentConfidence: overallConfidence });

    const messagesSoFar = await listRequirementsSessionMessages(sessionId);
    const nextDimension = selectNextDimension(decision, extractAskedDimensions(messagesSoFar));
    await appendNextAssistantTurn(sessionId, projectId, nextDimension);

    const [session, messages, refreshedModel] = await Promise.all([
      getRequirementsSession(sessionId),
      listRequirementsSessionMessages(sessionId),
      getBusinessUnderstandingModel(sessionId),
    ]);

    if (!session || !refreshedModel) {
      return null;
    }

    return { session, messages, model: refreshedModel, pendingDimension: nextDimension };
  } catch (error) {
    console.error('[RequirementsSessionOrchestrator] recordInterviewAnswer failed:', error);
    return null;
  }
}

export const requirementsSessionOrchestrator = {
  createRequirementsSessionForNewProject,
  recordRequirementsFormSubmission,
  startOrResumeInterview,
  recordInterviewAnswer,
};
