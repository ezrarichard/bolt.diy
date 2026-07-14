/**
 * Workspace Resume Lifecycle — Sprint 44.
 *
 * The explicit state machine for "reopening an already-generated Quick Build project" —
 * a different lifecycle from quickBuildGenerationTypes.ts's `QuickBuildStage` (that one
 * tracks a fresh LLM-driven generation; this one tracks re-materializing a project that
 * already finished generating, e.g. after a browser refresh). Deliberately its own module:
 * the Sprint 44 audit found the previous ad-hoc attempt to reuse `continueQuickBuildFromSnapshot`
 * directly from a React effect had no single source of truth for "is a resume already
 * running for this project" — this store is that source of truth.
 */

export type WorkspaceResumeStage =
  | 'idle'
  | 'hydratingProject'
  | 'loadingSnapshot'
  | 'waitingForWebContainer'
  | 'restoringFiles'
  | 'installingDependencies'
  | 'startingPreview'
  | 'ready'
  | 'failed';

/** Every state a stage can legally move to next — mirrors quickBuildGenerationTypes.ts's own transition table. `failed` is reachable from anywhere; a fresh resume (new resumeId) always restarts at `hydratingProject`. */
export const WORKSPACE_RESUME_TRANSITIONS: Record<WorkspaceResumeStage, WorkspaceResumeStage[]> = {
  idle: ['hydratingProject'],
  hydratingProject: ['loadingSnapshot', 'failed'],
  loadingSnapshot: ['waitingForWebContainer', 'failed'],
  waitingForWebContainer: ['restoringFiles', 'failed'],
  restoringFiles: ['installingDependencies', 'failed'],
  installingDependencies: ['startingPreview', 'failed'],
  startingPreview: ['ready', 'failed'],
  ready: [],
  failed: [],
};

export const WORKSPACE_RESUME_STAGE_LABEL: Record<WorkspaceResumeStage, string> = {
  idle: 'Idle',
  hydratingProject: 'Restoring workspace…',
  loadingSnapshot: 'Restoring workspace…',
  waitingForWebContainer: 'Restoring workspace…',
  restoringFiles: 'Restoring workspace…',
  installingDependencies: 'Installing dependencies…',
  startingPreview: 'Starting preview…',
  ready: 'Ready',
  failed: 'Failed',
};

export interface WorkspaceResumeFailure {
  step: WorkspaceResumeStage;
  reason: string;
}

export interface WorkspaceResumeState {
  projectId: string;

  /** This resume attempt's own identity — a retry after failure always mints a new one (see workspaceResumeOrchestrator.ts). Lets a stale, still-settling resume recognize a newer one has taken over and stop writing further state. */
  resumeId: string;
  stage: WorkspaceResumeStage;
  startedAt: string;
  previewUrl?: string;
  failure?: WorkspaceResumeFailure;
}
