import { useStore } from '@nanostores/react';
import { currentProjectIdStore, projectsStore } from '~/lib/stores/projects';
import { getProjectContextSummary, type ProjectContextSummary } from './context';

/**
 * The "clean helper" UI components use to read the active project's
 * workspace context — combines the currentProjectIdStore / projectsStore
 * nanostores with getProjectContextSummary() so nothing outside this file
 * needs to know how "active project" is tracked or how blueprint data is
 * resolved.
 *
 * Returns null when no project is active — callers (e.g. the Current
 * Project badge) use that to render nothing, matching "if no project is
 * active, chat works exactly like today."
 */
export function useActiveProjectContext(): ProjectContextSummary | null {
  const currentProjectId = useStore(currentProjectIdStore);
  const projects = useStore(projectsStore);

  if (!currentProjectId) {
    return null;
  }

  const project = projects.find((candidate) => candidate.id === currentProjectId);

  if (!project) {
    return null;
  }

  return getProjectContextSummary(project);
}
