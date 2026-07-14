/**
 * Quick Build Generation Lifecycle — Sprint 43A.
 *
 * Quick Build (raw chat → `<boltArtifact>`/`<boltAction>` parsing → WebContainer, see
 * app/lib/hooks/useMessageParser.ts) previously had no completion signal beyond "the LLM
 * stream finished" — which is not the same thing as "the requested application was actually
 * generated, installed, built, and is running." This module defines the explicit state
 * machine that replaces that assumption; see quickBuildGenerationStore.ts for the store/
 * transition logic and quickBuildOrchestrator.ts for what drives each transition.
 *
 * Deliberately named/shaped to reuse as much of Guided Engineering's existing verified
 * machinery as possible (repairEngine.ts's install/build/repair loop, the Engineering
 * Timeline, BuildersDB activity logging, workspace snapshots) — see quickBuildOrchestrator.ts
 * for exactly which functions are reused vs new.
 */

/** Every stage, in order — the sprint's own suggested list. `idle` is not a real generation state; it's "nothing running yet / previous run's terminal state was reset." */
export type QuickBuildStage =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'writingFiles'
  | 'installingDependencies'
  | 'building'
  | 'startingPreview'
  | 'savingSnapshot'
  | 'ready'
  | 'failed';

/** Every state a stage can legally move to next. Enforced by setQuickBuildStage() — an out-of-order transition is a bug in the orchestrator itself, not a runtime possibility to silently tolerate. `failed` is reachable from anywhere (any stage can fail); `preparing` is reachable from `failed`/`ready` (retrying, or starting a new prompt in the same chat). */
export const QUICK_BUILD_TRANSITIONS: Record<QuickBuildStage, QuickBuildStage[]> = {
  idle: ['preparing'],
  preparing: ['streaming', 'failed'],
  streaming: ['writingFiles', 'failed'],
  writingFiles: ['installingDependencies', 'failed'],
  installingDependencies: ['building', 'failed'],
  building: ['startingPreview', 'failed'],
  startingPreview: ['savingSnapshot', 'failed'],
  savingSnapshot: ['ready', 'failed'],
  ready: ['preparing'],
  failed: ['preparing'],
};

/** Human-readable label per stage — what Part 9's Engineering Timeline entries display. */
export const QUICK_BUILD_STAGE_LABEL: Record<QuickBuildStage, string> = {
  idle: 'Idle',
  preparing: 'Preparing…',
  streaming: 'Generating Files…',
  writingFiles: 'Generating Files…',
  installingDependencies: 'Installing Packages…',
  building: 'Building…',
  startingPreview: 'Launching Preview…',
  savingSnapshot: 'Saving Snapshot…',
  ready: 'Ready',
  failed: 'Failed',
};

/** What actually went wrong, recorded on every failure — Part 10's "reason, step, stack (sanitized)". */
export interface QuickBuildFailure {
  step: QuickBuildStage;
  reason: string;

  /** Already sanitized/truncated before it reaches this type — see quickBuildOrchestrator.ts's sanitizeStack(). Never a raw provider error, prompt, or secret. */
  stack?: string;
}

export interface QuickBuildGenerationState {
  projectId: string | null;
  stage: QuickBuildStage;
  startedAt: string | null;

  /** Set once files exist from a previous successful (or partially-successful, files-written) run — enables "Continue From Last Successful Step" (Part 11) even after a `failed` terminal state. */
  hasWrittenFiles: boolean;
  failure?: QuickBuildFailure;

  /**
   * Sprint 43B — identifies which `beginQuickBuildGeneration()` call is the CURRENT one this
   * store is tracking. `finalizeQuickBuildGeneration()` (quickBuildOrchestrator.ts) captures
   * this at the start of its own run and re-checks it before writing further stage/failure
   * state, so a still-in-flight finalize for an OLD generation (e.g. one whose own async
   * install/build hadn't finished before the user retried and a NEW generation began) can
   * never stomp the new generation's state — see that file's `isStillActiveGeneration()`.
   */
  generationId: string | null;
}

export const IDLE_QUICK_BUILD_STATE: QuickBuildGenerationState = {
  projectId: null,
  stage: 'idle',
  startedAt: null,
  hasWrittenFiles: false,
  generationId: null,
};
