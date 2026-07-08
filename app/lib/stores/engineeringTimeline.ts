import { atom } from 'nanostores';

/**
 * Drives the left-pane Engineering Timeline shown once code generation starts from the
 * Project Dashboard/Product Package (see useCodeGeneration.ts, EngineeringTimeline.tsx).
 * Deliberately a small standalone store rather than piggy-backing on `chatStore`'s
 * `messages` (owned by useChat/@ai-sdk/react, which round-trips through the chat API) —
 * generation events aren't chat turns, just local progress state to render alongside it.
 */

export type EngineeringTimelineStatus = 'active' | 'done' | 'failed';

export interface EngineeringTimelineEvent {
  id: string;
  label: string;
  detail?: string;
  status: EngineeringTimelineStatus;
  timestamp: number;
}

export const engineeringTimelineStore = atom<EngineeringTimelineEvent[]>([]);

export function resetEngineeringTimeline(): void {
  engineeringTimelineStore.set([]);
}

/**
 * Adds or updates the entry identified by `id`. Any other entry still `active` is
 * settled to `done` first, since a new/updated entry means the pipeline has moved on.
 */
export function upsertEngineeringTimelineEvent(
  id: string,
  patch: { label: string; status: EngineeringTimelineStatus; detail?: string },
): void {
  const current = engineeringTimelineStore.get();
  const settled = current.map((event) =>
    event.status === 'active' && event.id !== id ? { ...event, status: 'done' as const } : event,
  );
  const index = settled.findIndex((event) => event.id === id);
  const nextEvent: EngineeringTimelineEvent = { id, timestamp: Date.now(), ...patch };

  if (index === -1) {
    engineeringTimelineStore.set([...settled, nextEvent]);
  } else {
    const next = [...settled];
    next[index] = nextEvent;
    engineeringTimelineStore.set(next);
  }
}
