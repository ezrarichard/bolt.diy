/**
 * Application Manifest Domain — Sprint 44.2, Phase 1 (Incremental Application Manifest
 * foundation).
 *
 * The exact planned file structure for a generated application — deliberately a
 * DIFFERENT concept from `ProductPackage` (app/lib/product-assembly/assemblyTypes.ts —
 * approved engineering documents/specs) and from `GenerationPlan`
 * (app/lib/code-generation/codeGenerationTypes.ts — the in-memory-only page/route list
 * that's thrown away once generation finishes). The manifest is what actually gets
 * persisted: every file the runnable application will contain, each with a lifecycle
 * `status`, BEFORE the first AI file-generation call runs.
 *
 * Phase 1 is observational only — every file starts (and, this phase, stays) `pending`.
 * Later phases move files through `generating`/`generated`/`validating`/`repairing`/
 * `validated`/`complete`/`failed`/`skipped`/`superseded` as persistence (Phase 2) and
 * resume (Phase 3) land.
 */

/**
 * Sprint 44.2, Phase 3 adds `complete` (fully validated, available for preview — the
 * resume algorithm's strongest "skip" signal) to Phase 1/2's original set. `skipped` is
 * kept distinct from `superseded`: `skipped` means "intentionally not generated this
 * run" (not used before Phase 3 either, reserved for a future optional-file feature),
 * `superseded` means "this row belongs to a manifest version that's no longer active."
 *
 * Sprint 44.2, Phase 4 adds `queued` — a file that's been scheduled but generation
 * hasn't started yet. Distinct from `pending` ("not scheduled at all"): today's
 * single-worker pipeline never actually sets this (see generationPipeline.ts, which goes
 * straight `pending` → `generating`), but the value exists now so a future
 * parallel/queued-worker scheduler (see this phase's own "design for it, don't build it"
 * instruction) needs no schema or type-union change to start using it.
 */
export type ManifestFileStatus =
  | 'pending'
  | 'queued'
  | 'generating'
  | 'generated'
  | 'validating'
  | 'repairing'
  | 'validated'
  | 'complete'
  | 'failed'
  | 'skipped'
  | 'superseded';

/** Where a planned file's content will come from — `scaffold`/`ai_generated` are the only kinds Phase 1 produces; `derived`/`copied`/`repair_generated` are reserved for later phases (dependency-derived files, customer-data copies, repair-engine output). */
export type ManifestFileSourceKind = 'scaffold' | 'ai_generated' | 'derived' | 'copied' | 'repair_generated';

/**
 * Sprint 79 Phase 1 (Backend Generation Foundation) adds `'backend'` — every file inside a
 * Backend Module's `src/features/<moduleSlug>/` slice and its `api/<moduleSlug>/` adapter (see
 * `app/lib/backend-generation/backendModuleTypes.ts`). Deliberately ONE category for the whole
 * vertical slice (types/validators/repository/service/routes/api-adapter together) rather than
 * a category per layer — Backend Generation Architecture §9's carry-forward unit is the MODULE,
 * not the individual file layer, so these files are meant to move together. Unlike
 * `'pages'`/`'services'`/etc., `'backend'` has no aggregate `GenerationPlanFingerprints` entry —
 * invalidation for it is driven entirely by `resumeOrchestrator.ts`'s per-file `featureIds`
 * ownership check (`resolveFileCarryForwardPlan`), which every backend file always carries by
 * construction (see `resolveCarryForwardPlan`'s own `'backend'` case for the conservative
 * category-level fallback when that per-file signal isn't available).
 */
export type ManifestFileCategory =
  | 'entry'
  | 'config'
  | 'pages'
  | 'components'
  | 'types'
  | 'services'
  | 'styles'
  | 'documentation'
  | 'backend'
  | 'other';

export type ApplicationManifestStatus = 'active' | 'superseded';

/**
 * Sprint 92 (Deployment Verification, Part 8) — one client route the generated application
 * actually declares. Copied verbatim from `GenerationPlanPage` (`codeGenerationTypes.ts`), which is
 * ALSO what `projectScaffolder.ts`'s `appTsxFile` writes into the generated `App.tsx`'s
 * `<Route path=...>` list — so this is a record of the routing that was really generated, never a
 * guess derived from a project/page name. Deployment Verification's route discovery reads exactly
 * this (see `verificationPolicy.ts`'s `discoverVerifiableRoutes`), which is why it can refuse to
 * crawl: it never has to.
 *
 * Optional on the draft, and stored in `metadata` rather than as a new column — the same
 * discipline `mvpCode`/`featureScope`/`environmentRequirements` already established — so every
 * manifest built before this sprint stays valid with `routes` simply undefined (verification then
 * degrades to root-only, which is what `resolveVerificationPolicy` does).
 */
export interface ManifestRouteDeclaration {
  /** The router path exactly as generated, e.g. `/` or `/about`. May contain `:params` — the verification policy filters those out itself rather than this builder pre-judging them. */
  path: string;
  name: string;
  componentName: string;

  /** The manifest file implementing this route, e.g. `src/pages/Home.tsx`. */
  filePath: string;
}

