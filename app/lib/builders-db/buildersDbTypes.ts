import type { Project } from '~/lib/stores/projects';
import type { ProjectArtifact, ProjectArtifactStatus } from '~/lib/projects/artifacts';
import type { ProjectTaskStatus } from '~/lib/projects/executionEngine';
import type { ReviewStatus, TaskHistoryEventType } from '~/lib/projects/reviewEngine';

/**
 * BuildersDB row/frontend shape mapping — Sprint 34.
 *
 * Each `BuildersDb*Row` type below is the literal shape of a row in the table
 * named in its comment (see supabase/migrations/20260706120000_buildersdb_foundation.sql
 * for the DDL). The `to*Row`/`from*Row` functions are the only place a
 * frontend shape (Project, ProjectArtifact, ...) is translated to/from its
 * table row — buildersDbRepository.ts calls these rather than constructing
 * rows inline, so the mapping is defined exactly once per shape.
 */

/** builders_projects row. */
export interface BuildersDbProjectRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  blueprint_id: string | null;
  status: string;
  owner_id: string | null;

  /** Sprint 42 — set once at creation, never reassigned even if ownership is later transferred (owner_id can change; created_by never does). */
  created_by: string | null;

  /** Sprint 42 — last time this project was opened (Home Dashboard "Continue Working" / Project Dashboard). Null until first open after this column existed. */
  last_opened_at: string | null;

  /** Sprint 42 — user_id of whoever last mutated this project row. */
  last_editor: string | null;

  /** Sprint 42 — analytics counters, persisted only (PART 13); no UI reads these yet. */
  generation_count: number;
  repair_count: number;
  deployment_count: number;

  /** Sprint 39.7 — see app/lib/project-types/projectTypeRegistry.ts. Real column: queryable/constrained. */
  project_type: string;

  /** Sprint 39.7 — analytics-only provenance, see app/lib/project-types/projectTypeRegistry.ts's CreatedFrom. */
  created_from: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Fields on `Project` not worth their own builders_projects column yet — folded into
 * `metadata`. See the migration's builders_projects comment.
 *
 * Deliberately excludes taskStatus/taskNotes/taskReview/taskHistory/artifacts: those
 * have their own normalized tables (builders_project_tasks, builders_task_reviews,
 * builders_execution_logs, builders_role_outputs) so they're never duplicated here.
 */
const METADATA_FIELDS = [
  'roadmapStatus',
  'generationSession',
  'projectKnowledge',
  'githubRepo',
  'supabaseProjectId',
  'deploymentTarget',
  'environmentVariables',
  'members',
  'templates',
  'mcpServers',
  'knowledgeBase',

  /** Sprint 39.7 — the quick_build project's IndexedDB chat id/urlId; see linkProjectChat(). */
  'linkedChatId',

  /** Project Definition workflow — see app/lib/projects/projectDefinition.ts. */
  'projectDefinitionApproval',
  'projectDefinitionChat',
] as const;

/**
 * Sprint 42 — `ownerId` is the current authenticated user's id (see getCurrentActor() in
 * app/lib/stores/projects.ts). Only meaningful on INSERT: `.upsert()` in createProject()
 * always sends `owner_id`/`created_by`, but `updateProject()` builds its row via this same
 * function then strips `owner_id`/`created_by` before its `.update()` call, so an update never
 * reassigns ownership (see updateProject() in buildersDbRepository.ts). `editorId`, if given,
 * is stamped onto `last_editor` — every mutation is "someone editing this project", not just
 * creation.
 */
export function toProjectRow(
  project: Project,
  ownerId?: string | null,
  editorId?: string | null,
): BuildersDbProjectRow {
  const metadata: Record<string, unknown> = {};

  for (const field of METADATA_FIELDS) {
    const value = project[field as keyof Project];

    if (value !== undefined) {
      metadata[field] = value;
    }
  }

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    icon: project.icon,
    color: project.color,
    blueprint_id: project.blueprintId ?? null,
    status: 'active',
    owner_id: ownerId ?? null,
    created_by: ownerId ?? null,
    last_opened_at: null,
    last_editor: editorId ?? ownerId ?? null,
    generation_count: 0,
    repair_count: 0,
    deployment_count: 0,
    project_type: project.projectType,
    created_from: project.createdFrom,
    metadata,
    created_at: project.createdAt,
    updated_at: new Date().toISOString(),
  };
}

