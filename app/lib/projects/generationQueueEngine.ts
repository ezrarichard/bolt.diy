import type { Project } from '~/lib/stores/projects';
import type { ContextBudget, ContextRole } from './contextEngine';
import {
  generationPlannerEngine,
  type GenerationComplexity,
  type GenerationMode,
  type GenerationPhaseId,
  type RecommendedModel,
} from './generationPlannerEngine';

/**
 * Generation Queue Engine — Sprint 26 ("Generation Queue / Orchestrator
 * Foundation").
 *
 *   ... -> Project Manager -> Generation Planner Engine (Sprint 25)
 *     -> Generation Queue Engine (this file) -> Generation Engine (future)
 *
 * The Planner (generationPlannerEngine.ts) decides WHAT would be generated
 * and in what dependency order. This engine takes that same plan and
 * decides WHERE EACH ITEM CURRENTLY STANDS — ready to run, waiting on a
 * dependency, queued behind an earlier item, or blocked because the project
 * isn't ready for generation. It is the orchestrator's read model, not the
 * orchestrator: nothing here starts, runs, or simulates running anything.
 *
 * Pure and deterministic, same guarantees as the Planner: no React, no
 * nanostore subscriptions, no AI/provider imports, no network, no
 * filesystem access, no synchronous or async side effects. It never
 * duplicates planning logic — every queue item is a 1:1 read of one
 * `GenerationModule` from `generationPlannerEngine.buildGenerationPlan()`,
 * and readiness is still only ever read from `GenerationPlan.readyForGeneration`
 * (itself read from `projectManagerEngine.isReadyForGeneration`) — never
 * recomputed here.
 *
 * No persistence: there is no execution history anywhere yet, so every item
 * is evaluated fresh from the plan's dependency graph on every call, as if
 * nothing has ever run. `running` / `completed` / `failed` / `skipped` are
 * part of `GenerationQueueStatus` for forward-compatibility with a future
 * sprint that persists real execution state (see the "Future execution-state
 * integration" note in the accompanying report) — this engine itself only
 * ever produces `blocked`, `waiting`, `pending`, or `ready`.
 */

export type GenerationQueueStatus =
  | 'pending'
  | 'waiting'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked';

export interface GenerationQueueItem {
  /** Same id as the GenerationModule it wraps — one queue item per module (each module has exactly one GenerationTask today). */
  id: string;
  taskId: string;
  phaseId: GenerationPhaseId;
  title: string;
  status: GenerationQueueStatus;

  /** 1-based position in the overall queue — matches the Planner's `recommendedGenerationOrder`. */
  order: number;
  dependsOn: string[];
  unblocks: string[];
  recommendedModel: RecommendedModel;
  complexity: GenerationComplexity;
  generationMode: GenerationMode;
  contextBudget: ContextBudget;
  requiredContextRoles: ContextRole[];

  /** Human-readable explanation of why this item currently has this status. */
  reason: string;
}

export interface GenerationQueuePhase {
  id: GenerationPhaseId;
  title: string;
  itemIds: string[];

  /** Rolled up from this phase's items — see `rollupStatus` below. */
  status: GenerationQueueStatus;
}

export interface GenerationQueueSummary {
  totalItems: number;
  readyCount: number;
  pendingCount: number;
  waitingCount: number;
  blockedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  nextItemId: string | undefined;
}

/**
 * A deterministic, synthetic explanation trail for the current snapshot —
 * one entry per item, in queue order. Not a persisted history (nothing is
 * stored between calls); rebuilt fresh every time from the same reasoning
 * used for each item's `status`/`reason`.
 */
export interface GenerationQueueEvent {
  itemId: string;
  status: GenerationQueueStatus;
  message: string;
}

export interface GenerationQueue {
  projectId: string;
  status: GenerationQueueStatus;

  /** True only when the project is ready for generation AND at least one item is currently `ready`. */
  canStart: boolean;

  /** Copied from GenerationPlan.readinessBlockers — never recomputed here. */
  readinessBlockers: string[];
  items: GenerationQueueItem[];
  phases: GenerationQueuePhase[];
  summary: GenerationQueueSummary;
  events: GenerationQueueEvent[];
}

/**
 * Priority order used to roll many item statuses up into one phase/queue
 * status. Most-actionable-first: an in-progress or failed item is always
 * worth surfacing over a merely-ready one; `completed`/`skipped` only win
 * when literally everything else is one of those two.
 */
const STATUS_ROLLUP_PRIORITY: GenerationQueueStatus[] = [
  'failed',
  'running',
  'ready',
  'pending',
  'waiting',
  'blocked',
  'skipped',
  'completed',
];

function rollupStatus(statuses: GenerationQueueStatus[]): GenerationQueueStatus {
  for (const candidate of STATUS_ROLLUP_PRIORITY) {
    if (statuses.includes(candidate)) {
      return candidate;
    }
  }

  return 'pending';
}

function computeSummary(items: GenerationQueueItem[]): GenerationQueueSummary {
  const countWhere = (status: GenerationQueueStatus) => items.filter((item) => item.status === status).length;

  return {
    totalItems: items.length,
    readyCount: countWhere('ready'),
    pendingCount: countWhere('pending'),
    waitingCount: countWhere('waiting'),
    blockedCount: countWhere('blocked'),
    runningCount: countWhere('running'),
    completedCount: countWhere('completed'),
    failedCount: countWhere('failed'),
    skippedCount: countWhere('skipped'),
    nextItemId: items.find((item) => item.status === 'ready')?.id,
  };
}

