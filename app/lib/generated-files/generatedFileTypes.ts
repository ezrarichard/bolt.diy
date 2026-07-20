import type { ManifestFileStatus } from '~/lib/application-manifest/manifestTypes';

/**
 * Generated Application File Persistence Domain — Sprint 44.2, Phase 2.
 *
 * The current lifecycle state of one planned file (`GeneratedApplicationFile`, a strict
 * 1:1 companion to a `builders_application_manifest_files` row — see the Phase 1
 * domain) plus its immutable content history (`GeneratedApplicationFileVersion`). A new
 * version is only ever created when the content's checksum actually changed — see
 * generatedFilesRepository.ts's `persistGeneratedFile`.
 *
 * Reuses `ManifestFileStatus` (not a separate enum) — a generated file and its planning
 * entry share exactly one lifecycle vocabulary; keeping two parallel status unions would
 * only invite them drifting out of sync.
 */

export type GeneratedFileStatus = ManifestFileStatus;

/**
 * Sprint 49 — see app/lib/generated-files/fileOwnership.ts's own header comment for the
 * full model and decision rules. `undefined` (the column's actual nullable state for
 * every row written before this sprint) is treated as "never classified" by every
 * consumer of this type — NOT the same as `'unknown_legacy'`, which is a real,
 * persisted classification `fileOwnership.ts` assigns the first time a pre-Sprint-49 row
 * is checked and found to have no comparison baseline at all.
 */
export type FileOwnership = 'builders_generated' | 'user_modified' | 'user_owned' | 'protected' | 'unknown_legacy';

/** Sprint 49, Part 8 — `'none'` (no open conflict), `'pending_review'` (a conflict was recorded and awaits a customer/user decision), `'resolved'` (a prior conflict was explicitly resolved — see fileOwnership.ts). */
export type FileConflictState = 'none' | 'pending_review' | 'resolved';

export interface GeneratedApplicationFile {
  id: string;
  projectId: string;
  manifestId: string;
  manifestFileId: string;
  path: string;
  status: GeneratedFileStatus;
  latestVersion: number;
  latestChecksum?: string;
  validationStatus?: string;
  generationAttempts: number;
  repairCount: number;
  lastError?: string;
  generatedByRole?: string;
  createdBy?: string;
  generatedAt?: string;
  validatedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;

  /** Sprint 49 — see `FileOwnership`'s own comment. */
  ownership?: FileOwnership;

  /** Sprint 49 — the checksum of the file's CURRENT live workspace content, as of the last time `fileOwnership.ts`'s edit-detection pass ran (see useCodeGeneration.ts's `detectFileOwnershipConflicts`). Compared against `latestChecksum` (the last content Builders itself generated) to determine `ownership`. Undefined until the first edit-detection pass runs for this file. */
  currentHash?: string;

  /** Sprint 49 — when this file was last found to have manually-modified content (`currentHash !== latestChecksum` while ownership was/became `'user_modified'`). Undefined if never detected as modified. */
  userModifiedAt?: string;
  conflictState?: FileConflictState;
}

export interface GeneratedApplicationFileVersion {
  id: string;
  generatedFileId: string;
  projectId: string;
  manifestId: string;
  version: number;
  content: string;
  checksum: string;
  changeReason: string;

  /** e.g. a role key ('code-gen-types'), 'scaffold', or 'repair-engineer' — where this version's content came from. */
  generationSource: string;
  generationAttempt?: number;
  parentVersionId?: string;
  createdBy?: string;
  createdAt: string;
}

/** Input to persistGeneratedFile() — one successfully-generated file's content, ready to persist. */
export interface PersistGeneratedFileInput {
  projectId: string;
  manifestId: string;
  manifestFileId: string;
  path: string;
  content: string;
  generationSource: string;
  generationAttempt?: number;
  changeReason: string;
  createdBy?: string;
}

/**
 * Never throws — a failure is `{ ok: false, error }`, mirroring
 * applicationManifestRepository.ts's `ManifestPersistResult` contract so Phase 3 can
 * apply the same "make this a hard precondition" treatment to both without a shape
 * change. `versionCreated: false` with `ok: true` means the content's checksum matched
 * the existing latest version — the file's status/attempt count/generated_at were still
 * updated, just no new version row was inserted (requirement B).
 */
export interface PersistGeneratedFileResult {
  ok: boolean;
  versionCreated: boolean;
  file?: GeneratedApplicationFile;
  version?: GeneratedApplicationFileVersion;
  error?: string;
}

/**
 * Sprint 49, Part 8 — what Builders recommends doing about a file it wants to change but
 * isn't allowed to overwrite automatically (see fileOwnership.ts's `resolveOverwritePolicy`).
 * Only `'preserve'` and `'replace'` are actually IMPLEMENTED as automatic engine behavior
 * this sprint (see useCodeGeneration.ts) — `'review_diff'`, `'defer'`, and
 * `'create_alternate'` are recorded as the RECOMMENDED action a future review UI could
 * offer, per this sprint's own "implement only the minimum UI necessary" instruction; no
 * UI exists yet to act on them beyond preserving the file and surfacing the conflict.
 */
export type RecommendedFileAction = 'preserve' | 'replace' | 'review_diff' | 'defer' | 'create_alternate';

/** Sprint 49, Part 8 — one file Builders wanted to (re)generate but didn't, because its ownership required a decision it can't make automatically. Never causes the rest of a generation run to abort (Part 10) — it's reported alongside whatever else generated normally. */
export interface FileConflict {
  path: string;
  mvpId?: string;
  featureIds: string[];
  existingHash?: string;
  lastGeneratedHash?: string;
  proposedOperation: 'create' | 'modify';
  reason: string;
  recommendedAction: RecommendedFileAction;
}
