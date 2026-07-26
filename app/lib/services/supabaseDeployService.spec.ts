import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';
import type { DatabaseActivationState } from '~/lib/database-activation/databaseActivationTypes';

const { ensureDeploymentForProjectMock, attachSupabaseMock, getApprovedStructuredSchemaMock } = vi.hoisted(() => ({
  ensureDeploymentForProjectMock: vi.fn(),
  attachSupabaseMock: vi.fn(),
  getApprovedStructuredSchemaMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: {
    ensureDeploymentForProject: ensureDeploymentForProjectMock,
    attachSupabase: attachSupabaseMock,
  },
}));

vi.mock('~/lib/projects/databaseDesignerEngine', () => ({
  databaseDesignerEngine: { getApprovedStructuredSchema: getApprovedStructuredSchemaMock },
}));

const {
  syncSupabaseDeploymentAfterProvisioning,
  assessSupabaseReadiness,
  buildSupabaseEnvironmentHandoff,
  deriveSupabaseProjectUrl,
} = await import('./supabaseDeployService');

function makeProject(databaseActivation?: DatabaseActivationState): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    databaseActivation,
  } as unknown as Project;
}

describe('deriveSupabaseProjectUrl', () => {
  it('builds the standard Supabase project URL from a project ref', () => {
    expect(deriveSupabaseProjectUrl('abcdefghij')).toBe('https://abcdefghij.supabase.co');
  });
});

describe('syncSupabaseDeploymentAfterProvisioning', () => {
  beforeEach(() => {
    ensureDeploymentForProjectMock.mockReset();
    attachSupabaseMock.mockReset();
  });

  it('refuses to sync when provisioning used the mock provider (mock never attaches or advances lifecycle)', async () => {
    const project = makeProject({
      connectionConfig: { provider: 'mock', projectId: 'n/a', connectedAt: '2026-08-05T00:00:00.000Z' },
      provisioning: { provider: 'mock', status: 'succeeded', startedAt: '2026-08-05T00:00:00.000Z' },
    } as DatabaseActivationState);

    const result = await syncSupabaseDeploymentAfterProvisioning(project);

    expect(result.ok).toBe(false);
    expect(ensureDeploymentForProjectMock).not.toHaveBeenCalled();
    expect(attachSupabaseMock).not.toHaveBeenCalled();
  });

  it('refuses to sync when there is no databaseActivation at all', async () => {
    const result = await syncSupabaseDeploymentAfterProvisioning(makeProject(undefined));

    expect(result.ok).toBe(false);
    expect(attachSupabaseMock).not.toHaveBeenCalled();
  });

  it('refuses to sync when a real Supabase connection exists but provisioning has not succeeded yet', async () => {
    const project = makeProject({
      connectionConfig: { provider: 'supabase', projectId: 'abcdefghij', connectedAt: '2026-08-05T00:00:00.000Z' },
      provisioning: { provider: 'supabase', status: 'in_progress', startedAt: '2026-08-05T00:00:00.000Z' },
    } as DatabaseActivationState);

    const result = await syncSupabaseDeploymentAfterProvisioning(project);

    expect(result.ok).toBe(false);
    expect(attachSupabaseMock).not.toHaveBeenCalled();
  });

  it('ensures the Deployment and calls attachSupabase with safe, non-secret metadata after a real successful provisioning', async () => {
    ensureDeploymentForProjectMock.mockResolvedValue({
      id: 'dep-1',
      projectId: 'proj-1',
      status: 'repository_connected',
    });
    attachSupabaseMock.mockResolvedValue({
      id: 'sb-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      status: 'connected',
    });

    const project = makeProject({
      connectionConfig: {
        provider: 'supabase',
        projectId: 'abcdefghij',
        connectedAt: '2026-08-05T00:00:00.000Z',
        projectName: 'riverside-prod',
        region: 'us-east-1',
      },
      schema: {
        generatedAt: '2026-08-05T00:00:00.000Z',
        tableCount: 4,
        schemaSql: 'create table ...',
        migrationSql: 'begin; ... commit;',
        schemaVersion: 2,
      },
      provisioning: {
        provider: 'supabase',
        status: 'succeeded',
        startedAt: '2026-08-05T00:00:00.000Z',
        finishedAt: '2026-08-05T00:05:00.000Z',
        message: 'Provisioned 4 table(s) to Supabase project abcdefghij.',
      },
    } as DatabaseActivationState);

    const result = await syncSupabaseDeploymentAfterProvisioning(project, { performedBy: 'user-1' });

    expect(result.ok).toBe(true);
    expect(ensureDeploymentForProjectMock).toHaveBeenCalledWith('proj-1', { createdBy: 'user-1' });
    expect(attachSupabaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        supabaseProjectRef: 'abcdefghij',
        supabaseProjectUrl: 'https://abcdefghij.supabase.co',
        region: 'us-east-1',
        status: 'connected',
        metadata: expect.objectContaining({
          projectName: 'riverside-prod',
          schemaVersion: 2,
          tableCount: 4,
          mode: 'real',
        }),
      }),
      { performedBy: 'user-1' },
    );

    // Never a Management API token / secret anywhere in the persisted payload.
    const [payload] = attachSupabaseMock.mock.calls[0];
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|service_role|password/i);
  });

  it('surfaces a clear, actionable message when attachSupabase refuses an illegal lifecycle transition', async () => {
    ensureDeploymentForProjectMock.mockResolvedValue({ id: 'dep-1', projectId: 'proj-1', status: 'planning' });
    attachSupabaseMock.mockResolvedValue(null);

    const project = makeProject({
      connectionConfig: { provider: 'supabase', projectId: 'abcdefghij', connectedAt: '2026-08-05T00:00:00.000Z' },
      provisioning: { provider: 'supabase', status: 'succeeded', startedAt: '2026-08-05T00:00:00.000Z' },
    } as DatabaseActivationState);

    const result = await syncSupabaseDeploymentAfterProvisioning(project);

    expect(result.ok).toBe(false);
    expect(result.message.toLowerCase()).toContain('github');
  });

  it('does not create a Deployment when ensureDeploymentForProject fails (e.g. BuildersDB unavailable)', async () => {
    ensureDeploymentForProjectMock.mockResolvedValue(null);

    const project = makeProject({
      connectionConfig: { provider: 'supabase', projectId: 'abcdefghij', connectedAt: '2026-08-05T00:00:00.000Z' },
      provisioning: { provider: 'supabase', status: 'succeeded', startedAt: '2026-08-05T00:00:00.000Z' },
    } as DatabaseActivationState);

    const result = await syncSupabaseDeploymentAfterProvisioning(project);

    expect(result.ok).toBe(false);
    expect(attachSupabaseMock).not.toHaveBeenCalled();
  });
});