/**
 * Sprint 92 (Deployment Verification, Part 12) — an explicitly-declared, explicitly-safe endpoint
 * a live deployment may be probed with. NOTHING in this codebase populates this today, and that is
 * deliberate: Part 12 forbids inferring a safe API call from an arbitrary route name, so the
 * `'api'` verification category simply skips until a generator (or an operator-supplied
 * configuration) declares a real contract here. The type exists now so that declaring one later
 * needs no schema or verification-engine change.
 */
export interface ManifestVerificationEndpoint {
  path: string;
  method: 'GET' | 'HEAD';
  expectedStatus: number;
  expectedContentType?: string;

  /** Must be `true`. An endpoint declared without it is ignored by the verification policy — see `resolveVerificationPolicy`. */
  nonDestructive: boolean;

  /** `true` means the endpoint needs credentials Builders does not hold — the check is reported `unavailable`, never attempted. */
  requiresAuthentication?: boolean;
  timeoutMs?: number;
  required?: boolean;
}

/** One planned file, before it's ever been persisted (no id/manifestId/timestamps yet) — what manifestBuilder.ts produces and applicationManifestRepository.ts inserts. */
export interface ApplicationManifestFileDraft {
  path: string;
  fileType: string;
  category: ManifestFileCategory;
  componentName?: string;
  displayName?: string;
  generationOrder: number;

  /** The dependency graph's "depends_on" edges — paths this file needs. `used_by` (the inverse) is deliberately NOT a stored field — see dependencyGraph.ts's own header comment on why duplicating it would risk drift. */
  dependencies: string[];
  required: boolean;
  sourceKind: ManifestFileSourceKind;

  /** Sprint 44.2, Phase 4 — reserved for a future queue-aware scheduler (see this file's ManifestFileStatus comment on `'queued'`). Undefined/null today; no code assigns these yet. */
  priority?: number;
  queuePosition?: number;

  /**
   * Sprint 49 — the active MVP's in-scope Feature IDs this file was generated under,
   * validated against `GenerationPlan.scope.inScopeFeatureIds` (see manifestBuilder.ts's
   * `validateFeatureIds`) before being stored here — never invented by the AI, never
   * unvalidated free text. Empty for a deterministic scaffold file (package.json,
   * vite.config.ts, ...) — those don't implement a feature, they're template plumbing —
   * and for any file in a legacy project (no active MVP/Product Owner scope at all).
   *
   * Deliberately COARSE, not per-feature: every AI-generated file in an MVP-scoped run
   * gets the WHOLE MVP's `inScopeFeatureIds`, not a specific subset. There is no
   * structural signal anywhere upstream (Frontend/Database/Backend drafts) saying "this
   * exact page implements FEAT-003 and not FEAT-004" — inventing that mapping here would
   * be fabricating precision the underlying data doesn't have, exactly the trap Sprint 48
   * already flagged and Sprint 49 does not attempt to close (see this sprint's own
   * documentation for why: it needs a real draft-schema change, not a generation-engine
   * change). What this DOES give you: "this file was generated in service of these
   * feature(s)" at MVP granularity, which is genuinely new and useful for traceability
   * even though it isn't file-to-feature precision.
   */
  featureIds: string[];
}

/** A planned file once persisted. */
export interface ApplicationManifestFile extends ApplicationManifestFileDraft {
  id: string;
  manifestId: string;
  projectId: string;
  status: ManifestFileStatus;
  generationAttempts: number;
  checksum?: string;
  lastError?: string;
  generatedAt?: string;
  validatedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Sprint 44.2, Phase 3 — one checksum per generation category, over exactly the draft fields that category's own prompt reads (see codeGenerationTypes.ts's `GenerationPlanFingerprints`, which this is copied from at manifest-build time). Stored in `builders_application_manifests.metadata` (small, supplementary — never large content). */
export interface ManifestFingerprints {
  types: string;
  services: string;
  pages: string;
  components: string;
}

/** The manifest itself, before it's ever been persisted. */
export interface ApplicationManifestDraft {
  projectId: string;

  /**
   * Sprint 47 — which MVP this manifest was generated for, resolved from BuildersDB at the
   * moment generation starts (see mvpRepository.ts's `resolveActiveMvpId`). Undefined for a
   * project with no MVP yet (a legacy project, or one generating before Gate A exists in its
   * flow) — that's the deliberate backward-compatible default, not an error state. See
   * docs/02-Architecture/06-mvp-as-core-object.md for why this is a second FK dimension
   * rather than a schema restructuring.
   */
  mvpId?: string;

  /**
   * Sprint 48 — the same permanent, human-readable identifier as `Mvp.code` (e.g.
   * "MVP-001"), denormalized onto the manifest so history/activity views can display it
   * without a join back to `builders_mvps`. Stored in `metadata` (see
   * applicationManifestRepository.ts), not a new column — purely a display convenience,
   * `mvpId` remains the only field anything joins/filters on.
   */
  mvpCode?: string;

