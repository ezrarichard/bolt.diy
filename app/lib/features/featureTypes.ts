import type { MoscowPriority } from '~/lib/projects/prompts/productOwner';

/**
 * Feature Foundation — Sprint 78 Phase 0 (Product Lifecycle & Backend Generation Architecture).
 *
 * The first-class, persisted counterpart to a Product Owner's `CurrentMvpPlan.features`
 * (`ProductOwnerFeature[]`, `app/lib/projects/prompts/productOwner.ts`) — which today lives only
 * inside a Product Owner artifact's JSON `content` column
 * (see supabase/migrations/20260722100000_mvp_feature_identity.sql's header comment, which
 * deliberately deferred this promotion). Mirrors `app/lib/mvp/mvpTypes.ts`'s own shape exactly —
 * `Mvp` was promoted out of a draft blob into a first-class, `builders_mvps`-backed entity in
 * Sprint 45; `Feature` receives the identical treatment here, one level down.
 *
 * See docs/product-lifecycle/Product-Lifecycle-Architecture.md §3 for the approved model this
 * implements: `MVP → Features → Feature Slice/Module`. `moduleSlug` (the module grouping itself)
 * was originally deferred to Sprint 79/Phase 1
 * (docs/backend-generation/Backend-Generation-Architecture.md §5), but Phase 0's own review
 * ("Feature-aware manifest planning and carry-forward" — that document's Phase 0 item 5) requires
 * stable module ownership to exist NOW so `resumeOrchestrator.ts` can evaluate carry-forward at
 * module/file granularity rather than per aggregate category. This is the minimum slice of Sprint
 * 79 item 1 pulled forward: the field exists and is persisted, defaulting to the Feature's own
 * `code` (1:1 with its own module) exactly as §5 specifies, so a caller that doesn't yet do real
 * multi-Feature module grouping (Product Owner/Solution Architect prompt changes remain Sprint 79
 * scope) still gets a stable, non-null module identity for every Feature.
 */

/**
 * Free text, matching this codebase's existing convention of unconstrained status columns
 * validated at the application layer (see `MvpStatus`, `ProjectArtifactStatus`). Linear,
 * no-skip progression — see `lifecycleTransitions.ts`'s `isValidFeatureStatusTransition`, the one
 * place this is enforced.
 */
export type FeatureStatus = 'planned' | 'in_progress' | 'generated' | 'qa_passed' | 'deployed';

/** One Feature within an MVP's committed scope. Mirrors a `builders_features` row. */
export interface Feature {
  id: string;
  projectId: string;

  /** Immutable once set — a Feature is never re-parented to a different MVP (see `promoteFeaturesForMvp`'s own comment). */
  mvpId: string;

  /** Permanent identifier (e.g. "FEAT-001") — the SAME id `ProductOwnerFeature.id` already mints, never re-minted here. Unique per `mvpId`. */
  code: string;

  /**
   * The Feature Slice/Module this Feature's generated code belongs to (Product Lifecycle
   * Architecture §3 / Backend Generation Architecture §5). Several Features may share one
   * `moduleSlug` (e.g. "appointments"); defaults to this Feature's own `code` — 1:1 with its own
   * module — unless a caller explicitly groups it under an existing module's slug. Always
   * present (never undefined) once a Feature is persisted — see `featureRepository.ts`'s
   * `createFeature`/`fromFeatureRow` for the defaulting rule.
   */
  moduleSlug: string;

  title: string;
  description?: string;
  priority?: MoscowPriority;
  dependsOn: string[];
  customerValue?: string;
  status: FeatureStatus;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating (or matching, on re-promotion) a Feature row. */
export interface FeatureDraft {
  projectId: string;
  mvpId: string;
  code: string;

  /** Omitted defaults to `code` — see `Feature.moduleSlug`'s own comment. */
  moduleSlug?: string;
  title: string;
  description?: string;
  priority?: MoscowPriority;
  dependsOn?: string[];
  customerValue?: string;
}

export interface FeatureWriteResult {
  ok: boolean;
  feature?: Feature;
  error: string | null;
}

/** Result of one `promoteFeaturesForMvp` call — a batch upsert-by-`(mvpId, code)` over every Feature in a Product Owner draft's `currentMvp.features`. */
export interface PromoteFeaturesResult {
  ok: boolean;
  features: Feature[];
  error: string | null;
}
