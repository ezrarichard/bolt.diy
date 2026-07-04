import type { Project } from '~/lib/stores/projects';
import type { ProjectRepository } from '~/lib/builders-db/types';

/**
 * Local Provider — Sprint 18.
 *
 * The exact localStorage read/write logic that used to live directly in
 * app/lib/stores/projects.ts (loadProjects()/persist()), relocated here
 * unchanged so the Store no longer touches localStorage itself — it goes
 * through a ProjectRepository instead (see repositories/projectsRepository.ts).
 * Behavior is byte-for-byte identical to before this sprint: same storage
 * key, same one-time legacy-mock-project cleanup on first read, same
 * JSON.stringify/parse round trip, same SSR guard.
 */

const STORAGE_KEY = 'builder_projects';

/**
 * Sprint 9 — ids of the Sprint 1-era mock/demo projects (Builders Platform,
 * LocalShop India, AI Advertising, Company Website, Mobile App). Stripped
 * from whatever's already persisted so they never resurface — see the
 * original comment in app/lib/stores/projects.ts's Sprint 9 history for why
 * this exists. Unchanged here, just relocated.
 */
const LEGACY_MOCK_PROJECT_IDS = new Set([
  'proj-builders-platform',
  'proj-localshop-india',
  'proj-ai-advertising',
  'proj-company-website',
  'proj-mobile-app',
]);

function writeAll(projects: Project[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }
}

function readAll(): Project[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (project) => project && typeof project.id === 'string' && !LEGACY_MOCK_PROJECT_IDS.has(project.id),
        );

        if (cleaned.length !== parsed.length) {
          // One-time cleanup — re-persist without the legacy mock entries so they don't reappear on the next read.
          writeAll(cleaned);
        }

        return cleaned;
      }
    }
  } catch (error) {
    console.error('Failed to load projects from localStorage:', error);
  }

  return [];
}

function upsert(project: Project): void {
  const all = readAll();
  const exists = all.some((candidate) => candidate.id === project.id);
  writeAll(exists ? all.map((candidate) => (candidate.id === project.id ? project : candidate)) : [...all, project]);
}

/**
 * Local, localStorage-backed ProjectRepository — today's only active
 * provider. Every "update*" method is a full overwrite (writeAll) because
 * that's exactly what persisting a single localStorage key already means;
 * the distinct method names exist for the interface's sake (see types.ts),
 * not because this provider treats them differently.
 */
export function createLocalProjectRepository(): ProjectRepository {
  return {
    loadProjects: readAll,
    loadProject: (projectId) => readAll().find((project) => project.id === projectId),
    saveProject: upsert,
    saveProjects: writeAll,
    deleteProject: (projectId) => writeAll(readAll().filter((project) => project.id !== projectId)),
    updateKnowledge: writeAll,
    updateArtifacts: writeAll,
    updateTasks: writeAll,
    updateReviews: writeAll,
  };
}
