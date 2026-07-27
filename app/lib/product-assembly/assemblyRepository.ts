import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { addProjectActivity } from '~/lib/builders-db/repositories/buildersDbRepository';
import { formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';
import type {
  MissingSection,
  ProductAssemblySection,
  ProductAssemblyStatus,
  ProductPackage,
  ProductPackageFile,
} from './assemblyTypes';

/**
 * Product Assembly Repository — Sprint 37.
 *
 * Persists an already-assembled `ProductPackage` (app/lib/product-assembly/
 * productAssembler.ts) to `builders_product_packages`/`builders_product_package_files`
 * (see supabase/migrations/20260707150000_sprint37_product_assembly.sql). Same
 * defensive contract as every builders-db repository function in this codebase:
 * `isBuildersDbAvailable()`-equivalent guard up front, every Supabase call wrapped in
 * try/catch, every failure path logs a `console.error`/`console.warn` and returns a
 * safe fallback (`false`/`null`/`[]`) rather than throwing. Assembly itself
 * (productAssembler.ts) never depends on any of this succeeding — a project with
 * BuildersDB unconfigured (or unreachable) still assembles and previews locally, it
 * just doesn't survive a refresh.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[BuildersDB] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[ProductAssembly] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

interface PackageRow {
  id: string;
  project_id: string;
  assembled_at: string;
  missing_sections: MissingSection[];
}

interface PackageFileRow {
  id: string;
  package_id: string;
  project_id: string;
  section: ProductAssemblySection;
  path: string;
  filename: string;
  title: string;
  content: string;
  source_role: string | null;
  source_artifact_id: string | null;
  source_version: number | null;
  source_status: ProductAssemblyStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toFileRow(packageId: string, file: ProductPackageFile): Omit<PackageFileRow, 'id'> {
  return {
    package_id: packageId,
    project_id: file.projectId,
    section: file.section,
    path: file.path,
    filename: file.filename,
    title: file.title,
    content: file.content,
    source_role: file.sourceRole ?? null,
    source_artifact_id: file.sourceArtifactId ?? null,
    source_version: file.sourceVersion ?? null,
    source_status: file.sourceStatus,
    metadata: file.metadata ?? {},
    created_at: file.createdAt,
    updated_at: file.updatedAt,
  };
}

function fromFileRow(row: PackageFileRow): ProductPackageFile {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    filename: row.filename,
    section: row.section,
    title: row.title,
    content: row.content,
    sourceRole: row.source_role ?? undefined,
    sourceArtifactId: row.source_artifact_id ?? undefined,
    sourceVersion: row.source_version ?? undefined,
    sourceStatus: row.source_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata,
  };
}

/** Groups a flat file list back into `ProductPackage.sections`, in the same section order the files happen to appear in (already pipeline-ordered by productAssembler.ts, and by insertion order on read-back). */
function groupFilesBySection(files: ProductPackageFile[]): ProductPackage['sections'] {
  const bySection = new Map<ProductAssemblySection, ProductPackageFile[]>();

  for (const file of files) {
    const list = bySection.get(file.section) ?? [];
    list.push(file);
    bySection.set(file.section, list);
  }

  return Array.from(bySection.entries()).map(([id, sectionFiles]) => ({
    id,
    label: sectionFiles[0]?.path.split('/')[0] ?? id,
    files: sectionFiles,
  }));
}

/**
 * Replaces whatever package previously existed for this project with `pkg` (delete +
 * re-insert, kept simple per the sprint's "keep schema simple" guidance — see the
 * migration's header comment for why this table only ever holds ONE current package per
 * project rather than a history). Logs `product_package_assembled`,
 * `product_package_file_created`/`product_package_file_updated` (whichever applies —
 * "created" the first time a project is assembled, "updated" on every re-assembly), and
 * one `missing_role_output` entry per missing section.
 */
export async function saveProductPackage(pkg: ProductPackage): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('saveProductPackage');
    return false;
  }

  try {
    const { data: existing } = await client
      .from('builders_product_packages')
      .select('id')
      .eq('project_id', pkg.projectId)
      .maybeSingle();

    const isReassembly = Boolean(existing);

    // ON DELETE CASCADE (see the migration) removes the previous package's files too.
    await client.from('builders_product_packages').delete().eq('project_id', pkg.projectId);

    const { data: inserted, error: insertError } = await client
      .from('builders_product_packages')
      .insert({ project_id: pkg.projectId, assembled_at: pkg.assembledAt, missing_sections: pkg.missingSections })
      .select('id')
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error('Insert returned no row');
    }

    const allFiles = pkg.sections.flatMap((section) => section.files);

    if (allFiles.length > 0) {
      const { error: filesError } = await client
        .from('builders_product_package_files')
        .insert(allFiles.map((file) => toFileRow(inserted.id, file)));

      if (filesError) {
        throw filesError;
      }
    }

    addProjectActivity({
      projectId: pkg.projectId,
      activityType: 'product_package_assembled',
      description: `Product package assembled (${allFiles.length} file(s), ${pkg.missingSections.length} missing section(s))`,
      metadata: { fileCount: allFiles.length, missingCount: pkg.missingSections.length },
    }).catch((error) => logError('product_package_assembled activity', error));

    addProjectActivity({
      projectId: pkg.projectId,
      activityType: isReassembly ? 'product_package_file_updated' : 'product_package_file_created',
      description: `${allFiles.length} product package file(s) ${isReassembly ? 'updated' : 'created'}`,
      metadata: { fileCount: allFiles.length },
    }).catch((error) => logError('product_package_file activity', error));

    for (const missing of pkg.missingSections) {
      addProjectActivity({
        projectId: pkg.projectId,
        activityType: 'missing_role_output',
        description: `${missing.label} output missing from product package`,
        metadata: { section: missing.section },
      }).catch((error) => logError('missing_role_output activity', error));
    }

    return true;
  } catch (error) {
    logError('saveProductPackage', error);
    return false;
  }
}

