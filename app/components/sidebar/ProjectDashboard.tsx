import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { requestChatInputFocus, getRoadmapItemStatus, getProjectKnowledge } from '~/lib/stores/projects';
import type { Project } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { blueprintEngine, type RoadmapItemStatus } from '~/lib/blueprints';
import { isRequirementsCaptured } from '~/lib/projects/knowledge';
import {
  projectKnowledgeEngine,
  type KnowledgeFieldKey,
  type ReadinessStageStatus,
} from '~/lib/projects/projectKnowledgeEngine';
import { projectTaskEngine, type ProjectTaskStatus, type ProjectTaskWithStatus } from '~/lib/projects/taskEngine';
import { ProjectRequirementsDialog } from './ProjectRequirementsDialog';

interface ProjectDashboardProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

interface InfoCardProps {
  icon: string;
  label: string;
  rows: { label: string; value: string }[];
}

/**
 * One "Workspace Overview" tile. Values are read straight off the Project
 * object's optional integration fields (githubRepo/supabaseProjectId/
 * deploymentTarget/etc.) — all unset for every project today, so every
 * status honestly reads "Not Connected" rather than faking a connection.
 * The moment a future sprint wires real GitHub/Supabase/Vercel data into
 * those fields, these cards start reflecting reality with no markup changes.
 */
function InfoCard({ icon, label, rows }: InfoCardProps) {
  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'hover:border-purple-500/25 dark:hover:border-purple-500/20 transition-colors duration-200',
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className={classNames(icon, 'w-4 h-4 text-purple-600/80 dark:text-purple-400/80')} />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">{label}</div>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span className="text-bolt-elements-textTertiary">{row.label}</span>
            <span className="text-bolt-elements-textSecondary font-medium truncate max-w-[60%]">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: string;
  label: string;
  fullWidth?: boolean;
}

// All Project Actions/Quick Actions are placeholders — "No functionality yet" per spec.
function ActionButton({ icon, label, fullWidth }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className={classNames(
        'flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium',
        'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50',
        'text-bolt-elements-textTertiary cursor-not-allowed opacity-60',
        fullWidth ? 'w-full justify-start' : '',
      )}
    >
      <div className={classNames(icon, 'w-4 h-4 shrink-0')} />
      {label}
    </button>
  );
}

/**
 * Sprint 8 — status metadata for roadmap items and the "Future status
 * badge" mentioned in the spec. Purely presentational; the status itself
 * always comes from getRoadmapItemStatus(project, item.key), which defaults
 * to "not-started" until a future sprint wires up a way to change it.
 */