/** Reconstructs a `Project` from a builders_projects row, restoring the metadata-folded fields. */
export function fromProjectRow(row: BuildersDbProjectRow): Project {
  const metadata = (row.metadata ?? {}) as Partial<Project>;

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon ?? '',
    color: row.color ?? '',
    blueprintId: row.blueprint_id ?? undefined,
    projectType: (row.project_type as Project['projectType']) ?? 'guided_engineering',
    createdFrom: (row.created_from as Project['createdFrom']) ?? 'guided_engineering',
    createdAt: row.created_at,
    ...metadata,
  };
}

/** Sprint 36 — which workflow produced a role output version: a human clicking Generate/Regenerate in a *DraftPanel, or the Sprint 31 autonomous pipeline (useAutoEngineeringPipeline.ts). */
export type RoleOutputGenerationType = 'manual' | 'automatic';

/**
 * builders_role_outputs row — mirrors `ProjectArtifact` (app/lib/projects/artifacts.ts).
 *
 * Sprint 36 — `id` is now a surrogate uuid (one row per VERSION, not per artifact);
 * `artifact_id` is the frontend's stable `ProjectArtifact.id`, constant across every
 * regenerate of the same role output. See the Sprint 36 migration's header comment for
 * why this changed from Sprint 34's one-row-per-artifact shape.
 */
export interface BuildersDbRoleOutputRow {
  id: string;
  artifact_id: string;
  project_id: string;
  task_id: string | null;
  role_key: string | null;
  role_name: string | null;
  title: string | null;
  status: string;
  content: string | null;
  version: number | null;
  generation_type: RoleOutputGenerationType;
  parent_version_id: string | null;