/**
 * Builds the read-only generation queue for a project. Reuses
 * `generationPlannerEngine.buildGenerationPlan()` unchanged — every module,
 * dependency edge, and model/complexity/context classification comes
 * straight from the Planner; this function only decides each module's
 * current queue status.
 *
 * Status rule, evaluated once per item in Planner order (no persisted
 * completion state exists, so "dependency satisfied" always means "has no
 * dependencies" in practice today — this still walks the graph explicitly
 * so it keeps working once execution state is layered on top):
 *   - project not ready for generation -> `blocked`
 *   - a dependency hasn't completed -> `waiting`
 *   - dependencies satisfied and no earlier item is still un-started -> `ready` (at most one such item)
 *   - dependencies satisfied but an earlier item hasn't started yet -> `pending`
 */
function buildGenerationQueue(project: Project): GenerationQueue {
  const plan = generationPlannerEngine.buildGenerationPlan(project);
  const titleById = new Map(plan.modules.map((module) => [module.id, module.title]));

  /** Always empty this sprint — no execution has ever happened. Kept as an explicit set (not just "assume none") so a future sprint can pass in real completed ids without changing this function's logic. */
  const completedIds = new Set<string>();

  let readyAssigned = false;

  const items: GenerationQueueItem[] = plan.modules.map((module, index) => {
    const task = module.tasks[0];
    const dependsOn = module.dependencies.dependsOn;
    const unmetDependencies = dependsOn.filter((dependencyId) => !completedIds.has(dependencyId));

    let status: GenerationQueueStatus;
    let reason: string;

    if (!plan.readyForGeneration) {
      status = 'blocked';
      reason = 'Project is not ready for generation yet — see Project Manager blockers.';
    } else if (unmetDependencies.length > 0) {
      status = 'waiting';

      const unmetTitles = unmetDependencies.map((id) => titleById.get(id) ?? id);
      reason = `Waiting on ${unmetDependencies.length} upstream module(s): ${unmetTitles.join(', ')}.`;
    } else if (!readyAssigned) {
      status = 'ready';
      reason = 'Next in the generation queue — no unmet dependencies.';
      readyAssigned = true;
    } else {
      status = 'pending';
      reason = 'Dependencies satisfied — queued behind an earlier module.';
    }

    return {
      id: module.id,
      taskId: task.id,
      phaseId: module.phaseId,
      title: module.title,
      status,
      order: index + 1,
      dependsOn,
      unblocks: module.dependencies.unblocks,
      recommendedModel: task.recommendedModel,
      complexity: task.complexity,
      generationMode: task.generationMode,
      contextBudget: task.contextBudget,
      requiredContextRoles: task.requiredContextRoles,
      reason,
    };
  });

  const itemsById = new Map(items.map((item) => [item.id, item]));

  const phases: GenerationQueuePhase[] = plan.phases.map((phase) => ({
    id: phase.id,
    title: phase.title,
    itemIds: phase.moduleIds,
    status: rollupStatus(phase.moduleIds.map((id) => itemsById.get(id)?.status ?? 'blocked')),
  }));

  const summary = computeSummary(items);

  return {
    projectId: project.id,
    status: rollupStatus(items.map((item) => item.status)),
    canStart: plan.readyForGeneration && summary.readyCount > 0,
    readinessBlockers: plan.readinessBlockers,
    items,
    phases,
    summary,
    events: items.map((item) => ({ itemId: item.id, status: item.status, message: item.reason })),
  };
}

function getReadyQueueItems(queue: GenerationQueue): GenerationQueueItem[] {
  return queue.items.filter((item) => item.status === 'ready');
}

function getBlockedQueueItems(queue: GenerationQueue): GenerationQueueItem[] {
  return queue.items.filter((item) => item.status === 'blocked');
}

/** Always empty today — no execution state is persisted yet. Exposed now so callers/tests have a stable API once a future sprint adds real completion. */
function getCompletedQueueItems(queue: GenerationQueue): GenerationQueueItem[] {
  return queue.items.filter((item) => item.status === 'completed');
}

/** The single item that would run next, or undefined if nothing is ready (queue blocked, empty, or already fully queued/completed). */
function getNextQueueItem(queue: GenerationQueue): GenerationQueueItem | undefined {
  return queue.items.find((item) => item.id === queue.summary.nextItemId);
}

function getQueueSummary(queue: GenerationQueue): GenerationQueueSummary {
  return queue.summary;
}

/** Whether the queue for this project could be started right now — same underlying signal as `buildGenerationQueue(project).canStart`, exposed standalone so callers don't need to build the full queue just to check this. */
function canStartQueue(project: Project): boolean {
  return buildGenerationQueue(project).canStart;
}

/** Whether a specific queue item could run right now — true only for the single current `ready` item. */
function canRunQueueItem(queue: GenerationQueue, itemId: string): boolean {
  return queue.items.find((item) => item.id === itemId)?.status === 'ready';
}

export const generationQueueEngine = {
  buildGenerationQueue,
  getReadyQueueItems,
  getBlockedQueueItems,
  getCompletedQueueItems,
  getNextQueueItem,
  getQueueSummary,
  canStartQueue,
  canRunQueueItem,
};
