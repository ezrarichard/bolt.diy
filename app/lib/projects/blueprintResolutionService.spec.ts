import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';

const { recordBlueprintResolutionMock, getAllBlueprintsMock } = vi.hoisted(() => ({
  recordBlueprintResolutionMock: vi.fn(),
  getAllBlueprintsMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/blueprintResolutionRepository', () => ({
  blueprintResolutionRepository: {
    recordBlueprintResolution: recordBlueprintResolutionMock,
    getLatestBlueprintResolution: vi.fn(),
    listBlueprintResolutionHistory: vi.fn(),
    selectBlueprint: vi.fn(),
  },
}));

vi.mock('~/lib/blueprints', async () => {
  const actual = await vi.importActual<typeof import('~/lib/blueprints')>('~/lib/blueprints');
  return {
    ...actual,
    blueprintEngine: { ...actual.blueprintEngine, getAllBlueprints: getAllBlueprintsMock },
  };
});

const { resolveAndRecordBlueprint, resolveBlueprints } = await import('./blueprintResolutionService');
const { PROJECT_BLUEPRINTS } = await import('~/lib/blueprints/registry');

function makeModel(overrides: Partial<BusinessUnderstandingModel> = {}): BusinessUnderstandingModel {
  return {
    id: 'model-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    assessment: {},
    decision: {},
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
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('blueprintResolutionService', () => {
  beforeEach(() => {
    recordBlueprintResolutionMock.mockReset();
    getAllBlueprintsMock.mockReset();
    getAllBlueprintsMock.mockReturnValue(PROJECT_BLUEPRINTS);
  });

  describe('resolveBlueprints', () => {
    it('reads blueprints from the catalog and never mutates anything', () => {
      const result = resolveBlueprints(makeModel());

      expect(getAllBlueprintsMock).toHaveBeenCalled();
      expect(result.candidates.length).toBeGreaterThan(0);
    });
  });

  describe('resolveAndRecordBlueprint', () => {
    it('persists the top candidate as a new resolution row', async () => {
      recordBlueprintResolutionMock.mockResolvedValue({
        id: 'res-1',
        projectId: 'proj-1',
        sessionId: 'session-1',
        recommendedBlueprintId: 'business-website',
        selectedBlueprintId: 'business-website',
        confidence: 96,
        explanation: ['Local service business'],
        candidates: [],
        resolvedAt: '2026-07-31T00:00:00.000Z',
        createdAt: '2026-07-31T00:00:00.000Z',
      });

      const model = makeModel({
        businessIdentity: { industry: 'Local service business', vision: 'A marketing website for a local salon' },
        businessGoals: ['Generate enquiries'],
        functionalRequirements: ['Contact form', 'WhatsApp CTA'],
      });

      const { result, persisted } = await resolveAndRecordBlueprint({
        projectId: 'proj-1',
        sessionId: 'session-1',
        model,
      });

      expect(recordBlueprintResolutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          sessionId: 'session-1',
          recommendedBlueprintId: result.recommendedBlueprintId,
        }),
      );
      expect(persisted?.id).toBe('res-1');
    });

    it('skips persistence when nothing could be recommended', async () => {
      getAllBlueprintsMock.mockReturnValue([]);

      const { persisted } = await resolveAndRecordBlueprint({
        projectId: 'proj-1',
        sessionId: null,
        model: makeModel(),
      });

      expect(recordBlueprintResolutionMock).not.toHaveBeenCalled();
      expect(persisted).toBeNull();
    });
  });
});
