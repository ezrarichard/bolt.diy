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
  getEffectiveRegionalSelectionMock,
  getEffectivePackageSelectionMock,
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
  getEffectiveRegionalSelectionMock: vi.fn(),
  getEffectivePackageSelectionMock: vi.fn(),
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

vi.mock('~/lib/regional/regionalResolutionService', () => ({
  getEffectiveRegionalSelection: getEffectiveRegionalSelectionMock,
}));

vi.mock('~/lib/package-intelligence/packageResolutionService', () => ({
  getEffectivePackageSelection: getEffectivePackageSelectionMock,
}));

/*
 * Sprint 71 — module-level default (never reset by any pre-existing describe block's own
 * beforeEach, since none of them reference this mock): every Blueprint-only test written
 * before Sprint 71 gets a consistent "no regional profile resolved" result, so
 * `buildRegionalGuidance` returns null exactly like it did before this mock existed. Tests that
 * actually exercise Regional Guidance override this per-test.
 */
getEffectiveRegionalSelectionMock.mockResolvedValue({
  regionalProfileId: null,
  regionalProfileCode: null,
  regionalProfileVersion: null,
  selectionSource: 'none',
  sourceValue: null,
  matchedCountry: null,
  unresolvedReason: 'No manual regional selection has been made for this project.',
  resolvedAt: '2026-01-01T00:00:00.000Z',
  contentAvailable: false,
});

/*
 * Sprint 73 — module-level default (never reset by any pre-existing describe block's own
 * beforeEach, since none of them reference this mock): every pre-Sprint-73 test gets a
 * consistent "no package profile resolved" result, so `buildPackageGuidance` returns null
 * exactly like it did before this mock existed. Tests that actually exercise Package Guidance
 * override this per-test.
 */
