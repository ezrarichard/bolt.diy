import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { Project } from '~/lib/stores/projects';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import {
  fromContextTraceRow,
  fromProjectRow,
  fromRoleOutputRow,
  fromTaskReviewRow,
  toProjectRow,
  toRoleOutputRow,
  type BuildersDbActivityInput,
  type BuildersDbContextTraceInput,
  type BuildersDbExecutionLogInput,
  type BuildersDbTaskInput,
  type BuildersDbTaskReviewInput,
  type RoleOutputGenerationType,
} from '~/lib/builders-db/buildersDbTypes';

/**
 * BuildersDB Repository — Sprint 34.
 *
 * The async, network-backed persistence layer for BuildersDB's normalized
 * tables (builders_projects, builders_role_outputs, builders_project_tasks,
 * builders_task_reviews, builders_execution_logs, builders_project_activity —
 * see supabase/migrations/20260706120000_buildersdb_foundation.sql). This is
 * deliberately a *separate* module from
 * app/lib/builders-db/repositories/projectsRepository.ts's synchronous
 * `ProjectRepository` (the Sprint 18 local/Supabase-skeleton selector that
 * still backs the single localStorage-persisted `Project[]` blob) — converting
 * that whole interface to async, and auditing every call site for
 * await/loading-state handling, is real, separate work this sprint
 * deliberately doesn't do (see docs/buildersdb.md's "Future migration plan").
 *
 * Instead, app/lib/stores/projects.ts calls this repository's functions
 * *additively*, fire-and-forget, alongside its existing synchronous
 * localStorage writes: the UI keeps reading/writing `projectsStore`
 * exactly as before (zero behavior change when BuildersDB isn't
 * configured), while a configured BuildersDB also receives a mirrored,
 * normalized copy of the same writes in the background.
 *
 * Every function here is defensive by construction: `isBuildersDbConfigured()`
 * is checked up front, every Supabase call is wrapped in try/catch, and every
 * failure path logs a `console.error`/`console.warn` and returns a safe
 * fallback (`null`, `[]`, or `false`) rather than throwing. Callers should
 * never need their own try/catch around these functions.
 */

function unavailable(method: string): void {
  console.warn(
    `[BuildersDB] ${method}() skipped — BuildersDB is not configured (no BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY).`,
  );
}

function logError(method: string, error: unknown): void {
  console.error(`[BuildersDB] ${method}() failed:`, error);
}

/** Whether BuildersDB is configured AND reachable enough to attempt calls — the same check every function below starts with. */
export function isBuildersDbAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

// ── Projects ──────────────────────────────────────────────────────────────

export async function createProject(project: Project, ownerId?: string | null): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createProject');
    return false;
  }

  try {
    const { error } = await client.from('builders_projects').upsert(toProjectRow(project, ownerId));

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('createProject', error);
    return false;
  }
}

export async function updateProject(project: Project): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateProject');
    return false;
  }

  try {
    const row = toProjectRow(project);
    const { error } = await client.from('builders_projects').update(row).eq('id', project.id);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateProject', error);
    return false;
  }
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getProjectById');
    return null;
  }

  try {
    const { data, error } = await client.from('builders_projects').select('*').eq('id', projectId).maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromProjectRow(data) : null;
  } catch (error) {
    logError('getProjectById', error);
    return null;
  }
}

export async function listProjects(): Promise<Project[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listProjects');
    return [];
  }

  try {
    const { data, error } = await client.from('builders_projects').select('*').order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromProjectRow);
  } catch (error) {
    logError('listProjects', error);
    return [];
  }
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('deleteProject');
    return false;
  }

  try {
    /*
     * Every other builders_* table's project_id column has ON DELETE CASCADE
     * (see the migration) — deleting the project row is enough to remove its
     * role outputs, tasks, reviews, execution logs, and activity.
     */
    const { error } = await client.from('builders_projects').delete().eq('id', projectId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('deleteProject', error);
    return false;
  }
}

// ── Role outputs ──────────────────────────────────────────────────────────

