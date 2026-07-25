import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';
import type { StructuredDatabaseSchema } from './schemaTypes';

const { getApprovedStructuredSchemaMock, updateProjectDatabaseActivationMock, logProjectActivityMock } = vi.hoisted(
  () => ({
    getApprovedStructuredSchemaMock: vi.fn(),
    updateProjectDatabaseActivationMock: vi.fn(),
    logProjectActivityMock: vi.fn(),
  }),
);

vi.mock('~/lib/projects/databaseDesignerEngine', () => ({
  databaseDesignerEngine: { getApprovedStructuredSchema: getApprovedStructuredSchemaMock },
}));

vi.mock('~/lib/stores/projects', () => ({
  updateProjectDatabaseActivation: updateProjectDatabaseActivationMock,
  logProjectActivity: logProjectActivityMock,
}));

const { generateDatabaseSchema, validateDatabaseSchema, provisionDatabase, verifyDatabaseConnection } = await import(
  './databaseActivationService'
);

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

describe('databaseActivationService — Sprint 75', () => {
  beforeEach(() => {
    getApprovedStructuredSchemaMock.mockReset();
    updateProjectDatabaseActivationMock.mockReset();
    logProjectActivityMock.mockReset();
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
});
