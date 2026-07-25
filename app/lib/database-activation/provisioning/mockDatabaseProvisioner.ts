import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';
import type { ConnectionResult, DatabaseProvisioner, ProvisioningResult } from './databaseProvisioner';

/**
 * Mock Database Provisioner — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * The only working `DatabaseProvisioner` implementation in this phase.
 * Deterministically simulates a successful provision/connection — never
 * touches a network, a real database, or any external service. Its purpose
 * is to prove the provisioning abstraction, activity history, and Workspace
 * UI end-to-end without any of Part 10's safety concerns (destructive SQL,
 * overwriting a real customer database) being possible yet.
 */
export function createMockDatabaseProvisioner(): DatabaseProvisioner {
  return {
    providerId: 'mock',

    async provision(schema: StructuredDatabaseSchema, _sql: string): Promise<ProvisioningResult> {
      return {
        ok: true,
        provider: 'mock',
        message: `Simulated provisioning of ${schema.tables.length} table(s) — no real database was created or modified.`,
        provisionedAt: new Date().toISOString(),
      };
    },

    async verifyConnection(): Promise<ConnectionResult> {
      return {
        ok: true,
        provider: 'mock',
        message: 'Simulated connection verified — no real database was contacted.',
        verifiedAt: new Date().toISOString(),
      };
    },
  };
}
