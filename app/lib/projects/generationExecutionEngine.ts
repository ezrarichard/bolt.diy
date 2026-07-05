import type { Project } from '~/lib/stores/projects';
import type { ContextBudget, ContextRole } from './contextEngine';
import {
  generationPlannerEngine,
  type GenerationComplexity,
  type GenerationDependency,
  type GenerationMode,
  type GenerationPhaseId,
  type GenerationPlan,
  type RecommendedModel,
} from './generationPlannerEngine';
import { generationQueueEngine, type GenerationQueue, type GenerationQueueStatus } from './generationQueueEngine';

/**
 * Generation Execution Engine — Sprint 27 ("Generation Execution Engine —
 * Execution Planning Only").
 *
 *   ... -> Generation Planner Engine (Sprint 25) -> Generation Queue Engine
 *     (Sprint 26) -> Generation Execution Engine (this file) -> Generation Engine (future)
 *
 * The Planner decides WHAT would be generated and in what dependency order.
 * The Queue decides WHERE EACH ITEM CURRENTLY STANDS (ready/waiting/pending/
 * blocked). This engine is the workflow layer on top of both: for each item
 * it plans HOW it would be executed — which model, which execution/
 * validation/rollback strategy, and a rough cost estimate (files/prompts/
 * duration) — without ever executing anything.
 *
 * Pure and deterministic, same guarantees as the Planner and Queue: no
 * React, no nanostore subscriptions, no AI/provider imports, no network, no
 * filesystem access. It never recalculates dependencies or queue status —
 * every step's `status`/order comes straight from
 * `generationQueueEngine.buildGenerationQueue()`, and every step's
 * files/description/dependency-graph shape comes straight from
 * `generationPlannerEngine.buildGenerationPlan()`. The only thing this
 * engine computes fresh is the execution-workflow classification described
 * below (model/strategy/validation/rollback/estimates) — that classification
 * did not exist in either upstream engine.
 *
 * `executionId`/`createdAt` are freshly minted per call (same convention as
 * `createArtifact`/`createPlaceholderArtifact` in artifacts.ts) — they stamp
 * the identity/timestamp of a given plan snapshot, not project state, so
 * "deterministic" here means "identical `steps`/`summary`/`ready` for
 * identical project state," not "byte-identical output on every call."
 *
 * Model recommendation is exactly that — a recommendation. Nothing here
 * enforces it, invokes it, or removes the ability for a future UI to
 * override it; see `selectedModel` below, which exists specifically so that
 * override point already has somewhere to live.
 */

export type ExecutionStrategy = 'single-shot' | 'iterative' | 'review-first' | 'parallel-safe';

const EXECUTION_STRATEGIES: ExecutionStrategy[] = ['single-shot', 'iterative', 'review-first', 'parallel-safe'];

export interface GenerationExecutionStep {
  stepId: string;
  moduleId: string;
  moduleName: string;
  phase: GenerationPhaseId;

  /** This engine's own model classification — see `deriveRecommendedModel` below for how it can differ from the Planner's coarser per-task recommendation (only in the documentation-dominated case). */
  recommendedModel: RecommendedModel;

  /** The role whose perspective this step is generated from — the last (most specific) entry of the underlying task's `requiredContextRoles`, not a recalculation. */
  contextRole: ContextRole;
  contextBudget: ContextBudget;
  generationMode: GenerationMode;
  complexity: GenerationComplexity;

  /** Read straight from the Planner's module — never recalculated here. */
  dependencies: GenerationDependency;
  estimatedFiles: number;
  estimatedPrompts: number;
  estimatedDurationMinutes: number;
  executionStrategy: ExecutionStrategy;

  /** Descriptions only — no validation actually runs. See file header. */
  validationStrategy: string[];

  /** Descriptions only — no rollback actually runs. See file header. */
  rollbackStrategy: string[];

  /** Read straight from the matching Generation Queue item — never recalculated here. */
  status: GenerationQueueStatus;
}

export interface GenerationExecutionSummary {
  totalSteps: number;
  totalEstimatedPrompts: number;
  totalEstimatedFiles: number;
  totalEstimatedDurationMinutes: number;
  executionStrategyCounts: Record<ExecutionStrategy, number>;
  validationStrategyCounts: Record<string, number>;
  rollbackStrategyCounts: Record<string, number>;
}

export interface GenerationExecutionPlan {
  executionId: string;
  projectId: string;
  createdAt: string;

  /** Rolled up from the underlying Generation Queue — never recalculated here. */
  status: GenerationQueueStatus;

  /** Same signal as `GenerationQueue.canStart` — reused, not recomputed. */
  ready: boolean;
  reason: string;
  steps: GenerationExecutionStep[];
  summary: GenerationExecutionSummary;

