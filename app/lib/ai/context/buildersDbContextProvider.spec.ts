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

  it('never adds Blueprint guidance for a different role (e.g. qa-draft — architecture/database/backend-draft each get their own guidance since Sprint 65/66)', async () => {
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

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(getLatestBlueprintResolutionMock).not.toHaveBeenCalled();
    expect(block).not.toContain('Blueprint Guidance');
  });
});

describe('buildersDbContextProvider — Sprint 64 Blueprint-Aware Product Ownership', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Product Planning');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for Product Planning');
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
      makeResolution({ recommendedBlueprintId: 'business-website', selectedBlueprintId: 'ai-agent' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'ai-agent', name: 'AI Agent' }));

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('includes Product-Owner-relevant sections (business goals, standard/optional features) when available', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          businessGoals: [{ goal: 'Generate enquiries', description: 'Convert visitors', priority: 'high' }],
          standardFeatures: [{ name: 'Contact form', description: 'Lets visitors reach out' }],
          optionalFeatures: [{ name: 'Online booking', description: 'Self-serve scheduling' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Generate enquiries');
    expect(block).toContain('Contact form');
    expect(block).toContain('Online booking');
    expect(block).toContain('recommend, never auto-scope');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(true);
    expect(blueprintSource.sectionsSupplied).toEqual(['businessGoals', 'standardFeatures', 'optionalFeatures']);
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Product Planning');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });

  it('never adds Product Owner Blueprint guidance for a different role (e.g. requirements-draft uses its own BA guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Product Planning');
  });

  it('never adds any Blueprint guidance for an unrelated role (e.g. qa-draft — architecture/database/backend-draft each get their own guidance since Sprint 65/66)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(getLatestBlueprintResolutionMock).not.toHaveBeenCalled();
    expect(block).not.toContain('Blueprint Guidance');
  });
});

