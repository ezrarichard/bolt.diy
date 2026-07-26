import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MvpDraft } from './mvpTypes';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const {
  createMvp,
  listMvpsForProject,
  recordMvpApproval,
  updateMvpStatus,
  releaseMvp,
  resolveLatestReleasedMvp,
  resolveNextRoadmapTarget,
} = await import('./mvpRepository');

function makeDraft(overrides: Partial<MvpDraft> = {}): MvpDraft {
  return {
    projectId: 'proj-1',
    sequence: 1,
    theme: 'Landing page, auth, dashboard shell',
    ...overrides,
  };
}

describe('createMvp', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts a new MVP row and returns it', async () => {
    const insertedRow = {
      id: 'mvp-1',
      project_id: 'proj-1',
      code: 'MVP-001',
      sequence: 1,
      theme: 'Landing page, auth, dashboard shell',
      status: 'planned',
      scope_artifact_id: null,
      target_release: null,
      estimated_effort: null,
      business_priority: null,
      blocked_reason: null,
      created_by: null,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
      approved_at: null,
    };

    const from = vi.fn(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createMvp(makeDraft());

    expect(result.ok).toBe(true);
    expect(result.mvp).toEqual({
      id: 'mvp-1',
      projectId: 'proj-1',
      code: 'MVP-001',
      sequence: 1,
      theme: 'Landing page, auth, dashboard shell',
      status: 'planned',
      scopeArtifactId: undefined,
      targetRelease: undefined,
      estimatedEffort: undefined,
      businessPriority: undefined,
      blockedReason: undefined,
      createdBy: undefined,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      approvedAt: undefined,
    });
  });

  it('Sprint 46C — passes the caller-supplied code through to the insert payload verbatim', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'mvp-1' }, error: null }) }),
    }));
    const from = vi.fn(() => ({ insert }));

    getBuildersDbClientMock.mockReturnValue({ from });

    await createMvp(makeDraft({ sequence: 3, code: 'MVP-003' }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ code: 'MVP-003', sequence: 3 }));
  });

  it('Sprint 46C — generates a fallback code from sequence when the caller omits one, so no MVP row is ever created without a permanent identifier', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'mvp-1' }, error: null }) }),
    }));
    const from = vi.fn(() => ({ insert }));

    getBuildersDbClientMock.mockReturnValue({ from });

    await createMvp(makeDraft({ sequence: 7, code: undefined }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ code: 'MVP-007', sequence: 7 }));
  });

  it('returns ok: false with a safe error message when the insert fails', async () => {
    const from = vi.fn(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'unique violation' } }) }),
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createMvp(makeDraft());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unique violation');
  });

  it('is a safe no-op when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await createMvp(makeDraft());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

describe('listMvpsForProject', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns MVPs ordered by sequence', async () => {
    const rows = [
      {
        id: 'mvp-1',
        project_id: 'proj-1',
        sequence: 1,
        theme: 'MVP 1',
        status: 'approved',
        scope_artifact_id: null,
        created_by: null,
        created_at: '2026-07-20T00:00:00.000Z',
        updated_at: '2026-07-20T00:00:00.000Z',
        approved_at: '2026-07-20T01:00:00.000Z',
      },
    ];

    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await listMvpsForProject('proj-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('mvp-1');
    expect(result[0].status).toBe('approved');
  });

  it('returns [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await listMvpsForProject('proj-1');

    expect(result).toEqual([]);
  });
});

/** Sprint 78 Phase 0 — `updateMvpStatus` now reads the MVP's current status via `getMvpById` before writing (transition validation), so every test exercising an 'approved' decision must also mock the `select` query that read comes from, returning a row whose `status` is a valid predecessor of the expected target status. */
function mockMvpRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'mvp-1',
    project_id: 'proj-1',
    code: 'MVP-001',
    sequence: 1,
    theme: null,
    status: 'planned',
    scope_artifact_id: null,
    target_release: null,
    estimated_effort: null,
    business_priority: null,
    blocked_reason: null,
    created_by: null,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    approved_at: null,
    ...overrides,
  };
}

