import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { softDeleteProjects, projectsStore, requestNewProjectDialogStore, type Project } from '~/lib/stores/projects';
import {
  matchesFilter,
  matchesSearch,
  resolveProjectStatus,
  sortProjectsForDisplay,
  type ProjectFilter,
} from '~/lib/projects/projectLifecycle';
import { ProjectManagementDialog } from './ProjectManagementDialog';
import { ProjectListItem, PROJECT_COLOR_CLASSES } from './ProjectListItem';
import { NewProjectDialog } from './NewProjectDialog';

interface ProjectListProps {
  onSelectProject: (projectId: string) => void;

  /** Sprint 41.1 — icon-only rendering for the collapsed (72px) desktop/tablet sidebar. */
  collapsed?: boolean;

  /** Called when a collapsed-mode action (New Project, Search) needs the sidebar expanded first. */
  onRequestExpand?: () => void;
}

export function ProjectList({ onSelectProject, collapsed = false, onRequestExpand }: ProjectListProps) {
  const projects = useStore(projectsStore);
  const [query, setQuery] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>('active');
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

  /*
   * Project Lifecycle — only Active projects show by default. A search deliberately spans EVERY
   * status (the brief requires archived projects to stay findable), so typing a query widens the
   * result set rather than narrowing it within the current filter.
   */
  const filteredProjects = useMemo(() => {
    const searching = query.trim().length > 0;
    const matched = projects.filter(
      (project: Project) => matchesSearch(project, query) && (searching || matchesFilter(project, filter)),
    );

    return sortProjectsForDisplay(matched);
  }, [projects, query, filter]);

  /* The collapsed rail only ever shows active work — it has no room to explain a status badge. */
  const activeProjects = useMemo(
    () => sortProjectsForDisplay(projects.filter((project: Project) => resolveProjectStatus(project) === 'active')),
    [projects],
  );

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center min-h-0 gap-1.5 py-3">
        <button
          type="button"
          title="New Project"
          onClick={() => {
            onRequestExpand?.();
            setIsNewProjectOpen(true);
          }}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
        >
          <span className="i-ph:plus-circle h-5 w-5" />
        </button>
        <button
          type="button"
          title="Search projects"
          onClick={() => onRequestExpand?.()}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span className="i-ph:magnifying-glass h-5 w-5" />
        </button>
        <div className="flex-1 min-h-0 w-full overflow-y-auto modern-scrollbar flex flex-col items-center gap-1.5 pt-1">
          {activeProjects.map((project: Project) => {
            const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;

            return (
              <button
                key={project.id}
                type="button"
                title={project.name}
                onClick={() => onSelectProject(project.id)}
                className={classNames(
                  'flex items-center justify-center w-9 h-9 rounded-full shrink-0 ring-1 transition-colors',
                  colorClasses.bg,
                  colorClasses.ring,
                  'hover:ring-2',
                )}
              >
                <span className="text-sm leading-none">{project.icon}</span>
              </button>
            );
          })}
        </div>
        <NewProjectDialog open={isNewProjectOpen} onClose={() => setIsNewProjectOpen(false)} />
      </div>
    );
  }

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

        {/* Lifecycle filter chips — Phase 6. Counts come from the same resolver the rows use. */}
        <div className="flex items-center gap-1">
          {(['active', 'archived', 'deleted', 'all'] as ProjectFilter[]).map((value) => {
            const count =
              value === 'all'
                ? projects.length
                : projects.filter((project: Project) => resolveProjectStatus(project) === value).length;

            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={classNames(
                  'px-2 py-0.5 rounded-full text-[10px] appearance-none border transition-colors capitalize',
                  filter === value
                    ? 'border-builders-brand-primary/50 bg-builders-brand-subtleSurface text-builders-brand-primary font-medium'
                    : 'border-bolt-elements-borderColor/50 bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                )}
              >
                {value === 'deleted' ? 'bin' : value} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {query.trim() ? 'Search results' : 'Projects'}
          </span>
          <button
            type="button"
            onClick={() => setIsManageOpen(true)}
            className="text-[10px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
          >
            Manage
          </button>
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
              onDelete={(projectId: string) => softDeleteProjects([projectId])}
            />
          ))
        )}
      </div>

      <NewProjectDialog open={isNewProjectOpen} onClose={() => setIsNewProjectOpen(false)} />
      <ProjectManagementDialog open={isManageOpen} onClose={() => setIsManageOpen(false)} />
    </div>
  );
}
