// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  DeploymentHistoryEvent,
  DeploymentSupabase,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';
import type { Project } from '~/lib/stores/projects';

const { getDeploymentWithProvidersMock, getDeploymentHistoryMock } = vi.hoisted(() => ({
  getDeploymentWithProvidersMock: vi.fn(),
  getDeploymentHistoryMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    getDeploymentWithProviders: getDeploymentWithProvidersMock,
    getDeploymentHistory: getDeploymentHistoryMock,
  },
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
});
