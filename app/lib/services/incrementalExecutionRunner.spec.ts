import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_TYPES, type ProjectArtifact } from '~/lib/projects/artifacts';
import type { Project } from '~/lib/stores/projects';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { IncrementalPlanRecord, IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import type { IncrementalExecution, IncrementalRoleRun } from '~/lib/evolution/incrementalExecutionTypes';

/**
 * Sprint 97, Part 19 — the runner, with a MOCK AI PROVIDER throughout. No test here reaches a real
 * provider, a real BuildersDB or a real network: `generate` is a fake, and the repository is a
 * mock whose state is asserted directly.
 */

const { getLatestImpactAnalysisMock, resolveBaselineSnapshotMock, repositoryMock, getRoleGenerateOptionsMock } =
  vi.hoisted(() => ({
    getLatestImpactAnalysisMock: vi.fn(),
    resolveBaselineSnapshotMock: vi.fn(),
    getRoleGenerateOptionsMock: vi.fn(() => ({})),
    repositoryMock: {
      createExecution: vi.fn(),
      updateExecution: vi.fn(),
      getExecution: vi.fn(),
      getActiveExecution: vi.fn(),
      listExecutions: vi.fn(),
      listInvalidations: vi.fn(),
      startRoleRun: vi.fn(),
      finishRoleRun: vi.fn(),
      listRoleRuns: vi.fn(),
      recordDiscoveredImpacts: vi.fn(),
      listDiscoveredImpacts: vi.fn(),
      recordExecutionEvent: vi.fn(),
    },
  }));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: { getLatestImpactAnalysis: getLatestImpactAnalysisMock },
}));

vi.mock('~/lib/services/evolutionRunner', () => ({ resolveBaselineSnapshot: resolveBaselineSnapshotMock }));

vi.mock('~/lib/evolution/incrementalExecutionRepository', () => ({
  incrementalExecutionRepository: repositoryMock,
}));

vi.mock('~/lib/generation-profiles/generationProfileRepository', () => ({
  getRoleGenerateOptions: getRoleGenerateOptionsMock,
}));

const { runIncrementalExecution, resolveRoleEngine } = await import('./incrementalExecutionRunner');

const AT = '2026-08-14T10:00:00.000Z';
const CLOCK = () => AT;

function artifact(type: string, id: string): ProjectArtifact {
  return {
    id,
    taskId: 'task-1',
    title: type,
    type,
    createdAt: AT,
    updatedAt: AT,
    status: 'approved',
    content: '{}',
    version: 3,
  };
}

const PROJECT = {
  id: 'proj-1',
  name: 'Riverside',
  description: 'Restaurant booking',
  artifacts: [
    ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
    ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
    ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
    ARTIFACT_TYPES.DATABASE_DRAFT,
    ARTIFACT_TYPES.UIUX_DRAFT,
    ARTIFACT_TYPES.BACKEND_DRAFT,
    ARTIFACT_TYPES.FRONTEND_DRAFT,
    ARTIFACT_TYPES.QA_DRAFT,
    ARTIFACT_TYPES.DEVOPS_DRAFT,
  ].map((type, index) => artifact(type, `a-${index}`)),
} as Project;

const REQUEST = {
  id: 'req-1',
  requestNumber: 4,
  title: 'Rename the booking heading',
  description: 'The heading should read "Reserve a table".',
  deploymentId: 'dep-1',
  projectId: 'proj-1',
  releaseId: 'rel-1',
} as ChangeRequest;

function makePlanRecord(selected: IncrementalRoleId[] = ['frontend', 'qa']): IncrementalPlanRecord {
  return {
    id: 'plan-1',
    changeRequestId: 'req-1',
    impactAnalysisId: 'imp-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    planNumber: 1,
    modelVersion: '1.0.0',
    selectedRoles: selected,
    filesToModifyCount: 1,
    touchedPercentage: 33,
    createdAt: AT,
    plan: {
      modelVersion: '1.0.0',
      scope: {
        changeRequestId: 'req-1',
        releaseId: 'rel-1',
        releaseVersion: '1.2.0',
        baselineManifestVersion: 7,
        affectedFeatures: [{ identifier: 'F-1', label: 'Booking', evidence: 'named' }],
        affectedPages: [{ identifier: 'pages/Booking.tsx', label: 'Booking', evidence: 'named' }],
        affectedComponents: [],
        affectedDatabaseObjects: [],
        affectedApis: [],
        affectedEnvironment: [],
        affectedDocuments: [],
        affectedRoles: selected,
        unaffectedAreas: [],
        metadata: {
          classification: 'small_enhancement',
          riskLevel: 'low',
          complexityLevel: 'very_small',
          requiresHumanReview: false,
          capturedAt: AT,
        },
      },
      roleDecisions: selected.map((role) => ({ role, label: role, selected: true, reasoning: 'x', dependsOn: [] })),
      executionOrder: selected.map((role, index) => ({ order: index + 1, role, label: role, reasoning: 'x' })),
      changeSet: {
        summary: { modifyCount: 1, createCount: 0, unchangedCount: 2, totalReleasedFiles: 3, touchedPercentage: 33 },
      },
      reducedContexts: [],
      reviewRequirements: [{ stage: 'code_review', label: 'Code Review', required: true, reasoning: 'code changes' }],
      summary: 'x',
      outOfScope: [],
      createdAt: AT,
    },
  } as unknown as IncrementalPlanRecord;
}

