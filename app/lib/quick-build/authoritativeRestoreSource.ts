import type { Project } from '~/lib/stores/projects';
import type { WorkspaceSnapshotMeta } from '~/lib/workspace-snapshot';

/**
 * Workspace Resume Lifecycle — Sprint 44 (Phase 3).
 *
 * The single decision of "which file-restore source is authoritative for reopening this
 * chat" — pulled out of useChatHistory.ts's own effect into a pure, directly testable
 * function rather than left as inline conditionals, since getting this decision wrong is
 * exactly what caused the previous resume attempt's WebContainer race (see
 * workspaceResumeOrchestrator.ts's header comment). Returns `true` only when a real,
 * non-empty BuildersDB snapshot exists for a quick_build project — the ONLY case where
 * useChatHistory.ts's legacy IndexedDB `restoreSnapshot()` must be skipped in favor of
 * `resumeQuickBuildWorkspace()`. Every other case (Guided Engineering, a quick_build
 * project that never finished generating, BuildersDB unavailable) keeps using legacy
 * restore exactly as before — the fallback Sprint 44 explicitly requires.
 */
export function shouldSkipLegacyFileRestore(
  linkedProject: Pick<Project, 'projectType'> | undefined,
  buildersDbAvailable: boolean,
  snapshotMeta: WorkspaceSnapshotMeta | null,
): boolean {
  if (linkedProject?.projectType !== 'quick_build' || !buildersDbAvailable) {
    return false;
  }

  return !!snapshotMeta && snapshotMeta.fileCount > 0;
}
