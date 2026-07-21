import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
}));

const {
  createRequirementsSession,
  getRequirementsSession,
  listRequirementsSessionsByProject,
  getLatestRequirementsSession,
  updateRequirementsSessionStatus,
  archiveRequirementsSession,
} = await import('./requirementsSessionRepository');

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    project_id: 'proj-1',
    mode: 'form',
    status: 'created',
    selected_discovery_strategy: null,
    assessment_confidence: null,
    started_at: null,
    completed_at: null,
    approved_at: null,
    abandoned_at: null,
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('requirementsSessionRepository', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  describe('createRequirementsSession', () => {
    it('inserts a new session row and returns the mapped domain shape', async () => {
      const row = makeSessionRow();
      const single = vi.fn().mockResolvedValue({ data: row, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await createRequirementsSession('proj-1', 'form');

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'proj-1', mode: 'form', status: 'created' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ id: 'session-1', projectId: 'proj-1', mode: 'form', status: 'created' }),
      );
    });

    it('returns null without throwing when BuildersDB is not configured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await createRequirementsSession('proj-1', 'form');

      expect(result).toBeNull();
    });

    it('returns null without throwing when the insert fails (e.g. RLS rejection)', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'row-level security violation' } });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await createRequirementsSession('proj-1', 'form');

      expect(result).toBeNull();
    });
  });

  describe('getRequirementsSession', () => {
    it('returns the mapped session when found', async () => {
      const row = makeSessionRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getRequirementsSession('session-1');

      expect(result?.id).toBe('session-1');
    });

    it('returns null when no row matches', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getRequirementsSession('missing');

      expect(result).toBeNull();
    });
  });

  describe('listRequirementsSessionsByProject', () => {
    it('returns every session for a project, oldest first per the query', async () => {
      const rows = [makeSessionRow({ id: 'a' }), makeSessionRow({ id: 'b' })];
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await listRequirementsSessionsByProject('proj-1');

      expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('returns an empty array (never throws) on a query error', async () => {
      const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await listRequirementsSessionsByProject('proj-1');

      expect(result).toEqual([]);
    });
  });

  describe('getLatestRequirementsSession', () => {
    it('orders by created_at descending and limits to one row', async () => {
      const row = makeSessionRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const limit = vi.fn().mockReturnValue({ maybeSingle });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getLatestRequirementsSession('proj-1');

      expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(limit).toHaveBeenCalledWith(1);
      expect(result?.id).toBe('session-1');
    });
  });

  describe('updateRequirementsSessionStatus', () => {
    it('stamps the matching timestamp column for a lifecycle transition', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await updateRequirementsSessionStatus('session-1', 'complete');

      expect(ok).toBe(true);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'complete', completed_at: expect.any(String) }),
      );
    });

    it('does not stamp a timestamp for a status with no associated column (created)', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      await updateRequirementsSessionStatus('session-1', 'created');

      const payload = update.mock.calls[0][0];
      expect(Object.keys(payload)).toEqual(['status']);
    });
  });

  describe('archiveRequirementsSession', () => {
    it('delegates to updateRequirementsSessionStatus with status "archived"', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await archiveRequirementsSession('session-1');

      expect(ok).toBe(true);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
    });
  });
});
