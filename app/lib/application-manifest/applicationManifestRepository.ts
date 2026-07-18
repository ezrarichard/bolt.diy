import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ApplicationManifestFileDraft,
  ApplicationManifestDraft,
  ManifestFingerprints,
  ManifestPersistResult,
} from './manifestTypes';

/**
 * Application Manifest Repository — Sprint 44.2, Phase 1.
 *
 * Same defensive contract as every other builders-db repository in this codebase
 * (assemblyRepository.ts, buildersDbRepository.ts): guarded on BuildersDB being
 * configured, every Supabase call wrapped in try/catch, every failure path logs and
 * returns a safe, explicit `{ ok: false, error }` rather than throwing. Unlike most of
 * those, `saveApplicationManifest`'s failure is meant to be OBSERVED and reported by its
 * caller (see this migration's own header note) — Phase 1 callers (useCodeGeneration.ts)
 * log it into `builders_project_workspace_state.manifest_persistence_error` rather than
 * blocking generation on it; Phase 3 can change that to a hard precondition without
 * touching this function's contract.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[ApplicationManifest] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[ApplicationManifest] ${method}() failed:`, error);
}

/** Same shape as buildersDbRepository.ts's own safeErrorMessage() — a Postgrest error is a plain `{ message }` object, not an `Error` instance. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown error';
}

interface ManifestRow {
  id: string;
  project_id: string;
  version: number;
  status: ApplicationManifest['status'];
  source_package_version: number | null;
  source_package_assembled_at: string | null;
  framework: string;
  package_manager: string;
  entry_file: string;
  total_files: number;
  completed_files: number;
  failed_files: number;
  plan_checksum: string;
  source_content_checksum: string | null;
  metadata: { fingerprints?: ManifestFingerprints } | null;
  persisted_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ManifestFileRow {
  id: string;
  manifest_id: string;
  project_id: string;
  path: string;
  file_type: string | null;
  category: string | null;
  component_name: string | null;
  display_name: string | null;
  generation_order: number;
  dependencies: string[];
  required: boolean;
  source_kind: ApplicationManifestFile['sourceKind'];
  status: ApplicationManifestFile['status'];
  generation_attempts: number;
  checksum: string | null;
  last_error: string | null;
  generated_at: string | null;
  validated_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromManifestRow(row: ManifestRow): ApplicationManifest {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status,
    sourcePackageVersion: row.source_package_version ?? undefined,
    sourcePackageAssembledAt: row.source_package_assembled_at ?? undefined,
    framework: row.framework,
    packageManager: row.package_manager,
    entryFile: row.entry_file,
    totalFiles: row.total_files,
    completedFiles: row.completed_files,
    failedFiles: row.failed_files,
    planChecksum: row.plan_checksum,
    sourceContentChecksum: row.source_content_checksum ?? '',
    fingerprints: row.metadata?.fingerprints ?? { types: '', services: '', pages: '', components: '' },
    persistedAt: row.persisted_at,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function fromFileRow(row: ManifestFileRow): ApplicationManifestFile {
  return {
    id: row.id,
    manifestId: row.manifest_id,
    projectId: row.project_id,
    path: row.path,
    fileType: row.file_type ?? 'unknown',
    category: (row.category ?? 'other') as ApplicationManifestFile['category'],
    componentName: row.component_name ?? undefined,
    displayName: row.display_name ?? undefined,
    generationOrder: row.generation_order,
    dependencies: row.dependencies ?? [],
    required: row.required,
    sourceKind: row.source_kind,
    status: row.status,
    generationAttempts: row.generation_attempts,
    checksum: row.checksum ?? undefined,
    lastError: row.last_error ?? undefined,
    generatedAt: row.generated_at ?? undefined,
    validatedAt: row.validated_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFileInsertRow(manifestId: string, projectId: string, file: ApplicationManifestFileDraft) {
  return {
    manifest_id: manifestId,
    project_id: projectId,
    path: file.path,
    file_type: file.fileType,
    category: file.category,
    component_name: file.componentName ?? null,
    display_name: file.displayName ?? null,
    generation_order: file.generationOrder,
    dependencies: file.dependencies,
    required: file.required,
    source_kind: file.sourceKind,
    status: 'pending',
  };
}

/** The current (`status = 'active'`) manifest for a project, or null if none exists yet (or BuildersDB is unavailable) — never throws. */
export async function getActiveApplicationManifest(projectId: string): Promise<ApplicationManifest | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getActiveApplicationManifest');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_application_manifests')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'active')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromManifestRow(data as ManifestRow) : null;
  } catch (error) {
    logError('getActiveApplicationManifest', error);
    return null;
  }
}

