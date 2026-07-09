/**
 * Workspace Snapshot — Sprint 38.5 (revised).
 *
 * A generic, storage-agnostic contract for "where the current generated application's
 * files live". Deliberately its own domain (not under app/lib/builders-db/) and
 * deliberately structural rather than importing app/lib/code-generation's `GeneratedFile`
 * type — a future GitHub-backed implementation shouldn't need to depend on the code
 * generation domain any more than today's BuildersDB one does.
 *
 * `saveSnapshot`/`getSnapshot` deal in full file content (only used when actually
 * re-materializing the workspace — see useCodeGeneration.ts's `resumeApplication`).
 * `getSnapshotMeta` is the cheap path — no content — for UI badges (see
 * ProductPackagePanel.tsx's Application Status card "Files" count) so a provider backed
 * by, say, a GitHub repo can answer "how many files, when" without fetching every blob.
 */

export interface WorkspaceSnapshotFile {
  path: string;
  content: string;
}

export interface WorkspaceSnapshotMeta {
  fileCount: number;
  generatedAt: string | null;
}

export interface WorkspaceSnapshotProvider {
  /** Replaces whatever was previously saved for this project — one current snapshot, not a version history (role-output version history already covers "what did the AI produce"; this is just "what's currently on disk"). */
  saveSnapshot(projectId: string, files: WorkspaceSnapshotFile[]): Promise<boolean>;
  getSnapshot(projectId: string): Promise<WorkspaceSnapshotFile[]>;
  getSnapshotMeta(projectId: string): Promise<WorkspaceSnapshotMeta | null>;
}