getEffectivePackageSelectionMock.mockResolvedValue({
  packageProfileId: null,
  packageProfileCode: null,
  packageProfileVersion: null,
  selectionSource: 'none',
  sourceValue: null,
  unresolvedReason: 'No manual package selection has been made for this project.',
  resolvedAt: '2026-01-01T00:00:00.000Z',
  contentAvailable: false,
});

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

  it('never adds Blueprint guidance for a role outside the pipeline entirely (every real pipeline role has its own guidance as of Sprint 68)', async () => {
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

    const block = await buildRoleContextBlock('proj-1', 'unknown-role-draft', 'Build a dental clinic site');
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

  it('never adds any Blueprint guidance for a role outside the pipeline entirely (every real pipeline role has its own guidance as of Sprint 68)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'unknown-role-draft', 'Build a dental clinic site');
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

describe('buildersDbContextProvider — Sprint 67 Blueprint-Aware UI/UX Design', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for UI/UX Design');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for UI/UX Design');
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

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('improves information architecture via functional modules and user roles', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          functionalModules: [{ name: 'Booking', description: 'Appointment scheduling', features: [] }],
          userRoles: [{ name: 'Patient', description: 'Books appointments', permissions: [] }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Booking');
    expect(block).toContain('role-specific experiences');
    expect(block).toContain('Patient');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['userRoles', 'functionalModules']);
  });

  it('surfaces navigation and UI patterns', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          navigation: [{ label: 'Home', description: 'Landing page' }],
          uiPatterns: [{ name: 'Sticky cart', description: 'Always visible' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Home');
    expect(block).toContain('Sticky cart');
  });

  it('surfaces dashboard suggestions and reports when present', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          dashboardSuggestions: [{ name: 'Sales', description: 'Revenue overview', metrics: [] }],
          reports: [{ name: 'Sales Report', description: 'Monthly revenue', audience: 'Owner' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Sales');
    expect(block).toContain('Sales Report');
  });

  it('surfaces business rules affecting user flows', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          businessRules: [{ rule: 'No overselling', rationale: 'Prevents complaints' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('user-flow implications');
    expect(block).toContain('No overselling');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for UI/UX Design');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site')).resolves.toEqual(
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
          compliance: [{ name: 'GST invoicing', description: 'Tax compliance' }],
          businessDomain: { industry: 'Retail', category: 'Commerce', description: 'Sells things.' },
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
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
        sectionsSupplied: ['compliance', 'businessDomain'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds UI/UX Blueprint guidance for a different role (e.g. frontend-draft uses its own Sprint 67 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for UI/UX Design');
  });

  it('never affects the Backend Engineer role (backend-draft keeps its own Sprint 66 guidance, unaffected by Sprint 67)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for Backend Design');
    expect(block).not.toContain('Blueprint Guidance for UI/UX Design');
    expect(block).not.toContain('Blueprint Guidance for Frontend Implementation');
  });

  it('never leaks UI/UX Blueprint guidance into QA or DevOps (each gets its own guidance as of Sprint 68)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const qaBlock = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    const devopsBlock = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(qaBlock).not.toContain('Blueprint Guidance for UI/UX Design');
    expect(devopsBlock).not.toContain('Blueprint Guidance for UI/UX Design');
  });
});

describe('buildersDbContextProvider — Sprint 67 Blueprint-Aware Frontend Engineering', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Frontend Implementation');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for Frontend Implementation');
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

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('improves component/route decomposition via functional modules and navigation', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          functionalModules: [{ name: 'Booking', description: 'Appointment scheduling', features: [] }],
          navigation: [{ label: 'Home', description: 'Landing page' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Booking');
    expect(block).toContain('Home');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['functionalModules', 'navigation']);
  });

  it('surfaces performance and browser-relevant security expectations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          performanceExpectations: [{ metric: 'Time to Interactive', target: '<2s' }],
          security: [{ concern: 'XSS', mitigation: 'Sanitize input' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Time to Interactive');
    expect(block).toContain('Browser-relevant security expectations');
    expect(block).toContain('XSS');
  });

  it('surfaces business rules affecting validation/interaction', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          businessRules: [{ rule: 'No overselling', rationale: 'Prevents complaints' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('validation/interaction implications');
    expect(block).toContain('No overselling');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Frontend Implementation');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site')).resolves.toEqual(
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
          reports: [{ name: 'Sales Report', description: 'Monthly revenue', audience: 'Owner' }],
          integrations: [{ name: 'Razorpay', purpose: 'Payments', required: true }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
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
        sectionsSupplied: ['reports', 'integrations'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds Frontend Blueprint guidance for a different role (e.g. uiux-draft uses its own Sprint 67 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for Frontend Implementation');
  });

  it('never affects the UI/UX Designer role (uiux-draft keeps its own Sprint 67 guidance, unaffected by this Frontend guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for UI/UX Design');
    expect(block).not.toContain('Blueprint Guidance for Frontend Implementation');
  });

  it('never leaks Frontend Blueprint guidance into QA or DevOps (each gets its own guidance as of Sprint 68)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const qaBlock = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    const devopsBlock = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(qaBlock).not.toContain('Blueprint Guidance for Frontend Implementation');
    expect(devopsBlock).not.toContain('Blueprint Guidance for Frontend Implementation');
  });
});

describe('buildersDbContextProvider — Sprint 68 Blueprint-Aware QA Engineering', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for QA Testing');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for QA Testing');
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

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('improves functional and business-rule test coverage', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          functionalModules: [{ name: 'Booking', description: 'Appointment scheduling', features: [] }],
          businessRules: [{ rule: 'No double booking', rationale: 'Prevents scheduling conflicts' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Booking');
    expect(block).toContain('No double booking');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['functionalModules', 'businessRules']);
  });

  it('surfaces industry-typical testing scenarios and failure risks', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          testingScenarios: [{ scenario: 'Double-book the same slot', expectedOutcome: 'Booking rejected' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Industry-typical testing scenarios');
    expect(block).toContain('Double-book the same slot');
  });

  it('surfaces compliance and security validation expectations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          compliance: [{ name: 'HIPAA', description: 'Patient data protection' }],
          security: [{ concern: 'PHI leakage', mitigation: 'Encrypt patient records at rest' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Compliance considerations to validate');
    expect(block).toContain('HIPAA');
    expect(block).toContain('Security expectations to validate');
    expect(block).toContain('PHI leakage');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for QA Testing');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site')).resolves.toEqual(
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
          performanceExpectations: [{ metric: 'API latency', target: '<200ms' }],
          userRoles: [{ name: 'Patient', description: 'Books appointments', permissions: [] }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
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
        sectionsSupplied: ['userRoles', 'performanceExpectations'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds QA Blueprint guidance for a different role (e.g. devops-draft uses its own Sprint 68 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for QA Testing');
  });

  it('never affects the Frontend Engineer role (frontend-draft keeps its own Sprint 67 guidance, unaffected by Sprint 68)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for Frontend Implementation');
    expect(block).not.toContain('Blueprint Guidance for QA Testing');
    expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
  });

  it('never leaks into any earlier Blueprint-aware role (Business Analyst through UI/UX)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const baBlock = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    const poBlock = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    const archBlock = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    const dbBlock = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    const backendBlock = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    const uiuxBlock = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    for (const block of [baBlock, poBlock, archBlock, dbBlock, backendBlock, uiuxBlock]) {
      expect(block).not.toContain('Blueprint Guidance for QA Testing');
    }
  });
});

