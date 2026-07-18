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
