import { executionEngine, type ProjectTaskExecution } from './executionEngine';
import { projectTaskEngine, type ProjectTask } from './taskEngine';
import { createPlaceholderArtifact, type ProjectArtifact } from './artifacts';
import { getProjectArtifacts, getTaskReview, type Project } from '~/lib/stores/projects';

/**
 * Review & Approval Engine — Sprint 12.
 *
 *   Project Task Engine -> Execution Engine -> Review Engine (this file) -> AI Generation
 *
 * Sprint 11 gave tasks a lifecycle (Not Started -> Ready -> In Progress ->
 * Needs Review) but nothing ever turned "Needs Review" into "Completed" —
 * there was no approval step. This file is that step: it decides whether a
 * task can be approved, computes what approving/rejecting it should change,
 * and answers review-queue questions (pending/approved/changes-requested
 * counts, what to review next).
 *
 * Every function here is a pure read over a `Project` (plus, where needed,
 * a task id) — including `approveTask`/`rejectTask`, which do NOT write
 * anything. They return a `ReviewDecision` describing the change; the
 * store (`applyReviewDecision` in app/lib/stores/projects.ts) is what
 * actually merges it in and persists. This mirrors how executionEngine
 * only reads `project.taskStatus` rather than writing it. No React, no
 * stores, no LLM, no code generation, no prompts.
 */

export type ReviewStatus = 'approved' | 'changes-requested';

export interface TaskReviewRecord {
  taskId: string;
  reviewStatus: ReviewStatus;
  reviewedAt: string;
  reviewNotes?: string;
  reviewedBy: string;
}

export type TaskHistoryEventType = 'started' | 'paused' | 'submitted-for-review' | 'approved' | 'changes-requested';

export interface TaskHistoryEvent {
  event: TaskHistoryEventType;
  at: string;
  note?: string;
}

export interface ReviewSummary {
  pending: number;
  approved: number;
  changesRequested: number;
}

export interface ReviewDecision {
  taskId: string;
  taskStatus: 'completed' | 'in-progress';
  review: TaskReviewRecord;
  historyEvent: TaskHistoryEvent;

  /** Present only when approving — the roadmap step to mark completed alongside the task. */
  roadmapKey?: string;

  /** Present only when approving and the task has no artifact yet. */
  artifact?: ProjectArtifact;
}

export interface RecommendedAction {
  kind: 'review' | 'start';
  task: ProjectTaskExecution;
  reasons: string[];
}

/** reviewedBy always defaults to this — there's no reviewer identity system yet. */
const DEFAULT_REVIEWER = 'Local User';

/** A category's plausible placeholder output file — e.g. "homepage" (frontend) -> "homepage-spec.md". */
const ARTIFACT_SUFFIX_BY_CATEGORY: Record<ProjectTask['category'], string> = {
  database: 'schema.sql',
  planning: 'plan.md',
  backend: 'plan.md',
  integration: 'config.md',
  deployment: 'deployment.md',
  frontend: 'spec.md',
  design: 'spec.md',
};

function inferArtifactTitle(task: ProjectTask): string {
  return `${task.id}-${ARTIFACT_SUFFIX_BY_CATEGORY[task.category]}`;
}

function getPendingReviews(project: Project): ProjectTaskExecution[] {
  return executionEngine.getExecutionTasks(project).filter((task) => task.status === 'needs-review');
}

function getApprovedTasks(project: Project): ProjectTaskExecution[] {
  return executionEngine
    .getExecutionTasks(project)
    .filter((task) => getTaskReview(project, task.id)?.reviewStatus === 'approved');
}

function getRejectedTasks(project: Project): ProjectTaskExecution[] {
  return executionEngine
    .getExecutionTasks(project)
    .filter((task) => getTaskReview(project, task.id)?.reviewStatus === 'changes-requested');
}

function getReviewSummary(project: Project): ReviewSummary {
  return {
    pending: getPendingReviews(project).length,
    approved: getApprovedTasks(project).length,
    changesRequested: getRejectedTasks(project).length,
  };
}

/** Whether a task is currently eligible for an approval decision — only true while it's `needs-review`. */
function canApprove(project: Project, taskId: string): boolean {
  return executionEngine.getTaskStatus(project, taskId) === 'needs-review';
}

/** The next task waiting for review, in queue order (registry order) — undefined when the queue is empty. */
function getNextReview(project: Project): ProjectTaskExecution | undefined {
  return getPendingReviews(project)[0];
}

/**
 * Pure — computes what approving a task should change (task becomes
 * Completed, its roadmap step becomes Completed, a placeholder artifact is
 * created if one doesn't exist yet). Returns undefined if the task isn't
 * currently `needs-review`. Writes nothing; see applyReviewDecision in
 * app/lib/stores/projects.ts for the setter that actually persists this.
 */
function approveTask(project: Project, taskId: string, notes?: string): ReviewDecision | undefined {
  if (!canApprove(project, taskId)) {
    return undefined;
  }

  const task = projectTaskEngine.getTask(project.blueprintId, taskId);

  if (!task) {
    return undefined;
  }

  const now = new Date().toISOString();
  const hasArtifact = getProjectArtifacts(project).some((artifact) => artifact.taskId === taskId);

  return {
    taskId,
    taskStatus: 'completed',
    review: {
      taskId,
      reviewStatus: 'approved',
      reviewedAt: now,
      reviewNotes: notes,
      reviewedBy: DEFAULT_REVIEWER,
    },
    historyEvent: { event: 'approved', at: now, note: notes },
    roadmapKey: task.roadmapKey,
    artifact: hasArtifact ? undefined : createPlaceholderArtifact(taskId, inferArtifactTitle(task), task.outputType),
  };
}

/**
 * Pure — computes what requesting changes on a task should change (task
 * returns to In Progress, review notes recorded). Returns undefined if the
 * task isn't currently `needs-review`. Writes nothing.
 */
function rejectTask(project: Project, taskId: string, notes?: string): ReviewDecision | undefined {
  if (!canApprove(project, taskId)) {
    return undefined;
  }

  const now = new Date().toISOString();

  return {
    taskId,
    taskStatus: 'in-progress',
    review: {
      taskId,
      reviewStatus: 'changes-requested',
      reviewedAt: now,
      reviewNotes: notes,
      reviewedBy: DEFAULT_REVIEWER,
    },
    historyEvent: { event: 'changes-requested', at: now, note: notes },
  };
}

/**
 * The single next thing the user should do. If anything is awaiting
 * review, that always wins ("Review Homepage" beats "Generate Categories")
 * — only once the review queue is empty does this fall back to
 * executionEngine's ready-task recommendation. No AI: a deterministic pick
 * over data both engines already have.
 */
function getRecommendedNextAction(project: Project): RecommendedAction | undefined {
  const pending = getPendingReviews(project);

  if (pending.length > 0) {
    const [next] = pending;
    const reasons = pending.length > 1 ? [`${pending.length} tasks awaiting review`] : ['Awaiting your review'];

    return { kind: 'review', task: next, reasons };
  }

  const recommended = executionEngine.getNextRecommendedTask(project);

  return recommended ? { kind: 'start', task: recommended.task, reasons: recommended.reasons } : undefined;
}

export const reviewEngine = {
  getPendingReviews,
  getApprovedTasks,
  getRejectedTasks,
  getReviewSummary,
  approveTask,
  rejectTask,
  canApprove,
  getNextReview,
  getRecommendedNextAction,
};
