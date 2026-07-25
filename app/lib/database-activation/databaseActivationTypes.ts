import type { DatabaseProviderId, SchemaVerification, SqlExecutionReport } from './provisioning/databaseProvisioner';
import type { ValidationReport } from './schemaValidator';

/**
 * Sprint 75 — persisted on `Project.databaseActivation` (see
 * app/lib/stores/projects.ts), following the exact same metadata-folding
 * convention as `regionalSelection`/`packageSelection`: no new BuildersDB
 * table/migration, just another `builders_projects.metadata` key. Read by
 * DatabaseActivationCard.tsx; written only by databaseActivationService.ts.
 *
 * Sprint 76 — extended with `connectionConfig` (which provider/project a customer database is
 * provisioned into) and richer provisioning/connection detail. Contains ONLY public identifiers
 * and status — never a credential. See docs/backend-activation/Provisioning-Architecture.md §4:
 * the Supabase Management token lives exclusively in the session-scoped credential holder
 * (provisioning/supabaseSessionCredentials.ts) and is never written here.
 */
export interface DatabaseActivationState {
  schema?: {
    generatedAt: string;
    tableCount: number;
    schemaSql: string;
    migrationSql: string;

    /** Sprint 76 — the approved DATABASE_SCHEMA artifact's version at the time SQL was generated, surfaced in the Workspace UI. */
    schemaVersion?: number;
  };
  validation?: {
    validatedAt: string;
    report: ValidationReport;
  };

  /**
   * Sprint 76 — which customer database this project is connected to, if any. `projectId` is a
   * public Supabase project identifier, not a secret — the credential authorizing access to it is
   * never stored here or anywhere else in BuildersDB.
   */
  connectionConfig?: {
    provider: DatabaseProviderId;
    projectId: string;
    connectedAt: string;
  };
  provisioning?: {
    provider: DatabaseProviderId;
    status: 'in_progress' | 'succeeded' | 'failed';
    startedAt: string;
    finishedAt?: string;
    message?: string;

    /** Sprint 76 — per-attempt SQL execution detail (statement counts, retries, rollback). Omitted by providers that don't report it (the mock). */
    executionReport?: SqlExecutionReport;
  };
  connection?: {
    verified: boolean;
    verifiedAt: string;
    message: string;

    /** Sprint 76 — "did the tables we generated actually get created" detail. Omitted by providers that don't check it (the mock). */
    schemaVerification?: SchemaVerification;
  };
}
