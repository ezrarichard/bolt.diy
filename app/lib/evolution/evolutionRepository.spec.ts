import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChangeRequest, ChangeRequestDraft } from './changeRequestTypes';
import type { EvolutionPlan } from './evolutionPlan';
import type { ImpactAnalysis } from './impactTypes';

const { getBuildersDbClientMock, recordDeploymentEventMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
  recordDeploymentEventMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { recordDeploymentEvent: recordDeploymentEventMock },
}));

const {
  createChangeRequest,
  updateChangeRequestStatus,
  listChangeRequests,
  recordImpactAnalysis,
  getLatestImpactAnalysis,
  listImpactAnalyses,
} = await import('./evolutionRepository');

function draft(overrides: Partial<ChangeRequestDraft> = {}): ChangeRequestDraft {
  return {
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    title: 'Allow patients to cancel an appointment',
    description: 'FEAT-001 should support cancellation.',
    priority: 'medium',
    category: 'unknown',
    scope: 'unknown',
    declaredAreas: [],
    ...overrides,
  };
}

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cr-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    release_id: 'rel-1',
    release_version: '1.0.0',
    request_number: 1,
    title: 'Allow patients to cancel an appointment',
    description: 'FEAT-001 should support cancellation.',
    business_reason: null,
    priority: 'medium',
    category: 'unknown',
    scope: 'unknown',
    declared_areas: [],
    status: 'submitted',
    requested_by: 'ezra',
    requested_at: '2026-08-12T09:30:00.000Z',
    notes: null,
    metadata: {},
    created_at: '2026-08-12T09:30:00.000Z',
    updated_at: '2026-08-12T09:30:00.000Z',
    ...overrides,
  };
}

function makeAnalysisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ia-1',
    change_request_id: 'cr-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    release_id: 'rel-1',
    release_version: '1.0.0',
    analysis_number: 1,
    classification: 'feature_addition',
    risk_level: 'medium',
    complexity_level: 'medium',
    overall_confidence: 'high',
    requires_human_review: true,
    impact: { summary: { totalFindings: 3 } },
    evolution_plan: null,
    analysed_at: '2026-08-12T10:00:00.000Z',
    created_by: 'ezra',
    created_at: '2026-08-12T10:00:00.000Z',
    updated_at: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    ...draft(),
    id: 'cr-1',
    requestNumber: 1,
    status: 'submitted',
    requestedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    metadata: {},
    ...overrides,
  };
}

const impact = {
  classification: {
    category: 'feature_addition',
    source: 'inferred',
    confidence: 'medium',
    reasoning: '',
    alternatives: [],
  },
  risk: { level: 'medium', score: 3, factors: [], reasoning: '' },
  complexity: { level: 'medium', score: 4, factors: [], reasoning: '' },
  overallConfidence: 'high',
  requiresHumanReview: true,
  analysedAt: '2026-08-12T10:00:00.000Z',
} as unknown as ImpactAnalysis;

const evolutionPlan = {
  suggestedMvp: { placement: 'next_mvp', label: 'Schedule into the next MVP', reasoning: '' },
  estimatedPhases: [{ id: 'build', name: 'Implementation', roles: [], detail: '' }],
  requiredRoles: [{ role: 'frontend_engineer', label: 'Frontend Engineer', reason: '' }],
} as unknown as EvolutionPlan;