describe('recordMvpApproval', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts a Gate A ("scope") approval and flips the MVP status to "scoped", not "approved"', async () => {
    const insertApproval = vi.fn(() => Promise.resolve({ error: null }));
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const currentRow = mockMvpRow({ status: 'planned' });

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvp_approvals') {
        return { insert: insertApproval };
      }

      if (table === 'builders_mvps') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: currentRow, error: null }) }) }),
          update: updateMvp,
        };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await recordMvpApproval({
      mvpId: 'mvp-1',
      projectId: 'proj-1',
      stage: 'scope',
      decision: 'approved',
      decidedBy: 'user-1',
    });

    expect(ok).toBe(true);
    expect(insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ mvp_id: 'mvp-1', project_id: 'proj-1', stage: 'scope', decision: 'approved' }),
    );
    expect(updateMvp).toHaveBeenCalledWith(expect.objectContaining({ status: 'scoped' }));
  });

  it('inserts a Gate B ("delivery") approval and flips the MVP status to "approved"', async () => {
    const insertApproval = vi.fn(() => Promise.resolve({ error: null }));
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const currentRow = mockMvpRow({ status: 'ready_for_review' });

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvp_approvals') {
        return { insert: insertApproval };
      }

      if (table === 'builders_mvps') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: currentRow, error: null }) }) }),
          update: updateMvp,
        };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await recordMvpApproval({
      mvpId: 'mvp-1',
      projectId: 'proj-1',
      stage: 'delivery',
      decision: 'approved',
      decidedBy: 'user-1',
    });

    expect(ok).toBe(true);
    expect(updateMvp).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('does not touch MVP status on a "changes_requested" decision, at either stage', async () => {
    const insertApproval = vi.fn(() => Promise.resolve({ error: null }));
    const updateMvp = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvp_approvals') {
        return { insert: insertApproval };
      }

      if (table === 'builders_mvps') {
        return { update: updateMvp };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await recordMvpApproval({
      mvpId: 'mvp-1',
      projectId: 'proj-1',
      stage: 'scope',
      decision: 'changes_requested',
      notes: 'Nav needs a logo',
    });

    expect(ok).toBe(true);
    expect(updateMvp).not.toHaveBeenCalled();
  });

  it("Sprint 81 — persists a 'roadmap_review' approval but never touches MVP status (persist-only, not a Gate)", async () => {
    const insertApproval = vi.fn(() => Promise.resolve({ error: null }));
    const updateMvp = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvp_approvals') {
        return { insert: insertApproval };
      }

      if (table === 'builders_mvps') {
        return { update: updateMvp };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await recordMvpApproval({
      mvpId: 'mvp-2',
      projectId: 'proj-1',
      stage: 'roadmap_review',
      decision: 'approved',
      decidedBy: 'user-1',
    });

    expect(ok).toBe(true);
    expect(insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ mvp_id: 'mvp-2', stage: 'roadmap_review', decision: 'approved' }),
    );
    expect(updateMvp).not.toHaveBeenCalled();
  });
});

describe('updateMvpStatus — Sprint 78 Phase 0 transition validation', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  function mockFrom(
    currentRow: Record<string, unknown> | null,
    updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
  ) {
    return vi.fn((table: string) => {
      if (table === 'builders_mvps') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: currentRow, error: null }) }) }),
          update: updateMvp,
        };
      }

      throw new Error(`unexpected table ${table}`);
    });
  }

  it('allows a legal transition (planned -> scoped)', async () => {
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'planned' }), updateMvp) });

    const ok = await updateMvpStatus('mvp-1', 'scoped');

    expect(ok).toBe(true);
    expect(updateMvp).toHaveBeenCalledWith(expect.objectContaining({ status: 'scoped' }));
  });

  it('refuses an illegal transition (planned -> released) without writing anything', async () => {
    const updateMvp = vi.fn();
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'planned' }), updateMvp) });

    const ok = await updateMvpStatus('mvp-1', 'released');

    expect(ok).toBe(false);
    expect(updateMvp).not.toHaveBeenCalled();
  });

  it('refuses a backwards transition (approved -> planned)', async () => {
    const updateMvp = vi.fn();
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'approved' }), updateMvp) });

    const ok = await updateMvpStatus('mvp-1', 'planned');

    expect(ok).toBe(false);
    expect(updateMvp).not.toHaveBeenCalled();
  });

  it('treats a no-op (same status) as always valid — safe for an idempotent retry', async () => {
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'scoped' }), updateMvp) });

    const ok = await updateMvpStatus('mvp-1', 'scoped');

    expect(ok).toBe(true);
  });

  it('allows blocked from any pre-released state, and resuming from blocked back into a pre-released state', async () => {
    const updateMvp = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'generating' }), updateMvp) });

    expect(await updateMvpStatus('mvp-1', 'blocked')).toBe(true);

    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockMvpRow({ status: 'blocked' }), updateMvp) });

    expect(await updateMvpStatus('mvp-1', 'generating')).toBe(true);
  });

  it('refuses to update a nonexistent MVP', async () => {
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(null) });

    const ok = await updateMvpStatus('mvp-missing', 'scoped');

    expect(ok).toBe(false);
  });
});

