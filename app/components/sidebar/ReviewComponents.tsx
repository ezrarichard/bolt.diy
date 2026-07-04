import { classNames } from '~/utils/classNames';
import type { ReviewSummary, ReviewStatus, TaskHistoryEvent, TaskHistoryEventType } from '~/lib/projects/reviewEngine';

/**
 * Sprint 12 — reusable Review & Approval UI pieces (Task 9). Shared by
 * TaskDetailsDialog and ProjectDashboard so review presentation (badge
 * colors/labels, timeline event styling, the review-queue stat panel) is
 * defined exactly once rather than duplicated across surfaces.
 */

const REVIEW_BADGE_META: Record<'pending' | ReviewStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pending Review',
    className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10',
  },
  approved: {
    label: 'Approved',
    className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  'changes-requested': {
    label: 'Changes Requested',
    className: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  },
};

interface ReviewBadgeProps {
  status: 'pending' | ReviewStatus;
}

/** A small pill showing a review verdict — Pending Review / Approved / Changes Requested. */
export function ReviewBadge({ status }: ReviewBadgeProps) {
  const meta = REVIEW_BADGE_META[status];

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

const HISTORY_EVENT_META: Record<TaskHistoryEventType, { label: string; dotClass: string }> = {
  started: { label: 'Started', dotClass: 'bg-amber-500' },
  paused: { label: 'Paused', dotClass: 'bg-bolt-elements-textTertiary/50' },
  'submitted-for-review': { label: 'Submitted for Review', dotClass: 'bg-purple-500' },
  approved: { label: 'Approved', dotClass: 'bg-green-500' },
  'changes-requested': { label: 'Requested Changes', dotClass: 'bg-red-500' },
};

function formatHistoryTimestamp(at: string): string {
  const date = new Date(at);

  if (Number.isNaN(date.getTime())) {
    return at;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface ReviewTimelineProps {
  events: TaskHistoryEvent[];
}

/** A simple chronological timeline — Started / Paused / Submitted for Review / Approved / Requested Changes, with timestamps and optional notes. */
export function ReviewTimeline({ events }: ReviewTimelineProps) {
  if (events.length === 0) {
    return <div className="text-xs text-bolt-elements-textTertiary">No activity yet.</div>;
  }

  return (
    <div className="space-y-3">
      {events.map((event, index) => {
        const meta = HISTORY_EVENT_META[event.event];

        return (
          <div key={`${event.event}-${event.at}-${index}`} className="flex items-start gap-3">
            <span className={classNames('mt-1 w-2 h-2 rounded-full shrink-0', meta.dotClass)} />
            <div className="min-w-0">
              <div className="text-sm text-bolt-elements-textSecondary">{meta.label}</div>
              <div className="text-[11px] text-bolt-elements-textTertiary">{formatHistoryTimestamp(event.at)}</div>
              {event.note && <div className="text-xs text-bolt-elements-textSecondary mt-1">{event.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ReviewQueueCardProps {
  summary: ReviewSummary;
}

/** Dashboard panel (Sprint 12, Task 6) — Pending / Approved / Needs Changes counts for the review queue. */
export function ReviewQueueCard({ summary }: ReviewQueueCardProps) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 mb-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="text-[13px] font-semibold text-bolt-elements-textPrimary mb-3">Review Queue</div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-lg font-semibold text-purple-600 dark:text-purple-400">{summary.pending}</div>
          <div className="text-[11px] text-bolt-elements-textTertiary">Pending</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-green-600 dark:text-green-400">{summary.approved}</div>
          <div className="text-[11px] text-bolt-elements-textTertiary">Approved</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{summary.changesRequested}</div>
          <div className="text-[11px] text-bolt-elements-textTertiary">Needs Changes</div>
        </div>
      </div>
    </div>
  );
}
