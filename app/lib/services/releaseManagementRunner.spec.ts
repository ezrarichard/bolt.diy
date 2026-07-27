import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { Project } from '~/lib/stores/projects';

const {
  getDeploymentWithProvidersMock,
  createReleaseMock,
  recordCustomerAcceptanceMock,
  collectInputsMock,
  buildReleaseMock,
} = vi.hoisted(() => ({
  getDeploymentWithProvidersMock: vi.fn(),
  createReleaseMock: vi.fn(),
  recordCustomerAcceptanceMock: vi.fn(),
  collectInputsMock: vi.fn(),
  buildReleaseMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    getDeploymentWithProviders: getDeploymentWithProvidersMock,
    createRelease: createReleaseMock,
    recordCustomerAcceptance: recordCustomerAcceptanceMock,
  },
}));

vi.mock('~/lib/services/releaseManagementService', () => ({
  collectReleaseInputs: collectInputsMock,
  buildRelease: buildReleaseMock,
}));

const { createProjectRelease, recordReleaseAcceptance, suggestReleaseVersion } = await import(
  './releaseManagementRunner'
);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside',
    icon: '🦷',
    color: 'blue',
    createdAt: '2026-06-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    ...overrides,
  } as Project;
}

function makeDeployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'delivery_ready',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

const builtRelease = { semanticVersion: '1.0.0', releaseType: 'major', baseline: {}, integrity: { complete: true } };