describe('assessSupabaseReadiness', () => {
  beforeEach(() => {
    getApprovedStructuredSchemaMock.mockReset();
  });

  it('reports every item missing for a project with no approved schema', () => {
    getApprovedStructuredSchemaMock.mockReturnValue(undefined);

    const report = assessSupabaseReadiness(makeProject(undefined));

    expect(report.allReady).toBe(false);
    expect(report.items.find((item) => item.key === 'schema')?.ready).toBe(false);
    expect(report.items.find((item) => item.key === 'rls_policies')?.ready).toBe(false);
    expect(report.items.find((item) => item.key === 'auth')?.ready).toBe(false);
  });

  it('marks schema/FK/index/RLS/storage ready only when the approved schema actually declares them', () => {
    getApprovedStructuredSchemaMock.mockReturnValue({
      tables: [
        {
          name: 'orders',
          columns: [{ name: 'id', type: 'uuid', nullable: false }],
          primaryKey: ['id'],
          foreignKeys: [{ column: 'customer_id', referencesTable: 'customers', referencesColumn: 'id' }],
          indexes: [{ name: 'orders_customer_id_idx', columns: ['customer_id'] }],
        },
      ],
      policies: [{ table: 'orders', name: 'orders_select', description: 'owner can select' }],
      storageBuckets: [{ name: 'avatars', public: true }],
    });

    const report = assessSupabaseReadiness(makeProject(undefined));

    expect(report.items.find((item) => item.key === 'schema')?.ready).toBe(true);
    expect(report.items.find((item) => item.key === 'foreign_keys_indexes')?.ready).toBe(true);
    expect(report.items.find((item) => item.key === 'rls_policies')?.ready).toBe(true);
    expect(report.items.find((item) => item.key === 'storage_buckets')?.ready).toBe(true);

    // Never fabricated — auth wiring and seed data are never modeled yet, regardless of schema content.
    expect(report.items.find((item) => item.key === 'auth')?.ready).toBe(false);
    expect(report.items.find((item) => item.key === 'seed_data')?.ready).toBe(false);
  });

  it('marks environment_variables ready only when both required Supabase vars are declared', () => {
    getApprovedStructuredSchemaMock.mockReturnValue(undefined);

    const withBoth = assessSupabaseReadiness(makeProject(undefined), {
      environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
    const withOne = assessSupabaseReadiness(makeProject(undefined), {
      environmentRequirements: ['VITE_SUPABASE_URL'],
    });

    expect(withBoth.items.find((item) => item.key === 'environment_variables')?.ready).toBe(true);
    expect(withOne.items.find((item) => item.key === 'environment_variables')?.ready).toBe(false);
  });
});

describe('buildSupabaseEnvironmentHandoff', () => {
  it('never resolves an anon key and never touches secrets, only the derived project URL', () => {
    const project = makeProject({
      connectionConfig: { provider: 'supabase', projectId: 'abcdefghij', connectedAt: '2026-08-05T00:00:00.000Z' },
    } as DatabaseActivationState);

    const handoff = buildSupabaseEnvironmentHandoff(project, {
      environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });

    expect(handoff.VITE_SUPABASE_URL).toBe('https://abcdefghij.supabase.co');
    expect(handoff.VITE_SUPABASE_ANON_KEY).toBeUndefined();
    expect(handoff.projectRef).toBe('abcdefghij');
    expect(handoff.missingRequiredVariables).toEqual(['VITE_SUPABASE_ANON_KEY']);
  });

  it('returns no project ref/url when there is no real Supabase connection', () => {
    const handoff = buildSupabaseEnvironmentHandoff(makeProject(undefined));

    expect(handoff.projectRef).toBeUndefined();
    expect(handoff.VITE_SUPABASE_URL).toBeUndefined();
  });
});
