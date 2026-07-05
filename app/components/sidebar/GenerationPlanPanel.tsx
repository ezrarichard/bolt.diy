import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { generationPlannerEngine, RECOMMENDED_MODEL_LABELS } from '~/lib/projects/generationPlannerEngine';
import { generationQueueEngine, type GenerationQueueStatus } from '~/lib/projects/generationQueueEngine';

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
    </div>
  );
}