describe('buildersDbContextProvider — Sprint 68 Blueprint-Aware DevOps Engineering', () => {
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

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
    expect(getBlueprintMock).not.toHaveBeenCalled();
  });

  it('uses the recommended Blueprint when selected equals recommended', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('business-website');
    expect(block).toContain('Blueprint Guidance for DevOps Operations');
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

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build an AI product');
    await flush();

    expect(getBlueprintMock).toHaveBeenCalledWith('ai-agent');
    expect(block).toContain('manually selected by the user');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource).toEqual(
      expect.objectContaining({ blueprintId: 'ai-agent', selectionSource: 'manual_override' }),
    );
  });

  it('improves deployment planning via integrations and deployment considerations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          integrations: [{ name: 'Razorpay', purpose: 'Payments', required: true }],
          deploymentConsiderations: [{ consideration: 'Autoscaling', detail: 'Scale on CPU > 70%' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Razorpay');
    expect(block).toContain('Autoscaling');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.sectionsSupplied).toEqual(['integrations', 'deploymentConsiderations']);
  });

  it('surfaces security hardening and compliance-aware operations', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          security: [{ concern: 'PHI leakage', mitigation: 'Encrypt patient records at rest' }],
          compliance: [{ name: 'HIPAA', description: 'Patient data protection' }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('security hardening');
    expect(block).toContain('PHI leakage');
    expect(block).toContain('compliance-aware operations');
    expect(block).toContain('HIPAA');
  });

  it('surfaces operational alerting via notifications and access control via user roles', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(
      makeBlueprint({
        content: {
          schemaVersion: 1,
          notifications: [{ name: 'Deploy failed', trigger: 'CI pipeline failure', channel: 'PagerDuty' }],
          userRoles: [{ name: 'Admin', description: 'Manages the store', permissions: [] }],
        },
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('operational alerting design');
    expect(block).toContain('Deploy failed');
    expect(block).toContain('access control and administrative operations');
    expect(block).toContain('Admin');
  });

  it('continues safely when the selected Blueprint has no structured content yet', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(
      makeResolution({ selectedBlueprintId: 'shopify-app', recommendedBlueprintId: 'shopify-app' }),
    );
    getBlueprintMock.mockReturnValue(makeBlueprint({ id: 'shopify-app', name: 'Shopify App', content: undefined }));

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('No structured Blueprint knowledge is available');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const blueprintSource = sources.find((s: { type: string }) => s.type === 'blueprint-resolution');
    expect(blueprintSource.contentAvailable).toBe(false);
  });

  it('falls back safely when the effective Blueprint id no longer resolves', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution({ selectedBlueprintId: 'deprecated-blueprint' }));
    getBlueprintMock.mockReturnValue(undefined);

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
  });

  it('never throws even when the Blueprint Resolution lookup itself fails', async () => {
    getLatestBlueprintResolutionMock.mockRejectedValue(new Error('BuildersDB unreachable'));

    await expect(buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site')).resolves.toEqual(
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
          performanceExpectations: [{ metric: 'API latency', target: '<200ms' }],
          businessRules: [{ rule: 'No overselling', rationale: 'Prevents complaints' }],
        },
      }),
    );

    await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a dental clinic site');
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
        sectionsSupplied: ['performanceExpectations', 'businessRules'],
        contentAvailable: true,
      }),
    );
  });

  it('never adds DevOps Blueprint guidance for a different role (e.g. qa-draft uses its own Sprint 68 guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
  });

  it('never affects the QA Engineer role (qa-draft keeps its own Sprint 68 guidance, distinct from this DevOps guidance)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance for QA Testing');
    expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
  });

  it('never leaks into any earlier Blueprint-aware role (Business Analyst through Frontend)', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());

    const baBlock = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    const poBlock = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a dental clinic site');
    const archBlock = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    const dbBlock = await buildRoleContextBlock('proj-1', 'database-draft', 'Build a dental clinic site');
    const backendBlock = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a dental clinic site');
    const uiuxBlock = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    const frontendBlock = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a dental clinic site');
    await flush();

    for (const block of [baBlock, poBlock, archBlock, dbBlock, backendBlock, uiuxBlock, frontendBlock]) {
      expect(block).not.toContain('Blueprint Guidance for DevOps Operations');
    }
  });
});

