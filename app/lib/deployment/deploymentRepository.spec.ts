import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
}));

const {
  createDeployment,
  getDeploymentByProject,
  updateDeploymentStatus,
  attachGithub,
  getDeploymentHistory,
  recordDeploymentEvent,
} = await import('./deploymentRepository');

function makeDeploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    project_id: 'proj-1',
    status: 'planning',
    environment: 'production',
    last_error: null,
    metadata: {},
    created_by: null,
    created_at: '2026-08-04T00:00:00.000Z',
    updated_at: '2026-08-04T00:00:00.000Z',
    started_at: null,
    released_at: null,
    archived_at: null,
    ...overrides,
  };
}

function makeGithubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gh-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    repo_owner: 'acme',
    repo_name: 'my-app',
    repo_full_name: 'acme/my-app',
    repo_url: 'https://github.com/acme/my-app',
    default_branch: 'main',
    visibility: 'private',
    status: 'connected',
    last_error: null,
    connected_at: '2026-08-04T00:00:00.000Z',
    metadata: {},
    created_at: '2026-08-04T00:00:00.000Z',
    updated_at: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeHistoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    event_type: 'status_changed',
    from_status: 'planning',
    to_status: 'engineering',
    provider: null,
    message: null,
    metadata: {},
    created_by: null,
    created_at: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('deploymentRepository', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  describe('createDeployment', () => {
    it('inserts a new deployment row for the project', async () => {
      const row = makeDeploymentRow();
      const single = vi.fn().mockResolvedValue({ data: row, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await createDeployment({ projectId: 'proj-1' });

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'proj-1', environment: 'production' }));
      expect(result?.projectId).toBe('proj-1');
      expect(result?.status).toBe('planning');
    });

    it('returns null without throwing when BuildersDB is unconfigured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await createDeployment({ projectId: 'proj-1' });

      expect(result).toBeNull();
    });
  });

  describe('getDeploymentByProject', () => {
    it('returns the deployment for a project', async () => {
      const row = makeDeploymentRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getDeploymentByProject('proj-1');

      expect(eq).toHaveBeenCalledWith('project_id', 'proj-1');
      expect(result?.id).toBe('dep-1');
    });

    it('returns null when no deployment exists yet', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getDeploymentByProject('proj-1');

      expect(result).toBeNull();
    });
  });

  describe('updateDeploymentStatus', () => {
    it('writes the new status and records a status_changed history event on a legal transition', async () => {
      const readSingle = vi.fn().mockResolvedValue({ data: { status: 'planning' }, error: null });
      const readEq = vi.fn().mockReturnValue({ single: readSingle });
      const readSelect = vi.fn().mockReturnValue({ eq: readEq });

      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq: updateEq });

      const historySingle = vi.fn().mockResolvedValue({ data: makeHistoryRow(), error: null });
      const historySelect = vi.fn().mockReturnValue({ single: historySingle });
      const historyInsert = vi.fn().mockReturnValue({ select: historySelect });

      const from = vi.fn((table: string) => {
        if (table === 'builders_project_deployments') {
          return { select: readSelect, update };
        }

        if (table === 'builders_deployment_history') {
          return { insert: historyInsert };
        }

        throw new Error(`unexpected table: ${table}`);
      });
      getBuildersDbClientMock.mockReturnValue({ from });

      const ok = await updateDeploymentStatus('dep-1', 'proj-1', 'engineering');

      expect(ok).toBe(true);
      expect(update).toHaveBeenCalledWith({ status: 'engineering' });
      expect(historyInsert).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'status_changed', from_status: 'planning', to_status: 'engineering' }),
      );
    });

    it('rejects an illegal transition and writes nothing', async () => {
      const readSingle = vi.fn().mockResolvedValue({ data: { status: 'planning' }, error: null });
      const readEq = vi.fn().mockReturnValue({ single: readSingle });
      const readSelect = vi.fn().mockReturnValue({ eq: readEq });
      const update = vi.fn();

      const from = vi.fn(() => ({ select: readSelect, update }));
      getBuildersDbClientMock.mockReturnValue({ from });

      const ok = await updateDeploymentStatus('dep-1', 'proj-1', 'deployed');

      expect(ok).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });

    it('returns false without throwing when BuildersDB is unconfigured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const ok = await updateDeploymentStatus('dep-1', 'proj-1', 'engineering');

      expect(ok).toBe(false);
    });
  });

  describe('attachGithub', () => {
    it('upserts the github connection on deployment_id and records a history event', async () => {
      const githubSingle = vi.fn().mockResolvedValue({ data: makeGithubRow(), error: null });
      const githubSelect = vi.fn().mockReturnValue({ single: githubSingle });
      const upsert = vi.fn().mockReturnValue({ select: githubSelect });

      const historySingle = vi.fn().mockResolvedValue({
        data: makeHistoryRow({ event_type: 'github_connected', provider: 'github' }),
        error: null,
      });
      const historySelect = vi.fn().mockReturnValue({ single: historySingle });
      const historyInsert = vi.fn().mockReturnValue({ select: historySelect });

      const from = vi.fn((table: string) => {
        if (table === 'builders_deployment_github') {
          return { upsert };
        }

        if (table === 'builders_deployment_history') {
          return { insert: historyInsert };
        }

        throw new Error(`unexpected table: ${table}`);
      });
      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await attachGithub({
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        repoOwner: 'acme',
        repoName: 'my-app',
      });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ deployment_id: 'dep-1', repo_owner: 'acme', repo_name: 'my-app' }),
        { onConflict: 'deployment_id' },
      );
      expect(result?.repoFullName).toBe('acme/my-app');
      expect(historyInsert).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'github_connected', provider: 'github' }),
      );
    });

    it('returns null without throwing when BuildersDB is unconfigured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await attachGithub({ deploymentId: 'dep-1', projectId: 'proj-1' });

      expect(result).toBeNull();
    });
  });

  describe('recordDeploymentEvent / getDeploymentHistory', () => {
    it('records an event', async () => {
      const single = vi.fn().mockResolvedValue({ data: makeHistoryRow(), error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await recordDeploymentEvent({
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        eventType: 'note',
        message: 'hello',
      });

      expect(result?.eventType).toBe('status_changed');
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'note', message: 'hello' }));
    });

    it('returns history most-recent first', async () => {
      const rows = [makeHistoryRow({ id: 'evt-2' }), makeHistoryRow({ id: 'evt-1' })];
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getDeploymentHistory('dep-1');

      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result.map((e) => e.id)).toEqual(['evt-2', 'evt-1']);
    });

    it('returns [] without throwing when BuildersDB is unconfigured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await getDeploymentHistory('dep-1');

      expect(result).toEqual([]);
    });
  });
});
