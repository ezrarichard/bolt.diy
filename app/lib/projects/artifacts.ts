/**
 * Project Artifacts — Sprint 11, extended Sprint 13 (first real AI output).
 *
 * The output-shaped record an AI generation step populates for a task (a
 * generated requirements draft, a database schema, a config file, etc.) —
 * see app/lib/projects/executionEngine.ts and app/lib/projects/taskEngine.ts
 * for the task lifecycle this attaches to.
 *
 * Sprint 11/12 only ever created empty placeholders (`content: ''`,
 * `status: 'placeholder'`) on task approval. Sprint 13 adds the first real
 * content producer (app/lib/projects/businessAnalystEngine.ts) via
 * `createArtifact` below — the same generic shape (`type` is a free-text
 * label, `content` is always a string regardless of whether it holds
 * markdown, JSON, or SQL) is designed to be reused unchanged by every
 * future AI role (Solution Architect, Database Designer, UI Designer,
 * Backend Engineer): only the `type`/`generatedBy` values and the content
 * format differ.
 */

export type ProjectArtifactStatus = 'placeholder' | 'draft' | 'approved' | 'discarded' | 'final';

export interface ProjectArtifact {
  id: string;
  taskId: string;
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectArtifactStatus;
  content: string;

  /** Sprint 13 — which AI role produced this artifact, e.g. "AI Business Analyst". Undefined for the empty placeholders created on task approval. */
  generatedBy?: string;

  /** Sprint 13 — regeneration counter, starting at 1. Undefined for the empty placeholders created on task approval. */
  version?: number;
}

/** Builds an empty placeholder artifact for a task. Content is always '' — nothing generates real output yet. */
export function createPlaceholderArtifact(taskId: string, title: string, type: string): ProjectArtifact {
  const now = new Date().toISOString();

  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    title,
    type,
    createdAt: now,
    updatedAt: now,
    status: 'placeholder',
    content: '',
  };
}

/**
 * Sprint 13 — builds an artifact that already holds real (AI-generated)
 * content, as opposed to createPlaceholderArtifact's empty stub. Generic
 * over `type`/`generatedBy` so every future AI role can create its own
 * artifacts through this same constructor.
 */
export function createArtifact(input: {
  taskId: string;
  title: string;
  type: string;
  content: string;
  status: ProjectArtifactStatus;
  generatedBy: string;
  version: number;
}): ProjectArtifact {
  const now = new Date().toISOString();

  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: input.taskId,
    title: input.title,
    type: input.type,
    createdAt: now,
    updatedAt: now,
    status: input.status,
    content: input.content,
    generatedBy: input.generatedBy,
    version: input.version,
  };
}

/**
 * Sprint 14 — canonical artifact `type` values for every AI-role draft, so
 * no engine/component hand-types the string more than once. Add one entry
 * here per future AI role (Database Designer, UI Designer, Backend
 * Engineer, ...).
 */
export const ARTIFACT_TYPES = {
  REQUIREMENTS_DRAFT: 'requirements-draft',
  ARCHITECTURE_DRAFT: 'architecture-draft',
  DATABASE_DRAFT: 'database-draft',
  UIUX_DRAFT: 'uiux-draft',
  BACKEND_DRAFT: 'backend-draft',
  FRONTEND_DRAFT: 'frontend-draft',
  QA_DRAFT: 'qa-draft',
} as const;

/**
 * Sprint 14 — shared by every "*DraftPanel" component (RequirementsDraftPanel,
 * ArchitectureDraftPanel, and future AI-role panels) so "which artifact of
 * this type is the current one" is answered exactly once. Ties break toward
 * the higher version.
 */
export function getLatestArtifact(artifacts: ProjectArtifact[], type: string): ProjectArtifact | undefined {
  const matching = artifacts.filter((artifact) => artifact.type === type);

  if (matching.length === 0) {
    return undefined;
  }

  return matching.reduce((latest, candidate) =>
    (candidate.version ?? 0) > (latest.version ?? 0) ? candidate : latest,
  );
}

/** Sprint 14 — parses an artifact's JSON `content` back into its draft shape. Returns undefined rather than throwing on malformed content. */
export function parseArtifactContent<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * Sprint 16 — "read the latest artifact of `type`, but only if it's been
 * approved" — the exact check every gated AI role needs before it can run
 * (Database Designer gating on an approved Architecture Draft, UI/UX
 * Designer gating on an approved Database Design Draft, and future roles
 * gating on whichever draft precedes them). Extracted out of
 * databaseDesignerEngine.ts so it's defined once rather than re-implemented
 * per engine. Returns undefined for "doesn't exist yet", "still a draft",
 * and "discarded" alike — callers only care about the approved case.
 */
export function getApprovedArtifactContent<T>(artifacts: ProjectArtifact[], type: string): T | undefined {
  const latest = getLatestArtifact(artifacts, type);

  if (!latest || latest.status !== 'approved') {
    return undefined;
  }

  return parseArtifactContent<T>(latest.content);
}

/** Sprint 14 — shared timestamp formatting for artifact status lines. */
export function formatArtifactTimestamp(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

/** Sprint 14 — shared badge styling for an AI draft artifact's review status, used by every "*DraftPanel" component. */
export const ARTIFACT_STATUS_META: Record<'draft' | 'approved' | 'discarded', { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'text-purple-600 dark:text-purple-400 border-purple-500/30 bg-purple-500/10' },
  approved: {
    label: 'Approved',
    className: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
  },
  discarded: {
    label: 'Discarded',
    className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
};
