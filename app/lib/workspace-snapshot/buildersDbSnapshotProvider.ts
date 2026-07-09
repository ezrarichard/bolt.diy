import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { WorkspaceSnapshotFile, WorkspaceSnapshotMeta, WorkspaceSnapshotProvider } from './types';

/**
 * BuildersDB-backed `WorkspaceSnapshotProvider` — Sprint 38.5 (revised).
 *
 * Stores the whole generated application as ONE consolidated row (`builders_workspace_snapshots`,
 * one per project, `files` as a JSONB array) rather than one row per file. Deliberately
 * keeps BuildersDB's per-file surface area to a single JSONB blob column instead of a
 * normalized files table — this provider is meant to be an interim/swappable
 * implementation of `WorkspaceSnapshotProvider`, not BuildersDB's permanent role as a
 * source-code store. See app/lib/workspace-snapshot/index.ts for the selector this
 * plugs into, and where a future GitHub-backed provider would replace it once
 * `project.githubRepo` is a real, connected value.
 *
 * Same defensive contract as every other builders-db-backed module: guarded on
 * BuildersDB being configured, every Supabase call wrapped in try/catch, every failure
 * path logs and returns a safe fallback — "Continue Development" simply isn't available
 * when this fails, it never crashes the dashboard.
 */

function unavailable(method: string): void {
  console.warn(`[BuildersDB] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[BuildersDB] ${method}() failed:`, error);
}

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

async function saveSnapshot(projectId: string, files: WorkspaceSnapshotFile[]): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('saveSnapshot');
    return false;
  }

  try {
    const { error } = await client.from('builders_workspace_snapshots').upsert(
      {
        project_id: projectId,
        files,
        file_count: files.length,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    );

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('saveSnapshot', error);
    return false;
  }
}

async function getSnapshot(projectId: string): Promise<WorkspaceSnapshotFile[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getSnapshot');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_workspace_snapshots')
      .select('files')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.files as WorkspaceSnapshotFile[] | undefined) ?? [];
  } catch (error) {
    logError('getSnapshot', error);
    return [];
  }
}

/** No `files` in the select — the whole point is answering "how many, when" without paying for the content. */
async function getSnapshotMeta(projectId: string): Promise<WorkspaceSnapshotMeta | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getSnapshotMeta');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_workspace_snapshots')
      .select('file_count, generated_at')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? { fileCount: data.file_count, generatedAt: data.generated_at } : null;
  } catch (error) {
    logError('getSnapshotMeta', error);
    return null;
  }
}

export const buildersDbSnapshotProvider: WorkspaceSnapshotProvider = {
  saveSnapshot,
  getSnapshot,
  getSnapshotMeta,
};
