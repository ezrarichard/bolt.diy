import type { Feature } from '~/lib/features/featureTypes';
import type { StructuredDatabaseSchema } from '~/lib/database-activation/schemaTypes';
import type { BackendDraft } from '~/lib/projects/prompts/backend';
import type { BackendModulePlan } from './backendModuleTypes';

/**
 * Backend Module Planner — Sprint 79 Phase 1.
 *
 * Pure, deterministic, no AI call, no I/O — same discipline as
 * `app/lib/application-manifest/manifestBuilder.ts`'s own file-draft derivation. Groups
 * whichever Features are handed in by `moduleSlug` (several Features legitimately share one
 * module, Product Lifecycle Architecture §3 / Backend Generation Architecture §5) into one
 * `BackendModulePlan` per distinct slug, so a later MVP adding a Feature to an existing module
 * naturally accumulates onto the same plan rather than creating a second one.
 */
export function deriveBackendModulePlans(
  features: Feature[],
  schema: StructuredDatabaseSchema | undefined,
  backendDraft: BackendDraft | undefined,
): BackendModulePlan[] {
  const featureIdsByModule = new Map<string, string[]>();

  for (const feature of features) {
    const existing = featureIdsByModule.get(feature.moduleSlug) ?? [];

    if (!existing.includes(feature.code)) {
      existing.push(feature.code);
    }

    featureIdsByModule.set(feature.moduleSlug, existing);
  }

  const databaseTables = (schema?.tables ?? []).map((table) => table.name);
  const apiEndpoints = backendDraft?.apiEndpoints ?? [];

  return Array.from(featureIdsByModule.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleSlug, featureIds]) => ({ moduleSlug, featureIds, databaseTables, apiEndpoints }));
}
