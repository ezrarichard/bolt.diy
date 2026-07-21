import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
}));

const {
  createBusinessUnderstandingModel,
  getBusinessUnderstandingModel,
  initializeBusinessUnderstandingModel,
  updateBusinessUnderstandingModel,
} = await import('./businessUnderstandingRepository');

function makeModelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    session_id: 'session-1',
    project_id: 'proj-1',
    schema_version: 1,
    assessment: {},
    business_identity: {},
    business_goals: [],
    processes: [],
    target_users: [],
    pain_points: [],
    business_constraints: [],
    current_systems: [],
    functional_requirements: [],
    non_functional_requirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    open_questions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('businessUnderstandingRepository', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  describe('createBusinessUnderstandingModel', () => {
    it('inserts an empty model row scoped to the session/project', async () => {
      const row = makeModelRow();
      const single = vi.fn().mockResolvedValue({ data: row, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ insert }) });

      const result = await createBusinessUnderstandingModel('session-1', 'proj-1');

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: 'session-1', project_id: 'proj-1', business_goals: [] }),
      );
      expect(result?.businessGoals).toEqual([]);
    });
  });

  describe('getBusinessUnderstandingModel', () => {
    it('returns null when no model exists for the session yet', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getBusinessUnderstandingModel('session-1');

      expect(result).toBeNull();
    });
  });

  describe('initializeBusinessUnderstandingModel', () => {
    it('returns the existing model without inserting a second one', async () => {
      const row = makeModelRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      const insert = vi.fn();
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select, insert }) });

      const result = await initializeBusinessUnderstandingModel('session-1', 'proj-1');

      expect(insert).not.toHaveBeenCalled();
      expect(result?.id).toBe('model-1');
    });

    it('creates a new model when none exists yet', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });

      const insertedRow = makeModelRow();
      const insertSingle = vi.fn().mockResolvedValue({ data: insertedRow, error: null });
      const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
      const insert = vi.fn().mockReturnValue({ select: insertSelect });

      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select, insert }) });

      const result = await initializeBusinessUnderstandingModel('session-1', 'proj-1');

      expect(insert).toHaveBeenCalledTimes(1);
      expect(result?.id).toBe('model-1');
    });
  });

  describe('updateBusinessUnderstandingModel', () => {
    it('only sends the sections present on the patch, never unrelated sections', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await updateBusinessUnderstandingModel('session-1', { businessGoals: ['Reduce no-shows'] });

      expect(ok).toBe(true);

      const payload = update.mock.calls[0][0];
      expect(payload).toEqual({ business_goals: ['Reduce no-shows'] });
      expect(payload).not.toHaveProperty('risks');
      expect(payload).not.toHaveProperty('recommendations');
    });

    it('is a no-op (returns true, makes no call) for an empty patch', async () => {
      const update = vi.fn();
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await updateBusinessUnderstandingModel('session-1', {});

      expect(ok).toBe(true);
      expect(update).not.toHaveBeenCalled();
    });

    it('returns false without throwing when the update fails', async () => {
      const eq = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
      const update = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

      const ok = await updateBusinessUnderstandingModel('session-1', { risks: [] });

      expect(ok).toBe(false);
    });
  });
});
