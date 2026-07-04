import { blueprintEngine } from '~/lib/blueprints';
import { TASK_REGISTRY, type TaskDefinition } from './taskRegistry';

/**
 * Project Task Engine — Phase 3 (Sprint 10).
 *
 * The static execution model that sits between the Roadmap and future AI
 * generation:
 *
 *   Blueprint -> Requirements -> Project Knowledge -> Roadmap
 *     -> Project Task Engine (this file) -> Execution Engine -> AI Generation
 *
 * A blueprint's Roadmap (app/lib/blueprints/registry.ts) describes coarse
 * lifecycle steps ("Homepage", "Checkout", "Deployment"). The Task Engine
 * breaks each of those steps down into concrete, dependency-ordered units of
 * work — several tasks can share one `roadmapKey` (e.g. "Homepage" and
 * "Hero" both roll up under the "homepage" roadmap step).
 *
 * This file only answers "what tasks exist and how are they related" —
 * every function is a pure read over TASK_REGISTRY (taskRegistry.ts), with
 * no notion of a specific project's progress. "Where does a given project
 * currently stand on each task" (status, blocked reasons, execution
 * progress, recommended next task) is a separate, per-project concern —
 * see app/lib/projects/executionEngine.ts (Sprint 11), which is built on
 * top of this file rather than duplicating its registry access. No React,
 * no stores, no side effects. UI components should always go through
 * `projectTaskEngine` below rather than importing taskRegistry.ts directly,
 * mirroring `blueprintEngine`.
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

export const projectTaskEngine = {
  getTasks,
  getTask,
  getNextTasks,
  getDependencies,
  getEstimatedTime,
  getOutputType,
  getRequiredKnowledge,
};
