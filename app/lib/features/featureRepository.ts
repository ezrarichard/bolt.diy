import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { MoscowPriority } from '~/lib/projects/prompts/productOwner';
import { isValidFeatureStatusTransition } from '~/lib/mvp/lifecycleTransitions';
import { mvpRepository } from '~/lib/mvp/mvpRepository';
import { formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';
import type {
  Feature,
  FeatureCodeCollision,
  FeatureDraft,
  FeatureStatus,
  FeatureWriteResult,
  PromoteFeaturesResult,
} from './featureTypes';

/**
 * Feature Repository — Sprint 78 Phase 0 (Product Lifecycle & Backend Generation Architecture).
 *
 * Same defensive contract as `app/lib/mvp/mvpRepository.ts` and every other BuildersDB
 * repository in this codebase: guarded on BuildersDB being configured, every Supabase call
 * wrapped in try/catch, every failure path logs and returns a safe fallback (`false`/`[]`/`null`,
 * or an explicit `{ ok: false, error }`) rather than throwing.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[Feature] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[Feature] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown error';
}

interface FeatureRow {
  id: string;
  project_id: string;
  mvp_id: string;
  code: string;
  module_slug: string | null;
  title: string;
  description: string | null;
  priority: MoscowPriority | null;
  depends_on: string[] | null;
  customer_value: string | null;
  status: FeatureStatus;
  created_at: string;
  updated_at: string;
}

function fromFeatureRow(row: FeatureRow): Feature {
  return {
    id: row.id,
    projectId: row.project_id,
    mvpId: row.mvp_id,
    code: row.code,

    /*
     * Falls back to `code` for rows written before `module_slug` existed — same default the
     * write side (`createFeature`) applies going forward, see `Feature.moduleSlug`'s comment.
     */
    moduleSlug: row.module_slug ?? row.code,
    title: row.title,
    description: row.description ?? undefined,
    priority: row.priority ?? undefined,
    dependsOn: row.depends_on ?? [],
    customerValue: row.customer_value ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every Feature committed under one MVP. */
export async function listFeaturesForMvp(mvpId: string): Promise<Feature[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listFeaturesForMvp');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_features')
      .select('*')
      .eq('mvp_id', mvpId)
      .order('code', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as FeatureRow[]).map(fromFeatureRow);
  } catch (error) {
    logError('listFeaturesForMvp', error);
    return [];
  }
}

/**
 * Sprint 81 (Cross-MVP Foundation) — every Feature committed across the WHOLE project, spanning
 * every MVP, in project order (`created_at` ascending — MVPs are always planned/promoted in
 * sequence order, Gate A after Gate A, so creation order already matches roadmap order without
 * needing a join back to `builders_mvps.sequence`). This is the direct replacement for "only
 * inspecting the active MVP" — future roadmap planning (`assignFeatureIds`'s project-wide id
 * counter, Roadmap Analysis's dependency resolution, Part 1 of
 * docs/product-management/Product-Management-Architecture.md) reads this instead.
 */
export async function listFeaturesForProject(projectId: string): Promise<Feature[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listFeaturesForProject');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_features')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as FeatureRow[]).map(fromFeatureRow);
  } catch (error) {
    logError('listFeaturesForProject', error);
    return [];
  }
}

/**
 * Sprint 81 (Cross-MVP Foundation) — Migration Safety, item 7: detects (never repairs) every
 * Feature `code` collision across different MVPs within one project — the exact case the
 * `(project_id, code)` unique index (`20260801110000_cross_mvp_feature_identity.sql`) cannot yet
 * assume is impossible for data written before it applied. Read-only; a collision found here is
 * always a REPORT (project, MVPs, affected Feature rows — the migration's own required repair
 * report), never auto-renamed. Returns `[]` (never throws) when there is nothing to report,
 * including the expected case (BuildersDB unavailable, or a project with no collisions at all).
 */