  /**
   * Sprint 48 — the active MVP's Engineering Handoff scope boundary at the moment this
   * manifest was built, for traceability (Part 8: Feature ID -> Manifest lineage) and for
   * `resumeOrchestrator.ts`'s cross-MVP-transition reporting. `inScopeFeatureIds` are real
   * stable IDs; `outOfScopeFeatureDescriptions` are free text (see
   * `GenerationPlanScope`'s own comment on why out-of-scope features have no ID to carry).
   * Stored in `metadata`, not a new column — see this interface's own header comment on
   * why `mvp_id` (not this) is the field any future FK/filter should use.
   */
  featureScope?: { inScopeFeatureIds: string[]; outOfScopeFeatureDescriptions: string[] };
  framework: string;
  packageManager: string;
  entryFile: string;
  sourcePackageAssembledAt?: string;
  planChecksum: string;

  /**
   * Sprint 44.2, Phase 3 — a checksum over the Product Package's CONTENT (business
   * vision, core features, page names, entities, API endpoints, layout notes — see
   * `GenerationPlanFingerprints`), independent of `planChecksum` (which only fingerprints
   * the FILE STRUCTURE: paths/categories/dependencies). A project can have identical
   * `planChecksum` (same pages/files) but a different `sourceContentChecksum` (the
   * requirements behind those same pages changed) — that's exactly the case the resume
   * algorithm's "manifest checksum vs Product Package checksum" comparison exists to
   * catch (see applicationManifestRepository.ts's `saveApplicationManifest`).
   */
  sourceContentChecksum: string;
  fingerprints: ManifestFingerprints;

  /**
   * Sprint 86 (Deployment Foundation, Part 5) — the deterministic dependency/runtime facts
   * a future GitHub/Supabase/Vercel integration will need to reuse rather than re-derive
   * from scratch. All five are optional and stored in `metadata` (see
   * applicationManifestRepository.ts's `saveApplicationManifest` — same "not a new column"
   * discipline `mvpCode`/`featureScope` already established above), so every manifest built
   * before this sprint (or any test fixture constructing a draft directly) remains valid
   * with these simply undefined.
   */

  /** Every `package.json` "dependencies" entry this manifest's generation actually resolved (see `dependencyValidation.ts`'s `resolveRequiredDependencies`) — name -> version, exactly what was written to the generated project's own package.json. */
  dependencies?: Record<string, string>;

  /** Environment variable names (not values — see `.env.example`'s own "no secrets" rule) this generated application needs at runtime, e.g. `["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]`. Empty/undefined for a project needing no runtime configuration at all. */
  environmentRequirements?: string[];

  /** Runtime platform facts a deployment target would need — today always `["Node.js"]` for the one supported template (react-vite-ts), kept as a list (not a bare string) so a future template with additional runtime needs (e.g. a database driver) doesn't require a shape change. */
  runtimeRequirements?: string[];

  /** External services this generated application depends on to actually run correctly — e.g. `["Supabase"]` when a Backend Module or Database Activation schema exists, empty for a frontend-only mock-data project. Distinct from `environmentRequirements`: this names the SERVICE, not the variable. */
  requiredServices?: string[];

  /** The exact command a deployment target should run to produce a production build — always `"npm run build"` for this sprint's one template, but never hardcoded by a future consumer; read from here instead. */
  buildCommand?: string;

  /** Where the build command's output lands, relative to the project root — `"dist"` for the Vite template. */
  outputDirectory?: string;

  /** Sprint 92, Part 8 — see `ManifestRouteDeclaration`. Undefined for every manifest built before this sprint. */
  routes?: ManifestRouteDeclaration[];

  /** Sprint 92, Part 12 — see `ManifestVerificationEndpoint`. Nothing populates this yet, by design. */
  verificationEndpoints?: ManifestVerificationEndpoint[];
}

export interface ApplicationManifest extends ApplicationManifestDraft {
  id: string;
  version: number;
  status: ApplicationManifestStatus;

  /** Reserved for a future Product Package versioning scheme — always undefined today (see this migration's own header note: builders_product_packages has no version concept yet, only assembledAt). */
  sourcePackageVersion?: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  persistedAt: string;
}

export interface ManifestValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

/** Result of the pure, deterministic build step (manifestBuilder.ts) — never persists anything itself. */
export interface BuildManifestResult {
  ok: boolean;
  manifest?: ApplicationManifestDraft;
  files: ApplicationManifestFileDraft[];
  issues: ManifestValidationIssue[];
}

/**
 * Result of attempting to persist a manifest (applicationManifestRepository.ts).
 * `created: false` with `ok: true` means an unchanged plan matched the latest existing
 * version's checksum, so nothing new was inserted (see requirement: "do not create
 * duplicate manifest versions for an unchanged plan"). Never throws — a failed
 * persistence is `{ ok: false, created: false, error }`, which Phase 3 is expected to
 * treat as a hard precondition failure; Phase 1 callers only log it.
 */
export interface ManifestPersistResult {
  ok: boolean;
  created: boolean;
  manifest?: ApplicationManifest;
  files?: ApplicationManifestFile[];
  error?: string;
}
