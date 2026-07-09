import type { MouseEvent } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { getProjectTypeDefinition } from '~/lib/project-types/projectTypeRegistry';

interface ProjectListItemProps {
  project: Project;
  onClick: () => void;
  onDelete: (projectId: string) => void;
}

/*
 * UnoCSS/Tailwind need literal class strings to detect them at build time, so
 * color tokens are mapped through this static lookup rather than interpolated
 * (e.g. `bg-${color}-500` would not be picked up by the scanner).
 */
const COLOR_CLASSES: Record<string, { bg: string; ring: string }> = {
  purple: { bg: 'bg-purple-500/15', ring: 'ring-purple-500/20' },
  blue: { bg: 'bg-blue-500/15', ring: 'ring-blue-500/20' },
  green: { bg: 'bg-green-500/15', ring: 'ring-green-500/20' },
  orange: { bg: 'bg-orange-500/15', ring: 'ring-orange-500/20' },
  pink: { bg: 'bg-pink-500/15', ring: 'ring-pink-500/20' },
  teal: { bg: 'bg-teal-500/15', ring: 'ring-teal-500/20' },
  amber: { bg: 'bg-amber-500/15', ring: 'ring-amber-500/20' },
};

export function ProjectListItem({ project, onClick, onDelete }: ProjectListItemProps) {
  const colorClasses = COLOR_CLASSES[project.color] || COLOR_CLASSES.purple;
  const projectType = getProjectTypeDefinition(project.projectType);

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Never let the delete click also trigger the row's own onClick (which would open the project).
    event.stopPropagation();

    if (window.confirm('Delete this project? This cannot be undone.')) {
      onDelete(project.id);
    }
  };

  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={classNames(
          'w-full flex items-center gap-2.5 pl-3 pr-9 py-2 rounded-lg text-left',
          'bg-transparent hover:bg-purple-500/5 dark:hover:bg-white/[0.03]',
          'border border-transparent hover:border-bolt-elements-borderColor/50',
          'transition-all duration-150 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
        )}
      >
        <div
          className={classNames(
            'flex items-center justify-center w-9 h-9 rounded-full shrink-0 ring-1',
            colorClasses.bg,
            colorClasses.ring,
          )}
        >
          <span className="text-sm leading-none">{project.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[13px] font-medium text-bolt-elements-textPrimary truncate">{project.name}</div>
            <span className="text-[10px] text-bolt-elements-textTertiary shrink-0">
              {projectType.icon} {projectType.displayName}
            </span>
          </div>
          {project.description && (
            <div className="text-xs text-bolt-elements-textTertiary truncate">{project.description}</div>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={handleDeleteClick}
        aria-label={`Delete ${project.name}`}
        className={classNames(
          'absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md shrink-0',
          'text-bolt-elements-textTertiary hover:text-red-500 hover:bg-red-500/10',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
        )}
      >
        <span className="i-ph:trash w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export { COLOR_CLASSES as PROJECT_COLOR_CLASSES };
