import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import { DEFAULT_WORKSPACE_STATE, type ProjectWorkspaceState } from '~/lib/projects/workspaceState';

/**
 * Workspace State Repository — Sprint 38.5.
 *
 * Reads/writes `builders_project_workspace_state` (see
 * supabase/migrations/20260709030000_project_workspace_state.sql). Same defensive contract
 * as every other builders-db repository: guarded on BuildersDB being configured, every
 * Supabase call wrapped in try/catch, every failure path logs and returns a safe fallback
 * rather than throwing — a project with BuildersDB unconfigured/unreachable simply never
 * resumes (falls back to "Generate Application" as the primary action, same as today),
 * it never breaks.
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

interface WorkspaceStateRow {
  project_id: string;
  last_opened_section: string | null;
  last_generation_status: string;
  last_generation_time: string | null;
  last_preview_status: string;
  generated_application_exists: boolean;
  preview_available: boolean;
  workbench_files_created: boolean;
  last_active_engineer: string | null;
  last_activity: string | null;
  last_selected_tab: string | null;
  current_stage: string | null;
  last_error: string | null;
  product_package_assembled: boolean;
}

function fromRow(row: WorkspaceStateRow): ProjectWorkspaceState {
  return {
    lastOpenedSection: row.last_opened_section ?? undefined,
    lastGenerationStatus: row.last_generation_status as ProjectWorkspaceState['lastGenerationStatus'],
    lastGenerationTime: row.last_generation_time ?? undefined,
    lastPreviewStatus: row.last_preview_status as ProjectWorkspaceState['lastPreviewStatus'],
    generatedApplicationExists: row.generated_application_exists,
    previewAvailable: row.preview_available,
    workbenchFilesCreated: row.workbench_files_created,
    lastActiveEngineer: row.last_active_engineer ?? undefined,
    lastActivity: row.last_activity ?? undefined,
    lastSelectedTab: row.last_selected_tab ?? undefined,
    currentStage: row.current_stage ?? undefined,
    lastError: row.last_error ?? undefined,
    productPackageAssembled: row.product_package_assembled,
  };
}

export async function getWorkspaceState(projectId: string): Promise<ProjectWorkspaceState | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getWorkspaceState');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_project_workspace_state')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRow(data as WorkspaceStateRow) : null;
  } catch (error) {
    logError('getWorkspaceState', error);
    return null;
  }
}

/**
 * Merges `patch` onto whatever's currently persisted (reading the existing row first) and
 * upserts the full row — so a caller updating just `lastSelectedTab` never clobbers
 * `generatedApplicationExists`/etc. back to their defaults. Fire-and-forget from every call
 * site (see useCodeGeneration.ts, ProjectDashboard.tsx) — never blocks a UI action on this
 * succeeding.
 */
export async function upsertWorkspaceState(projectId: string, patch: Partial<ProjectWorkspaceState>): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('upsertWorkspaceState');
    return false;
  }

  try {
    const current = (await getWorkspaceState(projectId)) ?? DEFAULT_WORKSPACE_STATE;
    const next: ProjectWorkspaceState = { ...current, ...patch };

    const { error } = await client.from('builders_project_workspace_state').upsert(
      {
        project_id: projectId,
        last_opened_section: next.lastOpenedSection ?? null,
        last_generation_status: next.lastGenerationStatus,
        last_generation_time: next.lastGenerationTime ?? null,
        last_preview_status: next.lastPreviewStatus,
        generated_application_exists: next.generatedApplicationExists,
        preview_available: next.previewAvailable,
        workbench_files_created: next.workbenchFilesCreated,
        last_active_engineer: next.lastActiveEngineer ?? null,
        last_activity: next.lastActivity ?? null,
        last_selected_tab: next.lastSelectedTab ?? null,
        current_stage: next.currentStage ?? null,
        last_error: next.lastError ?? null,
        product_package_assembled: next.productPackageAssembled ?? false,
      },
      { onConflict: 'project_id' },
    );

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('upsertWorkspaceState', error);
    return false;
  }
}

export const workspaceStateRepository = {
  getWorkspaceState,
  upsertWorkspaceState,
};