export async function listApplicationManifestFiles(manifestId: string): Promise<ApplicationManifestFile[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listApplicationManifestFiles');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_application_manifest_files')
      .select('*')
      .eq('manifest_id', manifestId)
      .order('generation_order', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ManifestFileRow[]).map(fromFileRow);
  } catch (error) {
    logError('listApplicationManifestFiles', error);
    return [];
  }
}

/**
 * Persists a freshly-built manifest (manifestBuilder.ts) as a new version — UNLESS the
 * latest existing version's `plan_checksum` already matches (`created: false`, the
 * existing version returned unchanged), satisfying "do not create duplicate manifest
 * versions for an unchanged plan". When a new version IS created, the previous
 * `status = 'active'` row (if any) is flipped to `'superseded'` first.
 */
export async function saveApplicationManifest(
  draft: ApplicationManifestDraft,
  files: ApplicationManifestFileDraft[],
  options: { createdBy?: string; forceNewVersion?: boolean } = {},
): Promise<ManifestPersistResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('saveApplicationManifest');
    return { ok: false, created: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const { data: existingRows, error: existingError } = await client
      .from('builders_application_manifests')
      .select('*')
      .eq('project_id', draft.projectId)
      .order('version', { ascending: false })
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    const latest = (existingRows?.[0] as ManifestRow | undefined) ?? undefined;

    /*
     * Sprint 44.2, Phase 3 — a new version is created whenever EITHER checksum changed
     * (or `forceNewVersion` — "Restart Generation"), not just `plan_checksum` (Phase 1's
     * original condition): the Product Package's CONTENT can change (different business
     * vision/requirements) while the resulting file STRUCTURE stays identical (same
     * pages/paths) — see manifestTypes.ts's own comment on why these are two separate
     * checksums. Requirement: "Compare Manifest checksum against Product Package
     * checksum. If different: DO NOT RESUME... Create Manifest Version +1."
     */
    const unchanged =
      latest &&
      latest.status === 'active' &&
      !options.forceNewVersion &&
      latest.plan_checksum === draft.planChecksum &&
      latest.source_content_checksum === draft.sourceContentChecksum;

    if (unchanged) {
      const existingFiles = await listApplicationManifestFiles(latest.id);
      return { ok: true, created: false, manifest: fromManifestRow(latest), files: existingFiles };
    }

    if (latest && latest.status === 'active') {
      const { error: supersedeError } = await client
        .from('builders_application_manifests')
        .update({ status: 'superseded' })
        .eq('id', latest.id);

      if (supersedeError) {
        throw supersedeError;
      }
    }

    const nextVersion = (latest?.version ?? 0) + 1;

    const { data: inserted, error: insertError } = await client
      .from('builders_application_manifests')
      .insert({
        project_id: draft.projectId,
        version: nextVersion,
        status: 'active',
        source_package_assembled_at: draft.sourcePackageAssembledAt ?? null,
        framework: draft.framework,
        package_manager: draft.packageManager,
        entry_file: draft.entryFile,
        total_files: files.length,
        completed_files: 0,
        failed_files: 0,
        plan_checksum: draft.planChecksum,
        source_content_checksum: draft.sourceContentChecksum,
        metadata: { fingerprints: draft.fingerprints },
        persisted_at: new Date().toISOString(),
        created_by: options.createdBy ?? null,
      })
      .select('*')
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error('Insert returned no row');
    }

    const manifestRow = inserted as ManifestRow;

    if (files.length > 0) {
      const { error: filesError } = await client
        .from('builders_application_manifest_files')
        .insert(files.map((file) => toFileInsertRow(manifestRow.id, draft.projectId, file)));

      if (filesError) {
        throw filesError;
      }
    }

    const insertedFiles = await listApplicationManifestFiles(manifestRow.id);

    return { ok: true, created: true, manifest: fromManifestRow(manifestRow), files: insertedFiles };
  } catch (error) {
    logError('saveApplicationManifest', error);
    return { ok: false, created: false, error: safeErrorMessage(error) };
  }
}

export const applicationManifestRepository = {
  isAvailable,
  getActiveApplicationManifest,
  listApplicationManifestFiles,
  saveApplicationManifest,
};
