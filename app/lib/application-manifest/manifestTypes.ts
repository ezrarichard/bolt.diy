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

export type ManifestFileCategory =
  | 'entry'
  | 'config'
  | 'pages'
  | 'components'
  | 'types'
  | 'services'
  | 'styles'
  | 'documentation'
  | 'other';

export type ApplicationManifestStatus = 'active' | 'superseded';

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
