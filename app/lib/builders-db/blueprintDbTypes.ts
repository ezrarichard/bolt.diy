import type { ProjectBlueprint, RoadmapItem } from '~/lib/blueprints/types';

/**
 * BuildersDB row/frontend shape mapping for the Blueprint Foundation — Sprint 59. Mirrors the
 * convention `requirementsSessionDbTypes.ts` already established (see its own header comment):
 * `BuildersDbBlueprintRow` is the literal shape of a row in `builders_blueprints` (see
 * supabase/migrations/20260729100000_blueprint_foundation.sql for the DDL), and
 * `fromBlueprintRow` is the only place a row is translated into the frontend's existing
 * `ProjectBlueprint` shape — the same shape `app/lib/blueprints/registry.ts`'s hardcoded array
 * already uses, so `blueprintEngine` never needs to know whether a `ProjectBlueprint` came from
 * the registry or from BuildersDB.
 *
 * There is no `toBlueprintInsert`/`toBlueprintUpdate` in this sprint — the only writer of
 * `builders_blueprints` is the migration's own seed INSERT (see that file's header: Blueprint
 * Studio, a later sprint, is what introduces an application-level write path). This file is
 * read-only mapping on purpose.
 */

export interface BuildersDbBlueprintRow {
  id: string;
  slug: string;
  version: number;
  is_latest: boolean;
  status: string;
  parent_blueprint_id: string | null;
  sort_order: number;
  name: string;
  icon: string;
  description: string;
  category: string;
  product_type: string | null;
  industry: string | null;
  target_users: string | null;
  default_status: string | null;
  recommended_stack: string[];
  recommended_integrations: string[];
  recommended_next_steps: string[];
  roadmap: RoadmapItem[];
  enabled: boolean;
  coming_soon: boolean;
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Maps one `builders_blueprints` row onto the existing `ProjectBlueprint` shape. `id` is
 * deliberately the row's `slug` (not its BuildersDB uuid) — every existing consumer
 * (`project.blueprintId`, all 27+ `blueprintEngine.*` call sites) already keys blueprints by
 * this stable slug, and that must keep working unchanged; the row's own uuid `id` is exposed
 * separately as `parentBlueprintId` material for a future sprint, never as this field.
 */
export function fromBlueprintRow(row: BuildersDbBlueprintRow): ProjectBlueprint {
  return {
    id: row.slug,
    name: row.name,
    icon: row.icon,
    description: row.description,
    category: row.category as ProjectBlueprint['category'],
    productType: row.product_type ?? undefined,
    recommendedStack: row.recommended_stack ?? [],
    recommendedIntegrations: row.recommended_integrations ?? [],
    recommendedNextSteps: row.recommended_next_steps ?? [],
    targetUsers: row.target_users ?? undefined,
    defaultStatus: row.default_status ?? undefined,
    roadmap: row.roadmap ?? [],
    enabled: row.enabled,
    comingSoon: row.coming_soon,
    industry: row.industry ?? undefined,
    parentBlueprintId: row.parent_blueprint_id ?? undefined,
    version: row.version,
    status: row.status as ProjectBlueprint['status'],
    metadata: row.metadata ?? {},
    content: row.content ?? {},
  };
}
