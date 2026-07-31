/**
 * Project Lifecycle — Active / Archived / Deleted.
 *
 * Pure functions over `Project` data: no store, no repository, no React, so every rule here is
 * unit-testable on its own. The store (app/lib/stores/projects.ts) applies these decisions; this
 * module only decides.
 *
 * ## No migration
 *
 * `builders_projects.status` already exists (`text not null default 'active'`) and has no check
 * constraint — it was written as a hardcoded `'active'` and never read back. Lifecycle uses that
 * column, so nothing here needs a schema change. The timestamps and the pin flag fold into the
 * existing `metadata` jsonb, the same convention `regionalSelection`, `packageSelection` and
 * `databaseActivation` already use.
 *
 * ## Nothing is ever destroyed implicitly
 *
 * `deleted` is a soft state — a recycle bin. Rows are only ever removed by an explicit, separately
 * confirmed permanent delete. No automatic path in Builders can reach permanent deletion.
 */

import type { Project } from '~/lib/stores/projects';

export type ProjectStatus = 'active' | 'archived' | 'deleted';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'archived', 'deleted'] as const;

/** Anything unrecognised (or absent, on a row written before lifecycle existed) reads as active. */
export function resolveProjectStatus(project: Pick<Project, 'status'>): ProjectStatus {
  const status = project.status;
  return status === 'archived' || status === 'deleted' ? status : 'active';
}

export type ProjectFilter = ProjectStatus | 'all';

export function matchesFilter(project: Pick<Project, 'status'>, filter: ProjectFilter): boolean {
  return filter === 'all' || resolveProjectStatus(project) === filter;
}

/** Legal transitions. Permanent deletion is NOT a status — it removes the row and is handled separately. */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  active: ['archived', 'deleted'],
  archived: ['active', 'deleted'],

  /* A deleted project restores to active — never silently back to archived, which would hide it again. */
  deleted: ['active'],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return from !== to && ALLOWED_TRANSITIONS[from].includes(to);
}

// ── Pinning (bonus) ──────────────────────────────────────────────────────

export function isPinned(project: Pick<Project, 'pinnedAt'>): boolean {
  return Boolean(project.pinnedAt);
}

/**
 * Pinned first (most recently pinned wins among them), then by recency.
 *
 * `updatedAt` is preferred over `createdAt` so a long-running project that was worked on today
 * outranks one created today and abandoned — but it falls back to `createdAt`, because rows
 * written before lifecycle tracking have no `updatedAt` of their own.
 */
export function sortProjectsForDisplay<T extends Pick<Project, 'pinnedAt' | 'createdAt' | 'updatedAt'>>(
  projects: T[],
): T[] {
  return [...projects].sort((a, b) => {
    if (isPinned(a) !== isPinned(b)) {
      return isPinned(a) ? -1 : 1;
    }

    if (isPinned(a) && isPinned(b)) {
      return (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '');
    }

    return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
  });
}

// ── Temporary-project classification (Phase 1 / Phase 4) ─────────────────

export type CleanupCategory =
  | 'sprint-verification'
  | 'test'
  | 'quick-build'
  | 'debug'
  | 'prototype'
  | 'temporary'
  | 'acceptance-test';

export interface CleanupSuggestion {
  projectId: string;
  name: string;
  category: CleanupCategory;

  /** Shown in the confirmation dialog so the human can judge the call rather than trust it. */
  reason: string;
}

export const CLEANUP_CATEGORY_LABEL: Record<CleanupCategory, string> = {
  'sprint-verification': 'Sprint Verification',
  test: 'Test',
  'quick-build': 'Quick Build',
  debug: 'Debug',
  prototype: 'Prototype',
  temporary: 'Temporary',
  'acceptance-test': 'Acceptance Test',
};

/**
 * Name patterns that identify DEVELOPMENT work, anchored deliberately tightly.
 *
 * Each is written to avoid matching a plausible customer project name. `\btest\b` as a bare word
 * would match "Test Kitchen Bakery"; requiring the name to BE a test marker, or to pair "test"
 * with a development word, does not. The cost of a false positive is a real project hidden from
 * the default view, so these err towards missing a temporary project rather than catching a real
 * one.
 */