describe('releaseMvp — Sprint 78 Phase 0 auto-supersede rule', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('releases the target MVP and supersedes whichever OTHER MVP in the project currently holds "released"', async () => {
    const targetMvp = mockMvpRow({ id: 'mvp-2', sequence: 2, status: 'approved' });
    const previouslyReleased = mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'released' });

    const updateCalls: { id: string; status: string }[] = [];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_mvps') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: (_col: string, value: string) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: value === 'mvp-2' ? targetMvp : value === 'mvp-1' ? previouslyReleased : null,
                error: null,
              }),
            order: () => Promise.resolve({ data: [targetMvp, previouslyReleased], error: null }),
          }),
        }),
        update: (payload: { status: string }) => ({
          eq: (_col: string, value: string) => {
            updateCalls.push({ id: value, status: payload.status });
            return Promise.resolve({ error: null });
          },
        }),
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await releaseMvp('mvp-2');

    expect(ok).toBe(true);
    expect(updateCalls).toContainEqual({ id: 'mvp-2', status: 'released' });
    expect(updateCalls).toContainEqual({ id: 'mvp-1', status: 'superseded' });
  });

  it('does nothing extra when there is no previously-released MVP to supersede', async () => {
    const targetMvp = mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'approved' });
    const updateCalls: { id: string; status: string }[] = [];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_mvps') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: targetMvp, error: null }),
            order: () => Promise.resolve({ data: [targetMvp], error: null }),
          }),
        }),
        update: (payload: { status: string }) => ({
          eq: (_col: string, value: string) => {
            updateCalls.push({ id: value, status: payload.status });
            return Promise.resolve({ error: null });
          },
        }),
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await releaseMvp('mvp-1');

    expect(ok).toBe(true);
    expect(updateCalls).toEqual([{ id: 'mvp-1', status: 'released' }]);
  });

  it('refuses to release an MVP that does not exist', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const ok = await releaseMvp('mvp-missing');

    expect(ok).toBe(false);
  });
});

/**
 * Sprint 81 (Cross-MVP Foundation) — a small in-memory `builders_mvps` stand-in supporting both
 * `listMvpsForProject` (select/eq/order) and `createMvp` (insert/select/single) against the SAME
 * mutable row list, so `resolveNextRoadmapTarget`'s reuse-vs-create decision and its idempotency
 * across repeated calls can be exercised without re-wiring a fresh mock per call.
 */
function makeStatefulMvpsTable(initialRows: Record<string, unknown>[]) {
  const rows = [...initialRows];
  let nextId = 100;

  const from = vi.fn((table: string) => {
    if (table !== 'builders_mvps') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      select: () => ({
        eq: (_col: string, projectId: string) => ({
          order: () => Promise.resolve({ data: rows.filter((row) => row.project_id === projectId), error: null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const created = mockMvpRow({
              id: `mvp-new-${nextId++}`,
              project_id: row.project_id,
              sequence: row.sequence,
              code: row.code ?? null,
              theme: row.theme ?? null,
              status: 'planned',
              target_release: row.target_release ?? null,
              estimated_effort: row.estimated_effort ?? null,
            });
            rows.push(created);

            return Promise.resolve({ data: created, error: null });
          },
        }),
      }),
    };
  });

  return { from, rows };
}

