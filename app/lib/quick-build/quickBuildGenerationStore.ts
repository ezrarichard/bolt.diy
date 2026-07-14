import { atom } from 'nanostores';
import {
  IDLE_QUICK_BUILD_STATE,
  QUICK_BUILD_TRANSITIONS,
  type QuickBuildFailure,
  type QuickBuildGenerationState,
  type QuickBuildStage,
} from './quickBuildGenerationTypes';

/**
 * Quick Build Generation Lifecycle — Sprint 43A (Part 1).
 *
 * The single source of truth for "what is Quick Build's generation actually doing right
 * now." Every other signal the app previously inferred completion/failure from — LLM stream
 * completion, `workbenchStore.showWorkbench`, `chatStarted`, artifact visibility — stays
 * exactly as it was for its OWN purpose (UI panel visibility, etc.), but none of them are
 * read by quickBuildOrchestrator.ts to decide ready/failed anymore; only this store is.
 */
export const quickBuildGenerationStore = atom<QuickBuildGenerationState>(IDLE_QUICK_BUILD_STATE);

/** Thrown when the orchestrator itself attempts an invalid transition — a bug in the orchestrator's own sequencing, not a runtime condition any caller should need to handle; the orchestrator's own top-level try/catch converts this into a `failed` state (see quickBuildOrchestrator.ts). */
export class InvalidQuickBuildTransitionError extends Error {
  constructor(from: QuickBuildStage, to: QuickBuildStage) {
    super(`Invalid Quick Build generation transition: ${from} -> ${to}`);
    this.name = 'InvalidQuickBuildTransitionError';
  }
}

/**
 * Starts tracking a fresh generation for `projectId`, discarding any previous run's terminal
 * state (ready/failed) for this store — one Quick Build generation is tracked at a time,
 * matching one active chat tab. `generationId` (Sprint 43B) is this generation's own stable
 * identity, minted once by quickBuildOrchestrator.ts's `beginQuickBuildGeneration()` — see
 * quickBuildGenerationTypes.ts's `QuickBuildGenerationState.generationId` for why.
 */
export function beginQuickBuildTracking(projectId: string, generationId: string): void {
  quickBuildGenerationStore.set({
    projectId,
    stage: 'idle',
    startedAt: new Date().toISOString(),
    hasWrittenFiles: false,
    generationId,
  });
}

/**
 * Moves the state machine forward. Validates the transition against
 * QUICK_BUILD_TRANSITIONS — an invalid transition throws rather than silently applying,
 * since this store is meant to be provably correct, not merely descriptive.
 */
export function setQuickBuildStage(stage: QuickBuildStage, patch?: Partial<QuickBuildGenerationState>): void {
  const current = quickBuildGenerationStore.get();

  if (!QUICK_BUILD_TRANSITIONS[current.stage].includes(stage)) {
    throw new InvalidQuickBuildTransitionError(current.stage, stage);
  }

  quickBuildGenerationStore.set({ ...current, ...patch, stage });
}

/** Part 10 — records a failure without validating a specific "from" stage (failure can occur from anywhere), and preserves `hasWrittenFiles` so Part 11's recovery UI knows whether "Continue From Last Successful Step" is even possible. */
export function failQuickBuildGeneration(step: QuickBuildStage, reason: string, stack?: string): void {
  const current = quickBuildGenerationStore.get();
  const failure: QuickBuildFailure = { step, reason, stack };
  quickBuildGenerationStore.set({ ...current, stage: 'failed', failure });
}

/** Called once file-writing has genuinely happened (Part 4 verified) — independent of whether a later stage (install/build/preview) subsequently fails, so recovery always knows if there's something to resume from. */
export function markQuickBuildFilesWritten(): void {
  quickBuildGenerationStore.set({ ...quickBuildGenerationStore.get(), hasWrittenFiles: true });
}

export function resetQuickBuildGeneration(): void {
  quickBuildGenerationStore.set(IDLE_QUICK_BUILD_STATE);
}
