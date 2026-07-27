import { RELEASE_MODEL_VERSION } from '~/lib/deployment/releaseTypes';
import type {
  CustomerAcceptanceState,
  ReleaseBaseline,
  ReleaseIntegrity,
  ReleaseNotes,
  ReleaseRecord,
  ReleaseStatus,
} from '~/lib/deployment/releaseTypes';
import type { ReleaseType } from '~/lib/deployment/semanticVersion';

/**
 * BuildersDB row/frontend shape mapping for Release Management — Sprint 94. Mirrors
 * `deploymentDbTypes.ts`/`verificationDbTypes.ts`/`deliveryPackageDbTypes.ts` exactly: the
 * `BuildersDb...Row` interface is the literal shape of a `builders_releases` row (see
 * supabase/migrations/20260807100000_release_management.sql), and this file is the only place a
 * row is translated into the application's camelCase shape.
 */

export interface BuildersDbReleaseRow {
  id: string;
  deployment_id: string;
  project_id: string;
  release_number: number;
  semantic_version: string;
  release_name: string;
  release_type: ReleaseType;
  release_status: ReleaseStatus;
  release_date: string;
  delivery_package_id: string | null;
  verification_id: string | null;
  manifest_version: number | null;
  baseline: ReleaseBaseline | Record<string, never> | null;
  release_notes: ReleaseNotes | Record<string, never> | null;
  integrity: ReleaseIntegrity | Record<string, never> | null;
  customer_acceptance_state: CustomerAcceptanceState;
  customer_acceptance_notes: string | null;
  customer_acceptance_conditions: string[] | null;
  customer_acceptance_recorded_by: string | null;
  customer_acceptance_recorded_at: string | null;
  metadata: ReleaseRecord['metadata'] | Record<string, never> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_NOTES: ReleaseNotes = { summary: '', categories: [], breakingChanges: [], knownIssues: [] };

export function fromReleaseRow(row: BuildersDbReleaseRow): ReleaseRecord {
  const notes =
    row.release_notes && 'categories' in row.release_notes ? (row.release_notes as ReleaseNotes) : EMPTY_NOTES;
  const integrity =
    row.integrity && 'checks' in row.integrity
      ? (row.integrity as ReleaseIntegrity)
      : { complete: false, checks: [], checksum: '' };

  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    releaseNumber: row.release_number,
    semanticVersion: row.semantic_version,
    releaseName: row.release_name,
    releaseType: row.release_type,
    releaseStatus: row.release_status,
    releaseDate: row.release_date,
    baseline: (row.baseline ?? {}) as ReleaseBaseline,
    releaseNotes: notes,
    integrity,
    customerAcceptance: {
      state: row.customer_acceptance_state,
      notes: row.customer_acceptance_notes ?? undefined,
      conditions: row.customer_acceptance_conditions ?? [],
      recordedBy: row.customer_acceptance_recorded_by ?? undefined,
      recordedAt: row.customer_acceptance_recorded_at ?? undefined,
    },

    /* `metadata` is written whole by `createRelease`; the defaults only cover a row predating a field. */
    metadata: {
      ...({
        modelVersion: RELEASE_MODEL_VERSION,
        intendedType: row.release_type,
        intentMatchesVersion: true,
      } satisfies ReleaseRecord['metadata']),
      ...((row.metadata ?? {}) as ReleaseRecord['metadata']),
      createdBy: (row.metadata as ReleaseRecord['metadata'] | undefined)?.createdBy ?? row.created_by ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