const BASELINE = {
  releaseId: 'rel-1',
  semanticVersion: '1.2.0',
  capturedAt: AT,
  manifestVersion: 7,
  features: [{ code: 'F-1', title: 'Booking', state: 'delivered' }],
  routes: [],
  files: [
    { path: 'pages/Booking.tsx', category: 'pages', featureIds: ['F-1'] },
    { path: 'components/Header.tsx', category: 'components', featureIds: [] },
    { path: 'api/bookings.ts', category: 'backend', featureIds: ['F-1'] },
  ],
  databaseTables: [],
  environmentVariables: [],
  requiredServices: [],
  apiSurfaces: [],
  documentationSections: [],
};

const IMPACT = {
  baselineCapturedAt: AT,
  analysedAt: AT,
  classification: {
    category: 'small_enhancement',
    source: 'declared',
    confidence: 'high',
    reasoning: '',
    alternatives: [],
  },
  sections: [{ id: 'ui', label: 'UI', affected: true, items: [], confidence: 'high', detail: 'heading changes' }],
  unaffectedAreas: [],
  risk: { level: 'low', score: 1, factors: [], reasoning: '' },
  complexity: { level: 'very_small', score: 1, factors: [], reasoning: '' },
  roles: [],
  dependencies: [],
  recommendations: [],
  overallConfidence: 'high',
  requiresHumanReview: false,
  reasoning: [],
  summary: {
    affectedSections: 1,
    totalFindings: 1,
    highConfidenceFindings: 1,
    affectedFeatures: 1,
    affectedFiles: 1,
    affectedTables: 0,
  },
};

function makeExecution(overrides: Partial<IncrementalExecution> = {}): IncrementalExecution {
  return {
    id: 'exec-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    changeRequestId: 'req-1',
    impactAnalysisId: 'imp-1',
    engineeringPlanId: 'plan-1',
    status: 'running',
    recommendedRoles: ['frontend', 'qa'],
    selectedRoles: ['frontend', 'qa'],
    overrides: [],
    completedRoles: [],
    skippedRoles: [],
    failedRoles: [],
    invalidations: [],
    safetyFallbacks: [],
    discoveredImpacts: [],
    scopeExpansionDecisions: [],
    reviews: [],
    executionVersion: 1,
    modelVersion: '1.0.0',
    scopeFingerprint: 'scope-test',
    metadata: {},
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

/** A mock provider that returns a valid draft for every role. */
function okGenerate(payload: Record<string, unknown> = {}) {
  return vi.fn(async (_system: string | undefined, _prompt: string, _options?: Record<string, unknown>) => ({
    ok: true as const,
    text: JSON.stringify({
      summary: 'Updated the booking heading.',
      engineeringNotes: 'Only the heading string changed.',
      ...payload,
    }),
    finishReason: 'stop',
  }));
}

let runIdCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  runIdCounter = 0;

  getLatestImpactAnalysisMock.mockResolvedValue({ id: 'imp-1', impact: IMPACT, evolutionPlan: undefined });
  resolveBaselineSnapshotMock.mockResolvedValue({ code: 'ok', snapshot: BASELINE });
  getRoleGenerateOptionsMock.mockReturnValue({});

  repositoryMock.createExecution.mockImplementation(async (params: any) => ({
    ok: true,
    value: makeExecution({ selectedRoles: params.selectedRoles, safetyFallbacks: params.safetyFallbacks }),
  }));
  repositoryMock.updateExecution.mockResolvedValue(true);
  repositoryMock.listRoleRuns.mockResolvedValue([]);
  repositoryMock.startRoleRun.mockImplementation(async () => ({ ok: true, value: `run-${++runIdCounter}` }));
  repositoryMock.finishRoleRun.mockResolvedValue(true);
  repositoryMock.recordDiscoveredImpacts.mockResolvedValue(true);
  repositoryMock.recordExecutionEvent.mockResolvedValue(undefined);
});