const RULES: { category: CleanupCategory; pattern: RegExp; reason: string }[] = [
  {
    category: 'sprint-verification',
    pattern: /\bsprint\s*[\d.]*\s*(verification|verify|test|validation)\b/i,
    reason: 'Named as a sprint verification run',
  },
  { category: 'sprint-verification', pattern: /^sprint\s*[\d.]+\b/i, reason: 'Named after a sprint number' },
  { category: 'test', pattern: /^test\s*\d*$/i, reason: 'Named exactly "TEST"' },
  { category: 'test', pattern: /\b(claude|ai)\s+(test|verification)\b/i, reason: 'Named as an AI/Claude test run' },
  { category: 'quick-build', pattern: /^quick\s*build$/i, reason: 'Placeholder Quick Build project' },
  { category: 'debug', pattern: /\bdebug(ging)?\b/i, reason: 'Named as a debugging project' },
  { category: 'prototype', pattern: /\bprototype\b/i, reason: 'Named as a prototype' },
  { category: 'temporary', pattern: /\b(temp|temporary|scratch|throwaway)\b/i, reason: 'Named as temporary work' },
  {
    category: 'acceptance-test',
    pattern: /\bacceptance\s+(test|round)\b/i,
    reason: 'Named as an acceptance-test run',
  },
];

/**
 * Classifies ONE project, or returns undefined when nothing matches.
 *
 * Deliberately name-only. Project type is not used as a signal: a `quick_build` project can be
 * perfectly real customer work, and treating the type as disposable would archive exactly the
 * projects the brief says must never be archived automatically.
 */
export function classifyForCleanup(project: Pick<Project, 'id' | 'name' | 'status'>): CleanupSuggestion | undefined {
  /* Only ever proposes archiving something currently active — never resurrects or re-touches archived/deleted work. */
  if (resolveProjectStatus(project) !== 'active') {
    return undefined;
  }

  const name = project.name.trim();

  for (const rule of RULES) {
    if (rule.pattern.test(name)) {
      return { projectId: project.id, name, category: rule.category, reason: rule.reason };
    }
  }

  return undefined;
}

/**
 * Every active project that looks like development work.
 *
 * This is a SUGGESTION list. Nothing in Builders acts on it without an explicit human
 * confirmation showing the count and the names (see the bulk-archive dialog) — "archive these by
 * default" means pre-selected in that dialog, never applied silently.
 */
export function suggestProjectsForCleanup(projects: Pick<Project, 'id' | 'name' | 'status'>[]): CleanupSuggestion[] {
  return projects
    .map((project) => classifyForCleanup(project))
    .filter((suggestion): suggestion is CleanupSuggestion => suggestion !== undefined);
}

/**
 * Active projects sharing an identical (case-insensitive, trimmed) name — the "duplicate projects"
 * Phase 1 asks to surface. The FIRST created copy is never suggested: duplicates are reported as
 * the later copies only, so accepting every suggestion still leaves one of each.
 */
export function findDuplicateProjects<T extends Pick<Project, 'id' | 'name' | 'status' | 'createdAt'>>(
  projects: T[],
): T[] {
  const byName = new Map<string, T[]>();

  for (const project of projects) {
    if (resolveProjectStatus(project) !== 'active') {
      continue;
    }

    const key = project.name.trim().toLowerCase();
    const bucket = byName.get(key);

    if (bucket) {
      bucket.push(project);
    } else {
      byName.set(key, [project]);
    }
  }

  const duplicates: T[] = [];

  for (const bucket of byName.values()) {
    if (bucket.length < 2) {
      continue;
    }

    const [, ...rest] = [...bucket].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    duplicates.push(...rest);
  }

  return duplicates;
}

// ── Search ───────────────────────────────────────────────────────────────

/**
 * Matches name and description. Searching deliberately spans EVERY status — the brief requires
 * archived projects to stay findable — so callers apply the status filter separately rather than
 * having it baked in here.
 */
export function matchesSearch(project: Pick<Project, 'name' | 'description'>, query: string): boolean {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return true;
  }

  return project.name.toLowerCase().includes(trimmed) || (project.description ?? '').toLowerCase().includes(trimmed);
}
