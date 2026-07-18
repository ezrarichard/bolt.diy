/**
 * Activity Timeline Grouping — Sprint 44.2, Phase 4.
 *
 * `getProjectActivity()` (buildersDbRepository.ts) returns every raw activity row,
 * newest-first — during a real generation run that's easily 30+ rows (one per file
 * persisted/reused/failed, one per stage-completed tick). This phase's own instruction
 * ("avoid hundreds of repetitive rows... group events") is implemented here as a pure,
 * deterministic collapse of consecutive same-type REPETITIVE events into one summarized
 * entry — milestone events (generation started, manifest created/superseded/resumed,
 * failures, preview ready) are never grouped, so the timeline still reads as a real
 * narrative, not just noise removed.
 */

export interface RawActivityEvent {
  activityType: string;
  description: string;
  createdAt: string;
}

export interface GroupedActivityEvent {
  activityType: string;
  description: string;
  createdAt: string;
  count: number;
}

/** Activity types repetitive enough (one per file, one per stage tick) to collapse when they repeat back-to-back. Every other type is treated as a milestone and never grouped. */
const REPETITIVE_TYPES = new Set([
  'generation_stage_completed',
  'generated_file_persisted',
  'generated_file_reused',
  'generated_file_failed',
  'generated_file_unchanged',
]);

const GROUPED_LABELS: Record<string, (count: number) => string> = {
  generation_stage_completed: (count) => `${count} stage update${count === 1 ? '' : 's'}`,
  generated_file_persisted: (count) => `${count} file${count === 1 ? '' : 's'} generated`,
  generated_file_reused: (count) => `${count} file${count === 1 ? '' : 's'} reused (unchanged)`,
  generated_file_failed: (count) => `${count} file${count === 1 ? '' : 's'} failed`,
  generated_file_unchanged: (count) => `${count} file${count === 1 ? '' : 's'} unchanged`,
};

/** Collapses consecutive same-type repetitive events (see REPETITIVE_TYPES) into one entry with a count; every other event passes through unchanged. Assumes `events` is already ordered (newest-first, matching getProjectActivity()'s own order) — grouping is purely adjacency-based, not a full type-wide aggregate, so a milestone event between two repetitive runs correctly keeps them as separate groups. */
export function groupActivityEvents(events: RawActivityEvent[]): GroupedActivityEvent[] {
  const grouped: GroupedActivityEvent[] = [];

  for (const event of events) {
    const last = grouped[grouped.length - 1];

    if (last && last.activityType === event.activityType && REPETITIVE_TYPES.has(event.activityType)) {
      last.count += 1;
      last.description = GROUPED_LABELS[event.activityType]?.(last.count) ?? `${last.count} event(s)`;
      continue;
    }

    grouped.push({
      activityType: event.activityType,
      description: event.description,
      createdAt: event.createdAt,
      count: 1,
    });
  }

  return grouped;
}
