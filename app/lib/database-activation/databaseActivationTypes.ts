import type { DatabaseProviderId } from './provisioning/databaseProvisioner';
import type { ValidationReport } from './schemaValidator';

/**
 * Sprint 75 — persisted on `Project.databaseActivation` (see
 * app/lib/stores/projects.ts), following the exact same metadata-folding
 * convention as `regionalSelection`/`packageSelection`: no new BuildersDB
 * table/migration, just another `builders_projects.metadata` key. Read by
 * DatabaseActivationCard.tsx; written only by databaseActivationService.ts.
 */
export interface DatabaseActivationState {
  schema?: {
    generatedAt: string;
    tableCount: number;
    schemaSql: string;
    migrationSql: string;
  };
  validation?: {
    validatedAt: string;
    report: ValidationReport;
  };
  provisioning?: {
    provider: DatabaseProviderId;
    status: 'in_progress' | 'succeeded' | 'failed';
    startedAt: string;
    finishedAt?: string;
    message?: string;
  };
  connection?: {
    verified: boolean;
    verifiedAt: string;
    message: string;
  };
}