/*
 * Sprint 71 — Regional Intelligence Foundation. `makeRegionalResolution` mirrors `makeBlueprint`/
 * `makeResolution` above: a shared fixture builder for `RegionalResolutionResult`
 * (regionalResolutionService.ts), reused across every describe block below.
 */
function makeRegionalResolution(overrides: Record<string, unknown> = {}) {
  return {
    regionalProfileId: 'region-in',
    regionalProfileCode: 'IN',
    regionalProfileVersion: 1,
    selectionSource: 'manual_override',
    sourceValue: 'IN',
    matchedCountry: 'India',
    resolvedAt: '2026-07-25T00:00:00.000Z',
    contentAvailable: true,
    ...overrides,
  };
}

const UNRESOLVED_REGIONAL = {
  regionalProfileId: null,
  regionalProfileCode: null,
  regionalProfileVersion: null,
  selectionSource: 'none',
  sourceValue: null,
  matchedCountry: null,
  unresolvedReason: 'No manual regional selection has been made for this project.',
  resolvedAt: '2026-01-01T00:00:00.000Z',
  contentAvailable: false,
};

describe('buildersDbContextProvider — Sprint 71 Regional Intelligence Foundation', () => {
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
    getEffectiveRegionalSelectionMock.mockReset().mockResolvedValue(UNRESOLVED_REGIONAL);
  });

  it('adds no Regional Guidance when no regional profile is resolved', async () => {
    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Regional Guidance');
  });

  it('adds Regional Guidance once a manual selection resolves a profile', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Regional Guidance');
    expect(block).toContain('India');
    expect(block).toContain('manually selected by the user');
  });

  it('renders the Regional Guidance heading distinctly from Blueprint Guidance — never merged', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Blueprint Guidance');
    expect(block).toContain('### Regional Guidance');

    const blueprintIndex = block.indexOf('### Blueprint Guidance');
    const regionalIndex = block.indexOf('### Regional Guidance');
    expect(blueprintIndex).toBeGreaterThan(-1);
    expect(regionalIndex).toBeGreaterThan(-1);
    expect(blueprintIndex).not.toBe(regionalIndex);
  });

  it('records correct Regional traceability metadata, separate from Blueprint traceability', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const regionalSource = sources.find((s: { type: string }) => s.type === 'regional-resolution');

    expect(regionalSource).toEqual(
      expect.objectContaining({
        type: 'regional-resolution',
        regionalProfileId: 'region-in',
        regionalProfileCode: 'IN',
        regionalProfileVersion: 1,
        selectionSource: 'manual_override',
        contentAvailable: true,
      }),
    );
  });

  it('never throws when regional content is missing/sparse', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(
      makeRegionalResolution({ contentAvailable: false, regionalProfileCode: 'US' }),
    );

    await expect(buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a US SaaS app')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('never blocks generation when the regional lookup itself fails', async () => {
    getEffectiveRegionalSelectionMock.mockRejectedValue(new Error('lookup failed'));

    await expect(buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('Sprint 72 — a Business Discovery-resolved region produces Regional Guidance, traced as business_discovery', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(
      makeRegionalResolution({
        selectionSource: 'business_discovery',
        regionalProfileCode: 'AE',
        matchedCountry: 'United Arab Emirates',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a booking app');
    await flush();

    expect(block).toContain('### Regional Guidance');
    expect(block).toContain('from Business Discovery');

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const regionalSource = sources.find((s: { type: string }) => s.type === 'regional-resolution');

    expect(regionalSource).toEqual(expect.objectContaining({ selectionSource: 'business_discovery' }));
  });

  it('Sprint 72 — a manual override replaces Business Discovery-sourced guidance', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution({ selectionSource: 'manual_override' }));

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('manually selected by the user');
    expect(block).not.toContain('from Business Discovery');
  });

  it('gives the Business/Product family (requirements-draft) business-facing regional terminology', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Tax terminology for this market');
  });

  it('gives the Architecture/Engineering family (architecture-draft) technical regional guidance, not business terminology', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Regional Guidance');
    expect(block).not.toContain('Tax terminology for this market');
    expect(block).not.toContain('Invoice conventions');
  });

  it('gives the Design/Quality family (uiux-draft) formatting/accessibility guidance, not business or engineering-only sections', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Regional Guidance');
    expect(block).not.toContain('Invoice conventions');
  });

  it('no cross-family leakage: QA (design-quality) never contains Architecture/Engineering-only deployment wording', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(
      makeRegionalResolution({
        regionalProfileCode: 'US',
        regionalProfileId: 'region-us',
        matchedCountry: 'United States',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a US SaaS app');
    await flush();

    expect(block).not.toContain('Deployment considerations');
  });

  it('existing Blueprint-aware behaviour remains unchanged when Blueprint guidance is also present', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());
    getEffectiveRegionalSelectionMock.mockResolvedValue(UNRESOLVED_REGIONAL);

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Blueprint Guidance');
    expect(block).not.toContain('Regional Guidance');
  });

  it('a project with no region source still generates exactly as before (empty context stays empty)', async () => {
    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', undefined);
    await flush();

    expect(block).toBe('');
  });
});

