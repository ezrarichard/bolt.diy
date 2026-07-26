// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DeploymentHistoryEvent, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';

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

    render(<DeploymentStatusCard projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText('acme/my-app')).toBeTruthy());

    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Repository' }).getAttribute('href')).toBe(
      'https://github.com/acme/my-app',
    );
    expect(getDeploymentWithProvidersMock).toHaveBeenCalledWith('proj-1');
    expect(getDeploymentHistoryMock).toHaveBeenCalledWith('dep-1');
  });

  it('shows a "no deployment yet" state when the project has none', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(null);

    render(<DeploymentStatusCard projectId="proj-2" />);

    await waitFor(() => expect(screen.getByText('No deployment yet')).toBeTruthy());
    expect(getDeploymentHistoryMock).not.toHaveBeenCalled();
  });

  it('shows "No GitHub repository connected yet" when the Deployment exists but has no github row', async () => {
    getDeploymentWithProvidersMock.mockResolvedValue(makeDeployment({ github: null, status: 'planning' }));
    getDeploymentHistoryMock.mockResolvedValue([]);

    render(<DeploymentStatusCard projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText('No GitHub repository connected yet.')).toBeTruthy());
  });
});
