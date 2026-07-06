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
] as const;

/** ownerId is a placeholder param for a future auth sprint — always null/undefined until then (see docs/buildersdb.md). */
export function toProjectRow(project: Project, ownerId?: string | null): BuildersDbProjectRow {
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
    createdAt: row.created_at,
    ...metadata,
  };
}

/** builders_role_outputs row — mirrors `ProjectArtifact` (app/lib/projects/artifacts.ts). */
export interface BuildersDbRoleOutputRow {
  id: string;
  project_id: string;
  task_id: string | null;
  role_key: string | null;
  role_name: string | null;
  title: string | null;
  status: string;
  content: string | null;
  version: number | null;
  created_at: string;
  updated_at: string;
}

export function toRoleOutputRow(projectId: string, artifact: ProjectArtifact): BuildersDbRoleOutputRow {
  return {
    id: artifact.id,
    project_id: projectId,
    task_id: artifact.taskId,
    role_key: artifact.type,
    role_name: artifact.generatedBy ?? null,
    title: artifact.title,
    status: artifact.status,
    content: artifact.content,
    version: artifact.version ?? null,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
  };
}

export function fromRoleOutputRow(row: BuildersDbRoleOutputRow): ProjectArtifact {
  return {
    id: row.id,
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
  created_at: string;
}

export interface BuildersDbActivityInput {
  projectId: string | null;
  activityType: string;
  description: string;
  metadata?: Record<string, unknown>;
}
