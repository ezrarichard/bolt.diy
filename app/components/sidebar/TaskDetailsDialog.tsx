import { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import {
  applyReviewDecision,
  getTaskHistory,
  getTaskNotes,
  getTaskReview,
  setTaskNotes,
  setTaskStatus,
  type Project,
} from '~/lib/stores/projects';
import type { BlockingTask, ProjectTaskExecution } from '~/lib/projects/executionEngine';
import { reviewEngine } from '~/lib/projects/reviewEngine';
import { projectKnowledgeEngine, type KnowledgeFieldKey } from '~/lib/projects/projectKnowledgeEngine';
import { formatEstimatedMinutes, TASK_STATUS_META } from './ProjectTaskCard';
import { ReviewBadge, ReviewTimeline } from './ReviewComponents';

interface TaskDetailsDialogProps {
  project: Project | null;
  task: ProjectTaskExecution | null;
  dependencyTitles: string[];
  nextTaskTitles: string[];
  blockedBy: BlockingTask[];
  open: boolean;
  onClose: () => void;
}

interface DetailRowProps {
  label: string;
  value: string;
  capitalize?: boolean;
  span2?: boolean;
}

/** One label/value pair in the Task Details grid — reused for every metadata field. */
function DetailRow({ label, value, capitalize, span2 }: DetailRowProps) {
  return (
    <div className={span2 ? 'col-span-2' : undefined}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
        {label}
      </div>
      <div className={classNames('text-sm text-bolt-elements-textSecondary', capitalize && 'capitalize')}>{value}</div>
    </div>
  );
}

/**
 * Sprint 11, Task 3 — full Task Details dialog. Reuses the same visual
 * language as the Project Dashboard (dark cards, rounded panels, purple
 * accents). Notes are saved on blur; the three lifecycle actions
 * (Start/Pause/Submit for Review) call the same store setter the task
 * card's buttons use, so the dialog and card can never disagree about how
 * a transition happens. No AI, no generated content.
 */
export function TaskDetailsDialog({
  project,
  task,
  dependencyTitles,
  nextTaskTitles,
  blockedBy,
  open,
  onClose,
}: TaskDetailsDialogProps) {
  const [notes, setNotes] = useState('');
  const [reviewComment, setReviewComment] = useState('');

  useEffect(() => {
    if (open && project && task) {
      setNotes(getTaskNotes(project, task.id));
      setReviewComment('');
    }
  }, [open, project, task]);

  if (!project || !task) {
    return null;
  }

  const meta = TASK_STATUS_META[task.status];
  const latestReview = getTaskReview(project, task.id);
  const history = getTaskHistory(project, task.id);

  const saveNotes = () => {
    setTaskNotes(project.id, task.id, notes);
  };

  const handleStart = () => setTaskStatus(project.id, task.id, 'in-progress');
  const handlePause = () => setTaskStatus(project.id, task.id, 'not-started');
  const handleSubmitForReview = () => setTaskStatus(project.id, task.id, 'needs-review');

  /**
   * Sprint 12 — Approve/Request Changes compute their decision purely via
   * reviewEngine (task becomes Completed + roadmap auto-completed +
   * artifact placeholder created, or task returns to In Progress), then
   * hand that decision to the store to persist in one atomic update.
   */
  const handleApprove = () => {
    const decision = reviewEngine.approveTask(project, task.id, reviewComment.trim() || undefined);

    if (decision) {
      applyReviewDecision(project.id, decision);
      setReviewComment('');
    }
  };

  const handleRequestChanges = () => {
    const decision = reviewEngine.rejectTask(project, task.id, reviewComment.trim() || undefined);

    if (decision) {
      applyReviewDecision(project.id, decision);
      setReviewComment('');
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[120] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={onClose} className="relative z-[121]">
            <div
              className={classNames(
                'w-[640px] max-w-[92vw] max-h-[88vh]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              {/* Header */}
              <div className="px-8 pt-7 pb-5 border-b border-bolt-elements-borderColor/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <RadixDialog.Title className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary">
                        {task.title}
                      </RadixDialog.Title>
                      <span
                        className={classNames(
                          'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
                          meta.badgeClass,
                        )}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <RadixDialog.Description className="text-sm text-bolt-elements-textTertiary mt-1">
                      {task.description}
                    </RadixDialog.Description>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200 shrink-0"
                  >
                    <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
                <div
                  className={classNames(
                    'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                    'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                    'grid grid-cols-2 gap-5',
                  )}
                >
                  <DetailRow label="Category" value={task.category} capitalize />
                  <DetailRow label="Output Type" value={task.outputType} />
                  <DetailRow label="Estimated Time" value={formatEstimatedMinutes(task.estimatedMinutes)} />
                  <DetailRow label="Current Status" value={meta.label} />
                  <DetailRow
                    label="Dependencies"
                    value={dependencyTitles.length > 0 ? dependencyTitles.join(', ') : 'None'}
                    span2
                  />
                  <DetailRow
                    label="Next Tasks"
                    value={nextTaskTitles.length > 0 ? nextTaskTitles.join(', ') : 'None'}
                    span2
                  />
                  {task.requiredKnowledge.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
                        Knowledge Required
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {task.requiredKnowledge.map((key) => (
                          <span
                            key={key}
                            className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300"
                          >
                            {projectKnowledgeEngine.getFieldLabel(key as KnowledgeFieldKey)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {task.status === 'blocked' && blockedBy.length > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1.5">
                      Blocked By
                    </div>
                    <div className="text-sm text-bolt-elements-textSecondary">
                      {blockedBy.map((dependency) => dependency.title).join(', ')}
                    </div>
                  </div>
                )}

                {/* Latest Review — Sprint 12 */}
                {latestReview && (
                  <div
                    className={classNames(
                      'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
                      'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
                        Latest Review
                      </div>
                      <ReviewBadge status={latestReview.reviewStatus} />
                    </div>
                    <div className="text-xs text-bolt-elements-textTertiary">
                      {latestReview.reviewedBy} · {new Date(latestReview.reviewedAt).toLocaleString()}
                    </div>
                    {latestReview.reviewNotes && (
                      <div className="text-sm text-bolt-elements-textSecondary mt-2">{latestReview.reviewNotes}</div>
                    )}
                  </div>
                )}

                {/* Reviewer Comments — Sprint 12, shown while a decision can be made */}
                {reviewEngine.canApprove(project, task.id) && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
                      Reviewer Comments
                    </div>
                    <textarea
                      className={classNames(
                        'w-full bg-gray-50 dark:bg-bolt-elements-background-depth-2 px-3 py-2 rounded-lg',
                        'focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm min-h-[72px] resize-y',
                        'text-gray-900 dark:text-bolt-elements-textPrimary placeholder-gray-500 dark:placeholder-bolt-elements-textTertiary',
                        'border border-gray-200 dark:border-bolt-elements-borderColor',
                      )}
                      placeholder="Optional — recorded with your Approve or Request Changes decision."
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                    />
                  </div>
                )}

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
                    Notes
                  </div>
                  <textarea
                    className={classNames(
                      'w-full bg-gray-50 dark:bg-bolt-elements-background-depth-2 px-3 py-2 rounded-lg',
                      'focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm min-h-[120px] resize-y',
                      'text-gray-900 dark:text-bolt-elements-textPrimary placeholder-gray-500 dark:placeholder-bolt-elements-textTertiary',
                      'border border-gray-200 dark:border-bolt-elements-borderColor',
                    )}
                    placeholder="Add notes for this task (markdown supported). A future AI Project Manager will read these — nothing here is sent to AI yet."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    onBlur={saveNotes}
                  />
                </div>

                {/* History — Sprint 12, Task 4 */}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                    History
                  </div>
                  <ReviewTimeline events={history} />
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-8 py-4 border-t border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40">
                {task.status === 'in-progress' && (
                  <button
                    onClick={handlePause}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                  >
                    Pause
                  </button>
                )}
                {task.status === 'ready' && (
                  <button
                    onClick={handleStart}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                  >
                    Start
                  </button>
                )}
                {task.status === 'in-progress' && (
                  <button
                    onClick={handleSubmitForReview}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                  >
                    Submit for Review
                  </button>
                )}
                {task.status === 'needs-review' && (
                  <>
                    <button
                      onClick={handleRequestChanges}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                    >
                      Request Changes
                    </button>
                    <button
                      onClick={handleApprove}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-purple-500 text-white hover:bg-purple-600"
                    >
                      Approve
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-bolt-elements-textPrimary"
                >
                  Close
                </button>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
