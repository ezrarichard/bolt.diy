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

export type ManifestFileStatus =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'validating'
  | 'repairing'
  | 'validated'
  | 'failed'
  | 'complete'
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
  dependencies: string[];
  required: boolean;
  sourceKind: ManifestFileSourceKind;
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

/** The manifest itself, before it's ever been persisted. */
export interface ApplicationManifestDraft {
  projectId: string;
  framework: string;
  packageManager: string;
  entryFile: string;
  sourcePackageAssembledAt?: string;
  planChecksum: string;
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
