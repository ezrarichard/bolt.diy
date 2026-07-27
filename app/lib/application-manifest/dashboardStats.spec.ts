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

    expect(result).toMatchObject({ total: 5, completed: 2, percent: 40, generated: 1, reconciled: true });
  });

  it('returns 0% for an empty file list rather than dividing by zero', () => {
    expect(computeProgress([])).toMatchObject({ total: 0, completed: 0, percent: 0, generated: 0 });
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

/**
 * Sprint 98A, BUG-013 — one authoritative source for every counter.
 *
 * Acceptance Test Round 1 displayed four disagreeing numbers simultaneously: manifest
 * `total_files: 80`, "Planned Files (2)", 4 rows in the database, and a header reading
 * "0 / 2 files complete — 0%" beside "Files by Status: Generated: 2".
 */
describe('computeProgress — BUG-013 reconciliation', () => {
  it('uses the manifest total as the denominator, not the number of rows loaded', () => {
    const files = [file('complete'), file('generated')];
    const result = computeProgress(files, 80);

    // The exact Round 1 shape: 80 declared, 2 rows present.
    expect(result.total).toBe(80);
    expect(result.declaredTotal).toBe(80);
    expect(result.reconciled).toBe(false);
  });

  it('reports generated files separately so 0% never contradicts a visible Generated count', () => {
    const files = [file('generated'), file('generated')];
    const result = computeProgress(files, 2);

    expect(result.completed).toBe(0);
    expect(result.generated).toBe(2);
    expect(result.reconciled).toBe(true);
  });

  it('counts in-flight validation and repair as generated, not as nothing', () => {
    const result = computeProgress([file('generated'), file('validating'), file('repairing')], 3);

    expect(result.generated).toBe(3);
  });

  it('is reconciled when the manifest total matches the rows present', () => {
    const files = [file('complete'), file('complete')];

    expect(computeProgress(files, 2)).toMatchObject({ total: 2, percent: 100, reconciled: true });
  });

  it('never shrinks the total below the rows actually present', () => {
    // A stale/incorrect declared total must not make progress look better than it is.
    const files = [file('complete'), file('complete'), file('pending')];

    expect(computeProgress(files, 1).total).toBe(3);
  });

  it('stays backward compatible when no declared total is supplied', () => {
    const files = [file('complete'), file('pending')];

    expect(computeProgress(files)).toMatchObject({ total: 2, completed: 1, percent: 50, reconciled: true });
  });
});