/** Fire-and-forget — never lets an activity-log failure affect the write it's describing. */
function logRoleOutputVersionCreated(projectId: string, artifact: ProjectArtifact): void {
  addProjectActivity({
    projectId,
    activityType: 'role_output_version_created',
    description: `${artifact.generatedBy ?? artifact.type} version ${artifact.version ?? 1} created`,
    metadata: { roleKey: artifact.type, version: artifact.version ?? null },
  }).catch((error) => logError('logRoleOutputVersionCreated', error));
}

/**
 * Sprint 36 — upserts one role output VERSION. Targets the `(artifact_id, version)`
 * unique constraint (see the Sprint 36 migration) rather than the row's own `id`: a
 * status-only change to an already-persisted version (e.g. approving it) updates that
 * same row in place, while a genuinely new version (a `version` never seen before for
 * this `artifact_id`) inserts a new row — every earlier version stays exactly as it was,
 * which is the version history this sprint adds. `generationType` records which
 * workflow produced it ('manual' from a *DraftPanel, 'automatic' from
 * useAutoEngineeringPipeline.ts); `parent_version_id` is computed here by looking up the
 * immediately-prior version's row id, so version history can be walked backwards later.
 */
export async function createOrUpdateRoleOutput(
  projectId: string,
  artifact: ProjectArtifact,
  generationType: RoleOutputGenerationType = 'manual',
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createOrUpdateRoleOutput');
    return false;
  }

  try {
    const { data: existingVersions, error: fetchError } = await client
      .from('builders_role_outputs')
      .select('id, version')
      .eq('artifact_id', artifact.id)
      .order('version', { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    const versions = existingVersions ?? [];
    const isNewVersion = !versions.some((row) => row.version === (artifact.version ?? null));
    const parentVersionId = isNewVersion
      ? (versions.find((row) => (row.version ?? 0) < (artifact.version ?? 0))?.id ?? null)
      : null;

    const row = toRoleOutputRow(projectId, artifact, generationType, parentVersionId);
    const { error } = await client.from('builders_role_outputs').upsert(row, { onConflict: 'artifact_id,version' });

    if (error) {
      throw error;
    }

    if (isNewVersion) {
      logRoleOutputVersionCreated(projectId, artifact);
    }

    return true;
  } catch (error) {
    logError('createOrUpdateRoleOutput', error);
    return false;
  }
}

/**
 * All role outputs for a project, oldest first — lets an AI role read earlier roles'
 * output directly from BuildersDB instead of only the in-memory `Project.artifacts`.
 * Sprint 35 (app/lib/ai/context/buildersDbContextProvider.ts) is the first caller that
 * actually does this — see that file for the read side of the AI Engineering Team
 * Context Chain surviving a refresh/session restart.
 */
export async function getRoleOutputsForProject(projectId: string): Promise<ProjectArtifact[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getRoleOutputsForProject');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_role_outputs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromRoleOutputRow);
  } catch (error) {
    logError('getRoleOutputsForProject', error);
    return [];
  }
}

/** Sprint 35 — the single latest (highest-version) role output for one role_key, without fetching every role output for the project. */
export async function getLatestRoleOutput(projectId: string, roleKey: string): Promise<ProjectArtifact | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestRoleOutput');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_role_outputs')
      .select('*')
      .eq('project_id', projectId)
      .eq('role_key', roleKey)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRoleOutputRow(data) : null;
  } catch (error) {
    logError('getLatestRoleOutput', error);
    return null;
  }
}

/** Sprint 36 — every version of one role's output, oldest first — the version history requirement #1 calls for. Includes every status (draft/approved/discarded/final), so callers can see the full timeline, not just what's currently active. */
export async function getRoleVersionHistory(projectId: string, roleKey: string): Promise<ProjectArtifact[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getRoleVersionHistory');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_role_outputs')
      .select('*')
      .eq('project_id', projectId)
      .eq('role_key', roleKey)
      .order('version', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromRoleOutputRow);
  } catch (error) {
    logError('getRoleVersionHistory', error);
    return [];
  }
}

