import type { ManifestFileCategory, ManifestFileStatus } from './manifestTypes';

/**
 * Generation Dashboard Stats — Sprint 44.2, Phase 4.
 *
 * Pure, deterministic aggregation over already-fetched manifest/generated-file rows —
 * per this phase's own "never calculate progress in the frontend... always derive it
 * from BuildersDB" principle, these functions never invent state: every count comes
 * directly from the `status`/`category` fields BuildersDB already persisted (Phase 1-3),
 * this module just aggregates what's already there. No network calls, no React.
 */

export interface FileForStats {
  status: ManifestFileStatus;
  category: ManifestFileCategory;
}

/** Statuses that count toward "complete" for the overall progress bar — the resume algorithm's own "trusted, no AI call needed" set (see resumeOrchestrator.ts's `classifyResumeAction`) plus 'complete' itself. */
const COMPLETE_STATUSES: ReadonlySet<ManifestFileStatus> = new Set(['complete', 'validated']);

/** Content has been produced but not yet validated. A real milestone — see `generated` below. */
const GENERATED_STATUSES: ReadonlySet<ManifestFileStatus> = new Set(['generated', 'validating', 'repairing']);

export interface ProgressSummary {
  total: number;
  completed: number;

  /** Files with content produced but not yet validated. Reported separately so "0% complete" never contradicts a visible "Generated: N". */
  generated: number;
  percent: number;

  /**
   * False when the manifest declares more files than there are rows to count — the signature of a
   * partial or failed manifest persist. The dashboard shows this rather than rendering a
   * confident percentage over an incomplete set.
   */
  reconciled: boolean;

  /** What the manifest row itself declares, when the caller supplied it. */
  declaredTotal?: number;
}

/**
 * Sprint 98A, BUG-013 — one authoritative source for every counter.
 *
 * Acceptance Test Round 1 displayed four disagreeing numbers at once: the manifest row said
 * `total_files: 80`, the dashboard's "Planned Files" table said 2, the database held 4 rows, and
 * the header read "0 / 2 files complete — 0%" while "Files by Status" simultaneously showed
 * "Generated: 2". Two separate defects produced that:
 *
 *   1. `total` was `files.length` — however many rows happened to be loaded — rather than what the
 *      manifest declares, so the denominator silently shrank to match whatever had persisted.
 *   2. `'generated'` counted as neither complete nor in-progress, so files that demonstrably had
 *      content rendered as 0%.
 *
 * `declaredTotal` (the manifest's own `totalFiles`) is now the denominator when supplied, and a
 * shortfall between it and the rows present is reported as `reconciled: false` instead of being
 * absorbed into a smaller total.
 */
export function computeProgress(files: FileForStats[], declaredTotal?: number): ProgressSummary {
  const rowCount = files.length;
  const total = declaredTotal !== undefined && declaredTotal > rowCount ? declaredTotal : rowCount;

  const completed = files.filter((file) => COMPLETE_STATUSES.has(file.status)).length;
  const generated = files.filter((file) => GENERATED_STATUSES.has(file.status)).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return {
    total,
    completed,
    generated,
    percent,
    reconciled: declaredTotal === undefined || declaredTotal === rowCount,
    declaredTotal,
  };
}

const STATUS_ORDER: ManifestFileStatus[] = [
  'complete',
  'validated',
  'repairing',
  'validating',
  'generating',
  'queued',
  'generated',
  'pending',
  'failed',
  'skipped',
  'superseded',
];

export function groupFilesByStatus(files: FileForStats[]): { status: ManifestFileStatus; count: number }[] {
  const counts = new Map<ManifestFileStatus, number>();

  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  }

  return STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

const CATEGORY_ORDER: ManifestFileCategory[] = [
  'pages',
  'components',
  'services',
  'types',
  'styles',
  'config',
  'documentation',
  'entry',
  'other',
];

export function groupFilesByCategory(files: FileForStats[]): { category: ManifestFileCategory; count: number }[] {
  const counts = new Map<ManifestFileCategory, number>();

  for (const file of files) {
    counts.set(file.category, (counts.get(file.category) ?? 0) + 1);
  }

  return CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0).map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
}

/**
 * A simple, honest linear estimate — NOT a real scheduler prediction (this phase
 * explicitly designs for, but does not implement, parallel/queued generation). Returns
 * `undefined` whenever there isn't enough signal yet (nothing completed, or nothing left
 * to do) rather than guessing.
 */
export function estimateRemainingMs(input: {
  completed: number;
  total: number;
  elapsedMs: number;
}): number | undefined {
  const remaining = input.total - input.completed;

  if (input.completed <= 0 || remaining <= 0 || input.elapsedMs <= 0) {
    return undefined;
  }

  const msPerFile = input.elapsedMs / input.completed;

  return Math.round(msPerFile * remaining);
}
