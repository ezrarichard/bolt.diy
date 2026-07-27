// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  DeploymentHistoryEvent,
  DeploymentSupabase,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';
import type { Project } from '~/lib/stores/projects';

const {
  getDeploymentWithProvidersMock,
  getDeploymentHistoryMock,
  getActiveApplicationManifestMock,
  getLatestDeploymentVerificationMock,
  getLatestDeliveryPackageMock,
  getLatestReleaseMock,
} = vi.hoisted(() => ({
  getDeploymentWithProvidersMock: vi.fn(),
  getDeploymentHistoryMock: vi.fn(),
  getActiveApplicationManifestMock: vi.fn(),

  // Sprint 92 — the card now renders DeploymentVerificationPanel, which reads the latest report.
  getLatestDeploymentVerificationMock: vi.fn(),

  // Sprint 93 — and DeliveryPackagePanel, which reads the latest delivery package.
  getLatestDeliveryPackageMock: vi.fn(),

  // Sprint 94 — and ReleasePanel, which reads the latest release.
  getLatestReleaseMock: vi.fn(),
}));

// Sprint 95 — and ProductEvolutionPanel, which reads its own evolution domain.
const { listChangeRequestsMock, listImpactAnalysesMock, listIncrementalPlansMock } = vi.hoisted(() => ({
  listChangeRequestsMock: vi.fn(),
  listImpactAnalysesMock: vi.fn(),

  // Sprint 96 — and IncrementalEngineeringPanel, which reads the incremental plans.
  listIncrementalPlansMock: vi.fn(),
}));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: {
    listChangeRequests: listChangeRequestsMock,
    listImpactAnalyses: listImpactAnalysesMock,
    listIncrementalPlans: listIncrementalPlansMock,
  },
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    getDeploymentWithProviders: getDeploymentWithProvidersMock,
    getDeploymentHistory: getDeploymentHistoryMock,
    getLatestDeploymentVerification: getLatestDeploymentVerificationMock,
    getLatestDeliveryPackage: getLatestDeliveryPackageMock,
    getLatestRelease: getLatestReleaseMock,
  },
}));

vi.mock('~/lib/application-manifest/applicationManifestRepository', () => ({
  getActiveApplicationManifest: getActiveApplicationManifestMock,
}));