describe('buildersDbContextProvider — Sprint 71 Regional Intelligence scope control', () => {
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
    getEffectiveRegionalSelectionMock.mockReset().mockResolvedValue(makeRegionalResolution());
  });

  it('payment guidance is always gated by "only where payments are already approved" language, never a bare instruction', async () => {
    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a booking system');
    await flush();

    if (block.includes('Payment-method conventions')) {
      expect(block).toContain('only where payments are already approved');
    }
  });

  it('a booking-style project receives timezone guidance from the Architecture/Engineering family', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(
      makeRegionalResolution({
        regionalProfileCode: 'US',
        regionalProfileId: 'region-us',
        matchedCountry: 'United States',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a booking system');
    await flush();

    expect(block).toContain('Timezone strategy');
  });

  it('India-market e-commerce context surfaces GST terminology gated by "already approved"', async () => {
    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build an e-commerce checkout');
    await flush();

    expect(block).toContain('GST');
    expect(block).toContain('already approved');
  });

  it('invoicing guidance is never presented as a mandatory implementation requirement', async () => {
    const block = await buildRoleContextBlock('proj-1', 'product-owner-draft', 'Build a basic informational website');
    await flush();

    if (block.includes('Invoice conventions')) {
      expect(block).toContain('only where invoicing is already approved');
    }
  });

  it('regional guidance never mentions authentication as something it adds', async () => {
    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a basic informational website');
    await flush();

    expect(block.toLowerCase()).not.toContain('regional guidance adds authentication');
  });

  it('regional guidance never claims to add localization/multi-language support automatically', async () => {
    const block = await buildRoleContextBlock('proj-1', 'frontend-draft', 'Build a basic informational website');
    await flush();

    expect(block.toLowerCase()).not.toContain('automatically translat');
    expect(block.toLowerCase()).not.toContain('automatically localiz');
  });

  it('data-residency guidance remains advisory, never an automatic infrastructure requirement', async () => {
    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a basic informational website');
    await flush();

    if (block.includes('Data-residency considerations')) {
      expect(block).toContain('advisory only');
    }
  });
});

