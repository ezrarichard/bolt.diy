import type { ProjectRepository, StorageProviderKind } from '~/lib/builders-db/types';
import { createLocalProjectRepository } from '~/lib/builders-db/providers/localProvider';
import { createSupabaseProjectRepository } from '~/lib/builders-db/providers/supabaseProvider';
import { isBuildersDbConfigured } from '~/lib/builders-db/client';

/**
 * Repository selector — Sprint 18, Task 6. The ONLY place in the codebase
 * that decides which storage provider backs project persistence. Every
 * other file — app/lib/stores/projects.ts today, and anything that follows
 * it later — goes through createProjectRepository() rather than importing
 * LocalProvider/SupabaseProvider directly.
 */
export type { ProjectRepository } from '~/lib/builders-db/types';

/** Which provider is currently selected — same check createProjectRepository() below uses. Exposed for a future debug/admin view. */
export function getStorageProviderKind(): StorageProviderKind {
  return isBuildersDbConfigured() ? 'supabase' : 'local';
}

let cachedRepository: ProjectRepository | undefined;

/**
 * Selects Local when BuildersDB isn't configured (true today — no
 * BUILDERS_DB_SUPABASE_URL/BUILDERS_DB_SUPABASE_ANON_KEY exist anywhere in
 * this project yet) and Supabase once it is. Cached after first call.
 *
 * CAUTION for whoever configures BuildersDB in a future sprint: the
 * Supabase provider is currently a structural skeleton whose methods no-op
 * (see providers/supabaseProvider.ts) — setting those two env vars before
 * that provider is actually implemented would make this function switch
 * away from Local and silently stop persisting projects. Don't set them
 * until providers/supabaseProvider.ts has a real implementation. See
 * docs/buildersdb.md.
 */
export function createProjectRepository(): ProjectRepository {
  if (!cachedRepository) {
    cachedRepository = isBuildersDbConfigured() ? createSupabaseProjectRepository() : createLocalProjectRepository();
  }

  return cachedRepository;
}