const { DeploymentStatusCard } = await import('./DeploymentStatusCard');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
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
    status: 'repository_connected',
    environment: 'production',
    metadata: {},
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    github: {
      id: 'gh-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      repoOwner: 'acme',
      repoName: 'my-app',
      repoFullName: 'acme/my-app',
      repoUrl: 'https://github.com/acme/my-app',
      defaultBranch: 'main',
      visibility: 'private',
      status: 'connected',
      metadata: {},
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

function makeSupabase(overrides: Partial<DeploymentSupabase> = {}): DeploymentSupabase {
  return {
    id: 'sb-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    supabaseProjectRef: 'abcdefghij',
    supabaseProjectUrl: 'https://abcdefghij.supabase.co',
    region: 'us-east-1',
    status: 'connected',
    metadata: { projectName: 'riverside-prod', schemaVersion: 3 },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeVercel(overrides: Partial<DeploymentWithProviders['vercel']> = {}) {
  return {
    id: 'vc-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    vercelProjectId: 'p1',
    vercelProjectName: 'my-app',
    productionUrl: undefined,
    status: 'connected' as const,
    metadata: {
      teamId: 'team_x',
      framework: 'vite',
      productionBranch: 'main',
      latestDeploymentUrl: 'my-app.vercel.app',
      latestDeploymentState: 'READY',
      latestDeploymentAt: '2026-08-06T00:00:00.000Z',
    },
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

function makeHistoryEvent(overrides: Partial<DeploymentHistoryEvent> = {}): DeploymentHistoryEvent {
  return {
    id: 'evt-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    eventType: 'push_successful',
    provider: 'github',
    metadata: {},
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

describe('DeploymentStatusCard', () => {
  beforeEach(() => {
    getDeploymentWithProvidersMock.mockReset();
    getDeploymentHistoryMock.mockReset();
    getActiveApplicationManifestMock.mockReset();
    getActiveApplicationManifestMock.mockResolvedValue(null);
    getLatestDeploymentVerificationMock.mockReset();
    getLatestDeploymentVerificationMock.mockResolvedValue(null);
    getLatestDeliveryPackageMock.mockReset();
    getLatestDeliveryPackageMock.mockResolvedValue(null);
    getLatestReleaseMock.mockReset();
    getLatestReleaseMock.mockResolvedValue(null);
    listChangeRequestsMock.mockReset();
    listChangeRequestsMock.mockResolvedValue([]);
    listImpactAnalysesMock.mockReset();
    listImpactAnalysesMock.mockResolvedValue([]);
    listIncrementalPlansMock.mockReset();
    listIncrementalPlansMock.mockResolvedValue([]);
  });

  it('renders the Incremental Engineering section, sourced from its own domain (Sprint 96)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'released' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Incremental Engineering')).toBeTruthy();
    await waitFor(() => expect(listIncrementalPlansMock).toHaveBeenCalledWith('dep-1'));
  });

  it('renders the Product Evolution section, sourced from the evolution domain (Sprint 95)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'released' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Product Evolution')).toBeTruthy();
    await waitFor(() => expect(listChangeRequestsMock).toHaveBeenCalledWith('dep-1'));
  });

  it('renders the Release section, sourced from the release domain (Sprint 94)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'delivery_ready' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Release')).toBeTruthy();
    await waitFor(() => expect(getLatestReleaseMock).toHaveBeenCalledWith('dep-1'));
    expect(screen.getByRole('button', { name: 'Create Release' })).toBeTruthy();
  });

  it('shows the Released lifecycle badge (Sprint 94)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'released' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Released')).toBeTruthy();
  });

  it('renders the Delivery Package section, sourced from the delivery domain (Sprint 93)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'verified' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Delivery Package')).toBeTruthy();
    await waitFor(() => expect(getLatestDeliveryPackageMock).toHaveBeenCalledWith('dep-1'));
    expect(screen.getByRole('button', { name: 'Generate Package' })).toBeTruthy();
  });

  it('shows the Delivery Ready lifecycle badge (Sprint 93)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'delivery_ready' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Delivery Ready')).toBeTruthy();
  });

  it('renders the Verification section, sourced from the Deployment verification domain (Sprint 92)', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'deployed' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    expect(await screen.findByText('Verification')).toBeTruthy();
    await waitFor(() => expect(getLatestDeploymentVerificationMock).toHaveBeenCalledWith('dep-1'));
    expect(screen.getByRole('button', { name: 'Run Verification' })).toBeTruthy();
  });

  it('shows repository name, owner, branch, connection status, and an Open Repository link', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getDeploymentHistoryMock.mockResolvedValue([makeHistoryEvent()]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('acme/my-app')).toBeTruthy());

    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Repository' }).getAttribute('href')).toBe(
      'https://github.com/acme/my-app',
    );
    expect(getDeploymentWithProvidersMock).toHaveBeenCalledWith('proj-1');
    expect(getDeploymentHistoryMock).toHaveBeenCalledWith('dep-1');
  });

  it('shows a "no deployment yet" state when the project has none', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    render(<DeploymentStatusCard project={makeProject({ id: 'proj-2' })} />);

    await waitFor(() => expect(screen.getByText('No deployment yet')).toBeTruthy());
    expect(getDeploymentHistoryMock).not.toHaveBeenCalled();
  });

  it('shows "No GitHub repository connected yet" when the Deployment exists but has no github row', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ github: null, status: 'planning' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('No GitHub repository connected yet.')).toBeTruthy());
  });

  it('shows "No Supabase database connected yet" when there is no supabase row', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('No Supabase database connected yet.')).toBeTruthy());

    // No databaseActivation on this project means it was never provisioned in real mode.
    expect(screen.getByText('Simulated')).toBeTruthy();
  });

  it('shows connected Supabase project details and marks the connection as Real when provisioning used the real provider', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(
      makeDeployment({ status: 'database_connected', supabase: makeSupabase() }),
    );
    getDeploymentHistoryMock.mockResolvedValue([
      makeHistoryEvent({ id: 'evt-2', eventType: 'database_connected', provider: 'supabase' }),
    ]);

    const project = makeProject({
      databaseActivation: {
        provisioning: { provider: 'supabase', status: 'succeeded', startedAt: '2026-08-05T00:00:00.000Z' },
      } as Project['databaseActivation'],
    });

    render(<DeploymentStatusCard project={project} />);

    await waitFor(() => expect(screen.getByText('riverside-prod')).toBeTruthy());

    expect(screen.getByText('us-east-1')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('Real')).toBeTruthy();
  });

  it('lists missing readiness items (RLS, auth, storage, seed data, env vars) for a project with no approved schema', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ supabase: makeSupabase() }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('Missing Readiness Items')).toBeTruthy());
    expect(screen.getByText(/RLS Policies/)).toBeTruthy();
    expect(screen.getByText(/Authentication Wiring/)).toBeTruthy();
  });

  it('shows "no environment variables" copy when the Application Manifest declares none', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment());
    getDeploymentHistoryMock.mockResolvedValue([]);
    getActiveApplicationManifestMock.mockResolvedValue({ environmentRequirements: [] });

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() =>
      expect(
        screen.getByText("This project's Application Manifest declares no environment variables to configure."),
      ).toBeTruthy(),
    );
  });

  it('shows Missing Variables and Manual Actions Required when Supabase env vars are declared but not connected', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ supabase: null }));
    getDeploymentHistoryMock.mockResolvedValue([]);
    getActiveApplicationManifestMock.mockResolvedValue({
      environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('Missing Variables')).toBeTruthy());
    expect(screen.getByText('VITE_SUPABASE_URL')).toBeTruthy();
    expect(screen.getByText('Manual Actions Required')).toBeTruthy();

    // VITE_SUPABASE_ANON_KEY is both missing AND manual, so it legitimately appears in both lists.
    expect(screen.getAllByText('VITE_SUPABASE_ANON_KEY').length).toBe(2);
    expect(screen.getByText('Not Ready')).toBeTruthy();
  });

  it('shows Resolved Variables and Environment Ready once Supabase is connected and resolves VITE_SUPABASE_URL', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(
      makeDeployment({ status: 'environment_ready', supabase: makeSupabase() }),
    );
    getDeploymentHistoryMock.mockResolvedValue([]);
    getActiveApplicationManifestMock.mockResolvedValue({ environmentRequirements: ['VITE_SUPABASE_URL'] });

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('1 / 1')).toBeTruthy());

    /*
     * "Environment Ready" appears both as the overall Deployment status badge and the
     * section's own badge — both correctly reflect readiness, so two matches is expected.
     */
    expect(screen.getAllByText('Environment Ready').length).toBe(2);
  });

  it('shows "Not connected to Vercel yet" and a Deploy to Vercel button when the Deployment is environment_ready', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'environment_ready' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('Not connected to Vercel yet.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Deploy to Vercel' })).toBeTruthy();
  });

  it('shows connected Vercel project details and an Open Deployment link once attached', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(
      makeDeployment({ status: 'deployed', vercel: makeVercel() as DeploymentWithProviders['vercel'] }),
    );
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('my-app')).toBeTruthy());
    expect(screen.getByText('team_x')).toBeTruthy();
    expect(screen.getByText('vite')).toBeTruthy();
    expect(screen.getByText('READY')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Deployment' }).getAttribute('href')).toBe(
      'https://my-app.vercel.app',
    );
  });

  it('shows a Deploying… badge (no button) while a deployment is in progress', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'deploying' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('Deploying…')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Deploy to Vercel' })).toBeNull();
  });

  it('shows a Retry Deployment button when the Deployment has failed', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ status: 'failed' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard project={makeProject()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry Deployment' })).toBeTruthy());
  });
});
