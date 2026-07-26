import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { EnvironmentReadinessReport } from '~/lib/services/environmentReadinessService';

const { ensureDeploymentForProjectMock, attachVercelMock, updateDeploymentStatusMock } = vi.hoisted(() => ({
  ensureDeploymentForProjectMock: vi.fn(),
  attachVercelMock: vi.fn(),
  updateDeploymentStatusMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    ensureDeploymentForProject: ensureDeploymentForProjectMock,
    attachVercel: attachVercelMock,
    updateDeploymentStatus: updateDeploymentStatusMock,
  },
}));

const {
  validateVercelToken,
  listVercelTeams,
  findVercelProject,
  createVercelProject,
  setVercelEnvironmentVariables,
  createVercelDeployment,
  getVercelDeployment,
  pollVercelDeployment,
  deployToVercel,
} = await import('./vercelDeployService');

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function makeDeployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'environment_ready',
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
    supabase: {
      id: 'sb-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      supabaseProjectRef: 'abcdefghij',
      supabaseProjectUrl: 'https://abcdefghij.supabase.co',
      status: 'connected',
      metadata: {},
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    },
    vercel: null,
    ...overrides,
  };
}

function makeEnvironmentReport(overrides: Partial<EnvironmentReadinessReport> = {}): EnvironmentReadinessReport {
  const resolved = {
    name: 'VITE_SUPABASE_URL',
    status: 'resolved' as const,
    source: 'provider' as const,
    sensitive: false,
    value: 'https://abcdefghij.supabase.co',
    detail: '',
  };
  const manual = {
    name: 'VITE_SUPABASE_ANON_KEY',
    status: 'missing' as const,
    source: 'manual' as const,
    sensitive: true,
    detail: '',
  };

  return {
    variables: [resolved, manual],
    resolvedVariables: [resolved],
    missingVariables: [manual],
    providerVariables: [resolved],
    manualVariables: [manual],
    sensitiveVariables: [manual],
    ready: true,
    fullyResolved: false,
    ...overrides,
  };
}

