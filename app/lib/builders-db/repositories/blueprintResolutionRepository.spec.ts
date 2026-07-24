import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
}));

const { recordBlueprintResolution, getLatestBlueprintResolution, listBlueprintResolutionHistory, selectBlueprint } =
  await import('./blueprintResolutionRepository');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    project_id: 'proj-1',
    session_id: 'session-1',
    recommended_blueprint_id: 'business-website',
    selected_blueprint_id: 'business-website',
    confidence: 96,
    explanation: ['Local service business', 'Marketing website'],
    candidates: [{ blueprintId: 'business-website', blueprintName: 'Business Website', confidence: 96, reasons: [] }],
    resolved_at: '2026-07-31T00:00:00.000Z',
    created_at: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('blueprintResolutionRepository', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  describe('recordBlueprintResolution', () => {
    it('inserts a new row with selected defaulting to recommended', async () => {
      const row = makeRow();
      const single = vi.fn().mockResolvedValue({ data: row, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await recordBlueprintResolution({
        projectId: 'proj-1',
        sessionId: 'session-1',
        recommendedBlueprintId: 'business-website',
        confidence: 96,
        explanation: ['Local service business', 'Marketing website'],
        candidates: [],
      });

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'proj-1',
          recommended_blueprint_id: 'business-website',
          selected_blueprint_id: 'business-website',
        }),
      );
      expect(result?.recommendedBlueprintId).toBe('business-website');
      expect(result?.selectedBlueprintId).toBe('business-website');
    });

    it('returns null without throwing when BuildersDB is unconfigured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await recordBlueprintResolution({
        projectId: 'proj-1',
        sessionId: null,
        recommendedBlueprintId: 'business-website',
        confidence: 50,
        explanation: [],
        candidates: [],
      });

      expect(result).toBeNull();
    });
  });

  describe('getLatestBlueprintResolution', () => {
    it('returns the most recently resolved row', async () => {
      const row = makeRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const limit = vi.fn().mockReturnValue({ maybeSingle });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getLatestBlueprintResolution('proj-1');

      expect(order).toHaveBeenCalledWith('resolved_at', { ascending: false });
      expect(result?.id).toBe('res-1');
    });
  });

  describe('listBlueprintResolutionHistory', () => {
    it('never overwrites previous runs — returns every recorded resolution', async () => {
      const rows = [makeRow({ id: 'res-2' }), makeRow({ id: 'res-1' })];
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await listBlueprintResolutionHistory('proj-1');

      expect(result.map((r) => r.id)).toEqual(['res-2', 'res-1']);
    });
  });

  describe('selectBlueprint', () => {
    it('overrides the selection without touching the recommendation', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await selectBlueprint('res-1', 'localshop-india');

      expect(ok).toBe(true);
      expect(update).toHaveBeenCalledWith({ selected_blueprint_id: 'localshop-india' });
    });

    it('returns false without throwing when the update fails', async () => {
      const eq = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await selectBlueprint('res-1', 'localshop-india');

      expect(ok).toBe(false);
    });
  });
});
