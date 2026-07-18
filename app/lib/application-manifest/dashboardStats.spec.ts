import { describe, expect, it } from 'vitest';
import { computeProgress, estimateRemainingMs, groupFilesByCategory, groupFilesByStatus } from './dashboardStats';
import type { FileForStats } from './dashboardStats';

function file(status: FileForStats['status'], category: FileForStats['category'] = 'pages'): FileForStats {
  return { status, category };
}

describe('computeProgress', () => {
  it('counts complete and validated as completed, everything else as not', () => {
    const files = [file('complete'), file('validated'), file('generated'), file('pending'), file('failed')];
    const result = computeProgress(files);

    expect(result).toEqual({ total: 5, completed: 2, percent: 40 });
  });

  it('returns 0% for an empty file list rather than dividing by zero', () => {
    expect(computeProgress([])).toEqual({ total: 0, completed: 0, percent: 0 });
  });

  it('returns 100% when every file is complete', () => {
    const files = [file('complete'), file('validated'), file('complete')];
    expect(computeProgress(files).percent).toBe(100);
  });
});

describe('groupFilesByStatus', () => {
  it('groups and counts by status, in the defined display order, omitting statuses with zero files', () => {
    const files = [file('pending'), file('pending'), file('complete'), file('failed')];
    const groups = groupFilesByStatus(files);

    expect(groups).toEqual([
      { status: 'complete', count: 1 },
      { status: 'pending', count: 2 },
      { status: 'failed', count: 1 },
    ]);
  });

  it('includes queued when present (Sprint 44.2 Phase 4 addition)', () => {
    const groups = groupFilesByStatus([file('queued'), file('queued')]);
    expect(groups).toEqual([{ status: 'queued', count: 2 }]);
  });

  it('returns an empty array for no files', () => {
    expect(groupFilesByStatus([])).toEqual([]);
  });
});

describe('groupFilesByCategory', () => {
  it('groups and counts by category, omitting categories with zero files', () => {
    const files = [file('pending', 'pages'), file('pending', 'pages'), file('generated', 'types')];
    const groups = groupFilesByCategory(files);

    expect(groups).toEqual([
      { category: 'pages', count: 2 },
      { category: 'types', count: 1 },
    ]);
  });
});

describe('estimateRemainingMs', () => {
  it('estimates linearly from average time per completed file', () => {
    // 10 files done in 10,000ms => 1,000ms/file average; 5 remaining => 5,000ms estimate.
    const result = estimateRemainingMs({ completed: 10, total: 15, elapsedMs: 10_000 });
    expect(result).toBe(5000);
  });

  it('returns undefined when nothing has completed yet (no signal)', () => {
    expect(estimateRemainingMs({ completed: 0, total: 10, elapsedMs: 5000 })).toBeUndefined();
  });

  it('returns undefined when everything is already complete', () => {
    expect(estimateRemainingMs({ completed: 10, total: 10, elapsedMs: 5000 })).toBeUndefined();
  });

  it('returns undefined when no time has elapsed yet', () => {
    expect(estimateRemainingMs({ completed: 1, total: 10, elapsedMs: 0 })).toBeUndefined();
  });
});