describe('vercelDeployService', () => {
  beforeEach(() => {
    ensureDeploymentForProjectMock.mockReset();
    attachVercelMock.mockReset();
    updateDeploymentStatusMock.mockReset();
    vi.unstubAllGlobals();
  });

  describe('validateVercelToken', () => {
    it('returns ok with user info for a valid token', async () => {
      mockFetchSequence([jsonResponse(200, { user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } })]);

      const result = await validateVercelToken('tok');

      expect(result.ok).toBe(true);
      expect(result.user?.id).toBe('u1');
    });

    it('reports insufficient permissions on a 403', async () => {
      mockFetchSequence([jsonResponse(403, { error: { message: 'forbidden' } })]);

      const result = await validateVercelToken('tok');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('permissions');
    });

    it('reports an invalid token on any other failure', async () => {
      mockFetchSequence([jsonResponse(401, { error: { message: 'bad token' } })]);

      const result = await validateVercelToken('tok');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Invalid Vercel token');
    });
  });

  describe('listVercelTeams', () => {
    it('maps the team list', async () => {
      mockFetchSequence([jsonResponse(200, { teams: [{ id: 't1', name: 'Acme', slug: 'acme' }] })]);

      const teams = await listVercelTeams('tok');

      expect(teams).toEqual([{ id: 't1', name: 'Acme', slug: 'acme' }]);
    });
  });

  describe('findVercelProject', () => {
    it('returns the project when found', async () => {
      mockFetchSequence([jsonResponse(200, { id: 'p1', name: 'my-app' })]);

      const project = await findVercelProject('tok', 'my-app');

      expect(project?.id).toBe('p1');
    });

    it('returns null on a 404 (not found is not an error)', async () => {
      mockFetchSequence([jsonResponse(404, { error: { message: 'not found' } })]);

      const project = await findVercelProject('tok', 'my-app');

      expect(project).toBeNull();
    });

    it('rethrows for a non-404 failure', async () => {
      mockFetchSequence([jsonResponse(500, { error: { message: 'server error' } })]);

      await expect(findVercelProject('tok', 'my-app')).rejects.toThrow();
    });
  });

  describe('createVercelProject', () => {
    it('sends a gitRepository link at creation time', async () => {
      const fetchMock = mockFetchSequence([jsonResponse(200, { id: 'p1', name: 'my-app' })]);

      await createVercelProject('tok', {
        name: 'my-app',
        repoFullName: 'acme/my-app',
        productionBranch: 'main',
      });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.gitRepository).toEqual(
        expect.objectContaining({ type: 'github', repo: 'acme/my-app', productionBranch: 'main' }),
      );
    });
  });

  describe('setVercelEnvironmentVariables', () => {
    it('does not call fetch when there are no variables', async () => {
      const fetchMock = mockFetchSequence([]);

      await setVercelEnvironmentVariables('tok', 'p1', []);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends every variable in one request', async () => {
      const fetchMock = mockFetchSequence([jsonResponse(200, {})]);

      await setVercelEnvironmentVariables('tok', 'p1', [
        { key: 'VITE_SUPABASE_URL', value: 'https://x.supabase.co', target: ['preview'], type: 'plain' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('createVercelDeployment / getVercelDeployment', () => {
    it('creates a deployment from the linked repo branch', async () => {
      const fetchMock = mockFetchSequence([
        jsonResponse(200, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'QUEUED' }),
      ]);

      const result = await createVercelDeployment('tok', {
        projectId: 'p1',
        name: 'my-app',
        repoFullName: 'acme/my-app',
        branch: 'main',
        target: 'preview',
      });

      expect(result).toEqual({ id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'QUEUED' });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.gitSource).toEqual({ type: 'github', repo: 'acme/my-app', ref: 'main' });
    });

    it('reads current deployment status', async () => {
      mockFetchSequence([jsonResponse(200, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'BUILDING' })]);

      const result = await getVercelDeployment('tok', 'dpl_1');

      expect(result.readyState).toBe('BUILDING');
    });
  });

  describe('pollVercelDeployment', () => {
    const instantSleep = () => Promise.resolve();

    it('returns ready as soon as the deployment reaches READY', async () => {
      mockFetchSequence([
        jsonResponse(200, { id: 'dpl_1', readyState: 'QUEUED' }),
        jsonResponse(200, { id: 'dpl_1', readyState: 'BUILDING' }),
        jsonResponse(200, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'READY' }),
      ]);

      const result = await pollVercelDeployment('tok', 'dpl_1', undefined, { sleep: instantSleep, maxAttempts: 10 });

      expect(result.outcome).toBe('ready');
      expect(result.attempts).toBe(3);
      expect(result.url).toBe('my-app.vercel.app');
    });

    it('returns error immediately on ERROR without exhausting maxAttempts', async () => {
      mockFetchSequence([jsonResponse(200, { id: 'dpl_1', readyState: 'ERROR' })]);

      const result = await pollVercelDeployment('tok', 'dpl_1', undefined, { sleep: instantSleep, maxAttempts: 40 });

      expect(result.outcome).toBe('error');
      expect(result.attempts).toBe(1);
    });

    it('returns canceled on CANCELED', async () => {
      mockFetchSequence([jsonResponse(200, { id: 'dpl_1', readyState: 'CANCELED' })]);

      const result = await pollVercelDeployment('tok', 'dpl_1', undefined, { sleep: instantSleep });

      expect(result.outcome).toBe('canceled');
    });

    it('times out and stops after maxAttempts — never an infinite loop', async () => {
      const responses = Array.from({ length: 3 }, () => jsonResponse(200, { id: 'dpl_1', readyState: 'BUILDING' }));
      mockFetchSequence(responses);

      const result = await pollVercelDeployment('tok', 'dpl_1', undefined, { sleep: instantSleep, maxAttempts: 3 });

      expect(result.outcome).toBe('timeout');
      expect(result.attempts).toBe(3);
    });

    it('tolerates a transient network failure without aborting the loop', async () => {
      const fetchMock = vi.fn();
      fetchMock.mockRejectedValueOnce(new Error('network blip'));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'dpl_1', url: 'x.vercel.app', readyState: 'READY' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await pollVercelDeployment('tok', 'dpl_1', undefined, { sleep: instantSleep, maxAttempts: 5 });

      expect(result.outcome).toBe('ready');
      expect(result.attempts).toBe(2);
    });
  });

  describe('deployToVercel', () => {
    function baseParams(overrides: Partial<Parameters<typeof deployToVercel>[0]> = {}) {
      return {
        deployment: makeDeployment(),
        token: 'tok',
        projectName: 'my-app',
        requiresSupabase: true,
        environmentReport: makeEnvironmentReport(),
        manualVariableValues: { VITE_SUPABASE_ANON_KEY: 'anon-key-value' },
        ...overrides,
      };
    }

    it('refuses when no GitHub repository is connected', async () => {
      const result = await deployToVercel(baseParams({ deployment: makeDeployment({ github: null }) }));

      expect(result.ok).toBe(false);
      expect(result.message.toLowerCase()).toContain('github');
      expect(attachVercelMock).not.toHaveBeenCalled();
    });

    it('refuses when Supabase is required but not connected', async () => {
      const result = await deployToVercel(baseParams({ deployment: makeDeployment({ supabase: null }) }));

      expect(result.ok).toBe(false);
      expect(result.message.toLowerCase()).toContain('supabase');
    });

    it('refuses when the Deployment is not environment_ready (and not failed)', async () => {
      const result = await deployToVercel(baseParams({ deployment: makeDeployment({ status: 'database_connected' }) }));

      expect(result.ok).toBe(false);
      expect(result.message).toContain('environment_ready');
    });

    it('refuses when a required manual variable value is missing', async () => {
      const result = await deployToVercel(baseParams({ manualVariableValues: {} }));

      expect(result.ok).toBe(false);
      expect(result.message).toContain('VITE_SUPABASE_ANON_KEY');
    });

    it('refuses when the Vercel token is invalid, before touching DeploymentRepository', async () => {
      mockFetchSequence([jsonResponse(401, { error: { message: 'bad token' } })]);

      const result = await deployToVercel(baseParams());

      expect(result.ok).toBe(false);
      expect(attachVercelMock).not.toHaveBeenCalled();
    });

    it('refuses when the found project is already linked to a different repository', async () => {
      mockFetchSequence([
        jsonResponse(200, { user: { id: 'u1' } }), // token valid
        jsonResponse(200, { id: 'p1', name: 'my-app', link: { type: 'github', repo: 'other-org/other-repo' } }), // find
      ]);

      const result = await deployToVercel(baseParams());

      expect(result.ok).toBe(false);
      expect(result.message).toContain('different GitHub repository');
      expect(attachVercelMock).not.toHaveBeenCalled();
    });

    it('runs the full successful sequence: attach -> deploying -> env vars -> deploy -> poll -> deployed -> attach latest metadata', async () => {
      mockFetchSequence([
        jsonResponse(200, { user: { id: 'u1' } }), // token valid
        jsonResponse(404, { error: { message: 'not found' } }), // find (none yet)
        jsonResponse(200, { id: 'p1', name: 'my-app' }), // create
        jsonResponse(200, {}), // set env vars
        jsonResponse(200, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'QUEUED' }), // create deployment
        jsonResponse(200, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'READY' }), // poll -> ready
      ]);

      attachVercelMock.mockResolvedValue({
        id: 'vc-1',
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        status: 'connected',
      });
      updateDeploymentStatusMock.mockResolvedValue(true);

      const result = await deployToVercel(baseParams());

      expect(result.ok).toBe(true);
      expect(result.deploymentUrl).toBe('my-app.vercel.app');

      // attachVercel called twice: initial connection, then latest-metadata update after success.
      expect(attachVercelMock).toHaveBeenCalledTimes(2);
      expect(attachVercelMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ deploymentId: 'dep-1', projectId: 'proj-1', vercelProjectId: 'p1' }),
      );
      expect(attachVercelMock.mock.calls[1][1]).toEqual(expect.objectContaining({ toStatus: 'deployed' }));

      expect(updateDeploymentStatusMock).toHaveBeenNthCalledWith(
        1,
        'dep-1',
        'proj-1',
        'deploying',
        expect.objectContaining({ eventType: 'deployment_started' }),
      );
      expect(updateDeploymentStatusMock).toHaveBeenNthCalledWith(
        2,
        'dep-1',
        'proj-1',
        'deployed',
        expect.objectContaining({ eventType: 'deployment_succeeded' }),
      );

      // Never leaks the manual secret value into any repository call's non-value fields, error text, or overall result.
      expect(JSON.stringify(result)).not.toContain('anon-key-value');
    });

    it('marks the deployment failed (never deployed) when the poll reports an error, with one deployment_failed event', async () => {
      mockFetchSequence([
        jsonResponse(200, { user: { id: 'u1' } }),
        jsonResponse(404, { error: { message: 'not found' } }),
        jsonResponse(200, { id: 'p1', name: 'my-app' }),
        jsonResponse(200, {}),
        jsonResponse(200, { id: 'dpl_1', readyState: 'QUEUED' }),
        jsonResponse(200, { id: 'dpl_1', readyState: 'ERROR' }),
      ]);

      attachVercelMock.mockResolvedValue({
        id: 'vc-1',
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        status: 'connected',
      });
      updateDeploymentStatusMock.mockResolvedValue(true);

      const result = await deployToVercel(baseParams());

      expect(result.ok).toBe(false);
      expect(updateDeploymentStatusMock).toHaveBeenCalledTimes(2);
      expect(updateDeploymentStatusMock).toHaveBeenNthCalledWith(
        2,
        'dep-1',
        'proj-1',
        'failed',
        expect.objectContaining({ eventType: 'deployment_failed' }),
      );

      // Only ever ONE attachVercel call (the initial connection) — no misleading second "latest deployment" attach on failure.
      expect(attachVercelMock).toHaveBeenCalledTimes(1);
    });

    it('allows retrying from a failed deployment', async () => {
      mockFetchSequence([
        jsonResponse(200, { user: { id: 'u1' } }),
        jsonResponse(200, { id: 'p1', name: 'my-app', link: { type: 'github', repo: 'acme/my-app' } }),
        jsonResponse(200, {}),
        jsonResponse(200, { id: 'dpl_2', url: 'my-app.vercel.app', readyState: 'QUEUED' }),
        jsonResponse(200, { id: 'dpl_2', url: 'my-app.vercel.app', readyState: 'READY' }),
      ]);

      attachVercelMock.mockResolvedValue({
        id: 'vc-1',
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        status: 'connected',
      });
      updateDeploymentStatusMock.mockResolvedValue(true);

      const result = await deployToVercel(baseParams({ deployment: makeDeployment({ status: 'failed' }) }));

      expect(result.ok).toBe(true);
    });
  });
});
