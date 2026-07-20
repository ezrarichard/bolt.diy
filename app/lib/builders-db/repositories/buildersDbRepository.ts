import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { Project } from '~/lib/stores/projects';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import {
  fromContextTraceRow,
  fromProjectMemberRow,
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
  type ProjectMember,
  type ProjectMemberRole,
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

/** Postgrest errors are plain objects (not `instanceof Error`) but always carry a string `.message` — this extracts it for either shape. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown BuildersDB error.';
}

/** Whether BuildersDB is configured AND reachable enough to attempt calls — the same check every function below starts with. */
export function isBuildersDbAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

// ── Projects ──────────────────────────────────────────────────────────────

export interface BuildersDbWriteResult {
  ok: boolean;

  /** A safe, user-displayable message (Postgrest's own `.message` — never a key, token, or header). Null on success. */
  error: string | null;
}

/**
 * Sprint 42 — `ownerId` should always be the current authenticated user's id (see
 * getCurrentActor() in app/lib/stores/projects.ts); RLS's `builders_projects_insert_own`
 * policy (see the Sprint 42 migration) rejects the insert otherwise. A DB trigger
 * (`add_owner_membership`) inserts the matching `builders_project_members` Owner row
 * automatically — this function doesn't need to do that itself.
 *
 * Urgent fix — live-verified root cause: this used to call `.upsert()`, which PostgREST
 * executes as `INSERT ... ON CONFLICT (id) DO UPDATE`. Postgres RLS requires an upsert to
 * satisfy BOTH the INSERT policy's `WITH CHECK` AND the UPDATE policy's `USING` clause (the
 * planner can't know in advance whether the conflict branch fires) — but
 * `builders_projects_update_editable`'s `USING` clause calls `builders_user_can_edit_project(id)`,
 * which reads `builders_project_members`, which has NO row yet for a brand-new project (the
 * `add_owner_membership` trigger only inserts that row AFTER a successful INSERT). That's a
 * chicken-and-egg RLS deadlock: every first-time project insert — Quick Build or Guided
 * Engineering — was rejected with `42501` before ever reaching the trigger. Confirmed live: an
 * identical row succeeds via `.insert()` and fails via `.upsert()` under the same policies.
 * Every project id is minted fresh client-side (see projects.ts's `createLocalProject`), so a
 * genuine conflict is never expected — a collision surfacing as an error here (rather than a
 * silent overwrite) is the correct, safe behavior anyway.
 *
 * Also unlike every other function in this file, this one returns *why* it failed
 * (`BuildersDbWriteResult`), not just a boolean. Quick Build's first-message project creation
 * (see projects.ts's `persistQuickBuildProject`) awaits this result and must show the caller a
 * real reason ("not signed in" vs. "RLS rejected" vs. "network error") instead of a
 * console-only `logError()` — every other caller of `createProject` below keeps the plain
 * boolean it always had.
 */
export async function createProjectWithResult(
  project: Project,
  ownerId?: string | null,
): Promise<BuildersDbWriteResult> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('createProject');
    return { ok: false, error: 'BuildersDB is not configured on this deployment.' };
  }

  try {
    const { error } = await client.from('builders_projects').insert(toProjectRow(project, ownerId));

    if (error) {
      throw error;
    }

    return { ok: true, error: null };
  } catch (error) {
    logError('createProject', error);

    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function createProject(project: Project, ownerId?: string | null): Promise<boolean> {
  const result = await createProjectWithResult(project, ownerId);
  return result.ok;
}

/**
 * Sprint 42 — `editorId`, if given, is stamped onto `last_editor`. Deliberately strips
 * `owner_id`/`created_by` from the row `toProjectRow()` builds (rather than reusing it as-is):
 * an update must never reassign ownership, and RLS's `builders_projects_update_editable`
 * policy only checks the *current* row's owner/membership anyway, so sending a stale
 * `owner_id` back on every update is both pointless and risky if that logic ever changes.
 */
export async function updateProject(project: Project, editorId?: string | null): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('updateProject');
    return false;
  }

  try {
    const {
      owner_id: _ownerId,
      created_by: _createdBy,
      last_editor: lastEditor,
      ...rest
    } = toProjectRow(project, null, editorId);

    /*
     * Only include last_editor in the update payload when an editorId was actually given —
     * otherwise every unattributed updateProject() call (setRoadmapItemStatus,
     * updateProjectKnowledge, etc. — not every call site threads an actor through yet) would
     * null out whatever last_editor a previous, attributed update had set.
     */
    const row = editorId ? { ...rest, last_editor: lastEditor } : rest;
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

/** Sprint 42 (PART 1) — stamps `last_opened_at`. Deliberately a narrow single-column update, not a full updateProject(), so opening a project can never race/clobber a concurrent content edit. */
export async function touchLastOpened(projectId: string): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('touchLastOpened');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_projects')
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', projectId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('touchLastOpened', error);
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

/**
 * Sprint 42 (PART 4) — replaces the old unfiltered `listProjects()`. The actual filtering
 * (owned + shared-into projects only) is enforced by RLS's `builders_projects_select_accessible`
 * policy (see the Sprint 42 migration's `builders_user_can_access_project()`), not by a
 * client-side `.eq('owner_id', ...)` — an authenticated Supabase query already only returns
 * rows this user's policies allow, including rows shared via `builders_project_members` for
 * future collaboration, and archived-status filtering (PART 4's "Future archived projects")
 * can be added here later as a plain `.eq('status', ...)` without touching RLS at all.
 */
export async function listProjectsForCurrentUser(): Promise<Project[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listProjectsForCurrentUser');
    return [];
  }

  try {
    const { data, error } = await client.from('builders_projects').select('*').order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromProjectRow);
  } catch (error) {
    logError('listProjectsForCurrentUser', error);
    return [];
  }
}

