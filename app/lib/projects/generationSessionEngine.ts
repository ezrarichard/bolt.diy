import type { Project } from '~/lib/stores/projects';
import type { GenerationPhaseId, RecommendedModel } from './generationPlannerEngine';
import type { GenerationExecutionPlan, GenerationExecutionStep } from './generationExecutionEngine';
import type { GenerationQueueStatus } from './generationQueueEngine';

/**
 * Generation Session Engine — Sprint 28 ("Generation Session & Execution
 * State Engine").
 *
 *   ... -> Generation Planner (Sprint 25) -> Generation Queue (Sprint 26)
 *     -> Generation Execution Plan (Sprint 27)
 *       -> Generation Session Engine (this file) -> Claude execution (future)
 *
 * The Planner/Queue/Execution-Plan engines are all recomputed fresh on every
 * call — none of them have any notion of "this has already started." This
 * engine is the first one that models a RUNTIME, a session that is created
 * once and then moves through states over time (idle -> ready -> running ->
 * paused/failed/cancelled -> completed). It is the runtime state machine —
 * still entirely simulated. No function here calls an LLM, a provider,
 * GitHub, Supabase, the filesystem, Preview, or the terminal, and nothing
 * here advances a step automatically: every transition (`completeStep`,
 * `failStep`, `skipStep`, `pauseSession`, `resumeSession`, `cancelSession`)
 * only happens when explicitly called, and this sprint wires none of them
 * up to a button — see the file-level "Future Claude integration" note
 * below for where that will eventually plug in.
 *
 * Pure and deterministic: every exported function takes its full input as
 * arguments and returns a NEW object rather than mutating anything — the
 * exact same "decision, not mutation" shape reviewEngine.ts already uses
 * (`approveTask`/`rejectTask` return a decision; the store applies it). The
 * actual persistence setter (`getGenerationSession`/`setGenerationSession`)
 * lives in app/lib/stores/projects.ts, matching where every other
 * project-scoped accessor/setter (`getProjectArtifacts`, `setTaskStatus`,
 * ...) already lives — this file never touches a store.
 *
 * Order is never recalculated here: `createSession` walks
 * `GenerationExecutionPlan.steps` in the exact order the Planner/Queue
 * already computed, and every advance (`completeStep`/`skipStep`) simply
 * moves to the next array index. Because that order already respects every
 * dependency edge, walking it sequentially — one step "current" at a time —
 * is enough to stay correct without re-deriving `dependsOn`/`unblocks`.
 */

/**
 * The session's own top-level lifecycle — exactly the seven values this
 * sprint specifies. Steps use a related but larger vocabulary (see
 * `GenerationSessionStepStatus`) because the per-step summary explicitly
 * needs to count "Waiting" and "Skipped" buckets that don't appear in this
 * shorter, session-level list.
 */
