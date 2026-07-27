import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Incremental Execution Repository — Sprint 97, Part 14.
 *
 * THE COLUMN-NAME TESTS ARE THE POINT OF THIS FILE. Sprint 97 first shipped with a
 * `current_role` column, which PostgreSQL rejects: it is a fully reserved SQL-standard identifier
 * (a niladic function, like `current_user`), so the CREATE TABLE would not parse and the migration
 * failed on apply.
 *
 * TypeScript could not have caught it. The update patch is a `Record<string, unknown>` — every
 * column name in this repository is a string literal that no type checks against the schema. So
 * the names are pinned here instead, and the reserved-word list below is asserted directly against
 * every name this repository writes. A future column called `user`, `order` or `check` fails in
 * CI rather than on a production migration.
 */

const { getBuildersDbClientMock, recordDeploymentEventMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
  recordDeploymentEventMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({ getBuildersDbClient: getBuildersDbClientMock }));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { recordDeploymentEvent: recordDeploymentEventMock },
}));

const { createExecution, updateExecution, getExecution, startRoleRun } = await import(
  './incrementalExecutionRepository'
);

/** PostgreSQL's fully reserved key words — none may be a bare column name. */
const RESERVED_SQL_IDENTIFIERS = new Set(
  `all analyse analyze and any array as asc asymmetric both case cast check collate column constraint
   create current_catalog current_date current_role current_schema current_time current_timestamp
   current_user default deferrable desc distinct do else end except false fetch for foreign from grant
   group having in initially intersect into lateral leading limit localtime localtimestamp not null
   offset on only or order placing primary references returning select session_user some symmetric table
   then to trailing true union unique user using variadic when where window with`.split(/\s+/),
);

function makeExecutionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    engineering_plan_id: 'plan-1',
    change_request_id: 'req-1',
    impact_analysis_id: 'imp-1',
    deployment_id: 'dep-1',
    project_id: 'proj-1',
    release_id: 'rel-1',
    status: 'running',
    execution_version: 1,
    model_version: '1.0.0',
    recommended_roles: ['frontend', 'qa'],
    selected_roles: ['frontend', 'qa'],
    overrides: [],
    active_role: 'frontend',
    completed_roles: [],
    skipped_roles: [],
    failed_roles: [],
    safety_fallbacks: [],
    full_context_fallback: null,
    scope_expansion_decisions: [],
    reviews: [],
    scope_fingerprint: 'scope-abcd1234',
    failure: null,
    metadata: {},
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    created_by: 'ezra',
    created_at: '2026-08-14T10:00:00.000Z',
    updated_at: '2026-08-14T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * A Supabase client stub that records what each table was asked to do. Deliberately records the
 * raw payloads, because the payload KEYS are what these tests assert.
 */
function makeClient() {
  const executionInsert = vi.fn();
  const executionUpdate = vi.fn();
  const invalidationInsert = vi.fn();
  const roleRunInsert = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === 'builders_incremental_executions') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
            maybeSingle: async () => ({ data: makeExecutionRow(), error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          executionInsert(payload);
          return { select: () => ({ single: async () => ({ data: makeExecutionRow(payload), error: null }) }) };
        },
        update: (payload: Record<string, unknown>) => {
          executionUpdate(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
    }

    if (table === 'builders_incremental_invalidations') {
      return {
        insert: async (payload: unknown) => {
          invalidationInsert(payload);
          return { error: null };
        },
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      };
    }

    if (table === 'builders_incremental_role_runs') {
      return {
        insert: (payload: Record<string, unknown>) => {
          roleRunInsert(payload);
          return { select: () => ({ single: async () => ({ data: { id: 'run-1' }, error: null }) }) };
        },
        select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      };
    }

    if (table === 'builders_discovered_impacts') {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from }, executionInsert, executionUpdate, invalidationInsert, roleRunInsert };
}

function createParams(overrides: Record<string, unknown> = {}) {
  return {
    engineeringPlanId: 'plan-1',
    changeRequestId: 'req-1',
    impactAnalysisId: 'imp-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    releaseId: 'rel-1',
    modelVersion: '1.0.0',
    recommendedRoles: ['frontend', 'qa'] as never,
    selectedRoles: ['frontend', 'qa'] as never,
    overrides: [],
    safetyFallbacks: [],
    scopeFingerprint: 'scope-abcd1234',
    status: 'running' as const,
    invalidations: [],
    createdBy: 'ezra',
    ...overrides,
  };
}