  /** The engine's own pick — what would be used unless a step says otherwise. */
  recommendedDefaultModel: RecommendedModel;

  /** Defaults to `recommendedDefaultModel` today. This is the field a future model-override UI will write to — see file header. */
  selectedModel: RecommendedModel;
}

/**
 * Foundation/Deployment touch the whole project, so a human should look
 * before continuing; Frontend modules (pages) are typically independent of
 * each other within a phase, so they're safe to treat as parallel; Testing
 * is inherently a write/run/refine loop; Backend/Database escalate from a
 * single pass to an iterate-and-refine loop once a module gets complex.
 */
function deriveExecutionStrategy(phaseId: GenerationPhaseId, complexity: GenerationComplexity): ExecutionStrategy {
  switch (phaseId) {
    case 'foundation':
    case 'deployment':
      return 'review-first';

    case 'frontend':
      return 'parallel-safe';

    case 'testing':
      return 'iterative';

    case 'backend':
    case 'database':
      return complexity === 'high' ? 'iterative' : 'single-shot';

    default: {
      const exhaustiveCheck: never = phaseId;
      return exhaustiveCheck;
    }
  }
}

/** Base checks per phase, plus an extra Architecture Review once a module is complex enough to warrant one — descriptions only, nothing here runs a check. */
const BASE_VALIDATION_STRATEGY: Record<GenerationPhaseId, string[]> = {
  foundation: ['Self Review', 'Dependency Validation'],
  database: ['Self Review', 'Type Check', 'Dependency Validation'],
  backend: ['Self Review', 'Compile Check', 'Type Check', 'Dependency Validation'],
  frontend: ['Self Review', 'Compile Check', 'Type Check'],
  testing: ['Self Review', 'QA Review'],
  deployment: ['Self Review', 'Dependency Validation', 'Human Approval Required'],
};

function deriveValidationStrategy(phaseId: GenerationPhaseId, complexity: GenerationComplexity): string[] {
  const strategy = [...BASE_VALIDATION_STRATEGY[phaseId]];

  if (complexity === 'high' && !strategy.includes('Architecture Review')) {
    strategy.push('Architecture Review');
  }

  return strategy;
}

/** Ordered "try this, then this" sequence — project-wide work escalates straight to restoring/manual review rather than discarding, since it touches more than one module's output. Descriptions only, nothing here runs a rollback. */
function deriveRollbackStrategy(generationMode: GenerationMode, complexity: GenerationComplexity): string[] {
  const strategy = ['Retry Same Prompt', 'Escalate Model'];

  if (generationMode === 'project-wide') {
    strategy.push('Restore Previous Version', 'Manual Review');
  } else {
    strategy.push('Discard Generated Files');

    if (complexity === 'high') {
      strategy.push('Manual Review');
    }
  }

  return strategy;
}

/** Rough, deterministic prompt-count estimate — scales with how much a step touches, not a real call count. */
function estimatePrompts(complexity: GenerationComplexity, generationMode: GenerationMode): number {
  if (generationMode === 'project-wide') {
    return 3;
  }

  if (generationMode === 'multi-module') {
    return complexity === 'high' ? 4 : 3;
  }

  if (generationMode === 'feature-slice') {
    return complexity === 'high' ? 3 : 2;
  }

  return 1;
}

/** Rough, deterministic duration estimate in minutes — scales with mode/complexity/file count, not a measurement of anything real. */
function estimateDurationMinutes(
  complexity: GenerationComplexity,
  generationMode: GenerationMode,
  estimatedFiles: number,
): number {
  const base =
    generationMode === 'project-wide'
      ? 8
      : generationMode === 'multi-module'
        ? 6
        : generationMode === 'feature-slice'
          ? 4
          : 2;
  const complexityBump = complexity === 'high' ? 4 : complexity === 'medium' ? 2 : 0;

  return base + complexityBump + Math.ceil(estimatedFiles / 2);
}

/**
 * This engine's own model recommendation — deliberately not a hardcoded
 * default and never enforced (see `selectedModel` on the plan). Reuses the
 * Planner's already-computed complexity/generationMode rather than
 * reclassifying a module from scratch, and adds one genuinely new check on
 * top: a module whose files are dominated by the `documentation` file
 * group recommends Fable ("creative/documentation work"), matching the
 * recommendation rules this sprint adds. No phase's fixed file template
 * produces a documentation-dominated module today (Foundation pairs 2
 * configuration files with only 1 documentation file, so configuration
 * dominates) — this is a real, reachable rule, just not one today's
 * deterministic templates happen to trigger yet.
 */
