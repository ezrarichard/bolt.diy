import { blueprintEngine } from '~/lib/blueprints';
import { getRoadmapItemStatus, type Project } from '~/lib/stores/projects';
import { TASK_REGISTRY, type TaskDefinition } from './taskRegistry';

/**
 * Project Task Engine — Phase 3.
 *
 * The execution model that sits between the Roadmap and future AI
 * generation:
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap
 *     -> Project Task Engine (this file) -> AI Generation
 *
 * A blueprint's Roadmap (app/lib/blueprints/registry.ts) describes coarse
 * lifecycle steps ("Homepage", "Checkout", "Deployment"). The Task Engine
 * breaks each of those steps down into concrete, dependency-ordered units of
 * work — several tasks can share one `roadmapKey` (e.g. "Homepage" and
 * "Hero" both roll up under the "homepage" roadmap step).
 *
 * Nothing here calls an LLM, generates code, or writes a prompt — every
 * function is a pure read over TASK_REGISTRY (taskRegistry.ts) plus, where a
 * task's live status is needed, the project's own `roadmapStatus` (see
 * app/lib/stores/projects.ts). No React, no stores, no side effects. UI
 * components should always go through `projectTaskEngine` below rather than
 * importing taskRegistry.ts directly, mirroring `blueprintEngine`.
 */

export interface ProjectTask {
  id: string;
  roadmapKey: string;
  title: string;
  description: string;
  category: 'planning' | 'design' | 'database' | 'frontend' | 'backend' | 'integration' | 'deployment';
  dependsOn: string[];
  requiredKnowledge: string[];
  outputType: string;
  aiAction: string;
  nextTasks: string[];
  estimatedMinutes?: number;
  enabled?: boolean;
}

/**
 * A task's computed execution status:
 *  - `completed`: its roadmap step is marked completed on the project.
 *  - `ready`: every dependency is completed (or it has none) — can start now.
 *  - `blocked`: waiting on dependencies that are themselves ready/completed
 *    (i.e. the immediate next thing standing in the way).
 *  - `future`: waiting on dependencies that are further out (blocked/future
 *    themselves) — not actionable yet, even indirectly.
 */
export type ProjectTaskStatus = 'completed' | 'ready' | 'blocked' | 'future';

export interface ProjectTaskWithStatus extends ProjectTask {
  status: ProjectTaskStatus;
}

export interface TaskCompletion {
  overall: number;
  completedCount: number;
  totalCount: number;
}

function resolveBlueprintId(blueprintId: string | undefined): string {
  if (blueprintId && TASK_REGISTRY[blueprintId]) {
    return blueprintId;
  }

  return blueprintEngine.getDefaultBlueprint().id;
}

/**
 * Computes `nextTasks` (the reverse of `dependsOn`) once per blueprint so it
 * never has to be hand-maintained in taskRegistry.ts. Cached because it's a
 * pure function of static data — never recomputed per render/project.
 */
const builtTasksCache = new Map<string, ProjectTask[]>();

function buildTasks(definitions: TaskDefinition[]): ProjectTask[] {
  const nextTasksById = new Map<string, string[]>(definitions.map((definition) => [definition.id, []]));

  for (const definition of definitions) {
    for (const dependencyId of definition.dependsOn) {
      nextTasksById.get(dependencyId)?.push(definition.id);
    }
  }

  return definitions.map((definition) => ({
    ...definition,
    nextTasks: nextTasksById.get(definition.id) ?? [],
  }));
}

function getBuiltTasks(blueprintId: string): ProjectTask[] {
  const cached = builtTasksCache.get(blueprintId);

  if (cached) {
    return cached;
  }

  const built = buildTasks(TASK_REGISTRY[blueprintId] ?? []);
  builtTasksCache.set(blueprintId, built);

  return built;
}

/** All tasks defined for a blueprint, in registry order. Falls back to the default blueprint's tasks. */
function getTasks(blueprintId: string | undefined): ProjectTask[] {
  return getBuiltTasks(resolveBlueprintId(blueprintId));
}

