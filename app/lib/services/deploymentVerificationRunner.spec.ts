import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';

const { startMock, recordMock, verifyMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  recordMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { startDeploymentVerification: startMock, recordDeploymentVerification: recordMock },
}));

vi.mock('~/lib/services/deploymentVerificationService', async () => {
  const actual = await vi.importActual<typeof import('./deploymentVerificationService')>(
    './deploymentVerificationService',
  );

  return { ...actual, verifyDeployment: verifyMock };
});

const { runDeploymentVerification } = await import('./deploymentVerificationRunner');

function deployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
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
    vercel: {
      id: 'vc-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      vercelProjectId: 'p1',
      vercelProjectName: 'my-app',
      status: 'connected',
      metadata: { latestDeploymentUrl: 'app.vercel.app', latestDeploymentId: 'dpl_1' },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    },
    ...overrides,
  };
}

const passingReport = {
  status: 'passed' as const,
  policyVersion: 'v',
  targetUrl: 'https://app.vercel.app',
  startedAt: '2026-08-07T00:00:00.000Z',
  checks: [],
  summary: {
    total: 1,
    passed: 1,
    failed: 0,
    warnings: 0,
    skipped: 0,
    unavailable: 0,
    requiredTotal: 1,
    requiredPassed: 1,
    requiredFailed: 0,
  },
  message: 'Verification passed.',
};

describe('runDeploymentVerification', () => {
  beforeEach(() => {
    startMock.mockReset();
    recordMock.mockReset();
    verifyMock.mockReset();
  });

  it('refuses before creating an attempt when there is no Vercel provider', async () => {
    const result = await runDeploymentVerification({ deployment: deployment({ vercel: null }), manifest: null });

    expect(result).toMatchObject({ ok: false, code: 'no_provider' });
    expect(startMock).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('runs the full start → verify → finalise sequence and reports the transition', async () => {
    startMock.mockResolvedValue({ ok: true, verification: { id: 'ver-1' } });
    verifyMock.mockResolvedValue(passingReport);
    recordMock.mockResolvedValue({ ok: true, transitioned: true, duplicate: false, message: 'Verification passed.' });

    const result = await runDeploymentVerification({ deployment: deployment(), manifest: null, performedBy: 'ezra' });

    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        targetUrl: 'https://app.vercel.app',
        vercelDeploymentId: 'dpl_1',
      }),
    );
    expect(recordMock).toHaveBeenCalledWith('ver-1', passingReport, { performedBy: 'ezra' });
    expect(result).toMatchObject({ ok: true, code: 'completed', verified: true, verificationId: 'ver-1' });
  });

  it('does not run the checks at all when the attempt could not be opened', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'already_running', message: 'A verification is already running.' });

    const result = await runDeploymentVerification({ deployment: deployment(), manifest: null });

    expect(result).toMatchObject({ ok: false, code: 'already_running' });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('refuses a Deployment that is not deployed', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'not_deployed', message: 'Not deployed.' });

    expect(await runDeploymentVerification({ deployment: deployment(), manifest: null })).toMatchObject({
      ok: false,
      code: 'not_deployed',
    });
  });

  it('reports a failed verification without treating it as an error, and never as verified', async () => {
    startMock.mockResolvedValue({ ok: true, verification: { id: 'ver-2' } });
    verifyMock.mockResolvedValue({
      ...passingReport,
      status: 'failed',
      summary: { ...passingReport.summary, requiredFailed: 1, requiredPassed: 0, failed: 1 },
      message: 'Verification failed — HTTP response: HTTP 500',
    });
    recordMock.mockResolvedValue({ ok: true, transitioned: false, duplicate: false, message: 'failed' });

    const result = await runDeploymentVerification({ deployment: deployment(), manifest: null });

    expect(result).toMatchObject({ ok: false, code: 'completed', verified: false });
    expect(recordMock).toHaveBeenCalled();
  });

  it('surfaces a persistence failure distinctly from an application failure', async () => {
    startMock.mockResolvedValue({ ok: true, verification: { id: 'ver-3' } });
    verifyMock.mockResolvedValue(passingReport);
    recordMock.mockResolvedValue({ ok: false, transitioned: false, duplicate: false, message: 'could not be saved' });

    const result = await runDeploymentVerification({ deployment: deployment(), manifest: null });

    expect(result).toMatchObject({ ok: false, code: 'persist_failed', verified: false });
    expect(result.report).toBeDefined();
  });

  it('reports a re-verification of an already-verified Deployment as a duplicate, not a new transition', async () => {
    startMock.mockResolvedValue({ ok: true, verification: { id: 'ver-4' } });
    verifyMock.mockResolvedValue(passingReport);
    recordMock.mockResolvedValue({ ok: true, transitioned: false, duplicate: true, message: 'ok' });

    const result = await runDeploymentVerification({ deployment: deployment({ status: 'verified' }), manifest: null });

    expect(result).toMatchObject({ ok: true, verified: false, duplicate: true });
  });

  it('keeps three projects fully isolated — each attempt targets only its own deployment', async () => {
    startMock.mockImplementation(async (params: { deploymentId: string }) => ({
      ok: true,
      verification: { id: `ver-${params.deploymentId}` },
    }));
    verifyMock.mockImplementation(async (params: { deployment: DeploymentWithProviders }) => ({
      ...passingReport,
      targetUrl: `https://${params.deployment.projectId}.vercel.app`,
    }));
    recordMock.mockResolvedValue({ ok: true, transitioned: true, duplicate: false, message: 'ok' });

    const projects = ['proj-a', 'proj-b', 'proj-c'].map((projectId) =>
      deployment({
        id: `dep-${projectId}`,
        projectId,
        vercel: {
          ...deployment().vercel!,
          metadata: { latestDeploymentUrl: `${projectId}.vercel.app`, latestDeploymentId: `dpl_${projectId}` },
        },
      }),
    );

    const results = await Promise.all(
      projects.map((project) => runDeploymentVerification({ deployment: project, manifest: null })),
    );

    expect(results.map((result) => result.verificationId)).toEqual([
      'ver-dep-proj-a',
      'ver-dep-proj-b',
      'ver-dep-proj-c',
    ]);
    expect(startMock.mock.calls.map((call) => call[0].targetUrl)).toEqual([
      'https://proj-a.vercel.app',
      'https://proj-b.vercel.app',
      'https://proj-c.vercel.app',
    ]);
    expect(recordMock.mock.calls.map((call) => call[1].targetUrl)).toEqual([
      'https://proj-a.vercel.app',
      'https://proj-b.vercel.app',
      'https://proj-c.vercel.app',
    ]);
  });
});
