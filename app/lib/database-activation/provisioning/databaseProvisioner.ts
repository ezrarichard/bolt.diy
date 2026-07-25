import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';

/**
 * Provisioning Abstraction — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * Provider-independent by design (not Supabase-first): only `'mock'` has a
 * working implementation in this phase (see mockDatabaseProvisioner.ts).
 * `'supabase' | 'postgres' | 'sqlite'` are named/typed now so Sprint 76+ can
 * implement them behind this exact interface without any call site changing
 * — see getProvisioner.ts.
 */
export type DatabaseProviderId = 'mock' | 'supabase' | 'postgres' | 'sqlite';

export interface ProvisioningResult {
  ok: boolean;
  provider: DatabaseProviderId;
  message: string;
  provisionedAt: string;
}

export interface ConnectionResult {
  ok: boolean;
  provider: DatabaseProviderId;
  message: string;
  verifiedAt: string;
}

/**
 * A provisioner never runs unprompted — `databaseActivationService.ts` only
 * calls `provision()` in direct response to an explicit user action in the
 * Workspace UI (DatabaseActivationCard.tsx), and only after
 * `schemaValidator.ts` reports `passed: true`. No implementation of this
 * interface may execute destructive SQL (DROP/TRUNCATE/ALTER ... DROP) —
 * Phase 1's SQL generator never emits any.
 */
export interface DatabaseProvisioner {
  readonly providerId: DatabaseProviderId;
  provision(schema: StructuredDatabaseSchema, sql: string): Promise<ProvisioningResult>;
  verifyConnection(): Promise<ConnectionResult>;
}
