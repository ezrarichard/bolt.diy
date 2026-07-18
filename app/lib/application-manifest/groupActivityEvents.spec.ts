import { describe, expect, it } from 'vitest';
import { groupActivityEvents } from './groupActivityEvents';

function event(activityType: string, description: string, createdAt = '2026-07-19T00:00:00.000Z') {
  return { activityType, description, createdAt };
}

describe('groupActivityEvents', () => {
  it('collapses consecutive repetitive events of the same type into one entry with a count', () => {
    const events = [
      event('generated_file_persisted', 'src/App.tsx persisted as v1'),
      event('generated_file_persisted', 'src/main.tsx persisted as v1'),
      event('generated_file_persisted', 'src/index.css persisted as v1'),
    ];

    const grouped = groupActivityEvents(events);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(3);
    expect(grouped[0].description).toBe('3 files generated');
  });

  it('never groups milestone events, even if they repeat', () => {
    const events = [
      event('generation_started', 'Code generation started'),
      event('generation_started', 'Code generation started again'),
    ];

    const grouped = groupActivityEvents(events);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((entry) => entry.count === 1)).toBe(true);
  });

  it('keeps a milestone event between two repetitive runs as a separate boundary (adjacency-based grouping, not global)', () => {
    const events = [
      event('generated_file_persisted', 'a'),
      event('generated_file_persisted', 'b'),
      event('manifest_superseded', 'v1 superseded by v2'),
      event('generated_file_persisted', 'c'),
    ];

    const grouped = groupActivityEvents(events);

    expect(grouped).toHaveLength(3);
    expect(grouped[0].count).toBe(2);
    expect(grouped[1].activityType).toBe('manifest_superseded');
    expect(grouped[2].count).toBe(1);
  });

  it('returns an empty array for no events', () => {
    expect(groupActivityEvents([])).toEqual([]);
  });

  it('passes through a single event unchanged (count: 1)', () => {
    const grouped = groupActivityEvents([event('manifest_resumed', 'Resuming v2')]);
    expect(grouped).toEqual([
      { activityType: 'manifest_resumed', description: 'Resuming v2', createdAt: '2026-07-19T00:00:00.000Z', count: 1 },
    ]);
  });
});
