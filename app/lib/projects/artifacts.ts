/**
 * Project Artifacts — Sprint 11.
 *
 * The output-shaped record a future AI generation step will eventually
 * populate for a task (a generated page, a database schema, a config file,
 * etc.) — see app/lib/projects/executionEngine.ts and
 * app/lib/projects/taskEngine.ts for the task lifecycle this attaches to.
 *
 * This sprint introduces the data model and local storage only. Nothing
 * here calls an LLM, generates code, or writes a prompt — every artifact
 * created this sprint is an empty placeholder (`content: ''`,
 * `status: 'placeholder'`) so a future AI generation sprint has somewhere
 * to write real output without another data-model change.
 */

export type ProjectArtifactStatus = 'placeholder' | 'draft' | 'final';

export interface ProjectArtifact {
  id: string;
  taskId: string;
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectArtifactStatus;
  content: string;
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