export async function detectFeatureCodeCollisions(projectId: string): Promise<FeatureCodeCollision[]> {
  const features = await listFeaturesForProject(projectId);
  const byCode = new Map<string, Feature[]>();

  for (const feature of features) {
    const group = byCode.get(feature.code) ?? [];
    group.push(feature);
    byCode.set(feature.code, group);
  }

  const collisions: FeatureCodeCollision[] = [];

  for (const [code, group] of byCode) {
    const distinctMvps = new Set(group.map((feature) => feature.mvpId));

    if (distinctMvps.size > 1) {
      collisions.push({
        projectId,
        code,
        features: group.map((feature) => ({
          id: feature.id,
          mvpId: feature.mvpId,
          code: feature.code,
          title: feature.title,
        })),
      });
    }
  }

  return collisions;
}

export async function getFeatureById(featureId: string): Promise<Feature | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getFeatureById');
    return null;
  }

  try {
    const { data, error } = await client.from('builders_features').select('*').eq('id', featureId).maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromFeatureRow(data as FeatureRow) : null;
  } catch (error) {
    logError('getFeatureById', error);
    return null;
  }
}

/**
 * Sprint 78 Phase 0 — "Active-MVP Feature resolution": every Feature owned by whichever MVP
 * `mvpRepository.resolveActiveMvpId` currently resolves to for this project. This is the direct
 * replacement for `GenerationPlanScope.inScopeFeatureIds` (a flat, copied array) — callers query
 * this function instead of reading a denormalized scope list. Returns `[]` (never throws) for a
 * project with no active MVP, matching `resolveActiveMvpId`'s own "fall back to whole-product
 * generation" contract.
 */
export async function resolveActiveMvpFeatures(projectId: string): Promise<Feature[]> {
  const activeMvpId = await mvpRepository.resolveActiveMvpId(projectId);

  if (!activeMvpId) {
    return [];
  }

  return listFeaturesForMvp(activeMvpId);
}

