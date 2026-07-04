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