function deriveRecommendedModel(
  files: { group: string; estimatedCount: number }[],
  complexity: GenerationComplexity,
  generationMode: GenerationMode,
): RecommendedModel {
  const totalFiles = files.reduce((sum, file) => sum + file.estimatedCount, 0);
  const documentationFiles = files
    .filter((file) => file.group === 'documentation')
    .reduce((sum, file) => sum + file.estimatedCount, 0);
  const isDocumentationDominated = totalFiles > 0 && documentationFiles / totalFiles > 0.5;

  if (isDocumentationDominated) {
    return 'claude-fable-5';
  }

  if (generationMode === 'project-wide' || (complexity === 'high' && generationMode === 'multi-module')) {
    return 'claude-opus-4-8';
  }

  if (complexity === 'low' && generationMode === 'single-file') {
    return 'claude-haiku-4-5-20251001';
  }

  return 'claude-sonnet-5';
}

function countByLabel(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function countByExecutionStrategy(values: ExecutionStrategy[]): Record<ExecutionStrategy, number> {
  const counts = Object.fromEntries(EXECUTION_STRATEGIES.map((strategy) => [strategy, 0])) as Record<
    ExecutionStrategy,
    number
  >;

  for (const value of values) {
    counts[value] += 1;
  }

  return counts;
}

function buildExecutionSteps(plan: GenerationPlan, queue: GenerationQueue): GenerationExecutionStep[] {
  const queueItemsById = new Map(queue.items.map((item) => [item.id, item]));

  return plan.modules.map((module) => {
    const task = module.tasks[0];
    const queueItem = queueItemsById.get(module.id);
    const estimatedFiles = module.files.reduce((sum, file) => sum + file.estimatedCount, 0);
    const contextRole = task.requiredContextRoles[task.requiredContextRoles.length - 1] ?? 'business-analyst';

    return {
      stepId: `${module.id}-step`,
      moduleId: module.id,
      moduleName: module.title,
      phase: module.phaseId,
      recommendedModel: deriveRecommendedModel(module.files, task.complexity, task.generationMode),
      contextRole,
      contextBudget: task.contextBudget,
      generationMode: task.generationMode,
      complexity: task.complexity,
      dependencies: module.dependencies,
      estimatedFiles,
      estimatedPrompts: estimatePrompts(task.complexity, task.generationMode),
      estimatedDurationMinutes: estimateDurationMinutes(task.complexity, task.generationMode, estimatedFiles),
      executionStrategy: deriveExecutionStrategy(module.phaseId, task.complexity),
      validationStrategy: deriveValidationStrategy(module.phaseId, task.complexity),
      rollbackStrategy: deriveRollbackStrategy(task.generationMode, task.complexity),

      /** Blocked is the safe fallback if a module somehow has no matching queue item — should not happen, since the Queue is built from this same Planner output. */
      status: queueItem?.status ?? 'blocked',
    };
  });
}

/**
 * Builds the read-only execution plan for a project. Reuses
 * `generationPlannerEngine.buildGenerationPlan()` (module/file/dependency
 * detail) and `generationQueueEngine.buildGenerationQueue()` (order/status/
 * readiness) unchanged — this function only adds the execution-workflow
 * classification neither of those engines computes.
 */
function buildGenerationExecutionPlan(project: Project): GenerationExecutionPlan {
  const plan = generationPlannerEngine.buildGenerationPlan(project);
  const queue = generationQueueEngine.buildGenerationQueue(project);
  const steps = buildExecutionSteps(plan, queue);

  const summary: GenerationExecutionSummary = {
    totalSteps: steps.length,
    totalEstimatedPrompts: steps.reduce((sum, step) => sum + step.estimatedPrompts, 0),
    totalEstimatedFiles: steps.reduce((sum, step) => sum + step.estimatedFiles, 0),
    totalEstimatedDurationMinutes: steps.reduce((sum, step) => sum + step.estimatedDurationMinutes, 0),
    executionStrategyCounts: countByExecutionStrategy(steps.map((step) => step.executionStrategy)),
    validationStrategyCounts: countByLabel(steps.flatMap((step) => step.validationStrategy)),
    rollbackStrategyCounts: countByLabel(steps.flatMap((step) => step.rollbackStrategy)),
  };

  const nextStep = steps.find((step) => step.status === 'ready');
  const recommendedDefaultModel = nextStep?.recommendedModel ?? 'claude-sonnet-5';
  const ready = queue.canStart;

  const reason = ready
    ? `Ready — ${summary.totalSteps} execution step(s) queued, starting with "${nextStep?.moduleName ?? 'the first step'}".`
    : queue.readinessBlockers.length > 0
      ? `${queue.readinessBlockers.length} blocker(s) from Project Manager: ${queue.readinessBlockers.join(' ')}`
      : 'Not ready — no executable steps.';

  return {
    executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    status: queue.status,
    ready,
    reason,
    steps,
    summary,
    recommendedDefaultModel,
    selectedModel: recommendedDefaultModel,
  };
}

export const generationExecutionEngine = {
  buildGenerationExecutionPlan,
};
