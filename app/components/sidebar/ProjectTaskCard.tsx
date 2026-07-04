import { classNames } from '~/utils/classNames';
import { setTaskStatus } from '~/lib/stores/projects';
import type { BlockingTask, ProjectTaskExecution, ProjectTaskStatus } from '~/lib/projects/executionEngine';
import type { TaskReviewRecord } from '~/lib/projects/reviewEngine';
import { projectKnowledgeEngine, type KnowledgeFieldKey } from '~/lib/projects/projectKnowledgeEngine';
import { ReviewBadge } from './ReviewComponents';

/**
 * Sprint 11 — status metadata shared by ProjectTaskCard, TaskDetailsDialog,
 * and the Execution Progress / Recommended Next Task panels in
 * ProjectDashboard, so the label/color for a given ProjectTaskStatus is
 * defined exactly once.
 */
export const TASK_STATUS_META: Record<ProjectTaskStatus, { label: string; dotClass: string; badgeClass: string }> = {
  'not-started': {
    label: 'Not Started',
    dotClass: 'bg-bolt-elements-textTertiary/50',
    badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
  ready: {
    label: 'Ready',
    dotClass: 'bg-blue-500',
    badgeClass: 'text-blue-600 dark:text-blue-400 border-blue-500/30',
  },
  'in-progress': {
    label: 'In Progress',
    dotClass: 'bg-amber-500',
    badgeClass: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  'needs-review': {
    label: 'Needs Review',
    dotClass: 'bg-purple-500',
    badgeClass: 'text-purple-600 dark:text-purple-400 border-purple-500/30',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30',
  },
  blocked: {
    label: 'Blocked',
    dotClass: 'bg-red-500',
    badgeClass: 'text-red-600 dark:text-red-400 border-red-500/30',
  },
};

/** Shared by ProjectTaskCard and TaskDetailsDialog so the estimate format is defined exactly once. */
export function formatEstimatedMinutes(minutes: number | undefined): string {
  if (!minutes) {
    return 'Not estimated';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

interface ProjectTaskCardProps {
  projectId: string;
  task: ProjectTaskExecution;
  dependencyTitles: string[];
  blockedBy: BlockingTask[];
  latestReview?: TaskReviewRecord;
  onOpenDetails: () => void;
}

/**
 * One Task Execution Plan card — title, category, dependencies, required
 * knowledge, output type, estimate, computed status, and (per Sprint 11)
 * lifecycle action buttons. Clicking anywhere on the card opens the Task
 * Details dialog (Task 3); action buttons stop propagation so they don't
 * also trigger that.
 */
export function ProjectTaskCard({
  projectId,
  task,
  dependencyTitles,
  blockedBy,
  latestReview,
  onOpenDetails,
}: ProjectTaskCardProps) {
  const meta = TASK_STATUS_META[task.status];

  const handleStart = (event: React.MouseEvent) => {
    event.stopPropagation();
    setTaskStatus(projectId, task.id, 'in-progress');
  };

  const handlePause = (event: React.MouseEvent) => {
    event.stopPropagation();
    setTaskStatus(projectId, task.id, 'not-started');
  };

  const handleSubmitForReview = (event: React.MouseEvent) => {
    event.stopPropagation();
    setTaskStatus(projectId, task.id, 'needs-review');
  };

  const handleViewDetails = (event: React.MouseEvent) => {
    event.stopPropagation();
    onOpenDetails();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className={classNames(
        'text-left rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 cursor-pointer',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'hover:border-purple-500/25 dark:hover:border-purple-500/20 transition-colors duration-200',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={classNames('w-2 h-2 rounded-full shrink-0', meta.dotClass)} />
          <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.status === 'in-progress' && latestReview?.reviewStatus === 'changes-requested' && (
            <ReviewBadge status="changes-requested" />
          )}
          <span
            className={classNames(
              'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
              meta.badgeClass,
            )}
          >
            {meta.label}
          </span>
        </div>
      </div>

      <div className="text-xs text-bolt-elements-textTertiary mb-3">{task.description}</div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <div>
          <span className="text-bolt-elements-textTertiary">Category: </span>
          <span className="text-bolt-elements-textSecondary capitalize">{task.category}</span>
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Output: </span>
          <span className="text-bolt-elements-textSecondary">{task.outputType}</span>
        </div>
        <div className="col-span-2">
          <span className="text-bolt-elements-textTertiary">Estimated: </span>
          <span className="text-bolt-elements-textSecondary">{formatEstimatedMinutes(task.estimatedMinutes)}</span>
        </div>
        <div className="col-span-2">
          <span className="text-bolt-elements-textTertiary">Dependencies: </span>
          <span className="text-bolt-elements-textSecondary">
            {dependencyTitles.length > 0 ? dependencyTitles.join(', ') : 'None'}
          </span>
        </div>
        {task.requiredKnowledge.length > 0 && (
          <div className="col-span-2 flex flex-wrap gap-1.5 mt-1">
            {task.requiredKnowledge.map((key) => (
              <span
                key={key}
                className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300"
              >
                {projectKnowledgeEngine.getFieldLabel(key as KnowledgeFieldKey)}
              </span>
            ))}
          </div>
        )}
      </div>

      {task.status === 'blocked' && blockedBy.length > 0 && (
        <div className="mt-3 pt-3 border-t border-bolt-elements-borderColor/30 text-[11px]">
          <span className="text-red-600 dark:text-red-400 font-medium">Blocked by: </span>
          <span className="text-bolt-elements-textSecondary">
            {blockedBy.map((dependency) => dependency.title).join(', ')}
          </span>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-bolt-elements-borderColor/30 flex flex-wrap items-center gap-2">
        {task.status === 'ready' && (
          <button
            type="button"
            onClick={handleStart}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
          >
            Start
          </button>
        )}
        {task.status === 'in-progress' && (
          <>
            <button
              type="button"
              onClick={handlePause}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={handleSubmitForReview}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            >
              Submit for Review
            </button>
          </>
        )}
        {task.status === 'needs-review' && (
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-300">
            Waiting for Approval
          </span>
        )}
        {task.status === 'completed' && (
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
            Completed
          </span>
        )}
        <button
          type="button"
          onClick={handleViewDetails}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
        >
          View Details
        </button>
      </div>
    </div>
  );
}
