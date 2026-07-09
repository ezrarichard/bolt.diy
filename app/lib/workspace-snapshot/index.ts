import { buildersDbSnapshotProvider } from './buildersDbSnapshotProvider';
import type { WorkspaceSnapshotProvider } from './types';

export type { WorkspaceSnapshotProvider, WorkspaceSnapshotFile, WorkspaceSnapshotMeta } from './types';

/**
 * Snapshot storage selector — Sprint 38.5 (revised). The ONLY place that decides which
 * `WorkspaceSnapshotProvider` backs "Continue Development"/the Application Status card.
 * Every caller (useCodeGeneration.ts, ProductPackagePanel.tsx) goes through this function
 * rather than importing a concrete provider directly — the same one-selector pattern
 * app/lib/builders-db/repositories/projectsRepository.ts already uses for local vs.
 * Supabase project storage.
 *
 * Always BuildersDB-backed today. Once GitHub push/pull is real (`project.githubRepo`,
 * currently always unset — see Project in app/lib/stores/projects.ts), a future
 * `githubSnapshotProvider.ts` implementing the same `WorkspaceSnapshotProvider` interface
 * can be selected here — e.g. BuildersDB when no repo is connected yet, GitHub once one
 * is — with zero changes to any caller. That is the entire reason this is a pluggable
 * interface rather than useCodeGeneration.ts calling a BuildersDB repository directly.
 */
export function getWorkspaceSnapshotProvider(): WorkspaceSnapshotProvider {
  return buildersDbSnapshotProvider;
}
