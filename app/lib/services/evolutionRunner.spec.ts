import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ReleaseRecord } from '~/lib/deployment/releaseTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { Project } from '~/lib/stores/projects';

const {
  getDeploymentWithProvidersMock,
  getLatestReleaseMock,
  getLatestDeliveryPackageMock,
  getLatestDeploymentVerificationMock,
  listApplicationManifestFilesMock,
  recordImpactAnalysisMock,
} = vi.hoisted(() => ({
  getDeploymentWithProvidersMock: vi.fn(),
  getLatestReleaseMock: vi.fn(),
  getLatestDeliveryPackageMock: vi.fn(),
  getLatestDeploymentVerificationMock: vi.fn(),
  listApplicationManifestFilesMock: vi.fn(),
  recordImpactAnalysisMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    getDeploymentWithProviders: getDeploymentWithProvidersMock,
    getLatestRelease: getLatestReleaseMock,
    getLatestDeliveryPackage: getLatestDeliveryPackageMock,
    getLatestDeploymentVerification: getLatestDeploymentVerificationMock,
  },
}));

vi.mock('~/lib/application-manifest/applicationManifestRepository', () => ({
  listApplicationManifestFiles: listApplicationManifestFilesMock,
}));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: { recordImpactAnalysis: recordImpactAnalysisMock },
}));

const { resolveBaselineSnapshot, runImpactAnalysis } = await import('./evolutionRunner');

const CLOCK = () => '2026-08-12T10:00:00.000Z';

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
    databaseActivation: {
      schema: { generatedAt: '', tableCount: 1, schemaSql: 'create table appointments (id uuid);', migrationSql: '' },
    },
    ...overrides,
  } as Project;
}

function makeDeployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'released',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

function makeRelease(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    id: 'rel-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    releaseNumber: 1,
    semanticVersion: '1.0.0',
    releaseName: 'v1.0.0',
    releaseType: 'major',
    releaseStatus: 'released',
    releaseDate: '2026-08-10T09:00:00.000Z',
    baseline: {
      capturedAt: '2026-08-10T09:00:00.000Z',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      manifestId: 'man-1',
      manifestVersion: 4,
      manifestPlanChecksum: 'fnv1a:plan',
    },
    releaseNotes: { summary: '', categories: [], breakingChanges: [], knownIssues: [] },
    integrity: { complete: true, checks: [], checksum: 'x' },
    customerAcceptance: { state: 'accepted', conditions: [] },
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Cancel appointments',
    description: 'FEAT-001 should allow cancellation of an appointments record.',
    priority: 'medium',
    category: 'unknown',
    scope: 'unknown',
    declaredAreas: [],
    status: 'submitted',
    requestedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    metadata: {},
    ...overrides,
  };
}

describe('resolveBaselineSnapshot', () => {
  beforeEach(() => {
    getDeploymentWithProvidersMock.mockReset();
    getLatestReleaseMock.mockReset();
    getLatestDeliveryPackageMock.mockReset();
    listApplicationManifestFilesMock.mockReset();

    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getLatestReleaseMock.mockResolvedValue(makeRelease());
    getLatestDeliveryPackageMock.mockResolvedValue({
      deliverySummary: {
        applicationSummary: { routes: [{ path: '/appointments', name: 'Appointments' }], requiredServices: [] },
        featureInventory: { features: [{ code: 'FEAT-001', title: 'Book', state: 'verified' }] },
        environmentSummary: { variables: [] },
        documentation: { sections: [] },
      },
    });
    listApplicationManifestFilesMock.mockResolvedValue([]);
  });

  it('builds the snapshot from the release baseline, using the manifest the release froze', async () => {
    const result = await resolveBaselineSnapshot(makeProject(), CLOCK);

    expect(result.code).toBe('ok');
    expect(listApplicationManifestFilesMock).toHaveBeenCalledWith('man-1');
    expect(result.snapshot).toMatchObject({ releaseId: 'rel-1', semanticVersion: '1.0.0', manifestVersion: 4 });
    expect(result.snapshot?.databaseTables).toEqual(['appointments']);
  });

  it('refuses when the project has no Deployment', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    expect(await resolveBaselineSnapshot(makeProject(), CLOCK)).toMatchObject({ code: 'no_deployment' });
  });

  it('refuses when the product has never been released — there is no baseline', async () => {
    getLatestReleaseMock.mockResolvedValue(null);

    const result = await resolveBaselineSnapshot(makeProject(), CLOCK);

    expect(result).toMatchObject({ code: 'no_release' });
    expect(result.message).toMatch(/release baseline/i);
  });

  it('refuses when the only release was superseded', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease({ releaseStatus: 'superseded' }));

    expect(await resolveBaselineSnapshot(makeProject(), CLOCK)).toMatchObject({ code: 'no_release' });
  });
});

