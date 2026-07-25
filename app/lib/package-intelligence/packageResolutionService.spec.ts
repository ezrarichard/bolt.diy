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
  resolveEffectivePackageSelection,
  getEffectivePackageSelection,
  setManualPackageSelection,
  clearManualPackageSelection,
} = await import('./packageResolutionService');

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

describe('resolveEffectivePackageSelection (pure, no I/O)', () => {
  it('returns unresolved when no package selection is present', () => {
    const result = resolveEffectivePackageSelection(makeProject());

    expect(result.selectionSource).toBe('none');
    expect(result.packageProfileId).toBeNull();
    expect(result.contentAvailable).toBe(false);
    expect(result.unresolvedReason).toBeTruthy();
  });

  it('manual selection resolves the Starter profile', () => {
    const project = makeProject({
      packageSelection: { packageCode: 'STARTER', selectedAt: '2026-07-25T00:00:00.000Z' },
    });
    const result = resolveEffectivePackageSelection(project);

    expect(result.selectionSource).toBe('manual_override');
    expect(result.packageProfileCode).toBe('STARTER');
    expect(result.packageProfileId).toBe('package-starter');
    expect(result.contentAvailable).toBe(true);
  });

  it('Professional resolves', () => {
    const result = resolveEffectivePackageSelection(
      makeProject({ packageSelection: { packageCode: 'PROFESSIONAL', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );
    expect(result.packageProfileCode).toBe('PROFESSIONAL');
  });

  it('Premium resolves', () => {
    const result = resolveEffectivePackageSelection(
      makeProject({ packageSelection: { packageCode: 'PREMIUM', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );
    expect(result.packageProfileCode).toBe('PREMIUM');
  });

  it('an unknown/stale package code remains unresolved safely, never throws', () => {
    const project = makeProject({
      packageSelection: { packageCode: 'ENTERPRISE' as never, selectedAt: '2026-07-25T00:00:00.000Z' },
    });
    const result = resolveEffectivePackageSelection(project);

    expect(result.selectionSource).toBe('none');
    expect(result.packageProfileId).toBeNull();
    expect(result.unresolvedReason).toContain('ENTERPRISE');
  });

  it('never infers a package from Blueprint, Region, or budget/free-text (no such fields on the input type)', () => {
    const project = makeProject();
    const result = resolveEffectivePackageSelection(project);
    expect(result.selectionSource).toBe('none');
  });

  it('records the selection source and source value explicitly', () => {
    const resolved = resolveEffectivePackageSelection(
      makeProject({ packageSelection: { packageCode: 'PREMIUM', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );

    expect(resolved.selectionSource).toBe('manual_override');
    expect(resolved.sourceValue).toBe('PREMIUM');
  });

  it('existing projects without packageSelection remain backward compatible', () => {
    const result = resolveEffectivePackageSelection(makeProject());
    expect(result.selectionSource).toBe('none');
    expect(result.contentAvailable).toBe(false);
  });
});

describe('getEffectivePackageSelection (async, I/O)', () => {
  beforeEach(() => {
    getProjectByIdMock.mockReset();
    updateProjectMock.mockReset();
  });

  it('resolves unresolved when the project cannot be loaded', async () => {
    getProjectByIdMock.mockResolvedValue(null);

    const result = await getEffectivePackageSelection('proj-1');

    expect(result.selectionSource).toBe('none');
  });

  it('resolves the manually-selected package when the project has one', async () => {
    getProjectByIdMock.mockResolvedValue(
      makeProject({ packageSelection: { packageCode: 'PROFESSIONAL', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );

    const result = await getEffectivePackageSelection('proj-1');

    expect(result.selectionSource).toBe('manual_override');
    expect(result.packageProfileCode).toBe('PROFESSIONAL');
  });

  it('never throws even when the underlying lookup rejects', async () => {
    getProjectByIdMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(getEffectivePackageSelection('proj-1')).resolves.toEqual(
      expect.objectContaining({ selectionSource: 'none' }),
    );
  });
});

describe('setManualPackageSelection / clearManualPackageSelection', () => {
  beforeEach(() => {
    getProjectByIdMock.mockReset();
    updateProjectMock.mockReset();
    updateProjectMock.mockResolvedValue(true);
  });

  it('rejects an unknown package code without persisting anything', async () => {
    const ok = await setManualPackageSelection('proj-1', 'ENTERPRISE');

    expect(ok).toBe(false);
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('persists a valid manual selection', async () => {
    getProjectByIdMock.mockResolvedValue(makeProject());

    const ok = await setManualPackageSelection('proj-1', 'PREMIUM');

    expect(ok).toBe(true);
    expect(updateProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ packageSelection: expect.objectContaining({ packageCode: 'PREMIUM' }) }),
    );
  });

  it('clearing the selection removes the field and returns to unresolved', async () => {
    getProjectByIdMock.mockResolvedValue(
      makeProject({ packageSelection: { packageCode: 'STARTER', selectedAt: '2026-07-25T00:00:00.000Z' } }),
    );

    const ok = await clearManualPackageSelection('proj-1');

    expect(ok).toBe(true);

    const [persisted] = updateProjectMock.mock.calls[0];
    expect(persisted.packageSelection).toBeUndefined();
  });

  it('never throws when the project cannot be loaded', async () => {
    getProjectByIdMock.mockResolvedValue(null);

    await expect(setManualPackageSelection('proj-1', 'STARTER')).resolves.toBe(false);
    await expect(clearManualPackageSelection('proj-1')).resolves.toBe(false);
  });
});
