import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { addProjectActivity } from '~/lib/builders-db/repositories/buildersDbRepository';
import { checkPathSafety } from '~/lib/application-manifest/manifestBuilder';
import type {
  GeneratedApplicationFile,
  GeneratedApplicationFileVersion,
  GeneratedFileStatus,
  PersistGeneratedFileInput,
  PersistGeneratedFileResult,
} from './generatedFileTypes';

/**
 * Generated Application File Repository — Sprint 44.2, Phase 2.
 *
 * Same defensive contract as every builders-db repository in this codebase: guarded on
 * BuildersDB being configured, every Supabase call wrapped in try/catch, every failure
 * path logs and returns a safe `{ ok: false, error }` rather than throwing. Phase 2 keeps
 * this NON-BLOCKING for backward compatibility (a persistence failure never fails the
 * generation the user is watching — see useCodeGeneration.ts's file-lifecycle hooks) —
 * but every failure is recorded honestly on `builders_generated_application_files.status`
 * (`'failed'`, never left looking like `'generated'`) precisely so Phase 3 can flip this
 * to a hard precondition for resumable generation without any shape change here.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[GeneratedFiles] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[GeneratedFiles] ${method}() failed:`, error);
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

/**
 * FNV-1a (32-bit) over the raw file content — deliberately the SAME algorithm as
 * manifestBuilder.ts's computeManifestChecksum (structural fingerprint), just applied to
 * content bytes instead of a structural shape; a plain, non-cryptographic hash is enough
 * for change detection and avoids Node's `crypto` module (see that file's own comment on
 * why — this runs in the browser/Worker/Node test runner alike).
 */
