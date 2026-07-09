import { classNames } from '~/utils/classNames';
import { useActiveProjectContext } from '~/lib/projects/useActiveProjectContext';
import { isProjectDashboardOpenStore } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from '~/components/sidebar/ProjectListItem';
import { getProjectTypeDefinition } from '~/lib/project-types/projectTypeRegistry';

/**
 * Small, subtle pill shown above the chat prompt box when a project is
 * active (see useActiveProjectContext). Renders nothing when no project is
 * active, so global/no-project chat looks exactly like it did before this
 * sprint. Clicking it reopens the Project Dashboard for the active project.
 */
export function CurrentProjectBadge() {
  const context = useActiveProjectContext();

  if (!context) {
    return null;
  }

  const colorClasses = PROJECT_COLOR_CLASSES[context.project.color] || PROJECT_COLOR_CLASSES.purple;
  const projectType = getProjectTypeDefinition(context.project.projectType);

  return (
    <button
      type="button"
      onClick={() => isProjectDashboardOpenStore.set(true)}
      title="Open Project Dashboard"
      className={classNames(
        'group flex items-center gap-2 self-start max-w-full px-3 py-1.5 rounded-full',
        'bg-bolt-elements-background-depth-2/70 backdrop-blur-md',
        'border border-bolt-elements-borderColor/50',
        'hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-3/70',
        'transition-all duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
      )}
    >
      <span className="flex items-center gap-1 shrink-0">
        <span className="i-ph:circle-duotone w-2 h-2 text-green-500" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">
          Active Project
        </span>
      </span>
      <span className="w-px h-3 bg-bolt-elements-borderColor/60 shrink-0" />
      <span
        className={classNames(
          'flex items-center justify-center w-5 h-5 rounded-full ring-1 shrink-0',
          colorClasses.bg,
          colorClasses.ring,
        )}
      >
        <span className="text-[11px] leading-none">{context.project.icon}</span>
      </span>
      <span className="text-xs font-medium text-bolt-elements-textPrimary truncate max-w-[160px]">
        {context.project.name}
      </span>
      <span className="text-xs text-bolt-elements-textTertiary shrink-0">·</span>
      <span className="text-xs text-bolt-elements-textTertiary truncate max-w-[160px] group-hover:text-purple-500/80 transition-colors">
        {projectType.icon} {projectType.displayName}
      </span>
    </button>
  );
}
