import type { BusinessUnderstandingModel } from '~/lib/projects/requirementsSession';

/**
 * Shared test-only fixture for the Discovery AI Engine's `.spec.ts` files — not imported by any
 * non-test module. Mirrors the equivalent inline fixtures already duplicated across
 * `discoveryAgent.spec.ts`/`requirementsSessionOrchestrator.spec.ts`, centralized once here since
 * this directory's tests share it across many files rather than just one or two.
 */
export function emptyModel(overrides: Partial<BusinessUnderstandingModel> = {}): BusinessUnderstandingModel {
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
