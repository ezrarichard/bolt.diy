import { atom } from 'nanostores';
import {
  WORKSPACE_RESUME_TRANSITIONS,
  type WorkspaceResumeFailure,
  type WorkspaceResumeStage,
  type WorkspaceResumeState,
} from './workspaceResumeTypes';

/**
 * Workspace Resume Lifecycle — Sprint 44.
 *
 * Keyed by projectId (a plain Record, not a single shared state) — "opening two different
 * projects may resume independently" (Sprint 44 Phase 5) means this can never be a single
 * global boolean/state the way an earlier draft of this fix considered. Each entry's own
 * `resumeId` (see workspaceResumeOrchestrator.ts) is what a stale/superseded resume checks
 * before writing further state, so an old resume for a project that's since been retried
 * can never stomp the newer attempt's progress — the same pattern
 * quickBuildGenerationStore.ts already uses for `generationId`.
 */
export const workspaceResumeStore = atom<Record<string, WorkspaceResumeState>>({});

export class InvalidWorkspaceResumeTransitionError extends Error {
  constructor(from: WorkspaceResumeStage, to: WorkspaceResumeStage) {
    super(`Invalid workspace resume transition: ${from} -> ${to}`);
    this.name = 'InvalidWorkspaceResumeTransitionError';
  }
}

export function getWorkspaceResumeState(projectId: string): WorkspaceResumeState | undefined {
  return workspaceResumeStore.get()[projectId];
}

/** Starts tracking a fresh resume attempt for `projectId`, discarding any previous attempt's terminal state — a retry always gets a new `resumeId`. */
export function beginWorkspaceResume(projectId: string, resumeId: string): void {
  const next: WorkspaceResumeState = {
    projectId,
    resumeId,
    stage: 'idle',
    startedAt: new Date().toISOString(),
  };

  workspaceResumeStore.set({ ...workspaceResumeStore.get(), [projectId]: next });
}

/**
 * Moves `projectId`'s resume forward. `resumeId` must match the CURRENT tracked attempt —
 * a stale resume (superseded by a newer retry) silently no-ops instead of overwriting the
 * newer attempt's state, matching quickBuildOrchestrator.ts's `isStillActiveGeneration()`
 * pattern. Validates the transition itself the same way setQuickBuildStage() does.
 */
export function setWorkspaceResumeStage(
  projectId: string,
  resumeId: string,
  stage: WorkspaceResumeStage,
  patch?: Partial<WorkspaceResumeState>,
): void {
  const current = getWorkspaceResumeState(projectId);

  if (!current || current.resumeId !== resumeId) {
    return;
  }

  if (!WORKSPACE_RESUME_TRANSITIONS[current.stage].includes(stage)) {
    throw new InvalidWorkspaceResumeTransitionError(current.stage, stage);
  }

  workspaceResumeStore.set({
    ...workspaceResumeStore.get(),
    [projectId]: { ...current, ...patch, stage },
  });
}

export function failWorkspaceResume(projectId: string, resumeId: string, failure: WorkspaceResumeFailure): void {
  const current = getWorkspaceResumeState(projectId);

  if (!current || current.resumeId !== resumeId) {
    return;
  }

  workspaceResumeStore.set({
    ...workspaceResumeStore.get(),
    [projectId]: { ...current, stage: 'failed', failure },
  });
}

/** Whether `projectId` currently has a resume in flight (not idle/ready/failed) — the orchestrator's own "one resume per project at a time" guard reads this before starting a new attempt. */
export function isWorkspaceResumeActive(projectId: string): boolean {
  const state = getWorkspaceResumeState(projectId);
  return !!state && state.stage !== 'idle' && state.stage !== 'ready' && state.stage !== 'failed';
}