describe('buildersDbContextProvider — Sprint 65 Blueprint-Aware Solution Architecture', () => {
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

  it('adds no Blueprint guidance when no resolution has ever been recorded — architecture unchanged', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(null);

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Solution Architecture');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for Solution Architecture');
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

  it('respects manual override: uses the selected Blueprint even when it differs from the recommendation, and records the override', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ recommendedBlueprintId: 'business-website', selectedBlueprintId: 'localshop-india' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'localshop-india', name: 'LocalShop India' }));

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a clothing store site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('localshop-india');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'localshop-india', selectionSource: 'manual_override' }),
    );
  });

  it('surfaces security expectations when available', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          security: [{ concern: 'Payment fraud', mitigation: 'Use a PCI-compliant gateway' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Security expectations');
    expect(block).toContain('Payment fraud');
  });

  it('surfaces performance expectations when available', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          performanceExpectations: [{ metric: 'Load time', target: '<2s' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Performance expectations');
    expect(block).toContain('Load time');
  });

  it('improves integration planning by surfacing typical integrations/external systems', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          integrations: [{ name: 'Razorpay', purpose: 'Payments', required: true }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Typical integrations / external systems');
    expect(block).toContain('Razorpay');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['integrations']);
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves (deprecated/unhydrated)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Solution Architecture');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });

  it('records correct Blueprint traceability metadata: id, version, resolution id, selection source, sections supplied', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          businessDomain: { industry: 'Healthcare', category: 'Local Service', description: 'Dental care.' },
          security: [{ concern: 'PHI exposure', mitigation: 'Encrypt at rest' }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({
        type: 'blueprint-resolution',
        blueprintId: 'business-website',
        blueprintVersion: 2,
        resolutionId: 'res-1',
        selectionSource: 'recommendation',
        sectionsSupplied: ['businessDomain', 'security'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds Solution Architect Blueprint guidance for a different role (e.g. requirements-draft uses its own BA guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Solution Architecture');
  });

  it('never affects the Product Owner role (product-owner-draft keeps its own Sprint 64 guidance, unaffected by Sprint 65)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for Product Planning');
    expect(block).not.toContain('Blueprint Guidance for Solution Architecture');
  });
});

describe('buildersDbContextProvider — Sprint 66 Blueprint-Aware Database Engineering', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Database Design');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for Database Design');
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

  it('respects manual override: uses the selected Blueprint even when it differs from the recommendation, and records the override', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ recommendedBlueprintId: 'business-website', selectedBlueprintId: 'localshop-india' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'localshop-india', name: 'LocalShop India' }));

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a clothing store site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('localshop-india');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'localshop-india', selectionSource: 'manual_override' }),
    );
  });

  it('surfaces entity relationships to improve relationship design', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          dataEntities: [{ name: 'Product', description: 'An item', keyFields: ['sku'], relationships: ['Order'] }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Product');
    expect(block).toContain('Relates to: Order');
  });

  it('surfaces compliance considerations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: { schemaVersion: 1, compliance: [{ name: 'GST invoicing', description: 'Tax compliance' }] },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Compliance considerations');
    expect(block).toContain('GST invoicing');
  });

  it('surfaces security expectations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          security: [{ concern: 'Payment fraud', mitigation: 'Use a PCI-compliant gateway' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Security expectations');
    expect(block).toContain('Payment fraud');
  });

  it('surfaces performance expectations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: { schemaVersion: 1, performanceExpectations: [{ metric: 'Query latency', target: '<100ms' }] },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Performance expectations');
    expect(block).toContain('Query latency');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Database Design');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });

  it('records correct Blueprint traceability metadata', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          userRoles: [{ name: 'Customer', description: 'Buys products', permissions: [] }],
          security: [{ concern: 'PHI exposure', mitigation: 'Encrypt at rest' }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({
        type: 'blueprint-resolution',
        blueprintId: 'business-website',
        blueprintVersion: 2,
        resolutionId: 'res-1',
        selectionSource: 'recommendation',
        sectionsSupplied: ['userRoles', 'security'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds Database Blueprint guidance for a different role (e.g. backend-draft uses its own Sprint 66 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Database Design');
  });
});

describe('buildersDbContextProvider — Sprint 66 Blueprint-Aware Backend Engineering', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Backend Design');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for Backend Design');
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

  it('respects manual override: uses the selected Blueprint even when it differs from the recommendation, and records the override', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ recommendedBlueprintId: 'business-website', selectedBlueprintId: 'ai-agent' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'ai-agent', name: 'AI Agent' }));

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('improves API quality via functional modules and integrations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          functionalModules: [{ name: 'Booking', description: 'Appointment scheduling', features: [] }],
          integrations: [{ name: 'Razorpay', purpose: 'Payments', required: true }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Booking');
    expect(block).toContain('Razorpay');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['functionalModules', 'integrations']);
  });

  it('informs authentication planning via user roles', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          userRoles: [{ name: 'Patient', description: 'Books appointments', permissions: [] }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('authentication/authorization design');
    expect(block).toContain('Patient');
  });

  it('surfaces error-handling-relevant security expectations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          security: [{ concern: 'Rate limit abuse', mitigation: 'Throttle by API key' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Security expectations');
    expect(block).toContain('Rate limit abuse');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Backend Design');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
    await flush();
  });

  it('records correct Blueprint traceability metadata', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
          performanceExpectations: [{ metric: 'API latency', target: '<200ms' }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({
        type: 'blueprint-resolution',
        blueprintId: 'business-website',
        blueprintVersion: 2,
        resolutionId: 'res-1',
        selectionSource: 'recommendation',
        sectionsSupplied: ['performanceExpectations', 'deploymentConsiderations'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds Backend Blueprint guidance for a different role (e.g. database-draft uses its own Sprint 66 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Backend Design');
  });

  it('never affects the Solution Architect role (architecture-draft keeps its own Sprint 65 guidance, unaffected by Sprint 66)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for Solution Architecture');
    expect(block).not.toContain('Blueprint Guidance for Backend Design');
    expect(block).not.toContain('Blueprint Guidance for Database Design');
  });
});