/** Sprint 36 — requirement #5 ("Latest Approved vs Latest Draft"): the highest-version row with `status = 'approved'` for a role, or null if none has been approved yet. */
export async function getLatestApproved(projectId: string, roleKey: string): Promise<ProjectArtifact | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestApproved');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_role_outputs')
      .select('*')
      .eq('project_id', projectId)
      .eq('role_key', roleKey)
      .eq('status', 'approved')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRoleOutputRow(data) : null;
  } catch (error) {
    logError('getLatestApproved', error);
    return null;
  }
}

/** Sprint 36 — the highest-version row with `status = 'draft'` for a role (i.e. still awaiting a human decision), or null if none is currently pending. */
export async function getLatestDraft(projectId: string, roleKey: string): Promise<ProjectArtifact | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestDraft');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_role_outputs')
      .select('*')
      .eq('project_id', projectId)
      .eq('role_key', roleKey)
      .eq('status', 'draft')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRoleOutputRow(data) : null;
  } catch (error) {
    logError('getLatestDraft', error);
    return null;
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────

async function upsertProjectTask(projectId: string, input: BuildersDbTaskInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('upsertProjectTask');
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      project_id: projectId,
      task_id: input.taskId,
      updated_at: new Date().toISOString(),
    };

    /*
     * Only set columns this caller actually provided — e.g. setTaskNotes (which never
     * touches status) must not overwrite an existing row's status back to undefined.
     */
    if (input.status !== undefined) {
      payload.status = input.status;
    }

    if (input.notes !== undefined) {
      payload.notes = input.notes;
    }

    const { error } = await client.from('builders_project_tasks').upsert(payload, { onConflict: 'project_id,task_id' });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('upsertProjectTask', error);
    return false;
  }
}

/** Creates (or upserts, if it already exists) a project task's status/notes row. */
export async function createProjectTask(projectId: string, input: BuildersDbTaskInput): Promise<boolean> {
  return upsertProjectTask(projectId, input);
}

/** Same upsert as createProjectTask — a distinct name so call sites read as "this is a status/notes change", not "this task just started existing". */
export async function updateProjectTask(projectId: string, input: BuildersDbTaskInput): Promise<boolean> {
  return upsertProjectTask(projectId, input);
}

export async function getProjectTasks(projectId: string): Promise<BuildersDbTaskInput[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getProjectTasks');
    return [];
  }

  try {
    const { data, error } = await client.from('builders_project_tasks').select('*').eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      taskId: row.task_id,
      status: row.status,
      notes: row.notes ?? undefined,
    }));
  } catch (error) {
    logError('getProjectTasks', error);
    return [];
  }
}

// ── Task reviews ──────────────────────────────────────────────────────────

async function upsertTaskReview(projectId: string, input: BuildersDbTaskReviewInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('upsertTaskReview');
    return false;
  }

  try {
    const { error } = await client.from('builders_task_reviews').upsert(
      {
        project_id: projectId,
        task_id: input.taskId,
        review_status: input.reviewStatus,
        review_notes: input.reviewNotes ?? null,
        reviewed_by: input.reviewedBy,
        reviewed_at: input.reviewedAt,
      },
      { onConflict: 'project_id,task_id' },
    );

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('upsertTaskReview', error);
    return false;
  }
}

export async function createTaskReview(projectId: string, input: BuildersDbTaskReviewInput): Promise<boolean> {
  return upsertTaskReview(projectId, input);
}

export async function updateTaskReview(projectId: string, input: BuildersDbTaskReviewInput): Promise<boolean> {
  return upsertTaskReview(projectId, input);
}

/** Sprint 35 — every task's latest review verdict for a project (one row per task_id, see the migration's unique(project_id, task_id)). Used by the AI context provider to surface review/approval status alongside task status. */
export async function getTaskReviews(projectId: string): Promise<BuildersDbTaskReviewInput[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getTaskReviews');
    return [];
  }

  try {
    const { data, error } = await client.from('builders_task_reviews').select('*').eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromTaskReviewRow);
  } catch (error) {
    logError('getTaskReviews', error);
    return [];
  }
}