beforeEach(() => {
  getBuildersDbClientMock.mockReset();
  recordDeploymentEventMock.mockReset();
  recordDeploymentEventMock.mockResolvedValue({ id: 'evt-1' });
});

describe('reserved SQL identifiers', () => {
  it('never writes a column named with a reserved SQL key word', async () => {
    const { client, executionInsert, executionUpdate, roleRunInsert } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await createExecution(createParams() as never);
    await updateExecution('exec-1', { status: 'paused', currentRole: 'qa', completedRoles: ['frontend'] as never });
    await startRoleRun({
      executionId: 'exec-1',
      projectId: 'proj-1',
      role: 'frontend' as never,
      attempt: 1,
      artifactType: 'frontend-draft',
      context: undefined,
      startedAt: '2026-08-14T10:00:00.000Z',
    });

    const writtenColumns = [
      ...Object.keys(executionInsert.mock.calls[0][0]),
      ...Object.keys(executionUpdate.mock.calls[0][0]),
      ...Object.keys(roleRunInsert.mock.calls[0][0]),
    ];

    expect(writtenColumns.length).toBeGreaterThan(20);

    const collisions = writtenColumns.filter((column) => RESERVED_SQL_IDENTIFIERS.has(column));

    expect(collisions).toEqual([]);
  });

  it('specifically never writes `current_role`, which PostgreSQL rejects outright', async () => {
    const { client, executionInsert, executionUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await createExecution(createParams() as never);
    await updateExecution('exec-1', { currentRole: 'qa' as never });

    expect(Object.keys(executionInsert.mock.calls[0][0])).not.toContain('current_role');
    expect(Object.keys(executionUpdate.mock.calls[0][0])).not.toContain('current_role');
  });
});

describe('the currentRole ↔ active_role mapping', () => {
  it('writes the application’s currentRole to the active_role column', async () => {
    const { client, executionUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await updateExecution('exec-1', { currentRole: 'qa' as never });

    expect(executionUpdate).toHaveBeenCalledWith({ active_role: 'qa' });
  });

  it('clears the column when the runner passes null', async () => {
    const { client, executionUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await updateExecution('exec-1', { currentRole: null });

    expect(executionUpdate).toHaveBeenCalledWith({ active_role: null });
  });

  it('reads active_role back as currentRole', async () => {
    const { client } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const execution = await getExecution('exec-1');

    expect(execution?.currentRole).toBe('frontend');
  });

  it('omits the column entirely when currentRole was not part of the update', async () => {
    const { client, executionUpdate } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await updateExecution('exec-1', { status: 'completed' });

    expect(executionUpdate).toHaveBeenCalledWith({ status: 'completed' });
  });
});

describe('createExecution', () => {
  it('allocates execution_version 1 and records the started event', async () => {
    const { client, executionInsert } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createExecution(createParams() as never);

    expect(result.ok).toBe(true);
    expect(executionInsert.mock.calls[0][0]).toMatchObject({
      execution_version: 1,
      engineering_plan_id: 'plan-1',
      project_id: 'proj-1',
      scope_fingerprint: 'scope-abcd1234',
    });
    expect(recordDeploymentEventMock.mock.calls[0][0]).toMatchObject({
      eventType: 'incremental_execution_started',
    });
  });

  it('keeps the recommendation and the approved selection in separate columns', async () => {
    const { client, executionInsert } = makeClient();
    getBuildersDbClientMock.mockReturnValue(client);

    await createExecution(
      createParams({ recommendedRoles: ['frontend', 'qa', 'devops'], selectedRoles: ['frontend', 'qa'] }) as never,
    );

    expect(executionInsert.mock.calls[0][0]).toMatchObject({
      recommended_roles: ['frontend', 'qa', 'devops'],
      selected_roles: ['frontend', 'qa'],
      skipped_roles: ['devops'],
    });
  });

  it('reports a unique-violation as a conflict rather than an error', async () => {
    const { client } = makeClient();
    client.from = vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }),
      }),
    })) as never;
    getBuildersDbClientMock.mockReturnValue(client);

    const result = await createExecution(createParams() as never);

    expect(result).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('returns unavailable when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await createExecution(createParams() as never)).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await updateExecution('exec-1', { status: 'paused' })).toBe(false);
  });
});