describe('runImpactAnalysis', () => {
  beforeEach(() => {
    getDeploymentWithProvidersMock.mockReset();
    getLatestReleaseMock.mockReset();
    getLatestDeliveryPackageMock.mockReset();
    getLatestDeploymentVerificationMock.mockReset();
    listApplicationManifestFilesMock.mockReset();
    recordImpactAnalysisMock.mockReset();

    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getLatestReleaseMock.mockResolvedValue(makeRelease());
    getLatestDeliveryPackageMock.mockResolvedValue({
      deliverySummary: {
        applicationSummary: { routes: [{ path: '/appointments', name: 'Appointments' }], requiredServices: [] },
        featureInventory: { features: [{ code: 'FEAT-001', title: 'Book', state: 'verified' }] },
        environmentSummary: { variables: [] },
        documentation: { sections: [] },
      },
    });
    getLatestDeploymentVerificationMock.mockResolvedValue(null);
    listApplicationManifestFilesMock.mockResolvedValue([]);
    recordImpactAnalysisMock.mockResolvedValue({ ok: true, record: { id: 'ia-1', analysisNumber: 1 } });
  });

  it('analyses against the release and persists the result with a plan', async () => {
    const result = await runImpactAnalysis({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: true, code: 'completed' });
    expect(result.impact?.releaseVersion).toBe('1.0.0');
    expect(result.plan).toBeDefined();
    expect(recordImpactAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({ changeRequest: expect.objectContaining({ id: 'cr-1' }) }),
    );
    expect(recordImpactAnalysisMock.mock.calls[0][0].evolutionPlan).toBeDefined();
  });

  it('can produce an analysis without an evolution plan', async () => {
    const result = await runImpactAnalysis({
      project: makeProject(),
      request: makeRequest(),
      withEvolutionPlan: false,
      clock: CLOCK,
    });

    expect(result.plan).toBeUndefined();
    expect(recordImpactAnalysisMock.mock.calls[0][0].evolutionPlan).toBeUndefined();
  });

  it('refuses without a release, and never persists anything', async () => {
    getLatestReleaseMock.mockResolvedValue(null);

    const result = await runImpactAnalysis({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'no_release' });
    expect(recordImpactAnalysisMock).not.toHaveBeenCalled();
  });

  it('refuses without a deployment', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    expect(await runImpactAnalysis({ project: makeProject(), request: makeRequest(), clock: CLOCK })).toMatchObject({
      ok: false,
      code: 'no_deployment',
    });
  });

  it('writes nothing once the operator cancels', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runImpactAnalysis({
      project: makeProject(),
      request: makeRequest(),
      signal: controller.signal,
      clock: CLOCK,
    });

    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(recordImpactAnalysisMock).not.toHaveBeenCalled();
  });

  it('surfaces a persistence failure, keeping the analysis for inspection', async () => {
    recordImpactAnalysisMock.mockResolvedValue({ ok: false, code: 'error', message: 'could not be saved' });

    const result = await runImpactAnalysis({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'persist_failed' });
    expect(result.impact).toBeDefined();
  });

  it('keeps three projects isolated — each analysis targets only its own deployment and release', async () => {
    getDeploymentWithProvidersMock.mockImplementation(async (projectId: string) =>
      makeDeployment({ id: `dep-${projectId}`, projectId }),
    );
    getLatestReleaseMock.mockImplementation(async (deploymentId: string) =>
      makeRelease({
        id: `rel-${deploymentId}`,
        deploymentId,
        semanticVersion: `1.${deploymentId.slice(-1)}.0`,
        baseline: { capturedAt: '', deploymentId, projectId: 'x', manifestId: `man-${deploymentId}` },
      }),
    );

    const results = await Promise.all(
      ['proj-a', 'proj-b', 'proj-c'].map((id) =>
        runImpactAnalysis({
          project: makeProject({ id }),
          request: makeRequest({ deploymentId: `dep-${id}`, projectId: id }),
          clock: CLOCK,
        }),
      ),
    );

    expect(results.map((result) => result.impact?.releaseId)).toEqual([
      'rel-dep-proj-a',
      'rel-dep-proj-b',
      'rel-dep-proj-c',
    ]);
    expect(listApplicationManifestFilesMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'man-dep-proj-a',
      'man-dep-proj-b',
      'man-dep-proj-c',
    ]);
  });
});
