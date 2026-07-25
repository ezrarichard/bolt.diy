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

/**
 * Sprint 76 — a provider-agnostic summary of one SQL execution attempt. Any provider
 * (SupabaseProvisioner today; a future PostgresProvisioner/MySQL provider) can populate this the
 * same way — nothing here is Supabase-specific, so orchestration/UI code that reads it never needs
 * to branch on `provider`.
 */
export interface SqlExecutionReport {
  totalStatements: number;
  succeededStatements: number;

  /** Best-effort — the specific statement that failed, when the provider can identify it. */
  failedStatement?: string;
  errorMessage?: string;
  durationMs: number;

  /** How many attempts `withRetry` made (1 = succeeded or failed with no retry). */
  attempts: number;

  /** True when a failure meant nothing was committed (e.g. the whole migration ran inside one transaction that aborted). */
  rolledBack: boolean;
}

/** Sprint 76 — provider-agnostic "do the tables we generated actually exist" check, populated by `verifyConnection()`. */
export interface SchemaVerification {
  expectedTables: string[];
  foundTables: string[];
  missingTables: string[];
}

export interface ProvisioningResult {
  ok: boolean;
  provider: DatabaseProviderId;
  message: string;
  provisionedAt: string;

  /** Sprint 76 — omitted by providers that don't have per-statement detail to report (e.g. the mock). */
  executionReport?: SqlExecutionReport;
}

export interface ConnectionResult {
  ok: boolean;
  provider: DatabaseProviderId;
  message: string;
  verifiedAt: string;

  /** Sprint 76 — omitted by providers that don't check schema existence (e.g. the mock). */
  schemaVerification?: SchemaVerification;
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

  /**
   * Sprint 76 — `schema` is optional so this stays backward compatible with Sprint 75 callers/
   * implementations that never checked schema existence. When provided, a provider MAY populate
   * `ConnectionResult.schemaVerification`; providers that don't support this (the mock) just omit
   * it and still verify auth/connectivity/execution.
   */
  verifyConnection(schema?: StructuredDatabaseSchema): Promise<ConnectionResult>;
}