// ── Execution logs (append-only task history) ────────────────────────────

export async function createExecutionLog(projectId: string, input: BuildersDbExecutionLogInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createExecutionLog');
    return false;
  }

  try {
    const { error } = await client.from('builders_execution_logs').insert({
      project_id: projectId,
      task_id: input.taskId ?? null,
      event_type: input.eventType,
      note: input.note ?? null,
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('createExecutionLog', error);
    return false;
  }
}

// ── Project activity ─────────────────────────────────────────────────────

export async function addProjectActivity(input: BuildersDbActivityInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('addProjectActivity');
    return false;
  }

  try {
    const { error } = await client.from('builders_project_activity').insert({
      project_id: input.projectId,
      activity_type: input.activityType,
      description: input.description,
      metadata: input.metadata ?? {},
    });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('addProjectActivity', error);
    return false;
  }
}

/**
 * Sprint 38.5 — first real caller (ProjectHistoryPanel.tsx). Returns `createdAt` on each
 * entry, unlike `BuildersDbActivityInput` alone (that type only describes the write
 * shape) — a "newest first" history list is unusable without a timestamp to display, even
 * though the query itself already orders by it. Same `& { createdAt: string }` pattern
 * `getContextTrace` below already uses for the same reason.
 */
export async function getProjectActivity(
  projectId: string,
): Promise<(BuildersDbActivityInput & { createdAt: string })[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getProjectActivity');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_project_activity')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      projectId: row.project_id,
      activityType: row.activity_type,
      description: row.description,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    }));
  } catch (error) {
    logError('getProjectActivity', error);
    return [];
  }
}

// ── Context traces ────────────────────────────────────────────────────────

/**
 * Sprint 36 — records which sources fed into one role's generated context (see
 * app/lib/ai/context/buildersDbContextProvider.ts's buildRoleContextBlock, the only
 * caller). Also logs a lightweight `context_trace_stored` activity entry.
 */
export async function saveContextTrace(input: BuildersDbContextTraceInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('saveContextTrace');
    return false;
  }

  try {
    const { error } = await client.from('builders_context_traces').insert({
      project_id: input.projectId,
      role_key: input.roleKey,
      role_output_id: input.roleOutputId ?? null,
      sources: input.sources,
    });

    if (error) {
      throw error;
    }

    addProjectActivity({
      projectId: input.projectId,
      activityType: 'context_trace_stored',
      description: `Context trace stored for ${input.roleKey} (${input.sources.length} source(s))`,
      metadata: { roleKey: input.roleKey, sourceCount: input.sources.length },
    }).catch((error) => logError('context_trace_stored activity', error));

    return true;
  } catch (error) {
    logError('saveContextTrace', error);
    return false;
  }
}

/** The most recent context traces stored for a role, newest first — answers "why did this AI generate this response" (see app/lib/ai/context/contextTrace.ts). */
export async function getContextTrace(
  projectId: string,
  roleKey: string,
  limit = 5,
): Promise<(BuildersDbContextTraceInput & { createdAt: string })[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getContextTrace');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_context_traces')
      .select('*')
      .eq('project_id', projectId)
      .eq('role_key', roleKey)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromContextTraceRow);
  } catch (error) {
    logError('getContextTrace', error);
    return [];
  }
}

export const buildersDbRepository = {
  isBuildersDbAvailable,
  createProject,
  updateProject,
  getProjectById,
  listProjects,
  deleteProject,
  createOrUpdateRoleOutput,
  getRoleOutputsForProject,
  getLatestRoleOutput,
  getRoleVersionHistory,
  getLatestApproved,
  getLatestDraft,
  createProjectTask,
  updateProjectTask,
  getProjectTasks,
  createTaskReview,
  updateTaskReview,
  getTaskReviews,
  createExecutionLog,
  addProjectActivity,
  getProjectActivity,
  saveContextTrace,
  getContextTrace,
};
