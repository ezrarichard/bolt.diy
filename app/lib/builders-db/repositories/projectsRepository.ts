import type { ProjectRepository, StorageProviderKind } from '~/lib/builders-db/types';
import { createLocalProjectRepository } from '~/lib/builders-db/providers/localProvider';

/**
 * Repository selector — Sprint 18, Task 6.
 *
 * Sprint 38.3 — deliberately ALWAYS returns the Local provider now, regardless of
 * whether BuildersDB is configured. `providers/supabaseProvider.ts` (a structural
 * skeleton whose methods no-op — see that file) is no longer selected here: this
 * synchronous `ProjectRepository` interface is a poor fit for real network I/O (every
 * caller in app/lib/stores/projects.ts calls it synchronously and reads the result back
 * immediately), so converting it to a real async Supabase implementation was evaluated
 * and deliberately deferred as separate, higher-risk future work.
 *
 * Real BuildersDB persistence for a configured project instead flows through the async
 * `mirrorToBuildersDb()`/`hydrateProjectsFromBuildersDb()` pair in
 * app/lib/stores/projects.ts, which already calls the fully-implemented (not stubbed)
 * app/lib/builders-db/repositories/buildersDbRepository.ts functions directly: local
 * storage stays the instant, synchronous, always-available store the UI reads and writes
 * (see docs/buildersdb.md's "Future migration plan" for what a real async
 * ProjectRepository would still need to change everywhere else).
 */
export type { ProjectRepository } from '~/lib/builders-db/types';

/**
 * Which provider backs the synchronous `Project[]` store — always `'local'` today (see
 * createProjectRepository() above). `StorageProviderKind` still exists for whoever reads
 * it, but for the BuildersDB "Connected" status shown in the UI use
 * `checkBuildersDbConnection()` (app/lib/builders-db/client.ts) instead — that reflects
 * whether the background Supabase mirror is actually reachable, which this does not.
 */
export function getStorageProviderKind(): StorageProviderKind {
  return 'local';
}

let cachedRepository: ProjectRepository | undefined;

export function createProjectRepository(): ProjectRepository {
  if (!cachedRepository) {
    cachedRepository = createLocalProjectRepository();
  }

  return cachedRepository;
}
