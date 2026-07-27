import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { describeSchemaError, formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ApplicationManifestFileDraft,
  ApplicationManifestDraft,
  ManifestFingerprints,
  ManifestPersistResult,
  ManifestRouteDeclaration,
  ManifestVerificationEndpoint,
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
  console.error(`[ApplicationManifest] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

/**
 * Sprint 98A, BUG-010 — this string is the one the UI shows, so it now carries the Postgres code
 * and hint rather than the bare message. `[42703] column ... feature_ids does not exist` tells an
 * operator what to do; "column ... does not exist" alone does not, and `[object Object]` — what
 * Acceptance Round 1 actually got — tells them nothing at all.
 *
 * A schema error additionally gets the "apply outstanding migrations" sentence appended, because
 * that is the only action that resolves it.
 */
function safeErrorMessage(error: unknown): string {
  return describeSchemaError(error) ?? formatError(error);
}

/**
 * Sprint 98A, BUG-009 — "this database has not applied 20260811100000 yet", as opposed to "the
 * transaction ran and failed". PostgREST reports an unknown RPC as PGRST202; Postgres itself uses
 * `42883 undefined_function`. Only these two mean "fall back to the legacy path"; every other error
 * is a real failure and must not be silently retried against a non-transactional path.
 */
function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883';
}

interface ManifestRow {
  id: string;
  project_id: string;

  /** Sprint 47 — see ApplicationManifestDraft.mvpId's comment (manifestTypes.ts). */
  mvp_id: string | null;
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
  metadata: {
    fingerprints?: ManifestFingerprints;
    mvpCode?: string;
    featureScope?: { inScopeFeatureIds: string[]; outOfScopeFeatureDescriptions: string[] };

    /** Sprint 86, Part 5 — see ApplicationManifestDraft's own comments (manifestTypes.ts). Stored here, not new columns, same discipline `mvpCode`/`featureScope` above already established. */
    dependencies?: Record<string, string>;
    environmentRequirements?: string[];
    runtimeRequirements?: string[];
    requiredServices?: string[];
    buildCommand?: string;
    outputDirectory?: string;

    /** Sprint 92, Part 8/12 — see `ManifestRouteDeclaration`/`ManifestVerificationEndpoint` (manifestTypes.ts). Same `metadata`-not-a-column discipline. */
    routes?: ManifestRouteDeclaration[];
    verificationEndpoints?: ManifestVerificationEndpoint[];
  } | null;
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
  priority: number | null;
  queue_position: number | null;

  /** Sprint 49 — see ApplicationManifestFileDraft.featureIds's comment (manifestTypes.ts). */
  feature_ids: string[] | null;
}

function fromManifestRow(row: ManifestRow): ApplicationManifest {
  return {
    id: row.id,
    projectId: row.project_id,
    mvpId: row.mvp_id ?? undefined,
    mvpCode: row.metadata?.mvpCode ?? undefined,
    featureScope: row.metadata?.featureScope ?? undefined,
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
    dependencies: row.metadata?.dependencies ?? undefined,
    environmentRequirements: row.metadata?.environmentRequirements ?? undefined,
    runtimeRequirements: row.metadata?.runtimeRequirements ?? undefined,
    requiredServices: row.metadata?.requiredServices ?? undefined,
    buildCommand: row.metadata?.buildCommand ?? undefined,
    outputDirectory: row.metadata?.outputDirectory ?? undefined,
    routes: row.metadata?.routes ?? undefined,
    verificationEndpoints: row.metadata?.verificationEndpoints ?? undefined,
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
    priority: row.priority ?? undefined,
    queuePosition: row.queue_position ?? undefined,
    featureIds: row.feature_ids ?? [],
  };
}

/**
 * `manifestId` is null for the transactional RPC path (BUG-009): the function assigns the id
 * itself from the manifest it just inserted, because that id does not exist until the transaction
 * is already open. The legacy path passes the real id.
 */
function toFileInsertRow(manifestId: string | null, projectId: string, file: ApplicationManifestFileDraft) {
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
    priority: file.priority ?? null,
    queue_position: file.queuePosition ?? null,
    feature_ids: file.featureIds,
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

    const nextVersion = (latest?.version ?? 0) + 1;
    const supersedeId = latest && latest.status === 'active' ? latest.id : null;

    const metadata = {
      fingerprints: draft.fingerprints,
      mvpCode: draft.mvpCode,
      featureScope: draft.featureScope,
      dependencies: draft.dependencies,
      environmentRequirements: draft.environmentRequirements,
      runtimeRequirements: draft.runtimeRequirements,
      requiredServices: draft.requiredServices,
      buildCommand: draft.buildCommand,
      outputDirectory: draft.outputDirectory,
      routes: draft.routes,
      verificationEndpoints: draft.verificationEndpoints,
    };

    /*
     * Sprint 98A, BUG-009 — the transactional path. `builders_save_application_manifest` supersedes,
     * inserts the manifest and inserts every file row inside one plpgsql transaction, so a failure
     * anywhere rolls all of it back. Acceptance Round 1 produced an orphaned `active` manifest with
     * 80 declared files and zero rows precisely because these were three separate round-trips.
     *
     * Falls through to the legacy sequential path (with compensating cleanup) when the function is
     * not present, so a database that has not applied 20260811100000 keeps working unchanged.
     */
    const rpc = (
      typeof client.rpc === 'function'
        ? await client.rpc('builders_save_application_manifest', {
            p_project_id: draft.projectId,
            p_version: nextVersion,
            p_framework: draft.framework,
            p_package_manager: draft.packageManager,
            p_entry_file: draft.entryFile,
            p_total_files: files.length,
            p_plan_checksum: draft.planChecksum,
            p_source_content_checksum: draft.sourceContentChecksum,
            p_metadata: metadata,
            p_files: files.map((file) => toFileInsertRow(null, draft.projectId, file)),
            p_mvp_id: draft.mvpId ?? null,
            p_source_package_assembled_at: draft.sourcePackageAssembledAt ?? null,
            p_created_by: options.createdBy ?? null,
            p_supersede_manifest_id: supersedeId,
          })
        : /* No `rpc` on this client (older stub / unsupported transport) — use the legacy path. */
          { data: null, error: { code: 'PGRST202' } }
    ) as { data: unknown; error: unknown };

    if (!rpc.error && rpc.data) {
      const manifestRow = rpc.data as ManifestRow;
      const insertedFiles = await listApplicationManifestFiles(manifestRow.id);

      return { ok: true, created: true, manifest: fromManifestRow(manifestRow), files: insertedFiles };
    }

    if (rpc.error && !isMissingFunction(rpc.error)) {
      /* The transaction ran and genuinely failed — nothing was committed, so there is no orphan. */
      throw rpc.error;
    }

    /* ── Legacy fallback: database predates 20260811100000. ── */
    if (supersedeId) {
      const { error: supersedeError } = await client
        .from('builders_application_manifests')
        .update({ status: 'superseded' })
        .eq('id', supersedeId);

      if (supersedeError) {
        throw supersedeError;
      }
    }

    const { data: inserted, error: insertError } = await client
      .from('builders_application_manifests')
      .insert({
        project_id: draft.projectId,
        mvp_id: draft.mvpId ?? null,
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
        metadata,
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
        /*
         * BUG-009 compensating cleanup. This path has no transaction, so the manifest row above is
         * already committed. Deleting it is what stops the orphan Acceptance Round 1 found — an
         * `active` manifest declaring 80 files with none behind it. `on delete cascade` removes any
         * partially-inserted file rows with it.
         *
         * Best-effort by nature: if the delete itself fails there is nothing further this path can
         * do, so the cleanup outcome is reported alongside the original error rather than hidden.
         */
        const { error: cleanupError } = await client
          .from('builders_application_manifests')
          .delete()
          .eq('id', manifestRow.id);

        if (cleanupError) {
          logError('saveApplicationManifest.cleanup', cleanupError);
          throw new Error(
            `${safeErrorMessage(filesError)} (an incomplete manifest v${manifestRow.version} could not be removed and must be cleaned up manually)`,
          );
        }

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

/**
 * Sprint 44.2, Phase 4 — every manifest version ever created for a project (active AND
 * superseded), newest-first. The Generation Dashboard's "Manifest Versions" section
 * reads this directly rather than reconstructing version history from anywhere else —
 * `builders_application_manifests` already keeps every version as its own row (see
 * saveApplicationManifest's supersede-then-insert pattern), so there's nothing new to
 * store for this.
 */
export async function listManifestVersions(projectId: string): Promise<ApplicationManifest[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listManifestVersions');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_application_manifests')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ManifestRow[]).map(fromManifestRow);
  } catch (error) {
    logError('listManifestVersions', error);
    return [];
  }
}

export const applicationManifestRepository = {
  isAvailable,
  getActiveApplicationManifest,
  listApplicationManifestFiles,
  saveApplicationManifest,
  listManifestVersions,
};
