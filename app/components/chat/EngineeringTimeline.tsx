import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { engineeringTimelineStore, type EngineeringTimelineEvent } from '~/lib/stores/engineeringTimeline';

const STATUS_ICON: Record<EngineeringTimelineEvent['status'], string> = {
  active: 'i-svg-spinners:3-dots-fade text-bolt-elements-item-contentAccent',
  done: 'i-ph:check-circle-fill text-green-500',
  failed: 'i-ph:x-circle-fill text-red-500',
};

/** Renders `engineeringTimelineStore` above the message list; hides itself entirely for chat sessions that never triggered code generation. */
export function EngineeringTimeline() {
  const events = useStore(engineeringTimelineStore);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-chat mx-auto mb-4 rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] bg-[#F7F7F8]/90 dark:bg-[#161616]/80 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2 px-1">
        Engineering Timeline
      </div>
      <div className="space-y-1.5">
        {events.map((event) => (
          <div key={event.id} className="flex items-start gap-2 px-1 py-0.5">
            <div className={classNames('w-4 h-4 mt-0.5 shrink-0', STATUS_ICON[event.status])} />
            <div className="min-w-0">
              <div
                className={classNames('text-xs font-medium', {
                  'text-bolt-elements-textPrimary': event.status !== 'failed',
                  'text-red-600 dark:text-red-400': event.status === 'failed',
                })}
              >
                {event.label}
              </div>
              {event.detail && (
                <div className="text-[11px] text-bolt-elements-textTertiary truncate">{event.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
