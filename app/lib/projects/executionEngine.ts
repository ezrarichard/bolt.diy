import { projectTaskEngine, type ProjectTask } from './taskEngine';
import { getStoredTaskStatus, type Project } from '~/lib/stores/projects';

/**
 * Execution Engine — Sprint 11.
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap
 *     -> Project Task Engine -> Execution Engine (this file) -> AI Generation
 *
 * The Project Task Engine (taskEngine.ts) only knows the *static* shape of
 * a blueprint's tasks (dependencies, required knowledge, output type,
 * estimate). This file answers the *dynamic, per-project* question: where
 * does a specific project currently stand on each task, what's blocking a
 * given task, what should the user do next, and what's the overall
 * execution progress.
 *
 * `ProjectTaskStatus` is a different, more granular signal than a
 * blueprint's RoadmapItemStatus (project.roadmapStatus) — roadmap status
 * tracks coarse per-step progress; this tracks exactly where a single task
 * sits in its own Start -> Pause -> Submit for Review -> Completed
 * lifecycle. The two are intentionally not merged.
 *
 * Every function here is a pure read: it takes a `Project` (plus, where
 * needed, a task id) and returns a derived value. Nothing calls an LLM,
 * generates code, writes a prompt, or touches a store/atom directly — the
 * only thing imported from app/lib/stores/projects is the trivial
 * `getStoredTaskStatus` accessor (itself a pure read over the `Project`
 * object passed in), the same pattern taskEngine.ts already used for
 * roadmap status. No React, no stores, no side effects.
 */

/**
 * The manual stage a user moves a task through, persisted per-project on
 * `Project.taskStatus` (see app/lib/stores/projects.ts). `not-started`
 * is never actually persisted by any setter — it's simply what "no entry
 * yet" means. `ready` and `blocked` are computed by this engine rather
 * than stored explicitly; the union includes them anyway so the persisted
 * field's type stays accurate if a future sprint ever needs to write one
 * directly.
 */
export type ProjectTaskStatus = 'not-started' | 'ready' | 'in-progress' | 'needs-review' | 'completed' | 'blocked';

export interface ProjectTaskExecution extends ProjectTask {
  status: ProjectTaskStatus;
}

export interface BlockingTask {
  id: string;
  title: string;
  status: ProjectTaskStatus;
}

export interface ExecutionProgress {
  total: number;
  completed: number;
  needsReview: number;
  inProgress: number;
  ready: number;
  blocked: number;
  percentComplete: number;
}

export interface RecommendedTask {
  task: ProjectTaskExecution;
  reasons: string[];
}

export interface ExecutionSummary {
  progress: ExecutionProgress;
  recommended?: RecommendedTask;
  tasks: ProjectTaskExecution[];
}

function resolveManualStage(project: Project, taskId: string): ProjectTaskStatus {
  return getStoredTaskStatus(project, taskId) ?? 'not-started';
}

/**
 * Depth-first status resolution with memoization and cycle protection.
 * A task is `completed` once its own manual stage says so (a completed
 * task stays completed regardless of its dependencies). Otherwise it's
 * `blocked` unless every dependency has resolved to `completed`, in which
 * case its manual stage (`in-progress` / `needs-review` / anything else)
 * decides the rest — absence of progress resolves to `ready`.
 * `visiting` guards against a cycle (the registry is static/acyclic and
 * should never actually produce one).
 */
function computeStatus(
  project: Project,
  task: ProjectTask,
  tasksById: Map<string, ProjectTask>,
  memo: Map<string, ProjectTaskStatus>,
  visiting: Set<string>,
): ProjectTaskStatus {
  const cached = memo.get(task.id);

  if (cached) {
    return cached;
  }

  const manualStage = resolveManualStage(project, task.id);

  if (manualStage === 'completed') {
    memo.set(task.id, 'completed');
    return 'completed';
  }

  if (visiting.has(task.id)) {
    return 'blocked';
  }

  visiting.add(task.id);

  const unblocked = task.dependsOn.every((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId);
    return dependencyTask ? computeStatus(project, dependencyTask, tasksById, memo, visiting) === 'completed' : true;
  });

  visiting.delete(task.id);

  let status: ProjectTaskStatus;

  if (!unblocked) {
    status = 'blocked';
  } else if (manualStage === 'in-progress' || manualStage === 'needs-review') {
    status = manualStage;
  } else {
    status = 'ready';
  }

  memo.set(task.id, status);

  return status;
}

