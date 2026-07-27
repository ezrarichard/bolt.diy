import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { Project } from '~/lib/stores/projects';

const {
  getDeploymentWithProvidersMock,
  getLatestDeliveryPackageMock,
  recordDeliveryPackageMock,
  collectInputsMock,
  buildPackageMock,
} = vi.hoisted(() => ({
  getDeploymentWithProvidersMock: vi.fn(),
  getLatestDeliveryPackageMock: vi.fn(),
  recordDeliveryPackageMock: vi.fn(),
  collectInputsMock: vi.fn(),
  buildPackageMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    getDeploymentWithProviders: getDeploymentWithProvidersMock,
    getLatestDeliveryPackage: getLatestDeliveryPackageMock,
    recordDeliveryPackage: recordDeliveryPackageMock,
  },
}));

vi.mock('~/lib/services/deliveryPackageService', () => ({
  collectDeliveryPackageInputs: collectInputsMock,
  buildDeliveryPackage: buildPackageMock,
}));

const { generateDeliveryPackage } = await import('./deliveryPackageRunner');

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
    status: 'verified',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

const builtPackage = { completeness: { score: 92, level: 'almost_complete' }, versionSummary: { packageNumber: 1 } };

describe('generateDeliveryPackage', () => {
  beforeEach(() => {
    getDeploymentWithProvidersMock.mockReset();
    getLatestDeliveryPackageMock.mockReset();
    recordDeliveryPackageMock.mockReset();
    collectInputsMock.mockReset();
    buildPackageMock.mockReset();

    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getLatestDeliveryPackageMock.mockResolvedValue(null);
    collectInputsMock.mockResolvedValue({ verification: { id: 'ver-1' } });
    buildPackageMock.mockReturnValue(builtPackage);
    recordDeliveryPackageMock.mockResolvedValue({
      ok: true,
      transitioned: true,
      eventType: 'delivery_package_generated',
      record: { id: 'pkg-1', packageNumber: 1 },
    });
  });

  it('runs collect → build → persist and reports the lifecycle transition', async () => {
    const result = await generateDeliveryPackage({ project: makeProject(), generatedBy: 'ezra' });

    expect(collectInputsMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj-1' }), {
      packageNumber: 1,
      generatedBy: 'ezra',
    });
    expect(recordDeliveryPackageMock).toHaveBeenCalledWith('dep-1', 'proj-1', builtPackage, {
      verificationId: 'ver-1',
      generatedBy: 'ezra',
    });
    expect(result).toMatchObject({ ok: true, code: 'completed', transitioned: true });
    expect(result.message).toMatch(/ready for handover/i);
  });

  it('allocates the next package number so an earlier package is never overwritten', async () => {
    getLatestDeliveryPackageMock.mockResolvedValue({ packageNumber: 3 });

    await generateDeliveryPackage({ project: makeProject() });

    expect(collectInputsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ packageNumber: 4 }));
  });

  it('refuses a project with no Deployment before doing any work', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    const result = await generateDeliveryPackage({ project: makeProject() });

    expect(result).toMatchObject({ ok: false, code: 'no_deployment' });
    expect(collectInputsMock).not.toHaveBeenCalled();
  });

  it('refuses an unverified Deployment before collecting anything', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'deployed' }));

    const result = await generateDeliveryPackage({ project: makeProject() });

    expect(result).toMatchObject({ ok: false, code: 'not_verified' });
    expect(collectInputsMock).not.toHaveBeenCalled();
    expect(recordDeliveryPackageMock).not.toHaveBeenCalled();
  });

  it('reports a regeneration distinctly from a first package', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'delivery_ready' }));
    getLatestDeliveryPackageMock.mockResolvedValue({ packageNumber: 1 });
    recordDeliveryPackageMock.mockResolvedValue({
      ok: true,
      transitioned: false,
      eventType: 'delivery_package_updated',
      record: { id: 'pkg-2', packageNumber: 2 },
    });

    const result = await generateDeliveryPackage({ project: makeProject() });

    expect(result).toMatchObject({ ok: true, transitioned: false, eventType: 'delivery_package_updated' });
    expect(result.message).toMatch(/regenerated/i);
  });

  it('writes nothing once the operator cancels', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateDeliveryPackage({ project: makeProject(), signal: controller.signal });

    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(recordDeliveryPackageMock).not.toHaveBeenCalled();
  });

  it('surfaces a persistence failure distinctly, keeping the assembled package for inspection', async () => {
    recordDeliveryPackageMock.mockResolvedValue({ ok: false, code: 'error', message: 'left unchanged' });

    const result = await generateDeliveryPackage({ project: makeProject() });

    expect(result).toMatchObject({ ok: false, code: 'persist_failed', transitioned: false });
    expect(result.package).toBe(builtPackage);
  });

  it('keeps three projects isolated — each run targets only its own deployment', async () => {
    getDeploymentWithProvidersMock.mockImplementation(async (projectId: string) =>
      makeDeployment({ id: `dep-${projectId}`, projectId }),
    );
    recordDeliveryPackageMock.mockImplementation(async (deploymentId: string, projectId: string) => ({
      ok: true,
      transitioned: true,
      eventType: 'delivery_package_generated',
      record: { id: `pkg-${projectId}`, packageNumber: 1, deploymentId, projectId },
    }));

    await Promise.all(
      ['proj-a', 'proj-b', 'proj-c'].map((id) => generateDeliveryPackage({ project: makeProject({ id }) })),
    );

    expect(recordDeliveryPackageMock.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['dep-proj-a', 'proj-a'],
      ['dep-proj-b', 'proj-b'],
      ['dep-proj-c', 'proj-c'],
    ]);
  });
});
