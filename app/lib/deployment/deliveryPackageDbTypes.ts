import type {
  DeliveryCompletenessLevel,
  DeliveryPackage,
  DeliveryPackageRecord,
} from '~/lib/deployment/deliveryPackageTypes';

/**
 * BuildersDB row/frontend shape mapping for the Customer Delivery Package — Sprint 93. Mirrors
 * `deploymentDbTypes.ts`/`verificationDbTypes.ts` exactly: the `BuildersDb...Row` interface is the
 * literal shape of a `builders_delivery_packages` row (see
 * supabase/migrations/20260806100000_delivery_package.sql), and this file is the only place a row
 * is translated into the application's camelCase shape.
 */

export interface BuildersDbDeliveryPackageRow {
  id: string;
  deployment_id: string;
  project_id: string;
  package_number: number;
  package_version: string;
  generator_version: string;
  status: string;
  manifest_version: number | null;
  verification_id: string | null;
  completeness_score: number;
  completeness_level: DeliveryCompletenessLevel;
  delivery_summary: DeliveryPackage | Record<string, never> | null;
  generated_at: string;
  generated_by: string | null;
  created_at: string;
}

export function fromDeliveryPackageRow(row: BuildersDbDeliveryPackageRow): DeliveryPackageRecord {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    packageNumber: row.package_number,
    packageVersion: row.package_version,
    generatorVersion: row.generator_version,
    status: row.status,
    manifestVersion: row.manifest_version ?? undefined,
    verificationId: row.verification_id ?? undefined,
    completenessScore: row.completeness_score,
    completenessLevel: row.completeness_level,
    deliverySummary: (row.delivery_summary ?? {}) as DeliveryPackage,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by ?? undefined,
    createdAt: row.created_at,
  };
}
