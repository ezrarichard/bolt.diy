import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  isBuildersDbAvailableMock,
  getRoleOutputsForProjectMock,
  getProjectTasksMock,
  getTaskReviewsMock,
  addProjectActivityMock,
  saveContextTraceMock,
  getLatestRequirementsSessionMock,
  getBusinessUnderstandingModelMock,
  getLatestBlueprintResolutionMock,
  getBlueprintMock,
} = vi.hoisted(() => ({
  isBuildersDbAvailableMock: vi.fn(),
  getRoleOutputsForProjectMock: vi.fn(),
  getProjectTasksMock: vi.fn(),
  getTaskReviewsMock: vi.fn(),
  addProjectActivityMock: vi.fn(),
  saveContextTraceMock: vi.fn(),
  getLatestRequirementsSessionMock: vi.fn(),
  getBusinessUnderstandingModelMock: vi.fn(),
  getLatestBlueprintResolutionMock: vi.fn(),
  getBlueprintMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  isBuildersDbAvailable: isBuildersDbAvailableMock,
  buildersDbRepository: {
    getRoleOutputsForProject: getRoleOutputsForProjectMock,
    getProjectTasks: getProjectTasksMock,
    getTaskReviews: getTaskReviewsMock,
    addProjectActivity: addProjectActivityMock,
    saveContextTrace: saveContextTraceMock,
  },
}));

vi.mock('~/lib/builders-db/repositories/requirementsSessionRepository', () => ({
  getLatestRequirementsSession: getLatestRequirementsSessionMock,
}));

vi.mock('~/lib/builders-db/repositories/businessUnderstandingRepository', () => ({
  getBusinessUnderstandingModel: getBusinessUnderstandingModelMock,
}));

vi.mock('~/lib/projects/blueprintResolutionService', () => ({
  getLatestBlueprintResolution: getLatestBlueprintResolutionMock,
}));

vi.mock('~/lib/blueprints', () => ({
  blueprintEngine: { getBlueprint: getBlueprintMock },
}));

const { buildRoleContextBlock } = await import('./buildersDbContextProvider');

