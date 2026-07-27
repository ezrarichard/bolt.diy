import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChangeRequest } from './changeRequestTypes';
import type { IncrementalEngineeringPlan } from './engineeringScopeTypes';

/**
 * Repository-side incremental-plan tests — Sprint 96, Part 14. Own file, same BuildersDB client
 * double the rest of the evolution domain's specs use.
 */

const { getBuildersDbClientMock, recordDeploymentEventMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
  recordDeploymentEventMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { recordDeploymentEvent: recordDeploymentEventMock },
}));

const { recordIncrementalPlan, getLatestIncrementalPlan, listIncrementalPlans } = await import('./evolutionRepository');

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 2,
    title: 'Allow cancellation',
    description: 'x',
    priority: 'medium',
    category: 'feature_addition',
    scope: 'single_feature',
    declaredAreas: [],
    status: 'analyzed',
    requestedAt: '2026-08-14T09:00:00.000Z',
    createdAt: '2026-08-14T09:00:00.000Z',
    updatedAt: '2026-08-14T09:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

const plan = {
  modelVersion: '1.0.0',
  scope: {
    affectedFeatures: [{ identifier: 'FEAT-001', label: 'Book', evidence: 'x' }],
    affectedPages: [{ identifier: 'src/pages/A.tsx', label: 'A', evidence: 'x' }],
    affectedDatabaseObjects: [],
  },
  roleDecisions: [{ role: 'frontend' }, { role: 'qa' }, { role: 'database' }],
  executionOrder: [
    { order: 1, role: 'frontend', label: 'Frontend Engineer', reasoning: 'x' },
    { order: 2, role: 'qa', label: 'QA Engineer', reasoning: 'x' },
  ],
  changeSet: { summary: { modifyCount: 2, totalReleasedFiles: 6, touchedPercentage: 33 } },
  reducedContexts: [],
  reviewRequirements: [{ stage: 'code_review', required: true }],
  summary: 'x',
  outOfScope: [],
  createdAt: '2026-08-14T10:00:00.000Z',
} as unknown as IncrementalEngineeringPlan;

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ip-1',
    change_request_id: 'cr-1',
    impact_analysis_id: 'ia-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    plan_number: 1,
    model_version: '1.0.0',
    selected_roles: ['frontend', 'qa'],
    files_to_modify_count: 2,
    touched_percentage: 33,
    plan: { summary: 'x', executionOrder: [] },
    created_by: 'ezra',
    created_at: '2026-08-14T10:00:00.000Z',
    updated_at: '2026-08-14T10:00:00.000Z',
    ...overrides,
  };
}

function makeClient(options: { latestPlanNumber?: number; insertResult?: { data: unknown; error: unknown } } = {}) {
  const insert = vi.fn().mockReturnValue({
    select: () => ({
      single: () =>
        Promise.resolve(
          options.insertResult ?? {
            data: makeRow({ plan_number: (options.latestPlanNumber ?? 0) + 1 }),
            error: null,
          },
        ),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'builders_incremental_engineering_plans') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: options.latestPlanNumber ? [{ plan_number: options.latestPlanNumber }] : [],
                  error: null,
                }),
            }),
          }),
        }),
        insert,
      };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from }, insert };
}

describe('recordIncrementalPlan', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    recordDeploymentEventMock.mockReset();
    recordDeploymentEventMock.mockResolvedValue({ id: 'evt-1' });
  });

  it('persists plan #1 with denormalized headline results', async () => {
    const { client, insert } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordIncrementalPlan({
      changeRequest: makeRequest(),
      plan,
      impactAnalysisId: 'ia-1',
      createdBy: 'ezra',
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        change_request_id: 'cr-1',
        impact_analysis_id: 'ia-1',
        deployment_id: 'dep-1',
        project_id: 'proj-1',
        plan_number: 1,
        selected_roles: ['frontend', 'qa'],
        files_to_modify_count: 2,
        touched_percentage: 33,
      }),
    );
  });

  it('records the three canonical events (Part 10)', async () => {
    const { client } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await recordIncrementalPlan({ changeRequest: makeRequest(), plan });

    expect(recordDeploymentEventMock.mock.calls.map((call) => call[0].eventType)).toEqual([
      'engineering_scope_created',
      'role_selection_completed',
      'incremental_plan_created',
    ]);
    expect(recordDeploymentEventMock.mock.calls[1][0].metadata).toMatchObject({
      selectedRoles: ['frontend', 'qa'],
      skippedRoles: 1,
    });
  });

  it('allocates the next plan number so re-planning never overwrites an earlier plan', async () => {
    const { client, insert } = makeClient({ latestPlanNumber: 3 });
    getBuildersDbClientMock.mockReturnValue(client);

    await recordIncrementalPlan({ changeRequest: makeRequest(), plan });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ plan_number: 4 }));
  });

  it('reports a persistence failure without recording any event', async () => {
    const { client } = makeClient({ insertResult: { data: null, error: { message: 'boom' } } });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordIncrementalPlan({ changeRequest: makeRequest(), plan });

    expect(result).toMatchObject({ ok: false, code: 'error' });
    expect(recordDeploymentEventMock).not.toHaveBeenCalled();
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await recordIncrementalPlan({ changeRequest: makeRequest(), plan })).toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('reading incremental plans', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    recordDeploymentEventMock.mockReset();
  });

  it('returns the latest plan for a change request', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeRow({ plan_number: 3 }), error: null });
    const eq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await getLatestIncrementalPlan('cr-1');

    expect(eq).toHaveBeenCalledWith('change_request_id', 'cr-1');
    expect(result).toMatchObject({ planNumber: 3, selectedRoles: ['frontend', 'qa'], touchedPercentage: 33 });
  });

  it('returns null when a request has never been planned', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    expect(await getLatestIncrementalPlan('cr-1')).toBeNull();
  });

  it('lists every plan for a deployment, newest first', async () => {
    const order = vi
      .fn()
      .mockResolvedValue({ data: [makeRow({ id: 'ip-2', plan_number: 2 }), makeRow()], error: null });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) });

    const result = await listIncrementalPlans('dep-1');

    expect(result.map((entry) => entry.planNumber)).toEqual([2, 1]);
  });

  it('scopes every read to its own deployment (project isolation)', async () => {
    const eq = vi.fn().mockReturnValue({ order: () => Promise.resolve({ data: [], error: null }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    await listIncrementalPlans('dep-b');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-b');
  });

  it('returns safe fallbacks when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await listIncrementalPlans('dep-1')).toEqual([]);
    expect(await getLatestIncrementalPlan('cr-1')).toBeNull();
  });
});
