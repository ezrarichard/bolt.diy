import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import { getGenerationSession, type Project } from '~/lib/stores/projects';
import { generationPlannerEngine, RECOMMENDED_MODEL_LABELS } from '~/lib/projects/generationPlannerEngine';
import { generationQueueEngine, type GenerationQueueStatus } from '~/lib/projects/generationQueueEngine';
import { generationExecutionEngine, type ExecutionStrategy } from '~/lib/projects/generationExecutionEngine';
import { generationSessionEngine, type GenerationSessionStepStatus } from '~/lib/projects/generationSessionEngine';
import { generationRunner, type GenerationRunResult, type GeneratedFile } from '~/lib/projects/generationRunner';
import { CONTEXT_ROLE_LABELS, type ContextBudget } from '~/lib/projects/contextEngine';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import { formatEstimatedMinutes } from './ProjectTaskCard';

interface GenerationPlanPanelProps {
  project: Project;
}

interface StatProps {
  label: string;
  value: number;
  valueClassName?: string;
}

function Stat({ label, value, valueClassName }: StatProps) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-bolt-elements-background-depth-2/60',
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {label}
      </div>
      <div className={classNames('text-2xl font-semibold', valueClassName ?? 'text-bolt-elements-textPrimary')}>
        {value}
      </div>
    </div>
  );
}

