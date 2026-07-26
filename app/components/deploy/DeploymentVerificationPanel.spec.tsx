// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeploymentVerification, VerificationCheck } from '~/lib/deployment/verificationTypes';

const { getLatestDeploymentVerificationMock, runDeploymentVerificationMock } = vi.hoisted(() => ({
  getLatestDeploymentVerificationMock: vi.fn(),
  runDeploymentVerificationMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { getLatestDeploymentVerification: getLatestDeploymentVerificationMock },
}));

vi.mock('~/lib/services/deploymentVerificationRunner', () => ({
  runDeploymentVerification: runDeploymentVerificationMock,
}));

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { DeploymentVerificationPanel } = await import('./DeploymentVerificationPanel');

function makeDeployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'deployed',
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

function check(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    id: 'availability.http_response',
    category: 'availability',
    name: 'HTTP response',
    description: 'The deployment answers an HTTPS request.',
    required: true,
    status: 'passed',
    durationMs: 120,
    target: 'https://app.vercel.app/',
    expected: 'HTTP 2xx',
    actual: 'HTTP 200',
    evidence: { status: 200 },
    retryable: false,
    attempts: 1,
    ...overrides,
  };
}

function makeVerification(overrides: Partial<DeploymentVerification> = {}): DeploymentVerification {
  return {
    id: 'ver-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    verificationNumber: 1,
    status: 'passed',
    policyVersion: '2026-08-07.1',
    targetUrl: 'https://app.vercel.app',
    finalUrl: 'https://app.vercel.app/',
    startedAt: '2026-08-07T10:00:00.000Z',
    completedAt: '2026-08-07T10:00:04.000Z',
    durationMs: 4000,
    checks: [check()],
    summary: {
      total: 9,
      passed: 8,
      failed: 0,
      warnings: 1,
      skipped: 0,
      unavailable: 0,
      requiredTotal: 6,
      requiredPassed: 6,
      requiredFailed: 0,
    },
    message: 'Verification passed — 6/6 required checks passed.',
    createdAt: '2026-08-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('DeploymentVerificationPanel', () => {
  beforeEach(() => {
    getLatestDeploymentVerificationMock.mockReset();
    runDeploymentVerificationMock.mockReset();
    getLatestDeploymentVerificationMock.mockResolvedValue(null);
  });

  it('shows the empty state and offers to run verification for a deployed Deployment', async () => {
    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );

    expect(await screen.findByText(/has not been verified yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run Verification' })).toBeTruthy();
  });

  it('does not offer verification before the Deployment has deployed', async () => {
    render(
      <DeploymentVerificationPanel
        deployment={makeDeployment({ status: 'environment_ready' })}
        manifest={null}
        onVerificationComplete={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/becomes available once/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Run Verification' })).toBeNull();
  });

  it('renders a passed report from the persisted verification domain', async () => {
    getLatestDeploymentVerificationMock.mockResolvedValue(makeVerification());

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );

    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.getByText(/8 passed · 0 failed · 1 warnings/)).toBeTruthy();
    expect(screen.getByText('https://app.vercel.app')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry Verification' })).toBeTruthy();
  });

  it('renders a warning report distinctly from a pass', async () => {
    getLatestDeploymentVerificationMock.mockResolvedValue(makeVerification({ status: 'warning' }));

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );

    expect(await screen.findByText('Verified with warnings')).toBeTruthy();
  });

  it('surfaces the blocking failure for a failed report', async () => {
    getLatestDeploymentVerificationMock.mockResolvedValue(
      makeVerification({
        status: 'failed',
        summary: {
          ...makeVerification().summary,
          failed: 1,
          requiredFailed: 1,
          requiredPassed: 5,
          blockingFailure: {
            checkId: 'application.error_page',
            name: 'No deployment error page',
            errorCode: 'vercel_deployment_not_found',
            errorMessage: 'Vercel reports this deployment does not exist.',
          },
        },
      }),
    );

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );

    expect(await screen.findByText('Verification failed')).toBeTruthy();
    expect(screen.getByText(/Blocking Failure/i)).toBeTruthy();
    expect(screen.getByText(/does not exist/)).toBeTruthy();
  });

  it('renders the detailed checks grouped by category, without any raw header dump', async () => {
    getLatestDeploymentVerificationMock.mockResolvedValue(
      makeVerification({
        checks: [
          check(),
          check({ id: 'route:/about', category: 'route', name: 'Route /about', required: false, status: 'warning' }),
        ],
      }),
    );

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'View Details' }));

    expect(await screen.findByText('Verification #1')).toBeTruthy();
    expect(screen.getByText('Availability')).toBeTruthy();
    expect(screen.getByText('Routes')).toBeTruthy();
    expect(screen.getByText('HTTP response')).toBeTruthy();
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Advisory').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('set-cookie');
  });

  it('runs verification through the runner and re-reads the domain afterwards', async () => {
    const onComplete = vi.fn();
    runDeploymentVerificationMock.mockResolvedValue({
      ok: true,
      code: 'completed',
      verified: true,
      duplicate: false,
      message: 'Verification passed.',
    });

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={onComplete} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Run Verification' }));

    await waitFor(() => expect(runDeploymentVerificationMock).toHaveBeenCalledTimes(1));
    expect(runDeploymentVerificationMock.mock.calls[0][0]).toMatchObject({
      deployment: expect.objectContaining({ id: 'dep-1' }),
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(getLatestDeploymentVerificationMock).toHaveBeenCalledTimes(2);
  });

  it('shows progress and a cancel control while a run is in flight', async () => {
    let resolveRun: (value: unknown) => void = () => {};
    runDeploymentVerificationMock.mockImplementation((params: { onProgress?: (p: unknown) => void }) => {
      params.onProgress?.({ stage: 'checking_routes', completed: 4, planned: 12 });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    });

    render(
      <DeploymentVerificationPanel deployment={makeDeployment()} manifest={null} onVerificationComplete={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Run Verification' }));

    expect(await screen.findByText(/Checking routes/)).toBeTruthy();
    expect(screen.getByText('4/12')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel verification/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Cancel verification/i }));
    expect(runDeploymentVerificationMock.mock.calls[0][0].signal.aborted).toBe(true);

    resolveRun({
      ok: false,
      code: 'completed',
      verified: false,
      duplicate: false,
      message: 'Verification was cancelled.',
    });
    await waitFor(() => expect(screen.queryByText(/Checking routes/)).toBeNull());
  });

  it('restores the persisted report after a remount, with no session state to rebuild', async () => {
    getLatestDeploymentVerificationMock.mockResolvedValue(makeVerification({ verificationNumber: 3 }));

    const { unmount } = render(
      <DeploymentVerificationPanel
        deployment={makeDeployment({ status: 'verified' })}
        manifest={null}
        onVerificationComplete={vi.fn()}
      />,
    );
    expect(await screen.findByText('Verified')).toBeTruthy();
    unmount();

    render(
      <DeploymentVerificationPanel
        deployment={makeDeployment({ status: 'verified' })}
        manifest={null}
        onVerificationComplete={vi.fn()}
      />,
    );

    expect(await screen.findByText('Verified')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
    expect(await screen.findByText('Verification #3')).toBeTruthy();
  });

  it("reads each project's own latest report — no shared cache across deployments", async () => {
    getLatestDeploymentVerificationMock.mockImplementation(async (deploymentId: string) =>
      makeVerification({ deploymentId, targetUrl: `https://${deploymentId}.vercel.app` }),
    );

    render(
      <DeploymentVerificationPanel
        deployment={makeDeployment({ id: 'dep-a' })}
        manifest={null}
        onVerificationComplete={vi.fn()}
      />,
    );
    expect(await screen.findByText('https://dep-a.vercel.app')).toBeTruthy();

    render(
      <DeploymentVerificationPanel
        deployment={makeDeployment({ id: 'dep-b' })}
        manifest={null}
        onVerificationComplete={vi.fn()}
      />,
    );
    expect(await screen.findByText('https://dep-b.vercel.app')).toBeTruthy();

    expect(getLatestDeploymentVerificationMock.mock.calls.map((call) => call[0])).toEqual(['dep-a', 'dep-b']);
  });
});