export type GenerationSessionStatus = 'idle' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Per-step status. Adds `waiting` (blocked by an earlier step that hasn't
 * finished), `blocked` (the whole session isn't allowed to run yet — Project
 * Manager hasn't approved generation), and `skipped` on top of the
 * session-level vocabulary, since the required summary buckets need all of
 * these to be real, countable states.
 */
export type GenerationSessionStepStatus =
  | 'idle'
  | 'blocked'
  | 'waiting'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type GenerationValidationStatus = 'pending' | 'running' | 'passed' | 'failed';

export type GenerationRollbackStatus = 'none' | 'available' | 'executing' | 'completed';

export interface GenerationSessionStep {
  stepId: string;
  moduleId: string;
  moduleName: string;
  phase: GenerationPhaseId;
  status: GenerationSessionStepStatus;

  /** 0-100. Binary in practice today (0 until a terminal outcome, 100 once completed/skipped) since nothing partially executes yet — kept as a number so a future streaming-progress sprint can set intermediate values without a shape change. */
  progress: number;
  attempts: number;
  startedAt: string | undefined;
  completedAt: string | undefined;

  /** Defaults to `recommendedModel` at session creation — this is the field a future model-override UI would write to (see generationExecutionEngine.ts's identical Recommended/Selected split). */
  selectedModel: RecommendedModel;
  recommendedModel: RecommendedModel;
  validationStatus: GenerationValidationStatus;
  rollbackStatus: GenerationRollbackStatus;
  lastMessage: string;

  /**
   * Not part of a literal field-by-field spec — copied once from
   * `GenerationExecutionStep.estimatedDurationMinutes` at `createSession()`
   * time so `summarizeSession(session)` can compute "Estimated Remaining
   * Time" from the session alone, matching its documented signature
   * (`session` only, no execution plan) without re-reading the Execution
   * Plan.
   */
  estimatedDurationMinutes: number;
}

export interface GenerationSessionSummary {
  totalSteps: number;
  completedCount: number;
  runningCount: number;
  waitingCount: number;
  failedCount: number;
  skippedCount: number;
  overallProgressPercent: number;
  estimatedRemainingMinutes: number;
}

export interface GenerationSession {
  sessionId: string;

  /** Not a literal spec field, but every sibling engine's output (GenerationPlan/Queue/ExecutionPlan) already carries one — added for the same self-describing consistency. */
  projectId: string;
  createdAt: string;
  startedAt: string | undefined;
  completedAt: string | undefined;
  status: GenerationSessionStatus;
  currentStepId: string | undefined;

  /** 0-100, same value as `summary.overallProgressPercent` — the spec lists both a top-level field and a summary field, so both are always kept in sync by `calculateProgress`/`summarizeSession`. */
  overallProgress: number;
  steps: GenerationSessionStep[];
  summary: GenerationSessionSummary;
}

const INITIAL_STATUS_MESSAGE: Record<GenerationSessionStepStatus, string> = {
  idle: 'Not started yet.',
  blocked: 'Blocked — project is not ready for generation.',
  waiting: 'Waiting on an earlier step to complete.',
  ready: 'Ready to start — next in the session.',
  running: 'Currently running.',
  paused: 'Paused.',
  completed: 'Completed successfully.',
  failed: 'Failed — see rollback options.',
  skipped: 'Skipped by request.',
  cancelled: 'Cancelled.',
};

/** Maps a step's already-computed GenerationQueueStatus onto its initial session-step status — reused, not recalculated. `pending` (Queue's "deps satisfied but queued behind a sibling") becomes `idle` (no dependency issue, simply not its turn yet). */
function mapInitialStepStatus(queueStatus: GenerationQueueStatus): GenerationSessionStepStatus {
  switch (queueStatus) {
    case 'blocked':
      return 'blocked';
    case 'waiting':
      return 'waiting';
    case 'ready':
      return 'ready';
    case 'pending':
      return 'idle';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default: {
      const exhaustiveCheck: never = queueStatus;
      return exhaustiveCheck;
    }
  }
}

function buildSessionStep(executionStep: GenerationExecutionStep): GenerationSessionStep {
  const status = mapInitialStepStatus(executionStep.status);

  return {
    stepId: executionStep.stepId,
    moduleId: executionStep.moduleId,
    moduleName: executionStep.moduleName,
    phase: executionStep.phase,
    status,
    progress: 0,
    attempts: 0,
    startedAt: undefined,
    completedAt: undefined,
    selectedModel: executionStep.recommendedModel,
    recommendedModel: executionStep.recommendedModel,
    validationStatus: 'pending',
    rollbackStatus: 'none',
    lastMessage: INITIAL_STATUS_MESSAGE[status],
    estimatedDurationMinutes: executionStep.estimatedDurationMinutes,
  };
}

/** 0 until a step reaches a terminal completed/skipped outcome, then 100 — see the `progress` field's own doc comment for why this is binary today. */
function calculateProgress(session: GenerationSession): number {
  if (session.steps.length === 0) {
    return 0;
  }

  const total = session.steps.reduce((sum, step) => sum + step.progress, 0);

  return Math.round(total / session.steps.length);
}

function summarizeSession(session: GenerationSession): GenerationSessionSummary {
  const completedCount = session.steps.filter((step) => step.status === 'completed').length;
  const runningCount = session.steps.filter((step) => step.status === 'running').length;
  const failedCount = session.steps.filter((step) => step.status === 'failed').length;
  const skippedCount = session.steps.filter((step) => step.status === 'skipped').length;
  const waitingCount = session.steps.length - completedCount - runningCount - failedCount - skippedCount;

  const estimatedRemainingMinutes = session.steps
    .filter((step) => step.status !== 'completed' && step.status !== 'skipped')
    .reduce((sum, step) => sum + step.estimatedDurationMinutes, 0);

  return {
    totalSteps: session.steps.length,
    completedCount,
    runningCount,
    waitingCount,
    failedCount,
    skippedCount,
    overallProgressPercent: calculateProgress(session),
    estimatedRemainingMinutes,
  };
}

/** Recomputes `overallProgress`/`summary` together so they can never drift apart — every function below that changes `steps` finishes by calling this once. */
function finalizeSession(session: GenerationSession): GenerationSession {
  return { ...session, overallProgress: calculateProgress(session), summary: summarizeSession(session) };
}

/**
 * Builds a brand-new session from a project's current Execution Plan. Pure:
 * returns a new object, does not persist anything (see
 * `setGenerationSession` in app/lib/stores/projects.ts for that). Safe to
 * call repeatedly as a live, unsaved preview — exactly how
 * GenerationPlanPanel.tsx uses it when no session has been persisted yet.
 */
function createSession(project: Project, executionPlan: GenerationExecutionPlan): GenerationSession {
  const steps = executionPlan.steps.map(buildSessionStep);
  const readyStep = steps.find((step) => step.status === 'ready');

  const session: GenerationSession = {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    startedAt: undefined,
    completedAt: undefined,
    status: executionPlan.ready ? 'ready' : 'idle',
    currentStepId: readyStep?.stepId,
    overallProgress: 0,
    steps,
    summary: {
      totalSteps: steps.length,
      completedCount: 0,
      runningCount: 0,
      waitingCount: steps.length,
      failedCount: 0,
      skippedCount: 0,
      overallProgressPercent: 0,
      estimatedRemainingMinutes: 0,
    },
  };

  return finalizeSession(session);
}

function pauseSession(session: GenerationSession): GenerationSession {
  if (session.status !== 'ready' && session.status !== 'running') {
    return session;
  }

  return { ...session, status: 'paused' };
}

function resumeSession(session: GenerationSession): GenerationSession {
  if (session.status !== 'paused') {
    return session;
  }

  return { ...session, status: session.startedAt ? 'running' : 'ready' };
}

/** Cancels the session and every step that hasn't already reached a terminal outcome — completed/failed/skipped steps keep their history. No-op if the session is already terminal. */
function cancelSession(session: GenerationSession): GenerationSession {
  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return session;
  }

  const now = new Date().toISOString();
  const steps = session.steps.map((step) =>
    step.status === 'completed' || step.status === 'failed' || step.status === 'skipped'
      ? step
      : { ...step, status: 'cancelled' as const, lastMessage: INITIAL_STATUS_MESSAGE.cancelled },
  );

  return finalizeSession({ ...session, status: 'cancelled', completedAt: now, currentStepId: undefined, steps });
}