function run(overrides: Record<string, unknown> = {}) {
  return runIncrementalExecution({
    project: PROJECT,
    request: REQUEST,
    planRecord: makePlanRecord(),
    generate: okGenerate(),
    clock: CLOCK,
    ...overrides,
  } as never);
}

describe('resolveRoleEngine', () => {
  it('maps the Business Analyst, which sits outside AUTO_ENGINEERING_ROLES', () => {
    expect(resolveRoleEngine('requirements')?.artifactType).toBe(ARTIFACT_TYPES.REQUIREMENTS_DRAFT);
  });

  it('maps every pipeline role to a real engine', () => {
    for (const role of [
      'productowner',
      'architecture',
      'database',
      'uiux',
      'backend',
      'frontend',
      'qa',
      'devops',
    ] as const) {
      expect(resolveRoleEngine(role)).toBeDefined();
    }
  });
});

describe('runIncrementalExecution', () => {
  it('executes only the approved roles, in pipeline order', async () => {
    const generate = okGenerate();
    const result = await run({ generate });

    expect(result.ok).toBe(true);
    expect(result.code).toBe('completed');
    expect(result.execution?.completedRoles).toEqual(['frontend', 'qa']);
    expect(generate).toHaveBeenCalledTimes(2);

    const startedRoles = repositoryMock.startRoleRun.mock.calls.map((call) => call[0].role);
    expect(startedRoles).toEqual(['frontend', 'qa']);
  });

  it('sends the scoped instruction layer, not full project context', async () => {
    const generate = okGenerate();
    await run({ generate });

    const prompt = String(generate.mock.calls[0][1]);

    expect(prompt).toContain('ALREADY BUILT, ALREADY RELEASED');
    expect(prompt).toContain('pages/Booking.tsx');
    expect(prompt).toContain('EXPLICITLY OUT OF SCOPE');

    // The full-project BuildersDB block is never assembled on this path.
    expect(prompt).not.toContain('Persistent Project Context from BuildersDB');
  });

  it('persists an incremental artifact linked to the released one it would supersede', async () => {
    await run();

    const finished = repositoryMock.finishRoleRun.mock.calls[0][0];

    expect(finished.output).toMatchObject({
      generationType: 'incremental',
      role: 'frontend',
      artifactType: ARTIFACT_TYPES.FRONTEND_DRAFT,
      baselineReleaseId: 'rel-1',
      changeRequestId: 'req-1',
      engineeringPlanId: 'plan-1',
    });

    // Linked to the released artifact, never written over it.
    expect(finished.output.supersedesArtifactId).toBe('a-6');
    expect(finished.output.scopeFingerprint).toMatch(/^scope-/);
  });

  it('refuses an invalid role override before creating anything', async () => {
    const result = await run({ overrides: [{ role: 'qa', action: 'exclude', reason: 'in a hurry' }] });

    expect(result.code).toBe('invalid_override');
    expect(repositoryMock.createExecution).not.toHaveBeenCalled();
  });

  it('records the recommendation and the approved selection separately', async () => {
    await run({
      planRecord: makePlanRecord(['frontend', 'qa', 'devops']),
      overrides: [{ role: 'devops', action: 'exclude', reason: 'no infrastructure change' }],
    });

    const created = repositoryMock.createExecution.mock.calls[0][0];

    expect(created.recommendedRoles).toEqual(['frontend', 'qa', 'devops']);
    expect(created.selectedRoles).toEqual(['frontend', 'qa']);
    expect(created.overrides).toHaveLength(1);
  });

  it('fails before creating an execution when the baseline no longer matches the plan', async () => {
    resolveBaselineSnapshotMock.mockResolvedValue({ code: 'ok', snapshot: { ...BASELINE, manifestVersion: 9 } });

    const result = await run();

    expect(result.code).toBe('baseline_mismatch');
    expect(repositoryMock.createExecution).not.toHaveBeenCalled();
  });

  it('blocks rather than silently falling back to full context', async () => {
    getLatestImpactAnalysisMock.mockResolvedValue({
      id: 'imp-1',
      impact: { ...IMPACT, overallConfidence: 'low' },
    });

    const result = await run();

    expect(result.code).toBe('blocked');
    expect(result.execution?.status).toBe('blocked');
    expect(repositoryMock.startRoleRun).not.toHaveBeenCalled();
  });

  it('runs with full context only on an explicit, recorded operator approval', async () => {
    getLatestImpactAnalysisMock.mockResolvedValue({
      id: 'imp-1',
      impact: { ...IMPACT, overallConfidence: 'low' },
    });

    const generate = okGenerate();
    const result = await run({
      generate,
      fullContextApproval: { reason: 'Analysis is thin but the change is well understood.', approvedBy: 'ezra' },
    });

    expect(result.ok).toBe(true);
    expect(result.execution?.fullContextFallback).toMatchObject({
      approved: true,
      approvedBy: 'ezra',
      coversReasons: ['low_confidence_impact'],
    });

    // Labelled in the prompt itself, not only in the audit record.
    expect(String(generate.mock.calls[0][1])).toContain('FULL CONTEXT FALLBACK IS IN FORCE');
  });

  it('stops at the first failing role and never reports a misleading completion', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'provider exploded' })
      .mockResolvedValue({ ok: false, error: 'provider exploded' });

    const result = await run({ generate });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('role_failed');
    expect(result.execution?.failedRoles).toEqual(['frontend']);
    expect(result.execution?.completedRoles).toEqual([]);
    expect(result.execution?.status).toBe('failed');

    // QA never started — a role never runs on a failed upstream.
    expect(repositoryMock.startRoleRun).toHaveBeenCalledTimes(1);
  });

  it('treats malformed AI output as a failure rather than an artifact', async () => {
    const generate = vi.fn(async () => ({ ok: true as const, text: 'not json at all', finishReason: 'stop' }));
    const result = await run({ generate });

    expect(result.code).toBe('role_failed');
    expect(repositoryMock.finishRoleRun.mock.calls[0][0].status).toBe('failed');
    expect(repositoryMock.finishRoleRun.mock.calls[0][0].output).toBeUndefined();
  });

  it('cancels before the next role when the signal aborts', async () => {
    const controller = new AbortController();
    const inner = okGenerate();
    const generate = vi.fn(async (...args: Parameters<typeof inner>) => {
      controller.abort();
      return inner(...args);
    });

    const result = await run({ generate, signal: controller.signal });

    expect(result.code).toBe('cancelled');
    expect(result.execution?.status).toBe('cancelled');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reports a duplicate execution attempt as a conflict, not an error', async () => {
    repositoryMock.createExecution.mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'An execution is already in progress for this engineering plan.',
    });

    const result = await run();

    expect(result.code).toBe('conflict');
    expect(repositoryMock.startRoleRun).not.toHaveBeenCalled();
  });

  it('pauses on material discovered impact and does not widen the scope', async () => {
    const generate = okGenerate({
      discoveredImpact: [
        {
          description: 'The export job reads this heading string.',
          category: 'backend',
          affectedArtifact: 'api/exports.ts',
          reasoning: 'It is asserted in a snapshot.',
          severity: 'high',
          recommendedAction: 'expand_scope',
          scopeChangeRequired: true,
        },
      ],
    });

    const result = await run({ generate });

    expect(result.code).toBe('paused');
    expect(result.execution?.status).toBe('paused');
    expect(result.discoveredImpacts).toHaveLength(1);

    // The second role never ran, and the approved selection is untouched.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.execution?.selectedRoles).toEqual(['frontend', 'qa']);
    expect(repositoryMock.recordDiscoveredImpacts).toHaveBeenCalledTimes(1);
  });

  it('does not pause on an immaterial discovery', async () => {
    const generate = okGenerate({
      discoveredImpact: [
        {
          description: 'A comment nearby is now slightly out of date.',
          category: 'documentation',
          affectedArtifact: 'docs/booking.md',
          reasoning: 'cosmetic',
          severity: 'low',
          recommendedAction: 'monitor_only',
          scopeChangeRequired: false,
        },
      ],
    });

    const result = await run({ generate });

    expect(result.code).toBe('completed');

    // Both approved roles ran and both reported it — nothing was suppressed, nothing paused.
    expect(result.discoveredImpacts).toHaveLength(2);
  });

  it('refuses to resume under the old plan when an expansion is approved', async () => {
    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'paused' }));

    const result = await run({
      executionId: 'exec-1',
      scopeExpansionDecision: {
        decision: 'approve_expansion',
        reason: 'the export job matters',
        discoveredImpactIds: ['d-1'],
      },
    });

    expect(result.code).toBe('blocked');
    expect(result.message).toContain('Re-plan');
    expect(repositoryMock.startRoleRun).not.toHaveBeenCalled();
    expect(repositoryMock.recordExecutionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'scope_expansion_approved' }),
    );
  });

  it('continues within the original scope when the expansion is rejected', async () => {
    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'paused' }));

    const result = await run({
      executionId: 'exec-1',
      scopeExpansionDecision: {
        decision: 'reject_expansion',
        reason: 'raise a separate change request',
        discoveredImpactIds: ['d-1'],
      },
    });

    expect(result.code).toBe('completed');
    expect(repositoryMock.recordExecutionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'scope_expansion_rejected' }),
    );
  });

  it('resumes without re-running a completed role', async () => {
    const completedRun: IncrementalRoleRun = {
      id: 'run-old',
      executionId: 'exec-1',
      role: 'frontend',
      label: 'Frontend Engineer',
      attempt: 1,
      status: 'completed',
      discoveredImpacts: [],
      startedAt: AT,
      completedAt: AT,
    };

    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'paused', completedRoles: ['frontend'] }));
    repositoryMock.listRoleRuns.mockResolvedValue([completedRun]);

    const generate = okGenerate();
    const result = await run({ executionId: 'exec-1', generate });

    expect(result.code).toBe('completed');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repositoryMock.startRoleRun.mock.calls.map((call) => call[0].role)).toEqual(['qa']);
    expect(result.execution?.completedRoles).toEqual(['frontend', 'qa']);
  });

  it('is idempotent — resuming a fully completed execution runs nothing', async () => {
    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'paused' }));
    repositoryMock.listRoleRuns.mockResolvedValue(
      (['frontend', 'qa'] as IncrementalRoleId[]).map((role) => ({
        id: `run-${role}`,
        executionId: 'exec-1',
        role,
        label: role,
        attempt: 1,
        status: 'completed' as const,
        discoveredImpacts: [],
        startedAt: AT,
      })),
    );

    const generate = okGenerate();
    const result = await run({ executionId: 'exec-1', generate });

    expect(result.code).toBe('completed');
    expect(generate).not.toHaveBeenCalled();
    expect(repositoryMock.startRoleRun).not.toHaveBeenCalled();
  });

  it('numbers a retry as a new attempt rather than overwriting the failed one', async () => {
    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'paused' }));
    repositoryMock.listRoleRuns.mockResolvedValue([
      {
        id: 'run-old',
        executionId: 'exec-1',
        role: 'frontend',
        label: 'Frontend Engineer',
        attempt: 1,
        status: 'failed' as const,
        discoveredImpacts: [],
        startedAt: AT,
      },
    ]);

    await run({ executionId: 'exec-1' });

    expect(repositoryMock.startRoleRun.mock.calls[0][0]).toMatchObject({ role: 'frontend', attempt: 2 });
  });

  it('refuses to resume a finished execution', async () => {
    repositoryMock.getExecution.mockResolvedValue(makeExecution({ status: 'completed' }));

    const result = await run({ executionId: 'exec-1' });

    expect(result.code).toBe('conflict');
    expect(repositoryMock.startRoleRun).not.toHaveBeenCalled();
  });

  it('runs the required review stages over what actually ran', async () => {
    const result = await run();

    expect(result.execution?.reviews).toHaveLength(1);
    expect(result.execution?.reviews[0]).toMatchObject({ stage: 'code_review', decision: 'approved' });
  });

  it('stops when the impact analysis behind the plan is gone', async () => {
    getLatestImpactAnalysisMock.mockResolvedValue(null);

    const result = await run();

    expect(result.code).toBe('no_impact');
    expect(repositoryMock.createExecution).not.toHaveBeenCalled();
  });

  it('stops when there is no release baseline', async () => {
    resolveBaselineSnapshotMock.mockResolvedValue({ code: 'no_release', message: 'No release yet.' });

    const result = await run();

    expect(result.code).toBe('no_baseline');
  });

  it('keeps every write scoped to the change request’s own project', async () => {
    await run();

    for (const call of repositoryMock.startRoleRun.mock.calls) {
      expect(call[0].projectId).toBe('proj-1');
    }

    expect(repositoryMock.createExecution.mock.calls[0][0]).toMatchObject({
      projectId: 'proj-1',
      deploymentId: 'dep-1',
      changeRequestId: 'req-1',
    });
  });

  it('records the canonical completion event exactly once', async () => {
    await run();

    const events = repositoryMock.recordExecutionEvent.mock.calls.map((call) => call[0].eventType);

    expect(events.filter((event) => event === 'incremental_execution_completed')).toHaveLength(1);

    // Role-level events deliberately do not go to the project timeline — see the migration header.
    expect(events).not.toContain('incremental_role_completed');
  });
});