/** Sprint 26 — badge styling for every GenerationQueueStatus. Only blocked/waiting/pending/ready are ever produced today; running/completed/failed/skipped are reserved for a future execution-state sprint but styled now so the badge map stays complete. */
const QUEUE_STATUS_META: Record<GenerationQueueStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
  waiting: { label: 'Waiting', className: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10' },
  ready: { label: 'Ready', className: 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10' },
  running: {
    label: 'Running',
    className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10',
  },
  completed: {
    label: 'Completed',
    className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  failed: { label: 'Failed', className: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10' },
  skipped: { label: 'Skipped', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
  blocked: { label: 'Blocked', className: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10' },
};

interface QueueStatusBadgeProps {
  status: GenerationQueueStatus;
  size?: 'sm' | 'xs';
}

function QueueStatusBadge({ status, size = 'sm' }: QueueStatusBadgeProps) {
  const meta = QUEUE_STATUS_META[status];

  return (
    <span
      className={classNames(
        'font-medium uppercase tracking-wide rounded-full border shrink-0',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

/** Sprint 27 — display labels for ExecutionStrategy, presentation only. */
const EXECUTION_STRATEGY_LABELS: Record<ExecutionStrategy, string> = {
  'single-shot': 'Single Shot',
  iterative: 'Iterative',
  'review-first': 'Review First',
  'parallel-safe': 'Parallel Safe',
};

const EXECUTION_STRATEGY_ORDER: ExecutionStrategy[] = ['review-first', 'iterative', 'parallel-safe', 'single-shot'];

/**
 * Sprint 28 — badge styling shared by session-level and step-level status,
 * since `GenerationSessionStepStatus` is a superset of `GenerationSessionStatus`
 * (it adds `blocked`/`waiting`/`skipped` on top of the same seven session
 * values) — one map safely covers both.
 */
const SESSION_STATUS_META: Record<GenerationSessionStepStatus, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
  blocked: { label: 'Blocked', className: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10' },
  waiting: { label: 'Waiting', className: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10' },
  ready: { label: 'Ready', className: 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10' },
  running: {
    label: 'Running',
    className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10',
  },
  paused: { label: 'Paused', className: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10' },
  completed: {
    label: 'Completed',
    className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  failed: { label: 'Failed', className: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10' },
  skipped: { label: 'Skipped', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
  cancelled: { label: 'Cancelled', className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50' },
};

function SessionStatusBadge({ status }: { status: GenerationSessionStepStatus }) {
  const meta = SESSION_STATUS_META[status];

  return (
    <span
      className={classNames(
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

/** Sprint 30 — display labels for ContextBudget, presentation only. */
const CONTEXT_BUDGET_LABELS: Record<ContextBudget, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  full: 'Full',
};

interface TagListProps {
  entries: [string, number][];
}

/** A compact "label (count)" chip row — reused for the Execution Strategy / Validation / Rollback summaries below. */
function TagList({ entries }: TagListProps) {
  if (entries.length === 0) {
    return <div className="text-xs text-bolt-elements-textTertiary">None</div>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([label, count]) => (
        <span
          key={label}
          className="px-2.5 py-1 rounded-full border border-bolt-elements-borderColor/50 text-xs text-bolt-elements-textSecondary"
        >
          {label} <span className="text-bolt-elements-textTertiary">({count})</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Sprint 30 — one row of the Prototype Generation Test's read-only file
 * list. Content is only ever shown inside a collapsed `<details>` preview —
 * never rendered open by default, never written anywhere.
 */
function GeneratedFileRow({ file }: { file: GeneratedFile }) {
  return (
    <li className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-sm font-mono text-bolt-elements-textPrimary break-all">{file.path}</span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary shrink-0">
          {file.language}
        </span>
      </div>
      <div className="text-xs text-bolt-elements-textSecondary mb-1">{file.purpose}</div>
      <div className="text-[11px] text-bolt-elements-textTertiary mb-2">
        {file.generatedBy} · {formatArtifactTimestamp(file.generatedAt)}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-bolt-elements-textTertiary select-none">Content preview</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-bolt-elements-background-depth-3 p-2 text-[11px] text-bolt-elements-textSecondary whitespace-pre-wrap">
          {file.content}
        </pre>
      </details>
    </li>
  );
}

/**
 * Sprint 25 — read-only view of `generationPlannerEngine.buildGenerationPlan()`.
 * No Generate button, no AI call, no code/file/config generation — this
 * only renders the deterministic plan (phases, dependency graph,
 * recommended generation order, readiness) so a human can review it before
 * any future sprint wires up real generation. Recomputed on every render
 * straight from `project`, same reactive pattern as ProjectManagerPanel.
 */
export function GenerationPlanPanel({ project }: GenerationPlanPanelProps) {
  const plan = generationPlannerEngine.buildGenerationPlan(project);
  const queue = generationQueueEngine.buildGenerationQueue(project);
  const nextItem = generationQueueEngine.getNextQueueItem(queue);
  const executionPlan = generationExecutionEngine.buildGenerationExecutionPlan(project);
  const persistedSession = getGenerationSession(project);
  const session = persistedSession ?? generationSessionEngine.createSession(project, executionPlan);
  const currentStep = generationSessionEngine.getCurrentStep(session);
  const remainingSteps = session.summary.waitingCount + session.summary.runningCount;

  /**
   * Sprint 30 — Prototype Generation Test. `generationRunner.getRunnableStep`
   * is reused unchanged (never re-derived here) to decide whether there is a
   * currently-runnable Foundation step; the section below only renders when
   * the Project Manager also reports the project ready for generation.
   */
  const { generate, isGenerating } = useGenerateText();
  const [testResult, setTestResult] = useState<GenerationRunResult | undefined>(undefined);
  const [isRunningTest, setIsRunningTest] = useState(false);

  const runnableCheck = generationRunner.getRunnableStep(session);
  const runnableFoundationStep = 'step' in runnableCheck ? runnableCheck.step : undefined;
  const runnableExecutionStep = runnableFoundationStep
    ? executionPlan.steps.find((step) => step.stepId === runnableFoundationStep.stepId)
    : undefined;
  const showPrototypeGenerationTest =
    plan.readyForGeneration && Boolean(runnableFoundationStep && runnableExecutionStep);

  async function handleRunFoundationGeneration() {
    setIsRunningTest(true);
    setTestResult(undefined);

    try {
      const result = await generationRunner.runFoundationGeneration({ project, session, generate });
      setTestResult(result);
    } finally {
      setIsRunningTest(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Stat label="Phases" value={plan.summary.totalPhases} />
        <Stat label="Modules" value={plan.summary.totalModules} />
        <Stat label="Generation Tasks" value={plan.summary.totalTasks} />
        <div
          className={classNames(
            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
            'bg-bolt-elements-background-depth-2/60',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Ready For Generation
          </div>
          <span
            className={classNames(
              'text-sm font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border',
              plan.readyForGeneration
                ? 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10'
                : 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
            )}
          >
            {plan.readyForGeneration ? 'YES' : 'NOT READY'}
          </span>
        </div>
      </div>

      {!plan.readyForGeneration && plan.readinessBlockers.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1.5">
            Blockers
          </div>
          <ul className="space-y-1">
            {plan.readinessBlockers.map((reason) => (
              <li key={reason} className="text-xs text-bolt-elements-textSecondary flex gap-1.5">
                <span className="i-ph:x-circle-duotone w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Dependency Graph Summary
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.phases.map((phase, index) => (
            <span key={phase.id} className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-bolt-elements-borderColor/50 text-xs text-bolt-elements-textSecondary">
                {phase.title}
                <span className="text-[10px] text-bolt-elements-textTertiary">({phase.moduleIds.length})</span>
              </span>
              {index < plan.phases.length - 1 && (
                <span className="i-ph:arrow-right w-3 h-3 text-bolt-elements-textTertiary/50" />
              )}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Recommended Generation Order
        </div>
        <ol className="space-y-1.5">
          {plan.modules.map((module, index) => (
            <li key={module.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-5 h-5 shrink-0 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 flex items-center justify-center text-[10px] text-bolt-elements-textTertiary">
                {index + 1}
              </span>
              <span className="text-bolt-elements-textSecondary font-medium">{module.title}</span>
              <span className="text-bolt-elements-textTertiary">
                {RECOMMENDED_MODEL_LABELS[module.tasks[0]?.recommendedModel ?? 'claude-sonnet-5']}
              </span>
              {module.origin === 'default' && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary">
                  Default
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="text-[11px] text-bolt-elements-textTertiary">
        Estimated files across all modules: ~{plan.summary.totalEstimatedFiles}. This is a deterministic plan only — no
        code, file, or configuration has been generated.
      </div>

      {/* Generation Queue — Sprint 26, read-only orchestrator preview */}
      <div className="pt-5 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Generation Queue</div>
          <QueueStatusBadge status={queue.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Total Items" value={queue.summary.totalItems} />
          <Stat label="Ready" value={queue.summary.readyCount} valueClassName="text-blue-600 dark:text-blue-400" />
          <Stat
            label="Waiting"
            value={queue.summary.waitingCount}
            valueClassName="text-amber-600 dark:text-amber-400"
          />
          <Stat label="Blocked" value={queue.summary.blockedCount} valueClassName="text-red-600 dark:text-red-400" />
          <Stat label="Pending" value={queue.summary.pendingCount} />
          <Stat
            label="Completed"
            value={queue.summary.completedCount}
            valueClassName="text-green-600 dark:text-green-400"
          />
          <Stat label="Failed" value={queue.summary.failedCount} valueClassName="text-red-600 dark:text-red-400" />
          <Stat label="Skipped" value={queue.summary.skippedCount} />
        </div>

        {!queue.canStart && queue.readinessBlockers.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1.5">
              Queue Not Startable
            </div>
            <ul className="space-y-1">
              {queue.readinessBlockers.map((reason) => (
                <li key={reason} className="text-xs text-bolt-elements-textSecondary flex gap-1.5">
                  <span className="i-ph:x-circle-duotone w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {nextItem && (
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 px-3.5 py-2.5 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-1">
              Next Item
            </div>
            <div className="text-sm text-bolt-elements-textPrimary font-medium">{nextItem.title}</div>
            <div className="text-xs text-bolt-elements-textTertiary mt-0.5">
              {RECOMMENDED_MODEL_LABELS[nextItem.recommendedModel]} · {nextItem.reason}
            </div>
          </div>
        )}

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Phases
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {queue.phases.map((phase) => (
            <span
              key={phase.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-bolt-elements-borderColor/50 text-xs text-bolt-elements-textSecondary"
            >
              {phase.title}
              <QueueStatusBadge status={phase.status} size="xs" />
            </span>
          ))}
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Items
        </div>
        <ol className="space-y-1.5">
          {queue.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-5 h-5 shrink-0 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 flex items-center justify-center text-[10px] text-bolt-elements-textTertiary">
                {item.order}
              </span>
              <span className="text-bolt-elements-textSecondary font-medium">{item.title}</span>
              <QueueStatusBadge status={item.status} />
              <span className="text-bolt-elements-textTertiary">{RECOMMENDED_MODEL_LABELS[item.recommendedModel]}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
          Read-only preview of the orchestration queue — no item has run, and nothing here starts, calls a model, or
          creates a file. There is no Start button yet.
        </div>
      </div>

      {/* Execution Plan — Sprint 27, read-only workflow preview */}
      <div className="pt-5 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Execution Plan</div>
          <span
            className={classNames(
              'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
              executionPlan.ready
                ? 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10'
                : 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
            )}
          >
            {executionPlan.ready ? 'Ready' : 'Not Ready'}
          </span>
        </div>

        <div className="text-xs text-bolt-elements-textSecondary mb-1">{executionPlan.reason}</div>
        <div className="text-[11px] text-bolt-elements-textTertiary mb-4">
          Execution ID: <span className="font-mono">{executionPlan.executionId}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Steps" value={executionPlan.summary.totalSteps} />
          <Stat label="Prompts" value={executionPlan.summary.totalEstimatedPrompts} />
          <Stat label="Files" value={executionPlan.summary.totalEstimatedFiles} />
          <div
            className={classNames(
              'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
              'bg-bolt-elements-background-depth-2/60',
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
              Duration
            </div>
            <div className="text-2xl font-semibold text-bolt-elements-textPrimary">
              {formatEstimatedMinutes(executionPlan.summary.totalEstimatedDurationMinutes)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Recommended Default Model
            </div>
            <div className="text-sm text-bolt-elements-textPrimary font-medium">
              {RECOMMENDED_MODEL_LABELS[executionPlan.recommendedDefaultModel]}
            </div>
          </div>
          <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Selected Model
            </div>
            {/* Sprint 30.5 — static label only; the caret is a placeholder for a future model-selector dropdown, not a working control yet. */}
            <div
              className="flex items-center justify-between gap-2 text-sm text-bolt-elements-textPrimary font-medium"
              title="Model selection coming soon"
            >
              {RECOMMENDED_MODEL_LABELS[executionPlan.selectedModel]}
              <span className="i-ph:caret-down w-3.5 h-3.5 text-bolt-elements-textTertiary/60 shrink-0" />
            </div>
            <div className="text-[10px] text-bolt-elements-textTertiary mt-0.5">Use Recommended</div>
          </div>
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Execution Strategy
        </div>
        <div className="mb-4">
          <TagList
            entries={EXECUTION_STRATEGY_ORDER.filter(
              (strategy) => executionPlan.summary.executionStrategyCounts[strategy] > 0,
            ).map((strategy) => [
              EXECUTION_STRATEGY_LABELS[strategy],
              executionPlan.summary.executionStrategyCounts[strategy],
            ])}
          />
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Validation Summary
        </div>
        <div className="mb-4">
          <TagList entries={Object.entries(executionPlan.summary.validationStrategyCounts)} />
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Rollback Summary
        </div>
        <TagList entries={Object.entries(executionPlan.summary.rollbackStrategyCounts)} />

        <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
          Read-only execution plan — no model has been called, no prompt has been created, and no file has been
          generated. There is no Start button yet.
        </div>
      </div>

      {/* Execution Session — Sprint 28, read-only session preview */}
      <div className="pt-5 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Execution Session</div>
          <SessionStatusBadge status={session.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Progress" value={session.overallProgress} valueClassName="text-blue-600 dark:text-blue-400" />
          <Stat
            label="Completed"
            value={session.summary.completedCount}
            valueClassName="text-green-600 dark:text-green-400"
          />
          <Stat label="Remaining" value={remainingSteps} />
          <div
            className={classNames(
              'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
              'bg-bolt-elements-background-depth-2/60',
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
              Est. Remaining
            </div>
            <div className="text-2xl font-semibold text-bolt-elements-textPrimary">
              {formatEstimatedMinutes(session.summary.estimatedRemainingMinutes)}
            </div>
          </div>
        </div>

        {currentStep && (
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 px-3.5 py-2.5 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-1">
              Current Step
            </div>
            <div className="text-sm text-bolt-elements-textPrimary font-medium">{currentStep.moduleName}</div>
            <div className="text-xs text-bolt-elements-textTertiary mt-0.5">{currentStep.lastMessage}</div>
          </div>
        )}

        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Session Timeline
        </div>
        <ol className="space-y-1.5">
          {session.steps.map((step, index) => (
            <li key={step.stepId} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-5 h-5 shrink-0 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 flex items-center justify-center text-[10px] text-bolt-elements-textTertiary">
                {index + 1}
              </span>
              <span className="text-bolt-elements-textSecondary font-medium">{step.moduleName}</span>
              <SessionStatusBadge status={step.status} />
              <span className="text-bolt-elements-textTertiary">{step.lastMessage}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
          {persistedSession
            ? 'Persisted session snapshot.'
            : 'Live preview — no session has been created or saved yet.'}{' '}
          Nothing here executes, calls a model, or creates a file. There is no Start, Pause, or Resume button yet.
        </div>
      </div>

      {/* Prototype Generation Test — Sprint 30, internal/manual validation of generationRunner.runFoundationGeneration only */}
      {showPrototypeGenerationTest && runnableFoundationStep && runnableExecutionStep && (
        <div className="pt-5 border-t border-bolt-elements-borderColor/30">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <div className="text-sm font-semibold text-bolt-elements-textPrimary">Prototype Generation Test</div>
            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10">
              Prototype Mode
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border text-bolt-elements-textTertiary border-bolt-elements-borderColor/50">
              Internal Prototype Test
            </span>
          </div>
          <div className="text-[11px] text-bolt-elements-textTertiary mb-4">
            Not production generation — manually invokes the Foundation Generation Runner (Sprint 29) for validation
            only. No project data is changed by this section.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Current Runnable Step
              </div>
              <div className="text-sm text-bolt-elements-textPrimary font-medium">
                {runnableFoundationStep.moduleName}
              </div>
            </div>
            <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Selected Model
              </div>
              {/* Sprint 30.5 — static label only; the caret is a placeholder for a future model-selector dropdown, not a working control yet. */}
              <div
                className="flex items-center justify-between gap-2 text-sm text-bolt-elements-textPrimary font-medium"
                title="Model selection coming soon"
              >
                {RECOMMENDED_MODEL_LABELS[runnableFoundationStep.selectedModel]}
                <span className="i-ph:caret-down w-3.5 h-3.5 text-bolt-elements-textTertiary/60 shrink-0" />
              </div>
            </div>
            <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Recommended Model
              </div>
              <div className="text-sm text-bolt-elements-textPrimary font-medium">
                {RECOMMENDED_MODEL_LABELS[runnableFoundationStep.recommendedModel]}
              </div>
            </div>
            <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Context Role
              </div>
              <div className="text-sm text-bolt-elements-textPrimary font-medium">
                {CONTEXT_ROLE_LABELS[runnableExecutionStep.contextRole]}
              </div>
            </div>
            <div className="rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5 sm:col-span-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                Context Budget
              </div>
              <div className="text-sm text-bolt-elements-textPrimary font-medium">
                {CONTEXT_BUDGET_LABELS[runnableExecutionStep.contextBudget]}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 mb-4">
            <div className="text-xs text-amber-700 dark:text-amber-300 flex gap-1.5">
              <span className="i-ph:warning-duotone w-3.5 h-3.5 shrink-0 mt-0.5" />
              This will generate Foundation files in memory only. Nothing is written to disk.
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunFoundationGeneration}
            disabled={isRunningTest || isGenerating}
            className={classNames(
              'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
              isRunningTest || isGenerating
                ? 'opacity-60 cursor-not-allowed border-bolt-elements-borderColor/40 text-bolt-elements-textTertiary'
                : 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-300 hover:bg-purple-500/20',
            )}
          >
            {isRunningTest || isGenerating ? 'Running Foundation Generation…' : 'Run Foundation Generation'}
          </button>

          {testResult && (
            <div className="mt-4">
              {testResult.success ? (
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10">
                      Success
                    </span>
                    <span className="text-[11px] text-bolt-elements-textTertiary">
                      {testResult.files.length} file(s) · ~{testResult.tokens} tokens · {testResult.duration}ms
                    </span>
                  </div>

                  {testResult.warnings.length > 0 && (
                    <ul className="space-y-1 mb-3">
                      {testResult.warnings.map((warning) => (
                        <li key={warning} className="text-xs text-amber-600 dark:text-amber-400 flex gap-1.5">
                          <span className="i-ph:warning-duotone w-3.5 h-3.5 shrink-0 mt-0.5" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}

                  <ul className="space-y-2">
                    {testResult.files.map((file) => (
                      <GeneratedFileRow key={file.id} file={file} />
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1.5">
                    Generation Failed
                  </div>
                  <ul className="space-y-1">
                    {testResult.errors.map((error, index) => (
                      <li key={`${error.code}-${index}`} className="text-xs text-bolt-elements-textSecondary">
                        <span className="font-mono text-red-600 dark:text-red-400">{error.code}</span> — {error.message}
                      </li>
                    ))}
                  </ul>
                  {testResult.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {testResult.warnings.map((warning) => (
                        <li key={warning} className="text-xs text-amber-600 dark:text-amber-400">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {testResult.rawResponseText && (
                <details className="mt-3 rounded-lg border border-bolt-elements-borderColor/40 px-3.5 py-2.5">
                  <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
                    Raw Claude Response (temp diagnostic — before JSON parsing)
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-bolt-elements-background-depth-3 p-2 text-[11px] text-bolt-elements-textSecondary whitespace-pre-wrap">
                    {testResult.rawResponseText}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
            Internal validation only — results are held in this panel's local state and are discarded on refresh. No
            project data, workspace file, preview, git, or Supabase state is touched by this section.
          </div>
        </div>
      )}
    </div>
  );
}