describe('createProjectRelease', () => {
  beforeEach(() => {
    getDeploymentWithProvidersMock.mockReset();
    createReleaseMock.mockReset();
    collectInputsMock.mockReset();
    buildReleaseMock.mockReset();

    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    collectInputsMock.mockResolvedValue({ deliveryPackage: { id: 'pkg-1' }, verification: { id: 'ver-1' } });
    buildReleaseMock.mockReturnValue({ ok: true, release: builtRelease });
    createReleaseMock.mockResolvedValue({
      ok: true,
      transitioned: true,
      supersededReleases: 0,
      release: { id: 'rel-1', releaseNumber: 1, semanticVersion: '1.0.0' },
    });
  });

  it('runs collect → build → persist and reports the lifecycle transition', async () => {
    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      createdBy: 'ezra',
    });

    expect(buildReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ semanticVersion: '1.0.0', releaseType: 'major', createdBy: 'ezra' }),
    );
    expect(createReleaseMock).toHaveBeenCalledWith('dep-1', 'proj-1', builtRelease, {
      deliveryPackageId: 'pkg-1',
      verificationId: 'ver-1',
      createdBy: 'ezra',
    });
    expect(result).toMatchObject({ ok: true, code: 'completed', transitioned: true });
    expect(result.message).toMatch(/now released/i);
  });

  it('passes the operator version through untouched — nothing is auto-incremented', async () => {
    await createProjectRelease({ project: makeProject(), semanticVersion: '3.7.2', releaseType: 'patch' });

    expect(buildReleaseMock.mock.calls[0][0].semanticVersion).toBe('3.7.2');
  });

  it('refuses a project with no Deployment before doing any work', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
    });

    expect(result).toMatchObject({ ok: false, code: 'no_deployment' });
    expect(collectInputsMock).not.toHaveBeenCalled();
  });

  it('refuses a Deployment with no delivery package before collecting anything', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'verified' }));

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
    });

    expect(result).toMatchObject({ ok: false, code: 'not_delivery_ready' });
    expect(collectInputsMock).not.toHaveBeenCalled();
    expect(createReleaseMock).not.toHaveBeenCalled();
  });

  it('allows a follow-up release from an already-released Deployment', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'released' }));
    createReleaseMock.mockResolvedValue({
      ok: true,
      transitioned: false,
      supersededReleases: 1,
      release: { id: 'rel-2', releaseNumber: 2, semanticVersion: '1.0.1' },
    });

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.1',
      releaseType: 'patch',
    });

    expect(result).toMatchObject({ ok: true, transitioned: false, supersededReleases: 1 });
  });

  it('surfaces a version rejection without persisting anything', async () => {
    buildReleaseMock.mockReturnValue({ ok: false, code: 'invalid_version', message: 'not a valid semantic version' });

    const result = await createProjectRelease({ project: makeProject(), semanticVersion: '1.0', releaseType: 'patch' });

    expect(result).toMatchObject({ ok: false, code: 'invalid_version' });
    expect(createReleaseMock).not.toHaveBeenCalled();
  });

  it('surfaces an integrity refusal without persisting anything (never a partial release)', async () => {
    buildReleaseMock.mockReturnValue({ ok: false, code: 'integrity', message: 'No delivery package' });

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
    });

    expect(result).toMatchObject({ ok: false, code: 'integrity' });
    expect(createReleaseMock).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate version from the repository', async () => {
    createReleaseMock.mockResolvedValue({ ok: false, code: 'duplicate_version', message: 'already released' });

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
    });

    expect(result).toMatchObject({ ok: false, code: 'duplicate_version', transitioned: false });
  });

  it('writes nothing once the operator cancels', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(buildReleaseMock).not.toHaveBeenCalled();
    expect(createReleaseMock).not.toHaveBeenCalled();
  });

  it('surfaces a persistence failure, keeping the assembled release for inspection', async () => {
    createReleaseMock.mockResolvedValue({ ok: false, code: 'error', message: 'left unchanged' });

    const result = await createProjectRelease({
      project: makeProject(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
    });

    expect(result).toMatchObject({ ok: false, code: 'persist_failed', transitioned: false });
    expect(result.release).toBe(builtRelease);
  });

  it('keeps three projects isolated — each run targets only its own deployment', async () => {
    getDeploymentWithProvidersMock.mockImplementation(async (projectId: string) =>
      makeDeployment({ id: `dep-${projectId}`, projectId }),
    );
    createReleaseMock.mockImplementation(async (deploymentId: string, projectId: string) => ({
      ok: true,
      transitioned: true,
      supersededReleases: 0,
      release: { id: `rel-${projectId}`, releaseNumber: 1, semanticVersion: '1.0.0', deploymentId, projectId },
    }));

    await Promise.all(
      ['proj-a', 'proj-b', 'proj-c'].map((id) =>
        createProjectRelease({ project: makeProject({ id }), semanticVersion: '1.0.0', releaseType: 'major' }),
      ),
    );

    expect(createReleaseMock.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['dep-proj-a', 'proj-a'],
      ['dep-proj-b', 'proj-b'],
      ['dep-proj-c', 'proj-c'],
    ]);
  });
});

describe('recordReleaseAcceptance', () => {
  beforeEach(() => recordCustomerAcceptanceMock.mockReset());

  it('delegates straight to the repository', async () => {
    recordCustomerAcceptanceMock.mockResolvedValue({ ok: true, state: 'accepted', eventRecorded: true, message: 'ok' });

    const result = await recordReleaseAcceptance({
      releaseId: 'rel-1',
      state: 'accepted_with_conditions',
      notes: 'Fix the logo',
      conditions: ['Fix the logo'],
      recordedBy: 'ezra',
    });

    expect(recordCustomerAcceptanceMock).toHaveBeenCalledWith('rel-1', 'accepted_with_conditions', {
      notes: 'Fix the logo',
      conditions: ['Fix the logo'],
      recordedBy: 'ezra',
    });
    expect(result.ok).toBe(true);
  });
});

describe('suggestReleaseVersion', () => {
  it('only ever suggests — the caller decides what to submit', () => {
    expect(suggestReleaseVersion(undefined, 'minor')).toBe('1.0.0');
    expect(suggestReleaseVersion('2.4.1', 'minor')).toBe('2.5.0');
    expect(suggestReleaseVersion('2.4.1', 'major')).toBe('3.0.0');
    expect(suggestReleaseVersion('2.4.1', 'patch')).toBe('2.4.2');
  });
});
