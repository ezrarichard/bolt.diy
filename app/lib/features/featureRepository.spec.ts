import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { promoteFeaturesForMvp, resolveActiveMvpFeatures, updateFeatureStatus, listFeaturesForMvp } = await import(
  './featureRepository'
);

function mockFeatureRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'feature-1',
    project_id: 'proj-1',
    mvp_id: 'mvp-1',
    code: 'FEAT-001',
    module_slug: null,
    title: 'Book an appointment',
    description: 'Customer can book an appointment',
    priority: 'Must Have',
    depends_on: [],
    customer_value: 'Core booking flow',
    status: 'planned',
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function mockMvpRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'mvp-1',
    project_id: 'proj-1',
    sequence: 1,
    theme: null,
    status: 'approved',
    scope_artifact_id: null,
    created_by: null,
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
    approved_at: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

const SOURCE_FEATURES = [
  {
    id: 'FEAT-001',
    name: 'Book an appointment',
    description: 'Customer can book an appointment',
    priority: 'Must Have' as const,
    dependsOn: [],
    customerValue: 'Core booking flow',
  },
  {
    id: 'FEAT-002',
    name: 'Cancel an appointment',
    description: 'Customer can cancel a booking',
    priority: 'Should Have' as const,
    dependsOn: ['FEAT-001'],
    customerValue: 'Reduces no-shows',
  },
];

describe('promoteFeaturesForMvp — Sprint 78 Phase 0 idempotent Gate A promotion', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('creates a new Feature row for each source feature when none exist yet', async () => {
    const inserted: Record<string, unknown>[] = [];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: mockFeatureRow({ id: `feature-${row.code}`, code: row.code, title: row.title }),
                  error: null,
                }),
            }),
          };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await promoteFeaturesForMvp('proj-1', 'mvp-1', SOURCE_FEATURES);

    expect(result.ok).toBe(true);
    expect(result.features).toHaveLength(2);
    expect(inserted.map((row) => row.code)).toEqual(['FEAT-001', 'FEAT-002']);
    expect(inserted[0]).toMatchObject({ mvp_id: 'mvp-1', project_id: 'proj-1', code: 'FEAT-001' });
  });

  it('is idempotent — re-promoting the same features for the same MVP never creates duplicate rows and never touches status', async () => {
    const existingRows = [
      mockFeatureRow({ id: 'feature-1', code: 'FEAT-001', status: 'in_progress' }),
      mockFeatureRow({ id: 'feature-2', code: 'FEAT-002', status: 'planned' }),
    ];

    const insertCalls: Record<string, unknown>[] = [];
    const updateCalls: Record<string, unknown>[] = [];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: existingRows, error: null }) }) }),
        insert: (row: Record<string, unknown>) => {
          insertCalls.push(row);
          return {
            select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('should not insert') }) }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await promoteFeaturesForMvp('proj-1', 'mvp-1', SOURCE_FEATURES);

    expect(result.ok).toBe(true);
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(2);

    // status is never part of the update payload — re-promotion must not reset engineering progress.
    for (const payload of updateCalls) {
      expect(payload).not.toHaveProperty('status');
    }

    // Existing engineering progress (status) is preserved in the returned view of these Features.
    expect(result.features.find((f) => f.code === 'FEAT-001')?.status).toBe('in_progress');
  });

  it('updates descriptive fields (title/description/priority/dependsOn/customerValue) on re-promotion when the source draft changed', async () => {
    const existingRows = [
      mockFeatureRow({ id: 'feature-1', code: 'FEAT-001', title: 'Old title', status: 'generated' }),
    ];
    const updateCalls: Record<string, unknown>[] = [];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: existingRows, error: null }) }) }),
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    await promoteFeaturesForMvp('proj-1', 'mvp-1', [SOURCE_FEATURES[0]]);

    expect(updateCalls[0]).toMatchObject({ title: 'Book an appointment' });
  });
});

describe('resolveActiveMvpFeatures — Sprint 78 Phase 0 active-MVP Feature resolution', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns [] when the project has no active MVP', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'builders_mvps') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveActiveMvpFeatures('proj-1');

    expect(result).toEqual([]);
  });

  it("returns exactly the active MVP's Features — the direct replacement for GenerationPlanScope.inScopeFeatureIds", async () => {
    const mvpRows = [mockMvpRow({ id: 'mvp-1', sequence: 1, status: 'approved' })];
    const featureRows = [mockFeatureRow({ id: 'feature-1', mvp_id: 'mvp-1', code: 'FEAT-001' })];

    const from = vi.fn((table: string) => {
      if (table === 'builders_mvps') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mvpRows, error: null }) }) }) };
      }

      if (table === 'builders_features') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: featureRows, error: null }) }) }) };
      }

      throw new Error(`unexpected table ${table}`);
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await resolveActiveMvpFeatures('proj-1');

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('FEAT-001');
    expect(result[0].mvpId).toBe('mvp-1');
  });
});

describe('updateFeatureStatus — Sprint 78 Phase 0 transition validation', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  function mockFrom(
    currentRow: Record<string, unknown> | null,
    update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
  ) {
    return vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: currentRow, error: null }) }) }),
        update,
      };
    });
  }

  it('allows a legal transition (planned -> in_progress)', async () => {
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockFeatureRow({ status: 'planned' }), update) });

    const ok = await updateFeatureStatus('feature-1', 'in_progress');

    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: 'in_progress' });
  });

  it('refuses an illegal transition (planned -> deployed) without writing anything', async () => {
    const update = vi.fn();
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(mockFeatureRow({ status: 'planned' }), update) });

    const ok = await updateFeatureStatus('feature-1', 'deployed');

    expect(ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to update a nonexistent Feature', async () => {
    getBuildersDbClientMock.mockReturnValue({ from: mockFrom(null) });

    const ok = await updateFeatureStatus('feature-missing', 'in_progress');

    expect(ok).toBe(false);
  });
});

describe('listFeaturesForMvp — safe fallback', () => {
  it('returns [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await listFeaturesForMvp('mvp-1');

    expect(result).toEqual([]);
  });
});