const OUTCOME_MESSAGE: Record<'completed' | 'failed' | 'skipped', string> = {
  completed: INITIAL_STATUS_MESSAGE.completed,
  failed: INITIAL_STATUS_MESSAGE.failed,
  skipped: INITIAL_STATUS_MESSAGE.skipped,
};

/**
 * Shared implementation behind `completeStep`/`failStep`/`skipStep`. Only
 * ever acts on `session.currentStepId` — calling it with any other stepId is
 * a safe no-op (returns `session` unchanged) rather than throwing, matching
 * how `reviewEngine.approveTask` returns `undefined` instead of throwing
 * when a task isn't in the right state. On a non-failing outcome it also
 * advances `currentStepId` to the next step in array order and marks that
 * step `ready` — see the file header for why that never needs to
 * recalculate dependencies.
 */
function advanceCurrentStep(
  session: GenerationSession,
  stepId: string,
  outcome: 'completed' | 'failed' | 'skipped',
  message: string | undefined,
): GenerationSession {
  if (session.currentStepId !== stepId) {
    return session;
  }

  const stepIndex = session.steps.findIndex((step) => step.stepId === stepId);

  if (stepIndex === -1) {
    return session;
  }

  const now = new Date().toISOString();

  let nextCurrentStepId: string | undefined;

  const steps = session.steps.map((step, index) => {
    if (index === stepIndex) {
      return {
        ...step,
        status: outcome,
        progress: 100,
        attempts: outcome === 'failed' ? step.attempts + 1 : step.attempts,
        startedAt: step.startedAt ?? now,
        completedAt: now,
        validationStatus: outcome === 'completed' ? 'passed' : outcome === 'failed' ? 'failed' : 'pending',
        rollbackStatus: outcome === 'skipped' ? 'none' : 'available',
        lastMessage: message ?? OUTCOME_MESSAGE[outcome],
      } satisfies GenerationSessionStep;
    }

    const isNextStep = index === stepIndex + 1 && (step.status === 'idle' || step.status === 'waiting');

    if (outcome !== 'failed' && isNextStep) {
      nextCurrentStepId = step.stepId;
      return { ...step, status: 'ready' as const, lastMessage: INITIAL_STATUS_MESSAGE.ready };
    }

    return step;
  });

  const allSettled = steps.every((step) => ['completed', 'failed', 'skipped', 'cancelled'].includes(step.status));

  const status: GenerationSessionStatus = outcome === 'failed' ? 'failed' : allSettled ? 'completed' : 'running';

  return finalizeSession({
    ...session,
    steps,
    status,
    startedAt: session.startedAt ?? now,
    completedAt: status === 'completed' || status === 'failed' ? now : session.completedAt,
    currentStepId: outcome === 'failed' ? stepId : nextCurrentStepId,
  });
}

