import type { Project } from '~/lib/stores/projects';
import type { ProjectRepository } from '~/lib/builders-db/types';
import { isBuildersDbConfigured } from '~/lib/builders-db/client';

/**
 * Supabase Provider — Sprint 18 skeleton.
 *
 * Structure only, as instructed for this sprint: implements
 * ProjectRepository so it type-checks as a valid provider for
 * repositories/projectsRepository.ts's selector, but every method is inert.
 * Nothing here makes a network call — there is no BuildersDB Supabase
 * project configured yet (app/lib/builders-db/client.ts) and no
 * `@supabase/supabase-js` dependency installed, and this sprint deliberately
 * adds neither. Every method logs a clear warning and returns an empty/no-op
 * result rather than throwing, so nothing ever crashes if this provider is
 * ever selected.
 *
 * TODO (future sprint): once BuildersDB is configured and
 * `@supabase/supabase-js` is added, replace each body with the real
 * Supabase call it names (e.g. `saveProject` -> `supabase.from('projects')
 * .upsert(...)`), and convert ProjectRepository to an async
 * (Promise-returning) interface throughout — seeing this go from
 * synchronous no-ops to real `await`ed network calls is exactly the
 * signal that migration is due. See docs/buildersdb.md.
 */

function warnInactive(method: string): void {
  const reason = isBuildersDbConfigured()
    ? 'BuildersDB is configured, but the Supabase provider is not implemented yet (no @supabase/supabase-js dependency).'
    : 'BuildersDB is not configured yet.';

  console.warn(`[BuildersDB] SupabaseProvider.${method}() called, but this provider is inactive — ${reason}`);
}

export function createSupabaseProjectRepository(): ProjectRepository {
  return {
    loadProjects(): Project[] {
      warnInactive('loadProjects');
      return [];
    },
    loadProject(): Project | undefined {
      warnInactive('loadProject');
      return undefined;
    },
    saveProject(): void {
      warnInactive('saveProject');
    },
    saveProjects(): void {
      warnInactive('saveProjects');
    },
    deleteProject(): void {
      warnInactive('deleteProject');
    },
    updateKnowledge(): void {
      warnInactive('updateKnowledge');
    },
    updateArtifacts(): void {
      warnInactive('updateArtifacts');
    },
    updateTasks(): void {
      warnInactive('updateTasks');
    },
    updateReviews(): void {
      warnInactive('updateReviews');
    },
  };
}