/*
 * Sprint 73 — Package Intelligence Foundation. `makePackageResolution` mirrors
 * `makeRegionalResolution` above: a shared fixture builder for `PackageResolutionResult`
 * (packageResolutionService.ts), reused across every describe block below.
 */
function makePackageResolution(overrides: Record<string, unknown> = {}) {
  return {
    packageProfileId: 'package-professional',
    packageProfileCode: 'PROFESSIONAL',
    packageProfileVersion: 1,
    selectionSource: 'manual_override',
    sourceValue: 'PROFESSIONAL',
    resolvedAt: '2026-07-25T00:00:00.000Z',
    contentAvailable: true,
    ...overrides,
  };
}

const UNRESOLVED_PACKAGE = {
  packageProfileId: null,
  packageProfileCode: null,
  packageProfileVersion: null,
  selectionSource: 'none',
  sourceValue: null,
  unresolvedReason: 'No manual package selection has been made for this project.',
  resolvedAt: '2026-01-01T00:00:00.000Z',
  contentAvailable: false,
};

describe('buildersDbContextProvider — Sprint 73 Package Intelligence Foundation', () => {
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
    getEffectiveRegionalSelectionMock.mockReset().mockResolvedValue(UNRESOLVED_REGIONAL);
    getEffectivePackageSelectionMock.mockReset().mockResolvedValue(UNRESOLVED_PACKAGE);
  });

  it('adds no Package Guidance when no package profile is resolved', async () => {
    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('Package Guidance');
  });

  it('adds Package Guidance once a manual selection resolves a profile — Starter', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(
      makePackageResolution({
        packageProfileCode: 'STARTER',
        packageProfileId: 'package-starter',
        sourceValue: 'STARTER',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Package Guidance');
    expect(block).toContain('Starter');
  });

  it('adds Package Guidance once a manual selection resolves a profile — Professional', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a booking system');
    await flush();

    expect(block).toContain('### Package Guidance');
    expect(block).toContain('Professional');
  });

  it('adds Package Guidance once a manual selection resolves a profile — Premium', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(
      makePackageResolution({
        packageProfileCode: 'PREMIUM',
        packageProfileId: 'package-premium',
        sourceValue: 'PREMIUM',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build an e-commerce product');
    await flush();

    expect(block).toContain('### Package Guidance');
    expect(block).toContain('Premium');
  });

  it('renders the Package Guidance heading distinctly from Blueprint and Regional Guidance — never merged', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Blueprint Guidance');
    expect(block).toContain('### Regional Guidance');
    expect(block).toContain('### Package Guidance');

    const blueprintIndex = block.indexOf('### Blueprint Guidance');
    const regionalIndex = block.indexOf('### Regional Guidance');
    const packageIndex = block.indexOf('### Package Guidance');

    expect(new Set([blueprintIndex, regionalIndex, packageIndex]).size).toBe(3);
    expect(regionalIndex).toBeGreaterThan(blueprintIndex);
    expect(packageIndex).toBeGreaterThan(regionalIndex);
  });

  it('records correct Package traceability metadata, separate from Blueprint and Regional traceability', async () => {
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    const [{ sources }] = saveContextTraceMock.mock.calls[0];
    const packageSource = sources.find((s: { type: string }) => s.type === 'package-resolution');
    const regionalSource = sources.find((s: { type: string }) => s.type === 'regional-resolution');

    expect(packageSource).toEqual(
      expect.objectContaining({
        type: 'package-resolution',
        packageProfileId: 'package-professional',
        packageProfileCode: 'PROFESSIONAL',
        packageProfileVersion: 1,
        selectionSource: 'manual_override',
        contentAvailable: true,
      }),
    );
    expect(regionalSource).not.toBe(packageSource);
  });

  it('never throws when package content is missing/sparse', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution({ contentAvailable: false }));

    await expect(buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a US SaaS app')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('never blocks generation when the package lookup itself fails', async () => {
    getEffectivePackageSelectionMock.mockRejectedValue(new Error('lookup failed'));

    await expect(buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('each role receives its correct family guidance — business/product for requirements-draft', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('Delivery positioning');
  });

  it('each role receives its correct family guidance — architecture/engineering for devops-draft', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a booking system');
    await flush();

    expect(block).toContain('### Package Guidance');
  });

  it('each role receives its correct family guidance — design/quality for uiux-draft', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'uiux-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Package Guidance');
  });

  it('an unrecognized role key never receives Package Guidance', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'code-reviewer', 'Build a dental clinic site');
    await flush();

    expect(block).not.toContain('### Package Guidance');
  });

  it('existing Blueprint-aware and Regional behaviour remains unchanged when no package is selected', async () => {
    getLatestBlueprintResolutionMock.mockResolvedValue(makeResolution());
    getBlueprintMock.mockReturnValue(makeBlueprint());
    getEffectiveRegionalSelectionMock.mockResolvedValue(makeRegionalResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a dental clinic site');
    await flush();

    expect(block).toContain('### Blueprint Guidance');
    expect(block).toContain('### Regional Guidance');
    expect(block).not.toContain('### Package Guidance');
  });
});