/** Client double covering the two evolution tables. */
function makeClient(
  options: {
    existingRequests?: Array<{ request_number: number; title: string; status: string }>;
    insertResult?: { data: unknown; error: unknown };
    latestAnalysisNumber?: number;
    analysisInsertResult?: { data: unknown; error: unknown };
  } = {},
) {
  const requestInsert = vi.fn().mockReturnValue({
    select: () => ({ single: () => Promise.resolve(options.insertResult ?? { data: makeRequestRow(), error: null }) }),
  });
  const requestUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const requestUpdate = vi.fn().mockReturnValue({ eq: requestUpdateEq });

  const analysisInsert = vi.fn().mockReturnValue({
    select: () => ({
      single: () =>
        Promise.resolve(
          options.analysisInsertResult ?? {
            data: makeAnalysisRow({ analysis_number: (options.latestAnalysisNumber ?? 0) + 1 }),
            error: null,
          },
        ),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'builders_change_requests') {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: options.existingRequests ?? [], error: null }) }),
        }),
        insert: requestInsert,
        update: requestUpdate,
      };
    }

    if (table === 'builders_change_impact_analyses') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: options.latestAnalysisNumber ? [{ analysis_number: options.latestAnalysisNumber }] : [],
                  error: null,
                }),
            }),
          }),
        }),
        insert: analysisInsert,
      };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from }, requestInsert, requestUpdate, analysisInsert };
}

