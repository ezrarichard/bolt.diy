/**
 * Backend Module — Sprint 79 Phase 1 (Backend Generation Foundation).
 *
 * The canonical, deterministic backend-generation input this sprint's own "Part 2 —
 * Structured Backend Model" asks for. Deliberately minimal and reference-based rather than
 * a full structured spec (routes/serviceMethods/repositoryMethods/validators, as the sprint
 * brief's own illustrative example sketches) — this codebase has no structured source for
 * those yet (`BackendDraft.apiEndpoints` is free-text prose, same as the existing `services.ts`
 * generation already accepts unchanged, see prompts.ts's `buildServicesPrompt`), so modeling
 * them here would fabricate precision the underlying data doesn't have — exactly the trap
 * `ApplicationManifestFileDraft.featureIds`'s own comment (Sprint 49) already documented and
 * avoided for the same reason. What this model DOES give deterministically — moduleSlug,
 * accumulated featureIds, and which tables/endpoints this module's generation should read —
 * is real, derivable data; the actual route/service/repository/validator CODE is still AI-
 * generated content (same mechanism as every other manifest category), just scoped by this
 * plan rather than invented from nothing.
 *
 * References existing artifacts instead of duplicating them: `databaseTables` names into
 * `StructuredDatabaseSchema` (app/lib/database-activation/schemaTypes.ts), `apiEndpoints`
 * passes through `BackendDraft.apiEndpoints` (app/lib/projects/prompts/backend.ts) verbatim,
 * `featureIds` are `Feature.code` values (app/lib/features/featureTypes.ts) — no field here
 * re-describes what any of those already say.
 */
export interface BackendModulePlan {
  /** Same stable slug as `Feature.moduleSlug` — the unit this module's files are generated/carried-forward around. */
  moduleSlug: string;

  /**
   * Every Feature (by `code`) this module currently implements, accumulated across however
   * many MVPs have contributed to it (Backend Generation Architecture §5: "regenerated files'
   * featureIds accumulate ... never dropping the Features a module already implemented").
   * Always at least one entry — a module only exists because at least one Feature is grouped
   * under its slug.
   */
  featureIds: string[];

  /**
   * Table names from the project's approved `StructuredDatabaseSchema` this module's
   * Repository layer may access.
   *
   * Known simplification (Sprint 79 Phase 1, matches Sprint 49's own precedent for
   * `featureIds` coarseness): there is no structural Feature-to-table mapping anywhere in this
   * codebase today (which entities a Feature touches lives only as prose inside
   * `EngineeringHandoff`/Architecture content) — inventing one here would be exactly the kind
   * of fabricated precision this codebase's own conventions reject. With Sprint 79 scoped to
   * ONE module, this is harmless: every table in the active schema is, by construction, that
   * one module's tables. Partitioning tables correctly across MULTIPLE simultaneously-active
   * modules is real future work (Sprint 79 Phase 2+), not solved here.
   */
  databaseTables: string[];

  /** Verbatim from the approved `BackendDraft.apiEndpoints` — not restructured, not filtered per module (same "no structural signal to filter by" limitation as `databaseTables`, see above). */
  apiEndpoints: string[];
}

/**
 * The fixed, deterministic file set every Backend Module produces — known before any AI call
 * (mirrors how `src/types/index.ts`/`src/services/api.ts`/each page's path are already fixed
 * ahead of generation, see prompts.ts). Single source of truth shared by `manifestBuilder.ts`
 * (which plans these paths) and `generationPipeline.ts` (which resumes/generates them) so the
 * two can never drift apart.
 */
export function backendModuleFilePaths(moduleSlug: string): {
  types: string;
  validators: string;
  repository: string;
  service: string;
  routes: string;
  apiAdapter: string;
} {
  const base = `src/features/${moduleSlug}`;

  return {
    types: `${base}/types.ts`,
    validators: `${base}/validators.ts`,
    repository: `${base}/repository.ts`,
    service: `${base}/service.ts`,
    routes: `${base}/routes.ts`,
    apiAdapter: `api/${moduleSlug}/index.ts`,
  };
}

/** All six paths as a flat, ordered list — the order every dependency chain/generation-order assignment below follows. */
export function backendModuleFilePathList(moduleSlug: string): string[] {
  const paths = backendModuleFilePaths(moduleSlug);
  return [paths.types, paths.validators, paths.repository, paths.service, paths.routes, paths.apiAdapter];
}