/** Lets the fire-and-forget recordContextTrace() promise chain settle before assertions run. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function emptyModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    assessment: {},
    businessIdentity: {},
    businessGoals: [],
    processes: [],
    targetUsers: [],
    painPoints: [],
    businessConstraints: [],
    currentSystems: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    recommendations: [],
    assumptions: [],
    risks: [],
    openQuestions: [],
    traceability: [],
    completeness: { categories: {}, overallReady: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildersDbContextProvider — Sprint 52 Business Understanding provenance', () => {
  beforeEach(() => {
    isBuildersDbAvailableMock.mockReset().mockReturnValue(true);
    getRoleOutputsForProjectMock.mockReset().mockResolvedValue([]);
    getProjectTasksMock.mockReset().mockResolvedValue([]);
    getTaskReviewsMock.mockReset().mockResolvedValue([]);
    addProjectActivityMock.mockReset().mockResolvedValue(true);
    saveContextTraceMock.mockReset().mockResolvedValue(true);
    getLatestRequirementsSessionMock.mockReset();
    getBusinessUnderstandingModelMock.mockReset();
    getLatestBlueprintResolutionMock.mockReset().mockResolvedValue(null);
    getBlueprintMock.mockReset();
    getLatestRequirementsSessionMock.mockResolvedValue(null);
  });

  it('includes populated Business Understanding sections as sources when building context for the Requirements role', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
    getBusinessUnderstandingModelMock.mockResolvedValue(
      emptyModel({ targetUsers: ['Patients'], functionalRequirements: ['Booking'] }),
    );

    await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(saveContextTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        roleKey: 'requirements-draft',
        sources: expect.arrayContaining([
          expect.objectContaining({
            type: 'business-understanding-section',
            sectionKey: 'targetUsers',
            sessionId: 'session-1',
          }),
          expect.objectContaining({
            type: 'business-understanding-section',
            sectionKey: 'functionalRequirements',
            sessionId: 'session-1',
          }),
        ]),
      }),
    );
  });

  it('excludes empty Business Understanding sections from the trace', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue({ id: 'session-1' });
    getBusinessUnderstandingModelMock.mockResolvedValue(emptyModel({ targetUsers: ['Patients'] }));

    await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const sectionKeys = sources
      .filter((s: { type: string }) => s.type === 'business-understanding-section')
      .map((s: { sectionKey: string }) => s.sectionKey);

    expect(sectionKeys).toEqual(['targetUsers']);
  });

  it('does not add Business Understanding sources for a different role (e.g. architecture-draft)', async () => {
    getRoleOutputsForProjectMock.mockResolvedValue([
      {
        id: 'art-1',
        taskId: 'requirements',
        title: 'Requirements Draft',
        type: 'requirements-draft',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'approved',
        content: '{}',
        version: 1,
      },
    ]);

    await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(getLatestRequirementsSessionMock).not.toHaveBeenCalled();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    expect(sources.some((s: { type: string }) => s.type === 'business-understanding-section')).toBe(false);
  });

  it('records no Business Understanding sources when the project has no session yet', async () => {
    getLatestRequirementsSessionMock.mockResolvedValue(null);

    await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(getBusinessUnderstandingModelMock).not.toHaveBeenCalled();
  });

  it('never throws even if the Business Understanding lookup fails', async () => {
    getLatestRequirementsSessionMock.mockRejectedValue(new Error('network down'));

    await expect(buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });
});

function makeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'business-website',
    name: 'Business Website',
    icon: '🏪',
    description: 'A marketing site.',
    category: 'Website',
    enabled: true,
    version: 2,
    content: undefined,
    ...overrides,
  };
}

function makeResolution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    projectId: 'proj-1',
    sessionId: 'session-1',
    recommendedBlueprintId: 'business-website',
    selectedBlueprintId: 'business-website',
    confidence: 80,
    explanation: ['Local service business'],
    candidates: [],
    resolvedAt: '2026-07-31T00:00:00.000Z',
    createdAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildersDbContextProvider — Sprint 63 Blueprint-Aware Business Analysis', () => {
  beforeEach(() => {
    isBuildersDbAvailableMock.mockReset().mockReturnValue(true);
    getRoleOutputsForProjectMock.mockReset().mockResolvedValue([]);
    getProjectTasksMock.mockReset().mockResolvedValue([]);
    getTaskReviewsMock.mockReset().mockResolvedValue([]);
    addProjectActivityMock.mockReset().mockResolvedValue(true);
    saveContextTraceMock.mockReset().mockResolvedValue(true);
    getLatestRequirementsSessionMock.mockReset().mockResolvedValue(null);
    getBusinessUnderstandingModelMock.mockReset();
    getLatestBlueprintResolutionMock.mockReset();
    getBlueprintMock.mockReset();
  });

  it('adds no Blueprint guidance when no resolution has ever been recorded', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(null);

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance');
    expect(block).toContain('the recommended match');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({
        blueprintId: 'business-website',
        blueprintVersion: 2,
        resolutionId: 'res-1',
        selectionSource: 'recommendation',
        contentAvailable: false,
      }),
    );
  });

  it('uses the manually-selected Blueprint even when it differs from the recommendation, and records the override', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ recommendedBlueprintId: 'business-website', selectedBlueprintId: 'localshop-india' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'localshop-india', name: 'LocalShop India' }));

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a clothing store site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('localshop-india');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'localshop-india', selectionSource: 'manual_override' }),
    );
  });

  it('includes the Blueprint`s structured content when available', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          executiveSummary: { summary: 'A marketing site for local businesses.', valueProposition: 'Fast and simple.' },
          standardFeatures: [{ name: 'Contact form', description: 'Lets visitors reach out' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('A marketing site for local businesses.');
    expect(block).toContain('Contact form');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(true);
    expect(blueprintSource.sectionsSupplied).toEqual(['executiveSummary', 'standardFeatures']);
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves (deprecated/unhydrated)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance');

    const [{ sources }] = saveContextTraceMock.mock.calls[0] ?? [{ sources: [] }];
    expect((sources ?? []).some((s: { type: string }) => s.type === 'blueprint-resolution')).toBe(false);
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });

  it('never adds Blueprint guidance for a different role (e.g. architecture-draft)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());
    getRoleOutputsForProjectMock.mockResolvedValue([
      {
        id: 'art-1',
        taskId: 'requirements',
        title: 'Requirements Draft',
        type: 'requirements-draft',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'approved',
        content: '{}',
        version: 1,
      },
    ]);

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(getLatestBlueprintResolutionMock).not.toHaveBeenCalled();
    expect(block).not.toContain('Blueprint Guidance');
  });
});
