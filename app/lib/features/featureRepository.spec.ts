import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const {
  promoteFeaturesForMvp,
  resolveActiveMvpFeatures,
  updateFeatureStatus,
  listFeaturesForMvp,
  listFeaturesForProject,
  detectFeatureCodeCollisions,
} = await import('./featureRepository');

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

describe('listFeaturesForProject — Sprint 81 (Cross-MVP Foundation)', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('returns every committed Feature across ALL MVPs in the project, in project (created_at) order', async () => {
    const rows = [
      mockFeatureRow({ id: 'feature-1', mvp_id: 'mvp-1', code: 'FEAT-001', created_at: '2026-07-25T00:00:00.000Z' }),
      mockFeatureRow({ id: 'feature-2', mvp_id: 'mvp-2', code: 'FEAT-002', created_at: '2026-07-26T00:00:00.000Z' }),
    ];

    const from = vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: (column: string, value: string) => {
            expect(column).toBe('project_id');
            expect(value).toBe('proj-1');

            return { order: () => Promise.resolve({ data: rows, error: null }) };
          },
        }),
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await listFeaturesForProject('proj-1');

    expect(result.map((feature) => feature.code)).toEqual(['FEAT-001', 'FEAT-002']);
    expect(result.map((feature) => feature.mvpId)).toEqual(['mvp-1', 'mvp-2']);
  });

  it('returns [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await listFeaturesForProject('proj-1')).toEqual([]);
  });
});

describe('detectFeatureCodeCollisions — Sprint 81 (Cross-MVP Foundation, Migration Safety)', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  function mockListFrom(rows: Record<string, unknown>[]) {
    return vi.fn((table: string) => {
      if (table !== 'builders_features') {
        throw new Error(`unexpected table ${table}`);
      }

      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) };
    });
  }

  it('reports [] for a project with no cross-MVP collisions (the expected case for every project today)', async () => {
    const rows = [
      mockFeatureRow({ id: 'feature-1', mvp_id: 'mvp-1', code: 'FEAT-001' }),
      mockFeatureRow({ id: 'feature-2', mvp_id: 'mvp-1', code: 'FEAT-002' }),
    ];
    getBuildersDbClientMock.mockReturnValue({ from: mockListFrom(rows) });

    expect(await detectFeatureCodeCollisions('proj-1')).toEqual([]);
  });

  it('detects (never repairs) a Feature code shared by two DIFFERENT MVPs in the same project', async () => {
    const rows = [
      mockFeatureRow({ id: 'feature-1', mvp_id: 'mvp-1', code: 'FEAT-001', title: 'Book an appointment' }),
      mockFeatureRow({ id: 'feature-2', mvp_id: 'mvp-2', code: 'FEAT-001', title: 'Unrelated billing feature' }),
    ];
    getBuildersDbClientMock.mockReturnValue({ from: mockListFrom(rows) });

    const collisions = await detectFeatureCodeCollisions('proj-1');

    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toEqual({
      projectId: 'proj-1',
      code: 'FEAT-001',
      features: [
        { id: 'feature-1', mvpId: 'mvp-1', code: 'FEAT-001', title: 'Book an appointment' },
        { id: 'feature-2', mvpId: 'mvp-2', code: 'FEAT-001', title: 'Unrelated billing feature' },
      ],
    });
  });

  it('does NOT report two Features sharing a code under the SAME MVP as a collision (that is the existing, valid (mvp_id, code) case)', async () => {
    // Not realistically reachable (builders_features_project_code_unique/older mvp_code_unique would reject it), but confirms the detector's own logic keys on distinct mvpId, not just a repeated code.
    const rows = [
      mockFeatureRow({ id: 'feature-1', mvp_id: 'mvp-1', code: 'FEAT-001' }),
      mockFeatureRow({ id: 'feature-2', mvp_id: 'mvp-1', code: 'FEAT-001' }),
    ];
    getBuildersDbClientMock.mockReturnValue({ from: mockListFrom(rows) });

    expect(await detectFeatureCodeCollisions('proj-1')).toEqual([]);
  });

  it('returns [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await detectFeatureCodeCollisions('proj-1')).toEqual([]);
  });
});