async function createFeature(draft: FeatureDraft): Promise<FeatureWriteResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('createFeature');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const { data, error } = await client
      .from('builders_features')
      .insert({
        project_id: draft.projectId,
        mvp_id: draft.mvpId,
        code: draft.code,
        module_slug: draft.moduleSlug ?? draft.code,
        title: draft.title,
        description: draft.description ?? null,
        priority: draft.priority ?? null,
        depends_on: draft.dependsOn ?? [],
        customer_value: draft.customerValue ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw error ?? new Error('Insert returned no row');
    }

    return { ok: true, error: null, feature: fromFeatureRow(data as FeatureRow) };
  } catch (error) {
    logError('createFeature', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

/** Updates an existing Feature's descriptive fields only — never `status`, which is owned exclusively by engineering progress (see `updateFeatureStatus`), and never `mvpId`/`moduleSlug`, both immutable once a row exists (see `promoteFeaturesForMvp`'s own comment) — module assignment is a one-time Gate-A decision, not something a later descriptive re-promotion should silently move. */
async function updateFeatureFields(featureId: string, draft: FeatureDraft): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('updateFeatureFields');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_features')
      .update({
        title: draft.title,
        description: draft.description ?? null,
        priority: draft.priority ?? null,
        depends_on: draft.dependsOn ?? [],
        customer_value: draft.customerValue ?? null,
      })
      .eq('id', featureId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateFeatureFields', error);
    return false;
  }
}

/**
 * Sprint 78 Phase 0 — idempotent Gate A Feature promotion: commits every `ProductOwnerFeature`
 * from an approved `CurrentMvpPlan.features` into real `Feature` rows owned by `mvpId`.
 *
 * **Idempotency**: keyed on `(mvpId, code)` — the same natural key `builders_features`'s own
 * unique index enforces (see the migration). Gate A approval can be re-triggered (resume after
 * interruption, or a genuine re-approval after "changes requested" — see `MvpApproval`, one row
 * per decision, never an upsert), so this function must be safe to call more than once for the
 * same MVP: a Feature whose `(mvpId, code)` already exists is updated in place (descriptive
 * fields only) rather than inserted again, and its `status` is left completely untouched —
 * re-promotion must never reset engineering progress already recorded against a Feature.
 *
 * **Parent-MVP linkage**: every Feature this function creates is attached to `mvpId` exactly as
 * given by the caller — this function does not itself re-verify that MVP's Gate A status (the
 * caller, `app/lib/mvp/gateAApproval.ts`'s `approveGateA`, only calls this after its own
 * `recordMvpApproval` for stage `'scope'` succeeds, mirroring `mvpRepository.resolveActiveMvpId`'s
 * re-resolve-at-write-time discipline one level up rather than duplicating it here).
 * `Feature.mvpId` is immutable once a row exists — this function never moves an existing Feature
 * to a different `mvpId`, even if called again with the same `code` under a different one (that
 * would silently re-parent a Feature, which the Sprint 78 approval explicitly disallows); such a
 * call creates a distinct Feature row under the new MVP instead.
 */
export async function promoteFeaturesForMvp(
  projectId: string,
  mvpId: string,
  features: {
    id: string;
    name: string;
    description: string;
    priority: MoscowPriority;
    dependsOn: string[];
    customerValue: string;

    /** Omitted defaults to `id` (the Feature's own code) — see `Feature.moduleSlug`'s comment. Real multi-Feature-per-module grouping from Product Owner/Architect content remains Sprint 79 scope; this param exists so a future caller can supply it without a repository change. */
    moduleSlug?: string;
  }[],
): Promise<PromoteFeaturesResult> {
  if (!isAvailable()) {
    unavailable('promoteFeaturesForMvp');
    return { ok: false, features: [], error: 'BuildersDB is not configured.' };
  }

  try {
    const existing = await listFeaturesForMvp(mvpId);
    const existingByCode = new Map(existing.map((feature) => [feature.code, feature]));
    const results: Feature[] = [];

    for (const source of features) {
      const draft: FeatureDraft = {
        projectId,
        mvpId,
        code: source.id,
        moduleSlug: source.moduleSlug,
        title: source.name,
        description: source.description,
        priority: source.priority,
        dependsOn: source.dependsOn,
        customerValue: source.customerValue,
      };

      const existingFeature = existingByCode.get(source.id);

      if (existingFeature) {
        await updateFeatureFields(existingFeature.id, draft);

        /*
         * moduleSlug/status are both immutable on re-promotion (see updateFeatureFields' own
         * comment) — draft.moduleSlug is never written, so the returned view must keep the
         * existing row's value rather than let a merge overwrite it with `undefined`.
         */
        results.push({
          ...existingFeature,
          ...draft,
          moduleSlug: existingFeature.moduleSlug,
          status: existingFeature.status,
        });
      } else {
        const created = await createFeature(draft);

        if (created.ok && created.feature) {
          results.push(created.feature);
        }
      }
    }

    return { ok: true, features: results, error: null };
  } catch (error) {
    logError('promoteFeaturesForMvp', error);
    return { ok: false, features: [], error: safeErrorMessage(error) };
  }
}

/**
 * Sprint 78 Phase 0 — updates a Feature's engineering-progress status, validated against
 * `isValidFeatureStatusTransition` (`lifecycleTransitions.ts`) first. An illegal transition (or a
 * request for a Feature that no longer exists) is refused (logged, `false` returned) rather than
 * silently written. A no-op (`status` already equal to the Feature's current status) is always
 * valid — an idempotent retry of an already-applied write must never fail.
 */
export async function updateFeatureStatus(featureId: string, status: FeatureStatus): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('updateFeatureStatus');
    return false;
  }

  const current = await getFeatureById(featureId);

  if (!current) {
    logError('updateFeatureStatus', new Error(`Feature ${featureId} not found`));
    return false;
  }

  if (!isValidFeatureStatusTransition(current.status, status)) {
    logError('updateFeatureStatus', new Error(`Invalid Feature status transition: ${current.status} -> ${status}`));
    return false;
  }

  try {
    const { error } = await client.from('builders_features').update({ status }).eq('id', featureId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateFeatureStatus', error);
    return false;
  }
}

export const featureRepository = {
  isAvailable,
  listFeaturesForMvp,
  listFeaturesForProject,
  detectFeatureCodeCollisions,
  getFeatureById,
  resolveActiveMvpFeatures,
  promoteFeaturesForMvp,
  updateFeatureStatus,
};