  /** Sprint 42 (PART 9) — the authenticated user whose action produced this version, or null for automatic-pipeline runs with no human in the loop. */
  generated_by_user: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Builds the upsert payload for one version. Deliberately omits `id` — on a genuinely
 * new version (a fresh `(artifact_id, version)` pair) Postgres assigns a new surrogate
 * id via the column default; on a status-only change to an EXISTING version (the
 * `(artifact_id, version)` upsert conflict target matches), the existing row's `id` is
 * left untouched. See createOrUpdateRoleOutput in buildersDbRepository.ts, the only
 * caller.
 */
export function toRoleOutputRow(
  projectId: string,
  artifact: ProjectArtifact,
  generationType: RoleOutputGenerationType = 'manual',
  parentVersionId?: string | null,
  generatedByUserId?: string | null,
): Omit<BuildersDbRoleOutputRow, 'id'> {
  return {
    artifact_id: artifact.id,
    project_id: projectId,
    task_id: artifact.taskId,
    role_key: artifact.type,
    role_name: artifact.generatedBy ?? null,
    title: artifact.title,
    status: artifact.status,
    content: artifact.content,
    version: artifact.version ?? null,
    generation_type: generationType,
    parent_version_id: parentVersionId ?? null,
    generated_by_user: generatedByUserId ?? null,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
  };
}

export function fromRoleOutputRow(row: BuildersDbRoleOutputRow): ProjectArtifact {
  return {
    id: row.artifact_id,
    taskId: row.task_id ?? '',
    title: row.title ?? '',
    type: row.role_key ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as ProjectArtifactStatus,
    content: row.content ?? '',
    generatedBy: row.role_name ?? undefined,
    version: row.version ?? undefined,
  };
}

/**
 * Sprint 36 — one role output version's metadata, without its full `content` (see
 * getRoleVersionHistory in buildersDbRepository.ts) — everything requirement #2
 * ("Output Metadata") asks for that isn't already implied by `ProjectArtifact` itself.
 */
export interface RoleOutputVersionMeta {
  rowId: string;
  artifactId: string;
  version: number | null;
  status: ProjectArtifactStatus;
  generationType: RoleOutputGenerationType;
  parentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fromRoleOutputRowToVersionMeta(row: BuildersDbRoleOutputRow): RoleOutputVersionMeta {
  return {
    rowId: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    status: row.status as ProjectArtifactStatus,
    generationType: row.generation_type,
    parentVersionId: row.parent_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** builders_project_tasks row — mirrors `Project.taskStatus`/`Project.taskNotes` entries. */
export interface BuildersDbProjectTaskRow {
  id: string;
  project_id: string;
  task_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `status`/`notes` are both optional so a caller can update just one without
 * clobbering the other — e.g. setTaskNotes (app/lib/stores/projects.ts) only ever
 * changes notes, never status. See upsertProjectTask in buildersDbRepository.ts,
 * which only includes the keys actually present on this input in its upsert payload.
 */
export interface BuildersDbTaskInput {
  taskId: string;
  status?: ProjectTaskStatus;
  notes?: string;
}

/** builders_task_reviews row — mirrors `TaskReviewRecord` (app/lib/projects/reviewEngine.ts). */
export interface BuildersDbTaskReviewRow {
  id: string;
  project_id: string;
  task_id: string;
  review_status: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string;
  created_at: string;
}

export interface BuildersDbTaskReviewInput {
  taskId: string;
  reviewStatus: ReviewStatus;
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
}

/** Sprint 35 — reads a builders_task_reviews row back into the same shape `createTaskReview`/`updateTaskReview` accept, so `getTaskReviews()` returns something callers already know how to work with. */
export function fromTaskReviewRow(row: BuildersDbTaskReviewRow): BuildersDbTaskReviewInput {
  return {
    taskId: row.task_id,
    reviewStatus: row.review_status as ReviewStatus,
    reviewedBy: row.reviewed_by ?? '',
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes ?? undefined,
  };
}

/** builders_execution_logs row — mirrors one `TaskHistoryEvent` (app/lib/projects/reviewEngine.ts). */
export interface BuildersDbExecutionLogRow {
  id: string;
  project_id: string;
  task_id: string | null;
  event_type: string;
  note: string | null;
  created_at: string;
}

export interface BuildersDbExecutionLogInput {
  taskId?: string;
  eventType: TaskHistoryEventType | string;
  note?: string;
}

/** builders_project_activity row. */
export interface BuildersDbActivityRow {
  id: string;
  project_id: string | null;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;

  /** Sprint 42 (PART 8) — who performed this action, and their display name at the time (a snapshot, not a live join — see the migration). Null for system-generated entries with no acting user (e.g. automatic pipeline runs). */
  actor_id: string | null;
  actor_display_name: string | null;
  created_at: string;
}

export interface BuildersDbActivityInput {
  projectId: string | null;
  activityType: string;
  description: string;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  actorDisplayName?: string | null;
}

/** builders_project_members row (PART 3 / PART 11). */
export type ProjectMemberRole = 'Owner' | 'Editor' | 'Viewer';

export interface BuildersDbProjectMemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  created_at: string;
}

export interface ProjectMember {
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
}

export function fromProjectMemberRow(row: BuildersDbProjectMemberRow): ProjectMember {
  return {
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

/**
 * Sprint 36 — one entry in a builders_context_traces row's `sources` JSONB array: which
 * single piece of persistent context contributed to a role's generated response.
 * `roleKey`/`version` are only present for `type: 'role-output'`.
 */
export interface ContextTraceSource {
  type: 'role-output' | 'task' | 'original-prompt';
  label: string;
  roleKey?: string;
  version?: number;
}

/** builders_context_traces row. */
export interface BuildersDbContextTraceRow {
  id: string;
  project_id: string;
  role_key: string;
  role_output_id: string | null;
  sources: ContextTraceSource[];
  created_at: string;
}

export interface BuildersDbContextTraceInput {
  projectId: string;
  roleKey: string;
  roleOutputId?: string | null;
  sources: ContextTraceSource[];
}

export function fromContextTraceRow(
  row: BuildersDbContextTraceRow,
): BuildersDbContextTraceInput & { createdAt: string } {
  return {
    projectId: row.project_id,
    roleKey: row.role_key,
    roleOutputId: row.role_output_id,
    sources: row.sources ?? [],
    createdAt: row.created_at,
  };
}
