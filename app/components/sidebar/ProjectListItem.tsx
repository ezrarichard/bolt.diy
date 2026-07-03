import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';

interface ProjectListItemProps {
  project: Project;
  onClick: () => void;
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
};

export function ProjectListItem({ project, onClick }: ProjectListItemProps) {
  const colorClasses = COLOR_CLASSES[project.color] || COLOR_CLASSES.purple;

  return (
    <button
      onClick={onClick}
      className={classNames(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left',
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
        <span className="text-base leading-none">{project.icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-bolt-elements-textPrimary truncate">{project.name}</div>
        {project.description && (
          <div className="text-xs text-bolt-elements-textTertiary truncate">{project.description}</div>
        )}
      </div>
      <div className="i-ph:caret-right w-4 h-4 text-bolt-elements-textTertiary shrink-0" />
    </button>
  );
}

export { COLOR_CLASSES as PROJECT_COLOR_CLASSES };