/** Every task for the project's blueprint, with its resolved (dependency + manual stage) status attached. */
function getExecutionTasks(project: Project): ProjectTaskExecution[] {
  const tasks = projectTaskEngine.getTasks(project.blueprintId);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, ProjectTaskStatus>();
  const visiting = new Set<string>();

  return tasks.map((task) => ({
    ...task,
    status: computeStatus(project, task, tasksById, memo, visiting),
  }));
}

/** One task's resolved status. Returns `blocked` if the task id isn't found (fails safe, never actionable). */
function getTaskStatus(project: Project, taskId: string): ProjectTaskStatus {
  return getExecutionTasks(project).find((task) => task.id === taskId)?.status ?? 'blocked';
}

/** The dependency tasks (with resolved status) currently holding a task back — empty once it's not blocked. */
function getBlockedReason(project: Project, taskId: string): BlockingTask[] {
  const task = projectTaskEngine.getTask(project.blueprintId, taskId);

  if (!task) {
    return [];
  }

  const executionTasksById = new Map(getExecutionTasks(project).map((entry) => [entry.id, entry]));

  return task.dependsOn
    .map((dependencyId) => executionTasksById.get(dependencyId))
    .filter((dependency): dependency is ProjectTaskExecution => Boolean(dependency))
    .filter((dependency) => dependency.status !== 'completed')
    .map((dependency) => ({ id: dependency.id, title: dependency.title, status: dependency.status }));
}

/** Counts of tasks in each status, plus overall percent complete. */
function getExecutionProgress(project: Project): ExecutionProgress {
  const tasks = getExecutionTasks(project);
  const countWhere = (status: ProjectTaskStatus) => tasks.filter((task) => task.status === status).length;
  const total = tasks.length;
  const completed = countWhere('completed');

  return {
    total,
    completed,
    needsReview: countWhere('needs-review'),
    inProgress: countWhere('in-progress'),
    ready: countWhere('ready'),
    blocked: countWhere('blocked'),
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * Suggests the single best next task to work on — the `ready` task that
 * unblocks the most downstream work (ties broken by registry order), with
 * plain-text reasons templated from the dependency graph. No AI: this is
 * a deterministic pick over data the engine already has.
 */
function getNextRecommendedTask(project: Project): RecommendedTask | undefined {
  const tasks = getExecutionTasks(project);
  const readyTasks = tasks.filter((task) => task.status === 'ready');

  if (readyTasks.length === 0) {
    return undefined;
  }

  const [recommended] = [...readyTasks].sort((a, b) => b.nextTasks.length - a.nextTasks.length);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const reasons: string[] = [];

  for (const dependencyId of recommended.dependsOn) {
    const dependency = tasksById.get(dependencyId);

    if (dependency?.status === 'completed') {
      reasons.push(`${dependency.title} completed`);
    }
  }

  for (const nextId of recommended.nextTasks) {
    const nextTask = tasksById.get(nextId);

    if (nextTask) {
      reasons.push(`${nextTask.title} depends on ${recommended.title}`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('No dependencies — ready to start');
  }

  return { task: recommended, reasons };
}

/** Convenience bundle of progress + recommendation + full task list — one call for a dashboard-style view. */
function getExecutionSummary(project: Project): ExecutionSummary {
  return {
    progress: getExecutionProgress(project),
    recommended: getNextRecommendedTask(project),
    tasks: getExecutionTasks(project),
  };
}

export const executionEngine = {
  getExecutionTasks,
  getTaskStatus,
  getBlockedReason,
  getExecutionProgress,
  getNextRecommendedTask,
  getExecutionSummary,
};