/** The current persisted package for a project, or null if none has been assembled/saved yet (or BuildersDB is unavailable). */
export async function getProductPackage(projectId: string): Promise<ProductPackage | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getProductPackage');
    return null;
  }

  try {
    const { data: packageRow, error: packageError } = await client
      .from('builders_product_packages')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (packageError) {
      throw packageError;
    }

    if (!packageRow) {
      return null;
    }

    const row = packageRow as PackageRow;
    const { data: fileRows, error: filesError } = await client
      .from('builders_product_package_files')
      .select('*')
      .eq('package_id', row.id)
      .order('created_at', { ascending: true });

    if (filesError) {
      throw filesError;
    }

    const files = ((fileRows ?? []) as PackageFileRow[]).map(fromFileRow);

    return {
      projectId: row.project_id,
      projectName: '',
      assembledAt: row.assembled_at,
      sections: groupFilesBySection(files),
      missingSections: row.missing_sections ?? [],
    };
  } catch (error) {
    logError('getProductPackage', error);
    return null;
  }
}

/** Every persisted file for a project, flat (not grouped by section) — a convenience for callers that don't need the section/missing-sections structure. */
export async function listProductPackageFiles(projectId: string): Promise<ProductPackageFile[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listProductPackageFiles');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_product_package_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as PackageFileRow[]).map(fromFileRow);
  } catch (error) {
    logError('listProductPackageFiles', error);
    return [];
  }
}

/** Deletes a project's persisted package (its files cascade-delete with it — see the migration). */
export async function deleteProductPackage(projectId: string): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('deleteProductPackage');
    return false;
  }

  try {
    const { error } = await client.from('builders_product_packages').delete().eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('deleteProductPackage', error);
    return false;
  }
}

export const assemblyRepository = {
  isAvailable,
  saveProductPackage,
  getProductPackage,
  listProductPackageFiles,
  deleteProductPackage,
};
