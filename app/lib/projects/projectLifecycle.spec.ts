import { describe, expect, it } from 'vitest';
import {
  canTransition,
  classifyForCleanup,
  findDuplicateProjects,
  matchesFilter,
  matchesSearch,
  resolveProjectStatus,
  sortProjectsForDisplay,
  suggestProjectsForCleanup,
} from './projectLifecycle';
import type { Project } from '~/lib/stores/projects';

/**
 * The guarantees under test:
 *  - a project written before lifecycle existed is ACTIVE, never hidden;
 *  - the cleanup classifier never proposes a plausible customer project;
 *  - search reaches archived and deleted projects.
 */

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Riverside Dental Clinic',
    icon: '🦷',
    color: 'purple',
    createdAt: '2026-07-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

describe('resolveProjectStatus', () => {
  it('treats a project with no status as active, so legacy rows are never hidden', () => {
    expect(resolveProjectStatus(project({ status: undefined }))).toBe('active');
  });

  it('treats an unrecognised status as active rather than hiding it', () => {
    expect(resolveProjectStatus({ status: 'nonsense' as never })).toBe('active');
  });

  it('honours the real statuses', () => {
    expect(resolveProjectStatus(project({ status: 'archived' }))).toBe('archived');
    expect(resolveProjectStatus(project({ status: 'deleted' }))).toBe('deleted');
  });
});

describe('matchesFilter', () => {
  it('"all" matches every status', () => {
    for (const status of ['active', 'archived', 'deleted'] as const) {
      expect(matchesFilter(project({ status }), 'all')).toBe(true);
    }
  });

  it('the active filter excludes archived and deleted', () => {
    expect(matchesFilter(project({ status: 'active' }), 'active')).toBe(true);
    expect(matchesFilter(project({ status: 'archived' }), 'active')).toBe(false);
    expect(matchesFilter(project({ status: 'deleted' }), 'active')).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows the documented moves', () => {
    expect(canTransition('active', 'archived')).toBe(true);
    expect(canTransition('archived', 'active')).toBe(true);
    expect(canTransition('archived', 'deleted')).toBe(true);
    expect(canTransition('deleted', 'active')).toBe(true);
  });

  it('restores a deleted project to active, never straight back to archived', () => {
    expect(canTransition('deleted', 'archived')).toBe(false);
  });

  it('rejects a no-op transition', () => {
    expect(canTransition('active', 'active')).toBe(false);
  });
});

describe('classifyForCleanup', () => {
  it.each([
    ['Sprint 31 Verification', 'sprint-verification'],
    ['Sprint 54 Verification READY', 'sprint-verification'],
    ['Sprint 62 Verify — Riverside Dental Clinic', 'sprint-verification'],
    ['Sprint 31.1 Real Claude Test', 'sprint-verification'],
    ['TEST', 'test'],
    ['TEST1', 'test'],
    ['Quick Build', 'quick-build'],
    ['Acceptance Test — Bright Smile Dental', 'acceptance-test'],
  ])('flags %s as %s', (name, category) => {
    expect(classifyForCleanup(project({ name }))?.category).toBe(category);
  });

  it.each([
    'Riverside Dental Clinic',
    'Kovai Trends',
    'StyleHub Coimbatore',
    'SmileCare Dental Clinic',
    'Plumber Coimbatore Website',
    'Customer Feedback Survey',
    'Builders Reference Project – TaskFlow Lite',
    'Create a habit tracker app',
    'Build a simple landing page for a Church in India',
  ])('never flags the plausible customer project %s', (name) => {
    expect(classifyForCleanup(project({ name }))).toBeUndefined();
  });

  it('does not match "test" inside an ordinary word or name', () => {
    expect(classifyForCleanup(project({ name: 'Test Kitchen Bakery' }))).toBeUndefined();
    expect(classifyForCleanup(project({ name: 'Contest Platform' }))).toBeUndefined();
  });

  it('only ever proposes projects that are currently active', () => {
    expect(classifyForCleanup(project({ name: 'TEST', status: 'archived' }))).toBeUndefined();
    expect(classifyForCleanup(project({ name: 'TEST', status: 'deleted' }))).toBeUndefined();
  });

  it('explains itself, so a human can judge the suggestion', () => {
    expect(classifyForCleanup(project({ name: 'Sprint 51 Verification' }))?.reason).toMatch(/sprint/i);
  });
});

describe('suggestProjectsForCleanup', () => {
  it('returns only the matching projects', () => {
    const suggestions = suggestProjectsForCleanup([
      project({ id: 'a', name: 'Sprint 51 Verification' }),
      project({ id: 'b', name: 'Riverside Dental Clinic' }),
      project({ id: 'c', name: 'TEST' }),
    ]);

    expect(suggestions.map((suggestion) => suggestion.projectId)).toEqual(['a', 'c']);
  });
});

describe('findDuplicateProjects', () => {
  it('reports later copies only, so accepting every suggestion keeps one of each', () => {
    const duplicates = findDuplicateProjects([
      project({ id: 'first', name: 'Riverside Dental Clinic', createdAt: '2026-07-14T00:00:00.000Z' }),
      project({ id: 'second', name: 'Riverside Dental Clinic', createdAt: '2026-07-25T00:00:00.000Z' }),
    ]);

    expect(duplicates.map((duplicate) => duplicate.id)).toEqual(['second']);
  });

  it('ignores case and surrounding whitespace', () => {
    const duplicates = findDuplicateProjects([
      project({ id: 'a', name: 'Kovai Trends', createdAt: '2026-07-01T00:00:00.000Z' }),
      project({ id: 'b', name: '  kovai trends ', createdAt: '2026-07-02T00:00:00.000Z' }),
    ]);

    expect(duplicates).toHaveLength(1);
  });

  it('does not treat a unique name as a duplicate', () => {
    expect(findDuplicateProjects([project({ id: 'a' }), project({ id: 'b', name: 'Other' })])).toHaveLength(0);
  });
});

describe('sortProjectsForDisplay', () => {
  it('puts pinned projects first regardless of recency', () => {
    const sorted = sortProjectsForDisplay([
      project({ id: 'recent', createdAt: '2026-07-30T00:00:00.000Z' }),
      project({ id: 'pinned', createdAt: '2026-01-01T00:00:00.000Z', pinnedAt: '2026-07-01T00:00:00.000Z' }),
    ]);

    expect(sorted[0].id).toBe('pinned');
  });

  it('orders unpinned projects by most recent activity', () => {
    const sorted = sortProjectsForDisplay([
      project({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z' }),
      project({ id: 'new', createdAt: '2026-07-20T00:00:00.000Z' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('prefers updatedAt over createdAt when present', () => {
    const sorted = sortProjectsForDisplay([
      project({ id: 'createdRecently', createdAt: '2026-07-20T00:00:00.000Z' }),
      project({ id: 'workedOnToday', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' }),
    ]);

    expect(sorted[0].id).toBe('workedOnToday');
  });
});

describe('matchesSearch', () => {
  it('matches name and description, case-insensitively', () => {
    expect(matchesSearch(project({ name: 'Riverside Dental' }), 'dental')).toBe(true);
    expect(matchesSearch(project({ description: 'A clinic booking tool' }), 'booking')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesSearch(project(), '   ')).toBe(true);
  });

  it('is status-blind, so archived projects stay findable', () => {
    expect(matchesSearch(project({ name: 'Archived Thing', status: 'archived' }), 'archived thing')).toBe(true);
  });
});