describe('createChangeRequest', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    recordDeploymentEventMock.mockReset();
    recordDeploymentEventMock.mockResolvedValue({ id: 'evt-1' });
  });

  it('creates request #1 and records the change_requested event', async () => {
    const { client, requestInsert } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createChangeRequest(draft(), { createdBy: 'ezra' });

    expect(result.ok).toBe(true);
    expect(requestInsert).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 'dep-1', project_id: 'proj-1', request_number: 1, status: 'submitted' }),
    );
    expect(recordDeploymentEventMock).toHaveBeenCalledTimes(1);
    expect(recordDeploymentEventMock.mock.calls[0][0]).toMatchObject({ eventType: 'change_requested' });
  });

  it('allocates the next request number', async () => {
    const { client, requestInsert } = makeClient({
      existingRequests: [{ request_number: 4, title: 'Other', status: 'planned' }],
    });
    getBuildersDbClientMock.mockReturnValue(client);

    await createChangeRequest(draft());

    expect(requestInsert).toHaveBeenCalledWith(expect.objectContaining({ request_number: 5 }));
  });

  it('refuses a request with no release — there would be no baseline', async () => {
    getBuildersDbClientMock.mockReturnValue(makeClient().client);

    const result = await createChangeRequest(draft({ releaseId: undefined }));

    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result.ok === false && result.message).toMatch(/not been released/i);
  });

  it('refuses an empty title or description', async () => {
    getBuildersDbClientMock.mockReturnValue(makeClient().client);

    expect(await createChangeRequest(draft({ title: '  ' }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await createChangeRequest(draft({ description: '' }))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('rejects a duplicate of an open request with the same title', async () => {
    const { client, requestInsert } = makeClient({
      existingRequests: [{ request_number: 2, title: 'allow patients to CANCEL an appointment', status: 'analyzed' }],
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createChangeRequest(draft());

    expect(result).toMatchObject({ ok: false, code: 'duplicate' });
    expect(requestInsert).not.toHaveBeenCalled();
  });

  it('allows re-raising a title whose earlier request was cancelled or planned', async () => {
    const { client, requestInsert } = makeClient({
      existingRequests: [{ request_number: 2, title: 'Allow patients to cancel an appointment', status: 'cancelled' }],
    });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createChangeRequest(draft());

    expect(result.ok).toBe(true);
    expect(requestInsert).toHaveBeenCalled();
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await createChangeRequest(draft())).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('reports a persistence failure without recording an event', async () => {
    const { client } = makeClient({ insertResult: { data: null, error: { message: 'boom' } } });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createChangeRequest(draft());

    expect(result).toMatchObject({ ok: false, code: 'error' });
    expect(recordDeploymentEventMock).not.toHaveBeenCalled();
  });
});

describe('recordImpactAnalysis', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    recordDeploymentEventMock.mockReset();
    recordDeploymentEventMock.mockResolvedValue({ id: 'evt-1' });
  });

  it('persists analysis #1 and records impact_completed only, when no plan was generated', async () => {
    const { client, analysisInsert, requestUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordImpactAnalysis({ changeRequest: makeRequest(), impact, createdBy: 'ezra' });

    expect(result.ok).toBe(true);
    expect(analysisInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        change_request_id: 'cr-1',
        analysis_number: 1,
        classification: 'feature_addition',
        risk_level: 'medium',
        requires_human_review: true,
      }),
    );
    expect(recordDeploymentEventMock).toHaveBeenCalledTimes(1);
    expect(recordDeploymentEventMock.mock.calls[0][0].eventType).toBe('impact_completed');
    expect(requestUpdate).toHaveBeenCalledWith({ status: 'analyzed' });
  });

  it('records evolution_plan_created as a second event when a plan was generated', async () => {
    const { client, requestUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await recordImpactAnalysis({ changeRequest: makeRequest(), impact, evolutionPlan });

    expect(recordDeploymentEventMock.mock.calls.map((call) => call[0].eventType)).toEqual([
      'impact_completed',
      'evolution_plan_created',
    ]);
    expect(requestUpdate).toHaveBeenCalledWith({ status: 'planned' });
  });

  it('allocates the next analysis number so a re-analysis never overwrites an earlier one', async () => {
    const { client, analysisInsert } = makeClient({ latestAnalysisNumber: 2 });
    getBuildersDbClientMock.mockReturnValue(client);

    await recordImpactAnalysis({ changeRequest: makeRequest(), impact });

    expect(analysisInsert).toHaveBeenCalledWith(expect.objectContaining({ analysis_number: 3 }));
  });

  it('reports a persistence failure without recording any event', async () => {
    const { client } = makeClient({ analysisInsertResult: { data: null, error: { message: 'boom' } } });
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await recordImpactAnalysis({ changeRequest: makeRequest(), impact });

    expect(result).toMatchObject({ ok: false, code: 'error' });
    expect(recordDeploymentEventMock).not.toHaveBeenCalled();
  });

  it('returns a failure without throwing when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await recordImpactAnalysis({ changeRequest: makeRequest(), impact })).toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('reading and updating', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
    recordDeploymentEventMock.mockReset();
  });

  it('lists change requests newest first, scoped to their own deployment', async () => {
    const eq = vi.fn().mockReturnValue({
      order: () =>
        Promise.resolve({ data: [makeRequestRow({ id: 'cr-2', request_number: 2 }), makeRequestRow()], error: null }),
    });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await listChangeRequests('dep-1');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-1');
    expect(result.map((request) => request.requestNumber)).toEqual([2, 1]);
  });

  it('returns the latest analysis for a request', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeAnalysisRow({ analysis_number: 3 }), error: null });
    const eq = vi.fn().mockReturnValue({ order: () => ({ limit: () => ({ maybeSingle }) }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    const result = await getLatestImpactAnalysis('cr-1');

    expect(eq).toHaveBeenCalledWith('change_request_id', 'cr-1');
    expect(result).toMatchObject({ analysisNumber: 3, classification: 'feature_addition', riskLevel: 'medium' });
  });

  it('returns null when a request has never been analysed', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    getBuildersDbClientMock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }),
    });

    expect(await getLatestImpactAnalysis('cr-1')).toBeNull();
  });

  it('scopes analysis listing to its own deployment (project isolation)', async () => {
    const eq = vi.fn().mockReturnValue({ order: () => Promise.resolve({ data: [], error: null }) });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });

    await listImpactAnalyses('dep-b');

    expect(eq).toHaveBeenCalledWith('deployment_id', 'dep-b');
  });

  it('cancels a request without deleting it', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    getBuildersDbClientMock.mockReturnValue({ from: () => ({ update }) });

    expect(await updateChangeRequestStatus('cr-1', 'cancelled')).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(eq).toHaveBeenCalledWith('id', 'cr-1');
  });

  it('returns safe fallbacks when BuildersDB is unconfigured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await listChangeRequests('dep-1')).toEqual([]);
    expect(await listImpactAnalyses('dep-1')).toEqual([]);
    expect(await getLatestImpactAnalysis('cr-1')).toBeNull();
    expect(await updateChangeRequestStatus('cr-1', 'cancelled')).toBe(false);
  });
});