describe('buildersDbContextProvider — Sprint 73 Package Intelligence scope control', () => {
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
    getEffectiveRegionalSelectionMock.mockReset().mockResolvedValue(UNRESOLVED_REGIONAL);
  });

  it('Starter never drops below the minimum quality floor', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(
      makePackageResolution({
        packageProfileCode: 'STARTER',
        packageProfileId: 'package-starter',
        sourceValue: 'STARTER',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'qa-draft', 'Build a basic informational website');
    await flush();

    expect(block).toContain('Minimum quality floor');
    expect(block).toContain('Automated tests covering the critical user-facing paths');
  });

  it('Professional package guidance never instructs adding analytics — only ever "does not add" phrasing', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a booking system');
    await flush();

    const text = block.toLowerCase();

    if (text.includes('add analytics')) {
      expect(text).toContain('does not add analytics');
    }
  });

  it('Premium package guidance never instructs adding authentication, SSO, or multi-tenancy', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(
      makePackageResolution({
        packageProfileCode: 'PREMIUM',
        packageProfileId: 'package-premium',
        sourceValue: 'PREMIUM',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'architecture-draft', 'Build a US SaaS product');
    await flush();

    const sentences = block.toLowerCase().split(/[.\n]/);

    for (const sentence of sentences) {
      for (const phrase of ['add authentication', 'add sso', 'add multi-tenancy']) {
        if (sentence.includes(phrase)) {
          expect(sentence).toMatch(/not/);
        }
      }
    }
  });

  it('Premium package guidance never automatically requires microservices or Kubernetes', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(
      makePackageResolution({
        packageProfileCode: 'PREMIUM',
        packageProfileId: 'package-premium',
        sourceValue: 'PREMIUM',
      }),
    );

    const block = await buildRoleContextBlock('proj-1', 'devops-draft', 'Build a US SaaS product');
    await flush();

    expect(block.toLowerCase()).toContain('does not automatically require microservices, kubernetes');
  });

  it('Package Guidance never mentions payments, new user roles, integrations, or mobile apps as additions', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'backend-draft', 'Build a booking system');
    await flush();

    const text = block.toLowerCase();

    for (const phrase of ['add payments', 'add mobile apps', 'add integrations']) {
      if (text.includes(phrase)) {
        expect(text).toContain(`does not ${phrase}`);
      }
    }
  });

  it('Package Guidance is always scope-controlled: it only changes implementation depth', async () => {
    getEffectivePackageSelectionMock.mockResolvedValue(makePackageResolution());

    const block = await buildRoleContextBlock('proj-1', 'requirements-draft', 'Build a booking system');
    await flush();

    expect(block).toContain(
      'Package Guidance controls implementation depth and delivery maturity for already-approved product scope.',
    );
  });
});