function completeStep(session: GenerationSession, stepId: string, message?: string): GenerationSession {
  return advanceCurrentStep(session, stepId, 'completed', message);
}

function failStep(session: GenerationSession, stepId: string, message?: string): GenerationSession {
  return advanceCurrentStep(session, stepId, 'failed', message);
}

function skipStep(session: GenerationSession, stepId: string, message?: string): GenerationSession {
  return advanceCurrentStep(session, stepId, 'skipped', message);
}

function getCurrentStep(session: GenerationSession): GenerationSessionStep | undefined {
  return session.steps.find((step) => step.stepId === session.currentStepId);
}

/** The step that would become current after the current one finishes — or the first step if nothing has started yet. */
function getNextStep(session: GenerationSession): GenerationSessionStep | undefined {
  const currentIndex = session.steps.findIndex((step) => step.stepId === session.currentStepId);

  if (currentIndex === -1) {
    return session.steps[0];
  }

  return session.steps[currentIndex + 1];
}

export const generationSessionEngine = {
  createSession,
  pauseSession,
  resumeSession,
  cancelSession,
  completeStep,
  failStep,
  skipStep,
  getCurrentStep,
  getNextStep,
  calculateProgress,
  summarizeSession,
};

/**
 * FUTURE INTEGRATION POINT — documented only, nothing below is implemented.
 *
 * This is where real Claude-driven generation will eventually plug in, one
 * step at a time:
 *
 *   Generation Session (this file)
 *     -> Execution Step (generationExecutionEngine.ts — model/strategy already classified)
 *       -> Context Engine (contextEngine.ts — buildContextBundle for the step's contextRole/contextBudget)
 *         -> Prompt Builder (does not exist yet — would format the context bundle + module intent into an actual prompt)
 *           -> Claude (the step's selectedModel — actually invoked, for the first time in this whole engine chain)
 *             -> Validation (turns each step's static validationStrategy list into real checks — Compile Check, Type Check, etc. — updating `validationStatus`)
 *               -> Git Update (commits/writes whatever Claude produced — the first point anything touches a real file or repository)
 *                 -> Preview Refresh (reflects the new files in the live Preview pane)
 *                   -> Next Step (calls `completeStep`/`failStep` on this session, which — per this file's existing logic — advances `currentStepId` to the next step with no dependency recalculation needed)
 *
 * Every box above this file's own box is unimplemented today. This file's
 * job in that future flow is unchanged from today: hold the session state
 * and react to explicit `completeStep`/`failStep`/`skipStep` calls — it
 * will never itself decide to call Claude, git, or Preview.
 */