export function computeFileChecksum(content: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

interface GeneratedFileRow {
  id: string;
  project_id: string;
  manifest_id: string;
  manifest_file_id: string;
  path: string;
  status: GeneratedFileStatus;
  latest_version: number;
  latest_checksum: string | null;
  validation_status: string | null;
  generation_attempts: number;
  repair_count: number;
  last_error: string | null;
  generated_by_role: string | null;
  created_by: string | null;
  generated_at: string | null;
  validated_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GeneratedFileVersionRow {
  id: string;
  generated_file_id: string;
  project_id: string;
  manifest_id: string;
  version: number;
  content: string;
  checksum: string;
  change_reason: string;
  generation_source: string;
  generation_attempt: number | null;
  parent_version_id: string | null;
  created_by: string | null;
  created_at: string;
}

function fromFileRow(row: GeneratedFileRow): GeneratedApplicationFile {
  return {
    id: row.id,
    projectId: row.project_id,
    manifestId: row.manifest_id,
    manifestFileId: row.manifest_file_id,
    path: row.path,
    status: row.status,
    latestVersion: row.latest_version,
    latestChecksum: row.latest_checksum ?? undefined,
    validationStatus: row.validation_status ?? undefined,
    generationAttempts: row.generation_attempts,
    repairCount: row.repair_count,
    lastError: row.last_error ?? undefined,
    generatedByRole: row.generated_by_role ?? undefined,
    createdBy: row.created_by ?? undefined,
    generatedAt: row.generated_at ?? undefined,
    validatedAt: row.validated_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromVersionRow(row: GeneratedFileVersionRow): GeneratedApplicationFileVersion {
  return {
    id: row.id,
    generatedFileId: row.generated_file_id,
    projectId: row.project_id,
    manifestId: row.manifest_id,
    version: row.version,
    content: row.content,
    checksum: row.checksum,
    changeReason: row.change_reason,
    generationSource: row.generation_source,
    generationAttempt: row.generation_attempt ?? undefined,
    parentVersionId: row.parent_version_id ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

async function getFileByManifestFileId(manifestFileId: string): Promise<GeneratedFileRow | null> {
  const client = getBuildersDbClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('builders_generated_application_files')
    .select('*')
    .eq('manifest_file_id', manifestFileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as GeneratedFileRow | null) ?? null;
}

async function upsertFileRow(
  input: {
    projectId: string;
    manifestId: string;
    manifestFileId: string;
    path: string;
  },
  patch: Partial<{
    status: GeneratedFileStatus;
    latest_version: number;
    latest_checksum: string | null;
    validation_status: string | null;
    generation_attempts: number;
    repair_count: number;
    last_error: string | null;
    generated_by_role: string | null;
    created_by: string | null;
    generated_at: string | null;
    validated_at: string | null;
    completed_at: string | null;
  }>,
): Promise<GeneratedFileRow> {
  const client = getBuildersDbClient();

  if (!client) {
    throw new Error('BuildersDB is not configured.');
  }

  const existing = await getFileByManifestFileId(input.manifestFileId);

  if (!existing) {
    const { data, error } = await client
      .from('builders_generated_application_files')
      .insert({
        project_id: input.projectId,
        manifest_id: input.manifestId,
        manifest_file_id: input.manifestFileId,
        path: input.path,
        status: patch.status ?? 'pending',
        latest_version: patch.latest_version ?? 0,
        latest_checksum: patch.latest_checksum ?? null,
        validation_status: patch.validation_status ?? null,
        generation_attempts: patch.generation_attempts ?? 0,
        repair_count: patch.repair_count ?? 0,
        last_error: patch.last_error ?? null,
        generated_by_role: patch.generated_by_role ?? null,
        created_by: patch.created_by ?? null,
        generated_at: patch.generated_at ?? null,
        validated_at: patch.validated_at ?? null,
        completed_at: patch.completed_at ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw error ?? new Error('Insert returned no row');
    }

    return data as GeneratedFileRow;
  }

  const { data, error } = await client
    .from('builders_generated_application_files')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error || !data) {
    throw error ?? new Error('Update returned no row');
  }

  return data as GeneratedFileRow;
}

async function updateManifestFileStatus(
  manifestFileId: string,
  patch: { status: string; checksum?: string; lastError?: string; generatedAt?: string },
): Promise<void> {
  const client = getBuildersDbClient();

  if (!client) {
    return;
  }

  await client
    .from('builders_application_manifest_files')
    .update({
      status: patch.status,
      checksum: patch.checksum ?? null,
      last_error: patch.lastError ?? null,
      generated_at: patch.generatedAt ?? null,
    })
    .eq('id', manifestFileId);
}

/**
 * Step 2-3 of the persistence sequence (requirement C): marks the file `generating` and
 * bumps its attempt counter, BEFORE the AI call that will produce its content. Creates
 * the `builders_generated_application_files` row on first call for a given manifest
 * file. Never throws — a failure here is logged and swallowed (Phase 2 stays
 * non-blocking), but does NOT update workspace-visible state as a success; the caller
 * (useCodeGeneration.ts) treats a thrown/failed mark as "unable to track this file",
 * distinct from the file itself failing to generate.
 */
export async function markFileGenerating(input: {
  projectId: string;
  manifestId: string;
  manifestFileId: string;
  path: string;
  role: string;
}): Promise<boolean> {
  if (!isAvailable()) {
    unavailable('markFileGenerating');
    return false;
  }

  try {
    const existing = await getFileByManifestFileId(input.manifestFileId);
    await upsertFileRow(input, {
      status: 'generating',
      generation_attempts: (existing?.generation_attempts ?? 0) + 1,
      generated_by_role: input.role,
      last_error: null,
    });
    await updateManifestFileStatus(input.manifestFileId, { status: 'generating' });

    return true;
  } catch (error) {
    logError('markFileGenerating', error);
    return false;
  }
}

/**
 * Marks the active file `failed` and persists its error (requirement E) — every
 * previously-generated file/version is left completely untouched; only the row for THIS
 * manifest file is updated.
 */
export async function markFileFailed(input: {
  projectId: string;
  manifestId: string;
  manifestFileId: string;
  path: string;
  error: string;
}): Promise<boolean> {
  if (!isAvailable()) {
    unavailable('markFileFailed');
    return false;
  }

  try {
    await upsertFileRow(input, { status: 'failed', last_error: input.error });
    await updateManifestFileStatus(input.manifestFileId, { status: 'failed', lastError: input.error });

    addProjectActivity({
      projectId: input.projectId,
      activityType: 'generated_file_failed',
      description: `${input.path} failed to generate: ${input.error}`,
      metadata: { path: input.path, manifestId: input.manifestId },
    }).catch((activityError) => logError('generated_file_failed activity', activityError));

    return true;
  } catch (error) {
    logError('markFileFailed', error);
    return false;
  }
}

/**
 * Steps 4-9 of the persistence sequence: given already-generated content, computes its
 * checksum, persists a new immutable version ONLY if the checksum changed from the
 * current latest version (requirement B — an unchanged re-generation is a no-op on the
 * version table), updates the current-state row, and marks the manifest file
 * `'generated'`. Immediate — called right after each file's content is ready, never
 * batched until the end of the run (requirement D).
 */
export async function persistGeneratedFile(input: PersistGeneratedFileInput): Promise<PersistGeneratedFileResult> {
  if (!isAvailable()) {
    unavailable('persistGeneratedFile');
    return { ok: false, versionCreated: false, error: 'BuildersDB is not configured.' };
  }

  const client = getBuildersDbClient();

  if (!client) {
    return { ok: false, versionCreated: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const checksum = computeFileChecksum(input.content);
    const existing = await getFileByManifestFileId(input.manifestFileId);
    const checksumUnchanged = Boolean(existing?.latest_checksum && existing.latest_checksum === checksum);

    let versionRow: GeneratedFileVersionRow | undefined;
    let nextVersion = existing?.latest_version ?? 0;

    if (!checksumUnchanged) {
      nextVersion = (existing?.latest_version ?? 0) + 1;

      let parentVersionId: string | null = null;

      if (existing && existing.latest_version > 0) {
        const { data: parent } = await client
          .from('builders_generated_application_file_versions')
          .select('id')
          .eq('generated_file_id', existing.id)
          .eq('version', existing.latest_version)
          .maybeSingle();

        parentVersionId = (parent as { id: string } | null)?.id ?? null;
      }

      // The row must exist before a version can reference it via generated_file_id — create/refresh it first with a provisional state, then insert the version, then finalize below.
      const provisional = await upsertFileRow(input, {
        status: 'generating',
        generated_by_role: input.generationSource,
      });

      const { data: insertedVersion, error: versionError } = await client
        .from('builders_generated_application_file_versions')
        .insert({
          generated_file_id: provisional.id,
          project_id: input.projectId,
          manifest_id: input.manifestId,
          version: nextVersion,
          content: input.content,
          checksum,
          change_reason: input.changeReason,
          generation_source: input.generationSource,
          generation_attempt: input.generationAttempt ?? null,
          parent_version_id: parentVersionId,
          created_by: input.createdBy ?? null,
        })
        .select('*')
        .single();

      if (versionError || !insertedVersion) {
        throw versionError ?? new Error('Version insert returned no row');
      }

      versionRow = insertedVersion as GeneratedFileVersionRow;
    }

    const generatedAt = new Date().toISOString();
    const finalRow = await upsertFileRow(input, {
      status: 'generated',
      latest_version: nextVersion,
      latest_checksum: checksum,
      generated_by_role: input.generationSource,
      generated_at: generatedAt,
      last_error: null,
    });

    await updateManifestFileStatus(input.manifestFileId, {
      status: 'generated',
      checksum,
      generatedAt,
    });

    addProjectActivity({
      projectId: input.projectId,
      activityType: checksumUnchanged ? 'generated_file_unchanged' : 'generated_file_persisted',
      description: checksumUnchanged
        ? `${input.path} generated with no content change (still v${nextVersion})`
        : `${input.path} persisted as v${nextVersion}`,
      metadata: { path: input.path, manifestId: input.manifestId, version: nextVersion },
    }).catch((error) => logError('generated_file_persisted activity', error));

    return {
      ok: true,
      versionCreated: !checksumUnchanged,
      file: fromFileRow(finalRow),
      version: versionRow ? fromVersionRow(versionRow) : undefined,
    };
  } catch (error) {
    logError('persistGeneratedFile', error);
    return { ok: false, versionCreated: false, error: safeErrorMessage(error) };
  }
}

export async function listGeneratedFiles(manifestId: string): Promise<GeneratedApplicationFile[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listGeneratedFiles');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_generated_application_files')
      .select('*')
      .eq('manifest_id', manifestId);

    if (error) {
      throw error;
    }

    return ((data ?? []) as GeneratedFileRow[]).map(fromFileRow);
  } catch (error) {
    logError('listGeneratedFiles', error);
    return [];
  }
}

export async function listFileVersions(generatedFileId: string): Promise<GeneratedApplicationFileVersion[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listFileVersions');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_generated_application_file_versions')
      .select('*')
      .eq('generated_file_id', generatedFileId)
      .order('version', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as GeneratedFileVersionRow[]).map(fromVersionRow);
  } catch (error) {
    logError('listFileVersions', error);
    return [];
  }
}

/**
 * Requirement G — an AI response returned a file path that isn't itself in the
 * manifest. Validates the path (rejects anything checkPathSafety() flags — never
 * silently discarded, but never persisted unsafely either), then creates a new
 * `builders_application_manifest_files` row for it (`required: false`, since it was
 * never part of the original plan) so the normal persistGeneratedFile() path can then
 * store its content against a real manifest_file_id. Records a
 * `manifest_reconciled`/`unplanned_file_rejected` activity event either way.
 */
export async function reconcileUnplannedFile(input: {
  projectId: string;
  manifestId: string;
  path: string;
  sourceKind: 'ai_generated' | 'derived';
  category?: string;
}): Promise<{ ok: boolean; manifestFileId?: string; error?: string }> {
  const safety = checkPathSafety(input.path);

  if (!safety.safe) {
    addProjectActivity({
      projectId: input.projectId,
      activityType: 'unplanned_file_rejected',
      description: `Unplanned file rejected — ${safety.reason}`,
      metadata: { path: input.path, manifestId: input.manifestId },
    }).catch((error) => logError('unplanned_file_rejected activity', error));

    return { ok: false, error: safety.reason };
  }

  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('reconcileUnplannedFile');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const { data: existing } = await client
      .from('builders_application_manifest_files')
      .select('id')
      .eq('manifest_id', input.manifestId)
      .eq('path', safety.path)
      .maybeSingle();

    if (existing) {
      return { ok: true, manifestFileId: (existing as { id: string }).id };
    }

    const { data: maxOrderRow } = await client
      .from('builders_application_manifest_files')
      .select('generation_order')
      .eq('manifest_id', input.manifestId)
      .order('generation_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = ((maxOrderRow as { generation_order: number } | null)?.generation_order ?? 0) + 1;

    const { data: inserted, error: insertError } = await client
      .from('builders_application_manifest_files')
      .insert({
        manifest_id: input.manifestId,
        project_id: input.projectId,
        path: safety.path,
        file_type: safety.path.split('.').pop() ?? 'unknown',
        category: input.category ?? 'other',
        generation_order: nextOrder,
        dependencies: [],
        required: false,
        source_kind: input.sourceKind,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error('Insert returned no row');
    }

    const manifestFileId = (inserted as { id: string }).id;

    addProjectActivity({
      projectId: input.projectId,
      activityType: 'manifest_reconciled',
      description: `Application Manifest reconciled — unplanned file added: ${safety.path}`,
      metadata: { path: safety.path, manifestId: input.manifestId, sourceKind: input.sourceKind },
    }).catch((error) => logError('manifest_reconciled activity', error));

    return { ok: true, manifestFileId };
  } catch (error) {
    logError('reconcileUnplannedFile', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export const generatedFilesRepository = {
  computeFileChecksum,
  markFileGenerating,
  markFileFailed,
  persistGeneratedFile,
  listGeneratedFiles,
  listFileVersions,
  reconcileUnplannedFile,
};
