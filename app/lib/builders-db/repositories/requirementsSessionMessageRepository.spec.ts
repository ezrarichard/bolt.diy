import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
}));

const { appendRequirementsSessionMessage, listRequirementsSessionMessages, getLatestRequirementsSessionMessage } =
  await import('./requirementsSessionMessageRepository');

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    session_id: 'session-1',
    project_id: 'proj-1',
    role: 'user',
    message_type: 'text',
    content: 'I need a website for my bakery.',
    sequence_number: 1,
    metadata: {},
    created_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('requirementsSessionMessageRepository', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  describe('appendRequirementsSessionMessage', () => {
    it('computes sequence_number as one past the current highest for the session', async () => {
      const latestMaybeSingle = vi.fn().mockResolvedValue({ data: { sequence_number: 4 }, error: null });
      const latestLimit = vi.fn().mockReturnValue({ maybeSingle: latestMaybeSingle });
      const latestOrder = vi.fn().mockReturnValue({ limit: latestLimit });
      const latestEq = vi.fn().mockReturnValue({ order: latestOrder });
      const latestSelect = vi.fn().mockReturnValue({ eq: latestEq });

      const insertedRow = makeMessageRow({ sequence_number: 5 });
      const insertSingle = vi.fn().mockResolvedValue({ data: insertedRow, error: null });
      const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
      const insert = vi.fn().mockReturnValue({ select: insertSelect });

      getBuildersDbClientMock.mockReturnValue({
        from: () => ({ select: latestSelect, insert }),
      });

      const result = await appendRequirementsSessionMessage('session-1', 'proj-1', {
        role: 'user',
        messageType: 'text',
        content: 'hello',
      });

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sequence_number: 5 }));
      expect(result?.sequenceNumber).toBe(5);
    });

    it('starts sequence_number at 1 for the first message in a session', async () => {
      const latestMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const latestLimit = vi.fn().mockReturnValue({ maybeSingle: latestMaybeSingle });
      const latestOrder = vi.fn().mockReturnValue({ limit: latestLimit });
      const latestEq = vi.fn().mockReturnValue({ order: latestOrder });
      const latestSelect = vi.fn().mockReturnValue({ eq: latestEq });

      const insertedRow = makeMessageRow({ sequence_number: 1 });
      const insertSingle = vi.fn().mockResolvedValue({ data: insertedRow, error: null });
      const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
      const insert = vi.fn().mockReturnValue({ select: insertSelect });

      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: latestSelect, insert }) });

      await appendRequirementsSessionMessage('session-1', 'proj-1', {
        role: 'user',
        messageType: 'text',
        content: 'hello',
      });

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sequence_number: 1 }));
    });

    it('returns null without throwing when BuildersDB is not configured', async () => {
      getBuildersDbClientMock.mockReturnValue(null);

      const result = await appendRequirementsSessionMessage('session-1', 'proj-1', {
        role: 'user',
        messageType: 'text',
        content: 'hello',
      });

      expect(result).toBeNull();
    });
  });

  describe('listRequirementsSessionMessages', () => {
    it('orders by sequence_number ascending', async () => {
      const rows = [makeMessageRow({ id: 'a', sequence_number: 1 }), makeMessageRow({ id: 'b', sequence_number: 2 })];
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await listRequirementsSessionMessages('session-1');

      expect(order).toHaveBeenCalledWith('sequence_number', { ascending: true });
      expect(result.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('returns an empty array on error rather than throwing', async () => {
      const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await listRequirementsSessionMessages('session-1');

      expect(result).toEqual([]);
    });
  });

  describe('getLatestRequirementsSessionMessage', () => {
    it('orders by sequence_number descending and limits to one row', async () => {
      const row = makeMessageRow();
      const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const limit = vi.fn().mockReturnValue({ maybeSingle });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      getBuildersDbClientMock.mockReturnValue({ from: () => ({ select }) });

      const result = await getLatestRequirementsSessionMessage('session-1');

      expect(order).toHaveBeenCalledWith('sequence_number', { ascending: false });
      expect(result?.id).toBe('msg-1');
    });
  });
});