/** One task by id within a blueprint's task list. */
function getTask(blueprintId: string | undefined, taskId: string): ProjectTask | undefined {
  return getTasks(blueprintId).find((task) => task.id === taskId);
}

/** The resolved dependency tasks (not just ids) for one task. */
function getDependencies(blueprintId: string | undefined, taskId: string): ProjectTask[] {
  const tasks = getTasks(blueprintId);
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return [];
  }

  return task.dependsOn
    .map((dependencyId) => tasks.find((candidate) => candidate.id === dependencyId))
    .filter((candidate): candidate is ProjectTask => Boolean(candidate));
}

/** The resolved tasks (not just ids) that become available once this task is done. */
function getNextTasks(blueprintId: string | undefined, taskId: string): ProjectTask[] {
  const tasks = getTasks(blueprintId);
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return [];
  }

  return task.nextTasks
    .map((nextId) => tasks.find((candidate) => candidate.id === nextId))
    .filter((candidate): candidate is ProjectTask => Boolean(candidate));
}

function getOutputType(blueprintId: string | undefined, taskId: string): string | undefined {
  return getTask(blueprintId, taskId)?.outputType;
}

function getRequiredKnowledge(blueprintId: string | undefined, taskId: string): string[] {
  return getTask(blueprintId, taskId)?.requiredKnowledge ?? [];
}

function getEstimatedTime(blueprintId: string | undefined, taskId: string): number | undefined {
  return getTask(blueprintId, taskId)?.estimatedMinutes;
}

/**
 * Depth-first status computation with memoization and cycle protection.
 * `visiting` catches a task that (directly or indirectly) depends on itself —
 * treated as `future` rather than looping forever; the registry is static
 * and should never actually produce a cycle.
 */
function computeTaskStatus(
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

  if (visiting.has(task.id)) {
    return 'future';
  }

  if (getRoadmapItemStatus(project, task.roadmapKey) === 'completed') {
    memo.set(task.id, 'completed');
    return 'completed';
  }

  if (task.dependsOn.length === 0) {
    memo.set(task.id, 'ready');
    return 'ready';
  }

  visiting.add(task.id);

  const dependencyStatuses = task.dependsOn.map((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId);
    return dependencyTask ? computeTaskStatus(project, dependencyTask, tasksById, memo, visiting) : 'completed';
  });

  visiting.delete(task.id);

  let status: ProjectTaskStatus;

  if (dependencyStatuses.every((dependencyStatus) => dependencyStatus === 'completed')) {
    status = 'ready';
  } else if (
    dependencyStatuses.every((dependencyStatus) => dependencyStatus === 'completed' || dependencyStatus === 'ready')
  ) {
    status = 'blocked';
  } else {
    status = 'future';
  }

  memo.set(task.id, status);

  return status;
}

/** Every task for the project's blueprint, with its live status attached. */
function getTasksWithStatus(project: Project): ProjectTaskWithStatus[] {
  const tasks = getTasks(project.blueprintId);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, ProjectTaskStatus>();
  const visiting = new Set<string>();

  return tasks.map((task) => ({
    ...task,
    status: computeTaskStatus(project, task, tasksById, memo, visiting),
  }));
}

function getReadyTasks(project: Project): ProjectTaskWithStatus[] {
  return getTasksWithStatus(project).filter((task) => task.status === 'ready');
}

function getBlockedTasks(project: Project): ProjectTaskWithStatus[] {
  return getTasksWithStatus(project).filter((task) => task.status === 'blocked');
}

/** Overall task completion for the project — same shape/rounding convention as projectKnowledgeEngine.getCompletion(). */
function getCompletion(project: Project): TaskCompletion {
  const tasks = getTasksWithStatus(project);
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const totalCount = tasks.length;

  return {
    overall: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
    completedCount,
    totalCount,
  };
}

export const projectTaskEngine = {
  getTasks,
  getTask,
  getNextTasks,
  getDependencies,
  getBlockedTasks,
  getReadyTasks,
  getCompletion,
  getEstimatedTime,
  getOutputType,
  getRequiredKnowledge,
  getTasksWithStatus,
};
