import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';
import type { StructuredDatabaseSchema } from './schemaTypes';

const {
  getApprovedStructuredSchemaMock,
  updateProjectDatabaseActivationMock,
  logProjectActivityMock,
  getProjectArtifactsMock,
  clearSupabaseProvisioningSessionMock,
  isBuildersDbProjectIdMock,
} = vi.hoisted(() => ({
  getApprovedStructuredSchemaMock: vi.fn(),
  updateProjectDatabaseActivationMock: vi.fn(),
  logProjectActivityMock: vi.fn(),
  getProjectArtifactsMock: vi.fn(() => []),
  clearSupabaseProvisioningSessionMock: vi.fn(),
  isBuildersDbProjectIdMock: vi.fn(() => false),
}));

vi.mock('~/lib/projects/databaseDesignerEngine', () => ({
  databaseDesignerEngine: { getApprovedStructuredSchema: getApprovedStructuredSchemaMock },
}));

vi.mock('~/lib/stores/projects', () => ({
  updateProjectDatabaseActivation: updateProjectDatabaseActivationMock,
  logProjectActivity: logProjectActivityMock,
  getProjectArtifacts: getProjectArtifactsMock,
}));

const FIXTURE_TOKEN = 'sbp_super_secret_pat_do_not_leak';

vi.mock('./provisioning/supabaseSessionCredentials', () => ({
  clearSupabaseProvisioningSession: clearSupabaseProvisioningSessionMock,

  /*
   * Simulates a "live" connected session throughout this whole file, so the credential-leakage
   * tests below exercise the real SupabaseProvisioner (not a mock of it) with a real token present.
   */
  getSupabaseProvisioningToken: () => FIXTURE_TOKEN,
}));

vi.mock('./provisioning/buildersDbProjectGuard', () => ({
  isBuildersDbProjectId: isBuildersDbProjectIdMock,
  BUILDERS_DB_PROJECT_REFUSAL_MESSAGE: 'Refusing to connect or provision — this is the Builders platform database.',
}));

const {
  connectSupabaseProject,
  disconnectSupabaseProject,
  generateDatabaseSchema,
  validateDatabaseSchema,
  provisionDatabase,
  retryProvisionDatabase,
  verifyDatabaseConnection,
} = await import('./databaseActivationService');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

const ONE_TABLE_SCHEMA: StructuredDatabaseSchema = {
  tables: [{ name: 'users', columns: [{ name: 'id', type: 'uuid', nullable: false }], primaryKey: ['id'] }],
};

