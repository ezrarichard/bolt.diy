import type { ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { blueprintEngine } from '~/lib/blueprints';
import {
  currentProjectIdStore,
  isProjectDashboardOpenStore,
  projectsStore,
  requestNewProjectDialog,
  type Project,
} from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from '~/components/sidebar/ProjectListItem';

/**
 * Sprint 24 — Builders Home Experience Refresh.
 *
 * Two entry points into the same existing product, rendered on the home
 * screen above the (unchanged) prompt box:
 *
 *   Quick Build          -> focuses the existing prompt textarea, nothing else.
 *   Guided Engineering   -> opens the existing New Project dialog via
 *                           requestNewProjectDialog() (~/lib/stores/projects),
 *                           which ProjectList.tsx (sidebar) already renders.
 *
 * Neither card generates anything, calls an LLM, or creates fake data —
 * both just point at flows that already exist. The optional "Continue a
 * Project" list below reads `projectsStore` (already the single source of
 * truth for the sidebar's project list) and opens the Project Dashboard via
 * the same two store writes Menu.client.tsx's handleSelectProject and
 * CurrentProjectBadge.tsx's click handler already use — no new dashboard-
 * opening logic.
 */

const GUIDED_PIPELINE = [
  'Requirements',
  'Architecture',
  'Database',
  'UI/UX',
  'Backend',
  'Frontend',
  'QA',
  'DevOps',
  'Project Manager',
];

const RECENT_PROJECTS_LIMIT = 4;

/** Identical to Menu.client.tsx's handleSelectProject / CurrentProjectBadge's click handler — reused here, not reimplemented. */
function openProjectDashboard(projectId: string) {
  currentProjectIdStore.set(projectId);
  isProjectDashboardOpenStore.set(true);
}

interface WorkflowCardProps {
  icon: string;
  title: string;
  subtitle: string;
  cta: string;
  onClick: () => void;
  children?: ReactNode;
}

function WorkflowCard({ icon, title, subtitle, cta, onClick, children }: WorkflowCardProps) {
  return (
    <div
      className={classNames(
        'flex flex-col rounded-2xl border border-bolt-elements-borderColor/50 p-5 text-left',
        'bg-bolt-elements-background-depth-2/60 backdrop-blur-md',
        'hover:border-purple-500/30 transition-colors duration-200',
      )}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className={classNames(icon, 'w-4 h-4 text-purple-600/80 dark:text-purple-400/80')} />
        </div>
        <div className="text-sm font-semibold text-bolt-elements-textPrimary">{title}</div>
      </div>
      <p className="text-xs text-bolt-elements-textTertiary mb-4">{subtitle}</p>
      {children}
      <button
        type="button"
        onClick={onClick}
        className="mt-auto inline-flex items-center justify-center gap-1.5 self-start px-3.5 py-2 rounded-lg text-xs font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors"
      >
        {cta}
        <span className="i-ph:arrow-right w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface RecentProjectCardProps {
  project: Project;
}

function RecentProjectCard({ project }: RecentProjectCardProps) {
  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;
  const blueprint = project.blueprintId ? blueprintEngine.getBlueprint(project.blueprintId) : undefined;

  return (
    <button
      type="button"
      onClick={() => openProjectDashboard(project.id)}
      className={classNames(
        'flex items-center gap-3 rounded-xl border border-bolt-elements-borderColor/40 px-3.5 py-2.5 text-left',
        'bg-bolt-elements-background-depth-2/60 hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-3/60',
        'transition-colors duration-200',
      )}
    >
      <span
        className={classNames(
          'flex items-center justify-center w-7 h-7 rounded-full ring-1 shrink-0',
          colorClasses.bg,
          colorClasses.ring,
        )}
      >
        <span className="text-xs leading-none">{project.icon}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-bolt-elements-textPrimary truncate">{project.name}</span>
        {blueprint && (
          <span className="block text-[11px] text-bolt-elements-textTertiary truncate">{blueprint.name}</span>
        )}
      </span>
    </button>
  );
}

interface HomeWorkflowsProps {
  onFocusPrompt: () => void;
}

export function HomeWorkflows({ onFocusPrompt }: HomeWorkflowsProps) {
  const projects = useStore(projectsStore);
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_PROJECTS_LIMIT);

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WorkflowCard
          icon="i-ph:lightning-duotone"
          title="Quick Build"
          subtitle="Generate immediately from a prompt."
          cta="Start typing"
          onClick={onFocusPrompt}
        />
        <WorkflowCard
          icon="i-ph:flow-arrow-duotone"
          title="Guided Engineering"
          subtitle="Engineer your product before generating code."
          cta="Start Engineering"
          onClick={requestNewProjectDialog}
        >
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 mb-4 text-[10px] text-bolt-elements-textTertiary">
            {GUIDED_PIPELINE.map((step, index) => (
              <span key={step} className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 rounded-full border border-bolt-elements-borderColor/50">{step}</span>
                {index < GUIDED_PIPELINE.length - 1 && <span className="i-ph:arrow-right w-2.5 h-2.5" />}
              </span>
            ))}
          </div>
        </WorkflowCard>
      </div>

      {recentProjects.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2.5 px-1">
            Continue a Project
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {recentProjects.map((project) => (
              <RecentProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