describe('resolveLatestReleasedMvp — Sprint 81 (Cross-MVP Foundation)', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns undefined when no MVP has ever released', async () => {
    const { from } = makeStatefulMvpsTable([mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'scoped' })]);
    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await resolveLatestReleasedMvp('proj-1')).toBeUndefined();
  });

  it('selects the HIGHEST-SEQUENCE released MVP, independent of list/row order', async () => {
    // Deliberately out of sequence order in the underlying row list — the resolver must not just take the first match.
    const { from } = makeStatefulMvpsTable([
      mockMvpRow({ id: 'mvp-3', sequence: 3, status: 'released' }),
      mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'superseded' }),
      mockMvpRow({ id: 'mvp-2', sequence: 2, status: 'superseded' }),
    ]);
    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveLatestReleasedMvp('proj-1');

    expect(result?.id).toBe('mvp-3');
  });
});

describe('resolveNextRoadmapTarget — Sprint 81 (Cross-MVP Foundation)', () => {
  const ROADMAP_SKELETON = [
    { id: 'MVP-001', sequence: 1, theme: 'Appointments' },
    { id: 'MVP-002', sequence: 2, theme: 'Billing', targetRelease: 'v1.1' },
    { id: 'MVP-003', sequence: 3, theme: 'Inventory' },
  ];

  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns undefined when no MVP has ever released', async () => {
    const { from } = makeStatefulMvpsTable([mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'scoped' })]);
    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON)).toBeUndefined();
  });

  it('creates a new sequence-2 row when none exists yet, using the matching roadmapSkeleton entry', async () => {
    const { from, rows } = makeStatefulMvpsTable([mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'released' })]);
    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON);

    expect(result?.targetMvp.sequence).toBe(2);
    expect(result?.targetMvp.status).toBe('planned');
    expect(result?.targetMvp.theme).toBe('Billing');
    expect(result?.roadmapEntry.id).toBe('MVP-002');
    expect(result?.previousReleasedMvp?.id).toBe('mvp-1');
    expect(rows.filter((row) => row.sequence === 2)).toHaveLength(1);
  });

  it('returns undefined (never throws) when the roadmap has no entry sketched at the next sequence yet', async () => {
    const { from } = makeStatefulMvpsTable([mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'released' })]);
    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveNextRoadmapTarget('proj-1', [{ id: 'MVP-001', sequence: 1, theme: 'Appointments' }]);

    expect(result).toBeUndefined();
  });

  it.each(['planned', 'scoped', 'generating', 'ready_for_review', 'approved'])(
    "reuses the SAME sequence-2 row when it is at status '%s' — never creates a duplicate",
    async (status) => {
      const { from, rows } = makeStatefulMvpsTable([
        mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'released' }),
        mockMvpRow({ id: 'mvp-2', sequence: 2, status }),
      ]);
      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON);

      expect(result?.targetMvp.id).toBe('mvp-2');
      expect(rows.filter((row) => row.sequence === 2)).toHaveLength(1);
    },
  );

  it('Regression — Released MVP1 -> Planned MVP2 -> retry -> still MVP2, NOT MVP3', async () => {
    const { from, rows } = makeStatefulMvpsTable([mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'released' })]);
    getBuildersDbClientMock.mockReturnValue({ from });

    const first = await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON);
    expect(first?.targetMvp.sequence).toBe(2);

    // Retry — the MVP2 row created by the first call already exists now.
    const second = await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON);

    expect(second?.targetMvp.id).toBe(first?.targetMvp.id);
    expect(second?.targetMvp.sequence).toBe(2);
    expect(rows.filter((row) => row.sequence === 2)).toHaveLength(1);
    expect(rows.filter((row) => row.sequence === 3)).toHaveLength(0);
  });

  it('once the target itself releases, the NEXT call correctly advances to the sequence after it (never re-targets the same MVP)', async () => {
    const { from } = makeStatefulMvpsTable([
      mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'superseded' }),
      mockMvpRow({ id: 'mvp-2', sequence: 2, status: 'released' }),
    ]);
    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveNextRoadmapTarget('proj-1', ROADMAP_SKELETON);

    expect(result?.previousReleasedMvp?.id).toBe('mvp-2');
    expect(result?.targetMvp.sequence).toBe(3);
    expect(result?.roadmapEntry.id).toBe('MVP-003');
  });
});
