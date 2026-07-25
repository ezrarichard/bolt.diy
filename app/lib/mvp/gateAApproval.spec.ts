import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProductOwnerFeature } from '~/lib/projects/prompts/productOwner';

const { isAvailableMock, listMvpsForProjectMock, createMvpMock, recordMvpApprovalMock, promoteFeaturesForMvpMock } =
  vi.hoisted(() => ({
    isAvailableMock: vi.fn(),
    listMvpsForProjectMock: vi.fn(),
    createMvpMock: vi.fn(),
    recordMvpApprovalMock: vi.fn(),
    promoteFeaturesForMvpMock: vi.fn(),
  }));

vi.mock('./mvpRepository', () => ({
  mvpRepository: {
    isAvailable: isAvailableMock,
    listMvpsForProject: listMvpsForProjectMock,
    createMvp: createMvpMock,
    recordMvpApproval: recordMvpApprovalMock,
  },
}));

vi.mock('~/lib/features/featureRepository', () => ({
  featureRepository: {
    promoteFeaturesForMvp: promoteFeaturesForMvpMock,
  },
}));

const { approveGateA } = await import('./gateAApproval');

const FEATURES: ProductOwnerFeature[] = [
  {
    id: 'FEAT-001',
    name: 'Book an appointment',
    description: 'Customer can book an appointment',
    priority: 'Must Have',
    dependsOn: [],
    customerValue: 'Core booking flow',
  },
];

function baseInput(overrides: Partial<Parameters<typeof approveGateA>[0]> = {}) {
  return {
    projectId: 'proj-1',
    sequence: 1,
    code: 'MVP-001',
    decidedBy: 'user-1',
    features: FEATURES,
    ...overrides,
  };
}

describe('approveGateA — Sprint 78 Phase 0 corrective: transactional Gate A orchestration', () => {
  beforeEach(() => {
    isAvailableMock.mockReset().mockReturnValue(true);
    listMvpsForProjectMock.mockReset().mockResolvedValue([]);
    createMvpMock.mockReset().mockResolvedValue({ ok: true, mvp: { id: 'mvp-1' } });
    recordMvpApprovalMock.mockReset().mockResolvedValue(true);
    promoteFeaturesForMvpMock.mockReset().mockResolvedValue({ ok: true, features: [] });
  });

  it('is a no-op success when BuildersDB is not configured — a legitimate deployment mode, not a failure', async () => {
    isAvailableMock.mockReturnValue(false);

    const result = await approveGateA(baseInput());

    expect(result).toEqual({ ok: true });
    expect(listMvpsForProjectMock).not.toHaveBeenCalled();
  });

  it('creates the MVP, records the Gate A decision, and promotes Features, in order, when everything succeeds', async () => {
    const result = await approveGateA(baseInput());

    expect(result.ok).toBe(true);
    expect(result.mvpId).toBe('mvp-1');
    expect(createMvpMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', sequence: 1, code: 'MVP-001' }),
    );
    expect(recordMvpApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({ mvpId: 'mvp-1', projectId: 'proj-1', stage: 'scope', decision: 'approved' }),
    );
    expect(promoteFeaturesForMvpMock).toHaveBeenCalledWith('proj-1', 'mvp-1', FEATURES);

    const approvalOrder = recordMvpApprovalMock.mock.invocationCallOrder[0];
    const promotionOrder = promoteFeaturesForMvpMock.mock.invocationCallOrder[0];
    expect(promotionOrder).toBeGreaterThan(approvalOrder);
  });

  it('MVP persistence failure prevents successful Gate A completion — approval is never recorded, features are never promoted', async () => {
    createMvpMock.mockResolvedValue({ ok: false, error: 'insert failed' });

    const result = await approveGateA(baseInput());

    expect(result).toEqual({ ok: false, error: 'insert failed' });
    expect(recordMvpApprovalMock).not.toHaveBeenCalled();
    expect(promoteFeaturesForMvpMock).not.toHaveBeenCalled();
  });

  it('a failure to record the Gate A decision prevents successful Gate A completion — features are never promoted', async () => {
    recordMvpApprovalMock.mockResolvedValue(false);

    const result = await approveGateA(baseInput());

    expect(result.ok).toBe(false);
    expect(result.mvpId).toBe('mvp-1');
    expect(promoteFeaturesForMvpMock).not.toHaveBeenCalled();
  });

  it('Feature promotion failure prevents successful Gate A completion', async () => {
    promoteFeaturesForMvpMock.mockResolvedValue({ ok: false, features: [], error: 'promotion failed' });

    const result = await approveGateA(baseInput());

    expect(result).toEqual({ ok: false, mvpId: 'mvp-1', error: 'promotion failed' });
  });

  it('retry after partial completion succeeds idempotently — reuses the already-created MVP instead of creating a duplicate', async () => {
    createMvpMock.mockResolvedValueOnce({ ok: false, error: 'transient' });

    const firstAttempt = await approveGateA(baseInput());
    expect(firstAttempt.ok).toBe(false);

    // The MVP row now exists from some external retry path (or the transient failure only affected the response, not the write).
    listMvpsForProjectMock.mockResolvedValue([{ id: 'mvp-1', sequence: 1 }]);

    const secondAttempt = await approveGateA(baseInput());

    expect(secondAttempt.ok).toBe(true);
    expect(secondAttempt.mvpId).toBe('mvp-1');
    expect(createMvpMock).toHaveBeenCalledTimes(1);
  });

  it("repeated approval does not duplicate Features and preserves existing Feature status — delegated entirely to promoteFeaturesForMvp's own upsert-by-(mvpId, code) idempotency", async () => {
    listMvpsForProjectMock.mockResolvedValue([{ id: 'mvp-1', sequence: 1 }]);
    promoteFeaturesForMvpMock.mockResolvedValue({
      ok: true,
      features: [{ id: 'feature-1', code: 'FEAT-001', status: 'in_progress' }],
    });

    const first = await approveGateA(baseInput());
    const second = await approveGateA(baseInput());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(createMvpMock).not.toHaveBeenCalled();
    expect(promoteFeaturesForMvpMock).toHaveBeenCalledTimes(2);

    /*
     * Both calls hit the SAME (mvpId, code) — promoteFeaturesForMvp itself (tested separately in
     * featureRepository.spec.ts) is what guarantees no duplicate insert and no status reset; this
     * asserts the orchestration never bypasses that by, say, creating a second MVP row.
     */
    expect(promoteFeaturesForMvpMock).toHaveBeenNthCalledWith(1, 'proj-1', 'mvp-1', FEATURES);
    expect(promoteFeaturesForMvpMock).toHaveBeenNthCalledWith(2, 'proj-1', 'mvp-1', FEATURES);
    expect(second.features?.[0]?.status).toBe('in_progress');
  });
});
