import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { Project } from '~/lib/stores/projects';

const {
  getLatestImpactAnalysisMock,
  recordIncrementalPlanMock,
  resolveBaselineSnapshotMock,
  buildIncrementalPlanMock,
} = vi.hoisted(() => ({
  getLatestImpactAnalysisMock: vi.fn(),
  recordIncrementalPlanMock: vi.fn(),
  resolveBaselineSnapshotMock: vi.fn(),
  buildIncrementalPlanMock: vi.fn(),
}));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: {
    getLatestImpactAnalysis: getLatestImpactAnalysisMock,
    recordIncrementalPlan: recordIncrementalPlanMock,
  },
}));

vi.mock('~/lib/services/evolutionRunner', () => ({ resolveBaselineSnapshot: resolveBaselineSnapshotMock }));

vi.mock('~/lib/services/incrementalEngineeringService', () => ({
  buildIncrementalPlan: buildIncrementalPlanMock,
}));

const { planIncrementalEngineering } = await import('./incrementalEngineeringRunner');

const CLOCK = () => '2026-08-14T10:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside',
    icon: '🦷',
    color: 'blue',
    createdAt: '2026-06-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    ...overrides,
  } as Project;
}

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Allow cancellation',
    description: 'x',
    priority: 'medium',
    category: 'feature_addition',
    scope: 'single_feature',
    declaredAreas: [],
    status: 'analyzed',
    requestedAt: CLOCK(),
    createdAt: CLOCK(),
    updatedAt: CLOCK(),
    metadata: {},
    ...overrides,
  };
}

const builtPlan = {
  executionOrder: [{ order: 1, role: 'frontend', label: 'Frontend Engineer', reasoning: 'x' }],
  changeSet: { summary: { modifyCount: 2, totalReleasedFiles: 6, touchedPercentage: 33 } },
  scope: {},
  roleDecisions: [],
  reducedContexts: [],
  reviewRequirements: [],
  outOfScope: [],
  modelVersion: '1.0.0',
  summary: 'x',
  createdAt: CLOCK(),
};

describe('planIncrementalEngineering', () => {
  beforeEach(() => {
    getLatestImpactAnalysisMock.mockReset();
    recordIncrementalPlanMock.mockReset();
    resolveBaselineSnapshotMock.mockReset();
    buildIncrementalPlanMock.mockReset();

    getLatestImpactAnalysisMock.mockResolvedValue({
      id: 'ia-1',
      impact: { summary: {} },
      evolutionPlan: { requiredRoles: [] },
    });
    resolveBaselineSnapshotMock.mockResolvedValue({ code: 'ok', snapshot: { files: [] } });
    buildIncrementalPlanMock.mockReturnValue(builtPlan);
    recordIncrementalPlanMock.mockResolvedValue({ ok: true, record: { id: 'ip-1', planNumber: 1 } });
  });

  it('loads the persisted analysis, builds the plan against the release baseline, and persists it', async () => {
    const result = await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(getLatestImpactAnalysisMock).toHaveBeenCalledWith('cr-1');
    expect(resolveBaselineSnapshotMock).toHaveBeenCalled();
    expect(buildIncrementalPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ impactAnalysisId: 'ia-1', capturedAt: CLOCK() }),
    );
    expect(recordIncrementalPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ impactAnalysisId: 'ia-1', plan: builtPlan }),
    );
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    expect(result.message).toMatch(/1 role\(s\) selected, 33%/);
  });

  it('never recomputes the impact analysis — it reads the persisted one', async () => {
    await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(buildIncrementalPlanMock.mock.calls[0][0].impact).toEqual({ summary: {} });
  });

  it('refuses when the change request has never been analysed', async () => {
    getLatestImpactAnalysisMock.mockResolvedValue(null);

    const result = await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'no_impact' });
    expect(resolveBaselineSnapshotMock).not.toHaveBeenCalled();
    expect(recordIncrementalPlanMock).not.toHaveBeenCalled();
  });

  it('refuses when the analysis produced no evolution plan', async () => {
    getLatestImpactAnalysisMock.mockResolvedValue({ id: 'ia-1', impact: {}, evolutionPlan: undefined });

    expect(
      await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK }),
    ).toMatchObject({ ok: false, code: 'no_evolution_plan' });
  });

  it('refuses when there is no release baseline', async () => {
    resolveBaselineSnapshotMock.mockResolvedValue({ code: 'no_release', message: 'not released' });

    const result = await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'no_release' });
    expect(recordIncrementalPlanMock).not.toHaveBeenCalled();
  });

  it('refuses when the project has no deployment', async () => {
    resolveBaselineSnapshotMock.mockResolvedValue({ code: 'no_deployment', message: 'none' });

    expect(
      await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK }),
    ).toMatchObject({ ok: false, code: 'no_deployment' });
  });

  it('refuses an empty scope rather than persisting a plan implying work was scoped', async () => {
    buildIncrementalPlanMock.mockReturnValue({
      ...builtPlan,
      executionOrder: [],
      changeSet: { summary: { modifyCount: 0, totalReleasedFiles: 6, touchedPercentage: 0 } },
    });

    const result = await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'invalid_scope' });
    expect(result.plan).toBeDefined();
    expect(recordIncrementalPlanMock).not.toHaveBeenCalled();
  });

  it('writes nothing once the operator cancels', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await planIncrementalEngineering({
      project: makeProject(),
      request: makeRequest(),
      signal: controller.signal,
      clock: CLOCK,
    });

    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(recordIncrementalPlanMock).not.toHaveBeenCalled();
  });

  it('surfaces a persistence failure, keeping the plan for inspection', async () => {
    recordIncrementalPlanMock.mockResolvedValue({ ok: false, code: 'error', message: 'could not be saved' });

    const result = await planIncrementalEngineering({ project: makeProject(), request: makeRequest(), clock: CLOCK });

    expect(result).toMatchObject({ ok: false, code: 'persist_failed' });
    expect(result.plan).toBe(builtPlan);
  });

  it('keeps three projects isolated — each plan targets only its own request', async () => {
    getLatestImpactAnalysisMock.mockImplementation(async (requestId: string) => ({
      id: `ia-${requestId}`,
      impact: {},
      evolutionPlan: { requiredRoles: [] },
    }));
    recordIncrementalPlanMock.mockImplementation(async (params: { changeRequest: ChangeRequest }) => ({
      ok: true,
      record: { id: `ip-${params.changeRequest.id}`, planNumber: 1 },
    }));

    const results = await Promise.all(
      ['cr-a', 'cr-b', 'cr-c'].map((id) =>
        planIncrementalEngineering({
          project: makeProject({ id: `proj-${id}` }),
          request: makeRequest({ id, projectId: `proj-${id}`, deploymentId: `dep-${id}` }),
          clock: CLOCK,
        }),
      ),
    );

    expect(results.map((result) => result.record?.id)).toEqual(['ip-cr-a', 'ip-cr-b', 'ip-cr-c']);
    expect(recordIncrementalPlanMock.mock.calls.map((call) => call[0].impactAnalysisId)).toEqual([
      'ia-cr-a',
      'ia-cr-b',
      'ia-cr-c',
    ]);
  });
});