/**
 * Sprint 42 (PART 10) — Owner-only. RLS's `builders_projects_delete_owner_only` policy already
 * enforces this at the database level (an Editor's delete simply matches zero rows), but this
 * check runs first so the caller gets a clear `false` instead of a silent no-op delete, and so
 * the UI can distinguish "nothing to delete" from "you're not allowed to delete this."
 */
export async function deleteProject(projectId: string, requestingUserId?: string | null): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('deleteProject');
    return false;
  }

  try {
    if (requestingUserId) {
      const role = await getMemberRole(projectId, requestingUserId);

      if (role !== 'Owner') {
        console.warn(`[BuildersDB] deleteProject() refused — ${requestingUserId} is not the Owner of ${projectId}.`);
        return false;
      }
    }

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

// ── Project members (PART 3 / PART 11 — share-ready architecture, no sharing UI yet) ──────

/** Every member of a project, Owner first. Used by deleteProject()'s ownership check and future member-management UI. */
export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listMembers');
    return [];
  }

  try {
    const { data, error } = await client.from('builders_project_members').select('*').eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return (data ?? []).map(fromProjectMemberRow);
  } catch (error) {
    logError('listMembers', error);
    return [];
  }
}

/** This project's role for one user, or null if they have no access. */
export async function getMemberRole(projectId: string, userId: string): Promise<ProjectMemberRole | null> {
  const members = await listMembers(projectId);
  return members.find((member) => member.userId === userId)?.role ?? null;
}

/**
 * Not called from any UI yet (PART 11 — "DO NOT build sharing UI. Only prepare
 * architecture."). RLS's `builders_project_members_owner_manage` policy restricts this to the
 * project's current Owner regardless of caller.
 */
export async function inviteUserToProject(
  projectId: string,
  userId: string,
  role: ProjectMemberRole = 'Viewer',
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('inviteUserToProject');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_project_members')
      .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: 'project_id,user_id' });

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('inviteUserToProject', error);
    return false;
  }
}

/** Not called from any UI yet — see inviteUserToProject()'s comment. */
export async function removeUser(projectId: string, userId: string): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('removeUser');
    return false;
  }

  try {
    const { error } = await client
      .from('builders_project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('removeUser', error);
    return false;
  }
}

/** Not called from any UI yet — see inviteUserToProject()'s comment. */
export async function changeRole(projectId: string, userId: string, role: ProjectMemberRole): Promise<boolean> {
  return inviteUserToProject(projectId, userId, role);
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
/**
 * Sprint 45 — `mvpId` is optional and unused by every existing caller (undefined ->
 * null, identical to today's behavior): it exists so the future AI Product Owner
 * (Sprint 46+) can scope Architecture-or-later role outputs to an MVP without this
 * function's call shape changing again. See docs/02-Architecture/06-mvp-as-core-object.md.
 */
export async function createOrUpdateRoleOutput(
  projectId: string,
  artifact: ProjectArtifact,
  generationType: RoleOutputGenerationType = 'manual',
  generatedByUserId?: string | null,
  mvpId?: string | null,
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

    const row = toRoleOutputRow(projectId, artifact, generationType, parentVersionId, generatedByUserId, mvpId);
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
      actor_id: input.actorId ?? null,
      actor_display_name: input.actorDisplayName ?? null,
      mvp_id: input.mvpId ?? null,
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
      actorId: row.actor_id ?? null,
      actorDisplayName: row.actor_display_name ?? null,
      mvpId: row.mvp_id ?? null,
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
  createProjectWithResult,
  updateProject,
  getProjectById,
  listProjectsForCurrentUser,
  deleteProject,
  touchLastOpened,
  listMembers,
  getMemberRole,
  inviteUserToProject,
  removeUser,
  changeRole,
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