describe('databaseActivationService — Sprint 75/76', () => {
  beforeEach(() => {
    getApprovedStructuredSchemaMock.mockReset();
    updateProjectDatabaseActivationMock.mockReset();
    logProjectActivityMock.mockReset();
    getProjectArtifactsMock.mockReset().mockReturnValue([]);
    clearSupabaseProvisioningSessionMock.mockReset();
    isBuildersDbProjectIdMock.mockReset().mockReturnValue(false);
  });

  describe('generateDatabaseSchema', () => {
    it('fails when there is no approved structured schema yet', () => {
      getApprovedStructuredSchemaMock.mockReturnValue(undefined);

      const result = generateDatabaseSchema(makeProject());

      expect(result.ok).toBe(false);
      expect(updateProjectDatabaseActivationMock).not.toHaveBeenCalled();
    });

    it('generates SQL and persists it, logging database_schema_generated', () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const result = generateDatabaseSchema(makeProject());

      expect(result.ok).toBe(true);
      expect(updateProjectDatabaseActivationMock).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ schema: expect.objectContaining({ tableCount: 1 }) }),
      );
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_schema_generated', expect.any(String));
    });
  });

  describe('validateDatabaseSchema', () => {
    it('fails when the schema has not been generated', () => {
      getApprovedStructuredSchemaMock.mockReturnValue(undefined);

      const result = validateDatabaseSchema(makeProject());

      expect(result.ok).toBe(false);
    });

    it('passes validation for a clean schema and logs database_validation_passed', () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const result = validateDatabaseSchema(makeProject());

      expect(result.ok).toBe(true);
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_validation_passed', expect.any(String));
    });

    it('fails validation for an invalid schema (e.g. missing primary key) and logs database_validation_failed', () => {
      getApprovedStructuredSchemaMock.mockReturnValue({
        tables: [{ name: 'logs', columns: [{ name: 'message', type: 'text', nullable: false }], primaryKey: [] }],
      });

      const result = validateDatabaseSchema(makeProject());

      expect(result.ok).toBe(false);
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_validation_failed', expect.any(String));
    });
  });

  describe('provisionDatabase — safety gate', () => {
    it('refuses to provision when the schema has not been generated', async () => {
      const result = await provisionDatabase(makeProject(), 'mock');

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/generate the schema/i);
    });

    it('refuses to provision when validation has not passed', async () => {
      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
        },
      });

      const result = await provisionDatabase(project, 'mock');

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/validation must pass/i);
    });

    it('provisions successfully via the mock provider once validation has passed', async () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
          validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
        },
      });

      const result = await provisionDatabase(project, 'mock');

      expect(result.ok).toBe(true);
      expect(logProjectActivityMock).toHaveBeenCalledWith(
        'proj-1',
        'database_provisioning_started',
        expect.any(String),
      );
      expect(logProjectActivityMock).toHaveBeenCalledWith(
        'proj-1',
        'database_provisioning_finished',
        expect.any(String),
      );
    });
  });

  describe('verifyDatabaseConnection', () => {
    it('refuses to verify when provisioning has not succeeded', async () => {
      const result = await verifyDatabaseConnection(makeProject());

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/provision the database first/i);
    });

    it('verifies successfully once provisioning has succeeded, logging database_connection_verified', async () => {
      const project = makeProject({
        databaseActivation: {
          provisioning: { provider: 'mock', status: 'succeeded', startedAt: '2026-07-25T00:00:00.000Z' },
        },
      });

      const result = await verifyDatabaseConnection(project);

      expect(result.ok).toBe(true);
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_connection_verified', expect.any(String));
    });
  });

  describe('connectSupabaseProject / disconnectSupabaseProject — Sprint 76', () => {
    it('refuses to connect with an empty project id', () => {
      const result = connectSupabaseProject(makeProject(), '  ');

      expect(result.ok).toBe(false);
      expect(updateProjectDatabaseActivationMock).not.toHaveBeenCalled();
    });

    it('refuses to connect when the project id resolves to BuildersDB itself (structural isolation)', () => {
      isBuildersDbProjectIdMock.mockReturnValue(true);

      const result = connectSupabaseProject(makeProject(), 'builders-db-project');

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/builders platform database/i);
      expect(updateProjectDatabaseActivationMock).not.toHaveBeenCalled();
      expect(logProjectActivityMock).not.toHaveBeenCalledWith('proj-1', 'database_connected', expect.any(String));
    });

    it('persists only the public project id (never a token) and logs database_connected', () => {
      const result = connectSupabaseProject(makeProject(), 'proj-abc');

      expect(result.ok).toBe(true);
      expect(updateProjectDatabaseActivationMock).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          connectionConfig: expect.objectContaining({ provider: 'supabase', projectId: 'proj-abc' }),
        }),
      );
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_connected', expect.any(String));
    });

    it('disconnect wipes the session credential AND the persisted connection config, logging database_disconnected', () => {
      const result = disconnectSupabaseProject(makeProject());

      expect(result.ok).toBe(true);
      expect(clearSupabaseProvisioningSessionMock).toHaveBeenCalledTimes(1);
      expect(updateProjectDatabaseActivationMock).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ connectionConfig: undefined }),
      );
      expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'database_disconnected', expect.any(String));
    });
  });

  describe('provisionDatabase — Supabase requires a connected project (Sprint 76)', () => {
    it('refuses to provision with the "supabase" provider when no project is connected', async () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
          validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
        },
      });

      const result = await provisionDatabase(project, 'supabase');

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/connect a supabase project/i);
    });

    it('does not require a connection at all for the "mock" provider — backward compatible with Sprint 75 projects', async () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
          validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },

          // No connectionConfig at all — exactly what an existing Sprint 75 project looks like.
        },
      });

      const result = await provisionDatabase(project, 'mock');

      expect(result.ok).toBe(true);
    });
  });

  describe('retryProvisionDatabase — Sprint 76', () => {
    it('refuses to retry when nothing has been provisioned yet', async () => {
      const result = await retryProvisionDatabase(makeProject());

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/nothing to retry/i);
    });

    it('retries using the same provider recorded from the last attempt', async () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
          validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
          provisioning: { provider: 'mock', status: 'failed', startedAt: '2026-07-25T00:00:00.000Z' },
        },
      });

      const result = await retryProvisionDatabase(project);

      expect(result.ok).toBe(true);
    });
  });

  describe('credential non-leakage — Sprint 76', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    });

    it('never includes the raw token in any persisted databaseActivation state or activity log call, across the REAL Supabase connect/provision/verify path', async () => {
      getApprovedStructuredSchemaMock.mockReturnValue(ONE_TABLE_SCHEMA);

      connectSupabaseProject(makeProject(), 'proj-abc');

      const project = makeProject({
        databaseActivation: {
          schema: { generatedAt: '2026-07-25T00:00:00.000Z', tableCount: 1, schemaSql: 'x', migrationSql: 'y' },
          validation: { validatedAt: '2026-07-25T00:00:00.000Z', report: { passed: true, errors: [], warnings: [] } },
          connectionConfig: { provider: 'supabase', projectId: 'proj-abc', connectedAt: '2026-07-25T00:00:00.000Z' },
        },
      });

      /*
       * Exercises the REAL SupabaseProvisioner (getDatabaseProvisioner/supabaseSessionCredentials
       * are not mocked away here beyond the token-injection above) with a live fixture token, over a
       * fetch mock — this is the actual path a real token could leak through, not just a unit stub.
       */
      await provisionDatabase(project, 'supabase');
      await verifyDatabaseConnection({
        ...project,
        databaseActivation: {
          ...project.databaseActivation,
          provisioning: { provider: 'supabase', status: 'succeeded', startedAt: '2026-07-25T00:00:00.000Z' },
        },
      });

      expect(updateProjectDatabaseActivationMock.mock.calls.length).toBeGreaterThan(0);

      for (const call of updateProjectDatabaseActivationMock.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(FIXTURE_TOKEN);
      }

      for (const call of logProjectActivityMock.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(FIXTURE_TOKEN);
      }

      // The connectionConfig itself must only ever hold the public project id, never anything token-shaped.
      const connectCall = updateProjectDatabaseActivationMock.mock.calls.find((call) => call[1]?.connectionConfig);
      expect(connectCall?.[1]?.connectionConfig).toEqual({
        provider: 'supabase',
        projectId: 'proj-abc',
        connectedAt: expect.any(String),
      });
    });
  });
});
