import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';

const { getProjectByIdMock, updateProjectMock } = vi.hoisted(() => ({
  getProjectByIdMock: vi.fn(),
  updateProjectMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  getProjectById: getProjectByIdMock,
  updateProject: updateProjectMock,
}));

const {
  resolveEffectiveRegionalSelection,
  getEffectiveRegionalSelection,
  setManualRegionalSelection,
  clearManualRegionalSelection,
} = await import('./regionalResolutionService');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

describe('resolveEffectiveRegionalSelection (pure, no I/O)', () => {
  it('returns unresolved when no country or manual override is present', () => {
    const result = resolveEffectiveRegionalSelection(makeProject());

    expect(result.selectionSource).toBe('none');
    expect(result.regionalProfileId).toBeNull();
    expect(result.contentAvailable).toBe(false);
    expect(result.unresolvedReason).toBeTruthy();
  });

  it('manual override resolves the India profile', () => {
    const project = makeProject({
      regionalSelection: { regionCode: 'IN', selectedAt: '2026-07-25T00:00:00.000Z' },
    });
    const result = resolveEffectiveRegionalSelection(project);

    expect(result.selectionSource).toBe('manual_override');
    expect(result.regionalProfileCode).toBe('IN');
    expect(result.regionalProfileId).toBe('region-in');
    expect(result.matchedCountry).toBe('India');
    expect(result.contentAvailable).toBe(true);
  });

  it('manual override wins — is the only source this resolver reads', () => {
    const project = makeProject({
      regionalSelection: { regionCode: 'GB', selectedAt: '2026-07-25T00:00:00.000Z' },
    });
    const result = resolveEffectiveRegionalSelection(project);

    expect(result.selectionSource).toBe('manual_override');
    expect(result.regionalProfileCode).toBe('GB');
  });

  it('an unknown/stale region code remains unresolved safely, never throws', () => {
    const project = makeProject({
      regionalSelection: { regionCode: 'ZZ' as never, selectedAt: '2026-07-25T00:00:00.000Z' },
    });
    const result = resolveEffectiveRegionalSelection(project);

    expect(result.selectionSource).toBe('none');
    expect(result.regionalProfileId).toBeNull();
    expect(result.unresolvedReason).toContain('ZZ');
  });

  it('never reads browser locale, IP, or currency as a signal (no such fields exist on the input type)', () => {
    // Structural guarantee: the function's parameter type only accepts `regionalSelection`.
    const project = makeProject();
    const result = resolveEffectiveRegionalSelection(project);
    expect(result.selectionSource).toBe('none');
  });

  it('records the selection source explicitly on every result', () => {
    const resolved = resolveEffectiveRegionalSelection(
      makeProject({ regionalSelection: { regionCode: 'AE', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );
    const unresolved = resolveEffectiveRegionalSelection(makeProject());

    expect(resolved.selectionSource).toBe('manual_override');
    expect(unresolved.selectionSource).toBe('none');
  });
});

describe('getEffectiveRegionalSelection (async, I/O)', () => {
  beforeEach(() => {
    getProjectByIdMock.mockReset();
    updateProjectMock.mockReset();
  });

  it('resolves unresolved when the project cannot be loaded', async () => {
    getProjectByIdMock.mockResolvedValue(null);

    const result = await getEffectiveRegionalSelection('proj-1');

    expect(result.selectionSource).toBe('none');
  });

  it('resolves the manually-selected profile when the project has one', async () => {
    getProjectByIdMock.mockResolvedValue(
      makeProject({ regionalSelection: { regionCode: 'US', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );

    const result = await getEffectiveRegionalSelection('proj-1');

    expect(result.selectionSource).toBe('manual_override');
    expect(result.regionalProfileCode).toBe('US');
  });

  it('never throws even when the underlying lookup rejects', async () => {
    getProjectByIdMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(getEffectiveRegionalSelection('proj-1')).resolves.toEqual(
      expect.objectContaining({ selectionSource: 'none' }),
    );
  });

  it('existing projects with no regionalSelection field remain backward compatible', async () => {
    getProjectByIdMock.mockResolvedValue(makeProject());

    const result = await getEffectiveRegionalSelection('proj-1');

    expect(result.selectionSource).toBe('none');
    expect(result.contentAvailable).toBe(false);
  });
});

describe('setManualRegionalSelection / clearManualRegionalSelection', () => {
  beforeEach(() => {
    getProjectByIdMock.mockReset();
    updateProjectMock.mockReset();
    updateProjectMock.mockResolvedValue(true);
  });

  it('rejects an unknown region code without persisting anything', async () => {
    const ok = await setManualRegionalSelection('proj-1', 'ZZ');

    expect(ok).toBe(false);
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('persists a valid manual selection', async () => {
    getProjectByIdMock.mockResolvedValue(makeProject());

    const ok = await setManualRegionalSelection('proj-1', 'GB');

    expect(ok).toBe(true);
    expect(updateProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ regionalSelection: expect.objectContaining({ regionCode: 'GB' }) }),
    );
  });

  it('clearing the selection removes the field and can return to unresolved', async () => {
    getProjectByIdMock.mockResolvedValue(
      makeProject({ regionalSelection: { regionCode: 'IN', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );

    const ok = await clearManualRegionalSelection('proj-1');

    expect(ok).toBe(true);

    const [persisted] = updateProjectMock.mock.calls[0];
    expect(persisted.regionalSelection).toBeUndefined();
  });

  it('never throws when the project cannot be loaded', async () => {
    getProjectByIdMock.mockResolvedValue(null);

    await expect(setManualRegionalSelection('proj-1', 'IN')).resolves.toBe(false);
    await expect(clearManualRegionalSelection('proj-1')).resolves.toBe(false);
  });
});
