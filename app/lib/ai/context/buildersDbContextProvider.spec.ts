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
} = vi.hoisted(() => ({
  isBuildersDbAvailableMock: vi.fn(),
  getRoleOutputsForProjectMock: vi.fn(),
  getProjectTasksMock: vi.fn(),
  getTaskReviewsMock: vi.fn(),
  addProjectActivityMock: vi.fn(),
  saveContextTraceMock: vi.fn(),
  getLatestRequirementsSessionMock: vi.fn(),
  getBusinessUnderstandingModelMock: vi.fn(),
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
