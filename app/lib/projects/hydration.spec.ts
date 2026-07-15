import { describe, expect, it, beforeEach } from 'vitest';
import {
  getProjectHydrationState,
  invalidateAllProjectHydration,
  invalidateProjectHydration,
  projectHydrationStore,
  readHydrationState,
  resetProjectHydration,
  setProjectHydrationState,
  shouldHydrateProjectData,
} from './hydration';

describe('project hydration state store', () => {
  beforeEach(() => {
    projectHydrationStore.set({});
  });

  it('defaults to not_started for a project never touched', () => {
    expect(getProjectHydrationState('user-a', 'proj-1')).toEqual({
      status: 'not_started',
      userId: null,
      hydratedAt: null,
      error: null,
      usedLocalFallback: false,
    });
  });

  it('is keyed by userId + projectId, not projectId alone', () => {
    setProjectHydrationState('user-a', 'proj-1', { status: 'ready', hydratedAt: '2026-01-01T00:00:00Z' });

    expect(getProjectHydrationState('user-a', 'proj-1').status).toBe('ready');

    // A different user opening the SAME project id must not see user-a's hydration result.
    expect(getProjectHydrationState('user-b', 'proj-1').status).toBe('not_started');
  });

  it('readHydrationState reads a given snapshot map without touching the live store (for reactive React callers)', () => {
    setProjectHydrationState('user-a', 'proj-1', { status: 'loading' });

    const snapshot = projectHydrationStore.get();
    expect(readHydrationState(snapshot, 'user-a', 'proj-1').status).toBe('loading');
  });

  it('invalidateAllProjectHydration clears every entry (sign-out / user switch)', () => {
    setProjectHydrationState('user-a', 'proj-1', { status: 'ready' });
    setProjectHydrationState('user-a', 'proj-2', { status: 'failed', error: 'x' });

    invalidateAllProjectHydration();

    expect(getProjectHydrationState('user-a', 'proj-1').status).toBe('not_started');
    expect(getProjectHydrationState('user-a', 'proj-2').status).toBe('not_started');
  });

  it('invalidateProjectHydration clears only the given project id, across every user key', () => {
    setProjectHydrationState('user-a', 'proj-1', { status: 'ready' });
    setProjectHydrationState('user-b', 'proj-1', { status: 'ready' });
    setProjectHydrationState('user-a', 'proj-2', { status: 'ready' });

    invalidateProjectHydration('proj-1');

    expect(getProjectHydrationState('user-a', 'proj-1').status).toBe('not_started');
    expect(getProjectHydrationState('user-b', 'proj-1').status).toBe('not_started');
    expect(getProjectHydrationState('user-a', 'proj-2').status).toBe('ready');
  });

  it('resetProjectHydration allows a project to retry after failure', () => {
    setProjectHydrationState('user-a', 'proj-1', { status: 'failed', error: 'network down' });
    expect(getProjectHydrationState('user-a', 'proj-1').status).toBe('failed');

    resetProjectHydration('user-a', 'proj-1');

    expect(getProjectHydrationState('user-a', 'proj-1')).toEqual({
      status: 'not_started',
      userId: null,
      hydratedAt: null,
      error: null,
      usedLocalFallback: false,
    });
  });
});

describe('shouldHydrateProjectData (Quick Build exclusion)', () => {
  it('hydrates guided_engineering (Builders) projects', () => {
    expect(shouldHydrateProjectData('guided_engineering')).toBe(true);
  });

  it('never hydrates quick_build projects — they keep their own restore path unchanged', () => {
    expect(shouldHydrateProjectData('quick_build')).toBe(false);
  });
});
