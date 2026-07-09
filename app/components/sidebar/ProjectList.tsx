import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { deleteProject, projectsStore, requestNewProjectDialogStore, type Project } from '~/lib/stores/projects';
import { ProjectListItem } from './ProjectListItem';
import { NewProjectDialog } from './NewProjectDialog';

interface ProjectListProps {
  onSelectProject: (projectId: string) => void;
}

export function ProjectList({ onSelectProject }: ProjectListProps) {
  const projects = useStore(projectsStore);
  const [query, setQuery] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const newProjectDialogRequest = useStore(requestNewProjectDialogStore);

  /*
   * Sprint 24 — lets the home screen's "Guided Engineering" card open this
   * same dialog remotely (see requestNewProjectDialog() in
   * ~/lib/stores/projects). Skipped on the initial mount (counter starts at
   * 0), same guard as BaseChat.tsx's focusChatInputRequest effect.
   */
  useEffect(() => {
    if (newProjectDialogRequest > 0) {
      setIsNewProjectOpen(true);
    }
  }, [newProjectDialogRequest]);

  const filteredProjects = useMemo(() => {
    if (!query.trim()) {
      return projects;
    }

    const q = query.toLowerCase();

    return projects.filter((project: Project) => project.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Fixed header — New Project button, search, and section heading never scroll away. */}
      <div className="shrink-0 p-4 pb-3 space-y-3">
        <button
          onClick={() => setIsNewProjectOpen(true)}
          className="w-full flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
        >
          <span className="inline-block i-ph:plus-circle h-4 w-4" />
          <span className="text-sm font-medium">New Project</span>
        </button>

        <div className="relative w-full">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <span className="i-ph:magnifying-glass h-4 w-4 text-gray-400 dark:text-gray-500" />
          </div>
          <input
            className="w-full bg-gray-50 dark:bg-gray-900 relative pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
            type="search"
            placeholder="Search projects..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search projects"
          />
        </div>

        <div
          className={classNames('text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1')}
        >
          Projects
        </div>
      </div>

      {/* Scrollable project rows — independent of the fixed header above and whatever renders below ProjectList (chat search/history). */}
      <div className="flex-1 min-h-0 overflow-y-auto modern-scrollbar px-4 pb-4 space-y-1">
        {filteredProjects.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">No projects match your search</div>
        ) : (
          filteredProjects.map((project: Project) => (
            <ProjectListItem
              key={project.id}
              project={project}
              onClick={() => onSelectProject(project.id)}
              onDelete={deleteProject}
            />
          ))
        )}
      </div>

      <NewProjectDialog open={isNewProjectOpen} onClose={() => setIsNewProjectOpen(false)} />
    </div>
  );
}