const ROADMAP_STATUS_META: Record<RoadmapItemStatus, { label: string; dotClass: string; badgeClass: string }> = {
  'not-started': {
    label: 'Not Started',
    dotClass: 'bg-bolt-elements-textTertiary/50',
    badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
  'in-progress': {
    label: 'In Progress',
    dotClass: 'bg-amber-500',
    badgeClass: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30',
  },
  blocked: {
    label: 'Blocked',
    dotClass: 'bg-red-500',
    badgeClass: 'text-red-600 dark:text-red-400 border-red-500/30',
  },
};

interface RoadmapItemCardProps {
  title: string;
  description: string;
  status: RoadmapItemStatus;
}

/** One Project Roadmap step — status dot, title, description, status badge, hover effect. */
function RoadmapItemCard({ title, description, status }: RoadmapItemCardProps) {
  const meta = ROADMAP_STATUS_META[status];

  return (
    <div
      className={classNames(
        'flex items-start gap-3 rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'hover:border-purple-500/25 dark:hover:border-purple-500/20 transition-colors duration-200',
      )}
    >
      <span className={classNames('mt-1.5 w-2.5 h-2.5 rounded-full shrink-0', meta.dotClass)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-bolt-elements-textPrimary">{title}</div>
        <div className="text-xs text-bolt-elements-textTertiary mt-0.5">{description}</div>
      </div>
      <span
        className={classNames(
          'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
          meta.badgeClass,
        )}
      >
        {meta.label}
      </span>
    </div>
  );
}

/**
 * Phase 3 — status metadata for the Task Execution Plan. Purely
 * presentational; the status itself always comes from
 * projectTaskEngine.getTasksWithStatus(project), computed from the same
 * project.roadmapStatus data the Project Roadmap section reads — no
 * separate/manual task status is ever stored.
 */
const TASK_STATUS_META: Record<ProjectTaskStatus, { label: string; dotClass: string; badgeClass: string }> = {
  ready: {
    label: 'Ready',
    dotClass: 'bg-blue-500',
    badgeClass: 'text-blue-600 dark:text-blue-400 border-blue-500/30',
  },
  blocked: {
    label: 'Blocked',
    dotClass: 'bg-red-500',
    badgeClass: 'text-red-600 dark:text-red-400 border-red-500/30',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30',
  },
  future: {
    label: 'Future',
    dotClass: 'bg-bolt-elements-textTertiary/50',
    badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
};

function formatEstimatedMinutes(minutes: number | undefined): string {
  if (!minutes) {
    return 'Not estimated';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

interface TaskCardProps {
  task: ProjectTaskWithStatus;
  dependencyTitles: string[];
}

/** One Task Execution Plan card — title, category, dependencies, required knowledge, output type, estimate, computed status. */
function TaskCard({ task, dependencyTitles }: TaskCardProps) {
  const meta = TASK_STATUS_META[task.status];

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        'hover:border-purple-500/25 dark:hover:border-purple-500/20 transition-colors duration-200',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={classNames('w-2 h-2 rounded-full shrink-0', meta.dotClass)} />
          <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{task.title}</span>
        </div>
        <span
          className={classNames(
            'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
            meta.badgeClass,
          )}
        >
          {meta.label}
        </span>
      </div>

      <div className="text-xs text-bolt-elements-textTertiary mb-3">{task.description}</div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <div>
          <span className="text-bolt-elements-textTertiary">Category: </span>
          <span className="text-bolt-elements-textSecondary capitalize">{task.category}</span>
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Output: </span>
          <span className="text-bolt-elements-textSecondary">{task.outputType}</span>
        </div>
        <div className="col-span-2">
          <span className="text-bolt-elements-textTertiary">Estimated: </span>
          <span className="text-bolt-elements-textSecondary">{formatEstimatedMinutes(task.estimatedMinutes)}</span>
        </div>
        <div className="col-span-2">
          <span className="text-bolt-elements-textTertiary">Dependencies: </span>
          <span className="text-bolt-elements-textSecondary">
            {dependencyTitles.length > 0 ? dependencyTitles.join(', ') : 'None'}
          </span>
        </div>
        {task.requiredKnowledge.length > 0 && (
          <div className="col-span-2 flex flex-wrap gap-1.5 mt-1">
            {task.requiredKnowledge.map((key) => (
              <span
                key={key}
                className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-300"
              >
                {projectKnowledgeEngine.getFieldLabel(key as KnowledgeFieldKey)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface RequirementsRowProps {
  label: string;
  value?: string | string[];
}

/** One field in the captured Requirements & Knowledge summary — falls back to "Not set". */
function RequirementsRow({ label, value }: RequirementsRowProps) {
  const display = Array.isArray(value) ? value.filter(Boolean).join(', ') : value;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {label}
      </div>
      <div className="text-sm text-bolt-elements-textSecondary">
        {display && display.length > 0 ? display : <span className="text-bolt-elements-textTertiary">Not set</span>}
      </div>
    </div>
  );
}

/**
 * Sprint 10 — status meta for the Project Readiness panel (Task 5). Purely
 * presentational; status/percent always come from
 * projectKnowledgeEngine.getReadiness(project).
 */
const READINESS_STATUS_META: Record<
  ReadinessStageStatus,
  { icon: string; className: string; label: (percent?: number) => string }
> = {
  'not-started': {
    icon: 'i-ph:circle-dashed',
    className: 'text-bolt-elements-textTertiary',
    label: () => 'Not Started',
  },
  'in-progress': {
    icon: 'i-ph:circle-half-duotone',
    className: 'text-amber-600 dark:text-amber-400',
    label: (percent) => `${percent ?? 0}%`,
  },
  completed: {
    icon: 'i-ph:check-circle-duotone',
    className: 'text-green-600 dark:text-green-400',
    label: () => 'Completed',
  },
};

interface ReadinessRowProps {
  label: string;
  status: ReadinessStageStatus;
  percent?: number;
}

/** One row in the Project Readiness panel — icon, label, and status/percent. */
function ReadinessRow({ label, status, percent }: ReadinessRowProps) {
  const meta = READINESS_STATUS_META[status];

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={classNames(meta.icon, 'w-4 h-4 shrink-0', meta.className)} />
        <span className="text-sm text-bolt-elements-textSecondary">{label}</span>
      </div>
      <span className={classNames('text-xs font-medium', meta.className)}>{meta.label(percent)}</span>
    </div>
  );
}

interface ProjectProgressCardProps {
  completed: number;
  total: number;
}

/** Progress card — computed only from local roadmap status, per spec. */
function ProjectProgressCard({ completed, total }: ProjectProgressCardProps) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className="i-ph:gauge-duotone w-4 h-4 text-purple-600/80 dark:text-purple-400/80" />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Project Progress</div>
      </div>
      <div className="h-2 w-full rounded-full bg-bolt-elements-background-depth-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="text-xs text-bolt-elements-textTertiary mt-2">
        {completed} / {total} Completed
      </div>
    </div>
  );
}

export function ProjectDashboard({ project, open, onClose }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const [isRequirementsDialogOpen, setIsRequirementsDialogOpen] = useState(false);

  if (!project) {
    return null;
  }

  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;

  /**
   * Sprint 6 — "Start Chat" from the Project Dashboard.
   *
   * Closes the dashboard, keeps the project active (currentProjectIdStore
   * is untouched here — it was already set when the dashboard was opened),
   * client-side navigates to the homepage if we're not already there, and
   * asks the chat textarea to focus itself. No route is created, no
   * message is sent, and no chat persistence is touched — this only moves
   * the user's attention to the existing chat input.
   */
  const handleStartChat = () => {
    onClose();

    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      navigate('/');
    }

    requestChatInputFocus();
  };

  /*
   * Fall back to the Blank Project blueprint (always present in the registry)
   * when the project has no blueprintId, or one that no longer matches a
   * registry entry — satisfies "if no blueprint is found, show Blank Project"
   * while still rendering full structured data rather than a bare string.
   * All blueprint data is read through blueprintEngine, never the registry
   * directly (see app/lib/blueprints/engine.ts).
   */
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();

  /*
   * Sprint 8 — Project Roadmap. Static step content (key/title/description)
   * always comes from blueprintEngine.getRoadmap(), never hardcoded here or
   * read from the registry directly. Per-item status is resolved from the
   * project's own local-only roadmapStatus map (defaults to "not-started").
   * Progress is calculated purely from that local status, per spec.
   */
  const roadmap = blueprintEngine.getRoadmap(blueprint.id);
  const roadmapWithStatus = roadmap.map((item) => ({
    ...item,
    status: getRoadmapItemStatus(project, item.key),
  }));
  const completedRoadmapCount = roadmapWithStatus.filter((item) => item.status === 'completed').length;

  /*
   * Phase 3 — Task Execution Plan. Task definitions (title/category/
   * dependencies/required knowledge/output type/estimate) always come from
   * projectTaskEngine, never a registry import. Status is computed purely
   * from the same project.roadmapStatus data the Project Roadmap section
   * above reads — no separate task-status field exists on Project.
   */
  const tasksWithStatus = projectTaskEngine.getTasksWithStatus(project);
  const taskCompletion = projectTaskEngine.getCompletion(project);

  /*
   * Phase 2 Sprint 9 — Requirements & Knowledge. Read straight off the
   * project (getProjectKnowledge is a trivial accessor — see
   * app/lib/stores/projects.ts). No AI call, no generation; this is just
   * whatever the user has saved via the Requirements dialog.
   */
  const knowledge = getProjectKnowledge(project);
  const requirementsCaptured = isRequirementsCaptured(knowledge);

  /*
   * Sprint 10 — Project Readiness. The high-level, at-a-glance progress
   * indicator across the whole project lifecycle. Requirements/Roadmap are
   * computed from real local data via projectKnowledgeEngine; the remaining
   * stages (Design/Database/Frontend/Backend/Deployment) have no data
   * source yet in this sprint and always read "Not Started" until a future
   * sprint wires real signals into them.
   */
  const readiness = projectKnowledgeEngine.getReadiness(project);

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <RadixDialog.Portal>
          <div className="fixed inset-0 flex items-center justify-center z-[100] modern-scrollbar">
            <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

            <RadixDialog.Content aria-describedby={undefined} onEscapeKeyDown={onClose} className="relative z-[101]">
              <div
                className={classNames(
                  'w-[1100px] max-w-[92vw] h-[90vh]',
                  'bg-bolt-elements-background-depth-1',
                  'rounded-2xl shadow-2xl',
                  'border border-bolt-elements-borderColor',
                  'flex flex-col overflow-hidden relative',
                  'transform transition-all duration-200 ease-out',
                  open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
                )}
              >
                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                  <BackgroundRays />
                </div>

                <div className="relative z-10 flex flex-col h-full overflow-y-auto">
                  {/* Header */}
                  <div className="flex items-start justify-between px-8 py-6 border-b border-bolt-elements-borderColor/60">
                    <div className="flex items-center gap-4">
                      <div
                        className={classNames(
                          'flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 ring-1',
                          colorClasses.bg,
                          colorClasses.ring,
                        )}
                      >
                        <span className="text-2xl leading-none">{project.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2.5">
                          <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary">
                            {project.name}
                          </RadixDialog.Title>
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 ring-1 ring-green-500/20">
                            <span className="i-ph:circle-duotone w-2.5 h-2.5 text-green-500" />
                            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
                              Active Project
                            </span>
                          </span>
                        </div>
                        {project.description && (
                          <div className="text-sm text-bolt-elements-textTertiary mt-1">{project.description}</div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={onClose}
                      className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200"
                    >
                      <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                    </button>
                  </div>

                  <div className="flex-1 px-8 py-6 space-y-8">
                    {/* Workspace Overview */}
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Workspace Overview
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <InfoCard
                          icon="i-ph:github-logo-duotone"
                          label="GitHub"
                          rows={[
                            { label: 'Status', value: project.githubRepo ? 'Connected' : 'Not Connected' },
                            { label: 'Repository', value: project.githubRepo || 'Not linked yet' },
                          ]}
                        />
                        <InfoCard
                          icon="i-ph:database-duotone"
                          label="Supabase"
                          rows={[
                            { label: 'Status', value: project.supabaseProjectId ? 'Connected' : 'Not Connected' },
                            { label: 'Project', value: project.supabaseProjectId || 'Not linked yet' },
                          ]}
                        />
                        <InfoCard
                          icon="i-ph:rocket-launch-duotone"
                          label="Deployment"
                          rows={[
                            { label: 'Status', value: project.deploymentTarget ? 'Connected' : 'Not Connected' },
                            { label: 'Target', value: project.deploymentTarget || 'Not set' },
                          ]}
                        />
                        <InfoCard
                          icon="i-ph:flask-duotone"
                          label="Environment"
                          rows={[{ label: 'Current', value: 'Development' }]}
                        />
                        <InfoCard
                          icon="i-ph:users-duotone"
                          label="Members"
                          rows={[
                            {
                              label: 'Total',
                              value: `${project.members?.length || 1} Member${(project.members?.length || 1) === 1 ? '' : 's'}`,
                            },
                          ]}
                        />
                        <InfoCard
                          icon="i-ph:stack-duotone"
                          label="Templates"
                          rows={[{ label: 'Active', value: blueprint?.name || 'Blank Project' }]}
                        />
                      </div>
                    </div>

                    {/* Project Readiness — Sprint 10 */}
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Project Readiness
                      </h2>
                      <div
                        className={classNames(
                          'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                          'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                          'grid grid-cols-1 sm:grid-cols-2 gap-x-8 divide-y divide-bolt-elements-borderColor/20 sm:divide-y-0',
                        )}
                      >
                        {readiness.map((stage) => (
                          <ReadinessRow
                            key={stage.id}
                            label={stage.label}
                            status={stage.status}
                            percent={stage.percent}
                          />
                        ))}
                      </div>
                      <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                        Readiness is computed locally from Requirements and Roadmap progress — Design, Database,
                        Frontend, Backend, and Deployment become available in future sprints.
                      </div>
                    </div>

                    {/* Blueprint Overview */}
                    {blueprint && (
                      <div>
                        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                          Blueprint Overview
                        </h2>
                        <div
                          className={classNames(
                            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                            'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                          )}
                        >
                          <div className="flex items-start gap-3 mb-4">
                            <span className="text-2xl leading-none shrink-0">{blueprint.icon}</span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                                {blueprint.name}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 font-medium">
                                  {blueprintEngine.getBlueprintCategory(blueprint.id)}
                                </span>
                                {blueprintEngine.getBlueprintProductType(blueprint.id) && (
                                  <span className="text-xs text-bolt-elements-textTertiary">
                                    {blueprintEngine.getBlueprintProductType(blueprint.id)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                                Recommended Stack
                              </div>
                              {blueprintEngine.getRecommendedStack(blueprint.id).length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {blueprintEngine.getRecommendedStack(blueprint.id).map((item) => (
                                    <span
                                      key={item}
                                      className="text-xs px-2 py-1 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 text-bolt-elements-textSecondary"
                                    >
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-bolt-elements-textTertiary">No suggestions yet</div>
                              )}
                            </div>

                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                                Recommended Integrations
                              </div>
                              {blueprintEngine.getRecommendedIntegrations(blueprint.id).length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {blueprintEngine.getRecommendedIntegrations(blueprint.id).map((item) => (
                                    <span
                                      key={item}
                                      className="text-xs px-2 py-1 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 text-bolt-elements-textSecondary"
                                    >
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-bolt-elements-textTertiary">No suggestions yet</div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-bolt-elements-borderColor/30 text-[11px] text-bolt-elements-textTertiary">
                            These are recommendations only — nothing here is applied, generated, or connected
                            automatically.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Requirements & Knowledge — Phase 2 Sprint 9 */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
                          Requirements & Knowledge
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-bolt-elements-textTertiary">
                            {projectKnowledgeEngine.getCompletion(knowledge).overall}% complete
                          </span>
                          <span
                            className={classNames(
                              'text-[11px] font-medium px-2 py-0.5 rounded-full border',
                              requirementsCaptured
                                ? 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10'
                                : 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
                            )}
                          >
                            {requirementsCaptured ? 'Requirements captured' : 'Requirements missing'}
                          </span>
                        </div>
                      </div>

                      {!requirementsCaptured ? (
                        <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                          <span className="i-ph:clipboard-text-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                          <div className="text-sm font-medium text-bolt-elements-textSecondary">
                            No requirements captured yet.
                          </div>
                          <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[360px]">
                            Start by defining what this product should do.
                          </div>
                          <div className="flex flex-wrap justify-center gap-3 mt-4">
                            <button
                              type="button"
                              onClick={() => setIsRequirementsDialogOpen(true)}
                              className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
                            >
                              <span className="inline-block i-ph:plus-circle h-4 w-4" />
                              <span className="text-sm font-medium">Add Requirements</span>
                            </button>
                            <ActionButton icon="i-ph:sparkle" label="Generate Draft Requirements" />
                          </div>
                        </div>
                      ) : (
                        <div
                          className={classNames(
                            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                            'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                          )}
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <RequirementsRow label="Project Vision" value={knowledge?.projectVision} />
                            <RequirementsRow label="Target Users" value={knowledge?.targetUsers} />
                            <RequirementsRow label="Core Features" value={knowledge?.coreFeatures} />
                            <RequirementsRow label="Pages / Screens" value={knowledge?.pagesOrScreens} />
                            <RequirementsRow label="Integrations" value={knowledge?.integrations} />
                            <RequirementsRow
                              label="Payments / Compliance"
                              value={[...(knowledge?.paymentNeeds ?? []), ...(knowledge?.complianceNeeds ?? [])]}
                            />
                            <RequirementsRow
                              label="Languages / Region"
                              value={[
                                ...(knowledge?.languages ?? []),
                                ...(knowledge?.location ? [knowledge.location] : []),
                              ]}
                            />
                          </div>

                          <div className="mt-5 pt-4 border-t border-bolt-elements-borderColor/30 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => setIsRequirementsDialogOpen(true)}
                              className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
                            >
                              <span className="inline-block i-ph:pencil-simple h-4 w-4" />
                              <span className="text-sm font-medium">Edit Requirements</span>
                            </button>
                            <ActionButton icon="i-ph:sparkle" label="Generate Draft Requirements" />
                          </div>
                        </div>
                      )}

                      <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                        Requirements are stored locally for this project only — nothing here is sent to AI or generated
                        automatically yet.
                      </div>
                    </div>

                    {/* Project Roadmap — Sprint 8 */}
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Project Roadmap
                      </h2>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="lg:col-span-2 space-y-3">
                          {roadmapWithStatus.length > 0 ? (
                            roadmapWithStatus.map((item) => (
                              <RoadmapItemCard
                                key={item.key}
                                title={item.title}
                                description={item.description}
                                status={item.status}
                              />
                            ))
                          ) : (
                            <div className="text-xs text-bolt-elements-textTertiary">
                              No roadmap for this blueprint yet
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <ProjectProgressCard completed={completedRoadmapCount} total={roadmapWithStatus.length} />

                          <div
                            className={classNames(
                              'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
                              'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                            )}
                          >
                            <div className="text-[13px] font-semibold text-bolt-elements-textPrimary mb-3">
                              Quick Actions
                            </div>
                            <div className="flex flex-col gap-2">
                              <ActionButton icon="i-ph:play-circle" label="Continue Building" fullWidth />
                              <ActionButton icon="i-ph:clipboard-text" label="Generate Requirements" fullWidth />
                              <ActionButton icon="i-ph:layout" label="Generate UI" fullWidth />
                              <ActionButton icon="i-ph:database" label="Generate Database" fullWidth />
                              <ActionButton icon="i-ph:github-logo" label="Connect GitHub" fullWidth />
                              <ActionButton icon="i-ph:database-duotone" label="Connect Supabase" fullWidth />
                              <ActionButton icon="i-ph:rocket-launch" label="Deploy" fullWidth />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                        Roadmap status is stored locally for this project only — nothing here is generated, connected,
                        or deployed automatically.
                      </div>
                    </div>

                    {/* Task Execution Plan — Phase 3 */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
                          Task Execution Plan
                        </h2>
                        <span className="text-[11px] font-medium text-bolt-elements-textTertiary">
                          {taskCompletion.completedCount} / {taskCompletion.totalCount} Completed (
                          {taskCompletion.overall}%)
                        </span>
                      </div>

                      {tasksWithStatus.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {tasksWithStatus.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              dependencyTitles={projectTaskEngine
                                .getDependencies(project.blueprintId, task.id)
                                .map((dependency) => dependency.title)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-bolt-elements-textTertiary">
                          No tasks defined for this blueprint yet
                        </div>
                      )}

                      <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                        Status is computed from Project Roadmap progress — nothing here is generated by AI yet. This is
                        the execution model future AI generation will use.
                      </div>
                    </div>

                    {/* Recent Chats */}
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Recent Chats
                      </h2>
                      <div className="flex flex-col items-center justify-center text-center py-14 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                        <span className="i-ph:chats-circle-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                        <div className="text-sm font-medium text-bolt-elements-textSecondary">
                          No chats in this project yet.
                        </div>
                        <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[320px]">
                          Start a conversation and it will automatically belong to this project.
                        </div>
                        <button
                          type="button"
                          onClick={handleStartChat}
                          className="mt-4 flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
                        >
                          <span className="inline-block i-ph:plus-circle h-4 w-4" />
                          <span className="text-sm font-medium">Start Chat</span>
                        </button>
                      </div>
                    </div>

                    {/* Project Actions */}
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                        Project Actions
                      </h2>
                      <div className="flex flex-wrap gap-3">
                        <ActionButton icon="i-ph:github-logo" label="Open GitHub" />
                        <ActionButton icon="i-ph:database" label="Open Supabase" />
                        <ActionButton icon="i-ph:rocket-launch" label="Deploy" />
                        <ActionButton icon="i-ph:sliders-horizontal-duotone" label="Project Settings" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </RadixDialog.Content>
          </div>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <ProjectRequirementsDialog
        project={project}
        open={isRequirementsDialogOpen}
        onClose={() => setIsRequirementsDialogOpen(false)}
      />
    </>
  );
}
