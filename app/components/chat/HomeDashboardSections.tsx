import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import {
  currentProjectIdStore,
  isProjectDashboardOpenStore,
  projectsStore,
  touchProjectLastOpened,
  type Project,
} from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from '~/components/sidebar/ProjectListItem';
import { getProjectTypeDefinition } from '~/lib/project-types/projectTypeRegistry';
import { DEFAULT_GENERATION_PROFILES, DEFAULT_GENERATION_PROFILE_ID } from '~/lib/generation-profiles/defaultProfiles';
import { projectManagerEngine } from '~/lib/projects/projectManagerEngine';
import { getProjectActivity, isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { ACTIVITY_ICON, DEFAULT_ACTIVITY_ICON } from '~/components/sidebar/ProjectHistoryPanel';

/**
 * Sprint 39.8 — Builders Home Dashboard Experience.
 *
 * Everything below reads `projectsStore` (and, for the activity feed, the existing
 * `getProjectActivity` BuildersDB function — already called by ProjectHistoryPanel.tsx)
 * directly, the same pattern Sprint 39.7's `ContinueProjectSection` used. No new
 * persistence, no engineering-pipeline changes: every stat/stage/status here is derived
 * from data another sprint already produces (`Project.workspaceState`,
 * `projectManagerEngine.analyzeProject`, `DEFAULT_GENERATION_PROFILES`,
 * `builders_project_activity`).
 *
 * Rendered by BaseChat.tsx as a flat ordered list of independent sections — each one
 * renders `null` when it has nothing to show, and none of them assume they're first.
 * That's deliberate: a future "Pinned Project" section only needs to be added before
 * `ContinueWorkingSection` in that list, no other section needs to change.
 */

/**
 * Landing Redesign — anchor ids for the hero's quick access cards. BaseChat.tsx puts these on
 * the wrappers around the sections below, so "My Projects" / "Recent Activity" scroll to real
 * content on this page instead of navigating somewhere that doesn't exist.
 */
export const HOME_PROJECTS_ANCHOR_ID = 'home-projects';
export const HOME_ACTIVITY_ANCHOR_ID = 'home-activity';

const CONTINUE_WORKING_LIMIT = 3;
const RECENT_PROJECTS_LIMIT = 6;
const ACTIVITY_PROJECT_SCAN_LIMIT = 5;
const ACTIVITY_ENTRY_LIMIT = 8;

function lastTouchedIso(project: Project): string {
  return project.workspaceState?.lastGenerationTime ?? project.createdAt;
}

/** Most-recently-active first; projects nothing has happened to yet fall back to creation time. */
function sortByRecency(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => new Date(lastTouchedIso(b)).getTime() - new Date(lastTouchedIso(a)).getTime());
}

/** No existing relative-time formatter in the codebase — formatArtifactTimestamp (artifacts.ts) is absolute-only. */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return '';
  }

  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'Just now';
  }

  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m ago`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h ago`;
  }

  if (diffMs < 2 * day) {
    return 'Yesterday';
  }

  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d ago`;
  }

  return new Date(iso).toLocaleDateString();
}

const GENERATION_STAGE_LABELS: Record<string, string> = {
  planning: 'Planning',
  'writing-files': 'Writing Files',
  installing: 'Installing',
  'launching-preview': 'Launching Preview',
  complete: 'Completed',
};

/** See the plan's "Current stage / status derivation" — reuses projectManagerEngine.analyzeProject (Sprint 23) rather than re-deriving engineering-pipeline stage logic. */
function getCurrentStageLabel(project: Project): string {
  const workspaceState = project.workspaceState;

  if (workspaceState?.lastRepairStatus === 'repairing') {
    return 'Repairing';
  }

  if (workspaceState?.currentStage && GENERATION_STAGE_LABELS[workspaceState.currentStage]) {
    return GENERATION_STAGE_LABELS[workspaceState.currentStage];
  }

  if (project.projectType === 'guided_engineering') {
    const health = projectManagerEngine.analyzeProject(project);
    const stages = [
      health.requirementsStatus,
      health.architectureStatus,
      health.databaseStatus,
      health.uiuxStatus,
      health.backendStatus,
      health.frontendStatus,
      health.qaStatus,
      health.devopsStatus,
    ];
    const current = stages.find((stage) => stage.status !== 'approved');

    return current ? current.label : 'Ready for Generation';
  }

  return 'Getting Started';
}

type ApplicationStatusTone = 'neutral' | 'progress' | 'success' | 'warning';

const STATUS_TONE_CLASSES: Record<ApplicationStatusTone, string> = {
  neutral: 'bg-bolt-elements-textTertiary/60',
  progress: 'bg-blue-500',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
};

/** The states from the spec, mapped from workspaceState.lastGenerationStatus (plus Sprint 98C's 'cancelled'). */
function getApplicationStatusMeta(project: Project): { label: string; tone: ApplicationStatusTone } {
  const status = project.workspaceState?.lastGenerationStatus;

  if (status === 'generating') {
    return { label: 'Generating', tone: 'progress' };
  }

  if (status === 'generated') {
    return { label: 'Generated', tone: 'success' };
  }

  if (status === 'failed') {
    return { label: 'Needs Repair', tone: 'warning' };
  }

  // Sprint 98C, DEF-1 — a stopped run reads as neutral, not as a failure and not as never-started.
  if (status === 'cancelled') {
    return { label: 'Stopped', tone: 'neutral' };
  }

  return { label: 'Not Generated', tone: 'neutral' };
}

function getGenerationProfileName(project: Project): string {
  const id = project.workspaceState?.selectedGenerationProfileId ?? DEFAULT_GENERATION_PROFILE_ID;
  return DEFAULT_GENERATION_PROFILES.find((profile) => profile.id === id)?.name ?? 'Balanced';
}

/**
 * A quick_build project only has somewhere useful to go once its chat is linked (see
 * useChatHistory.ts's linkProjectChat call). Until then, opening the (guided-engineering-
 * oriented) Project Dashboard for it is confusing/empty rather than helpful — cards for
 * such a project render as a disabled, clearly-labeled state instead (see
 * ContinueWorkingCard/RecentProjectCard below) rather than silently doing nothing useful.
 */
function canOpenProject(project: Project): boolean {
  return project.projectType !== 'quick_build' || Boolean(project.linkedChatId);
}

/**
 * Sprint 39.7's existing quick_build-vs-guided_engineering branch (Menu.client.tsx /
 * HomeWorkflows.tsx) — reused verbatim, not reimplemented. Exported for the hero's
 * "Open Recent Project" link so that link and these cards open a project the same way.
 */
export function openProject(project: Project, navigate: ReturnType<typeof useNavigate>) {
  currentProjectIdStore.set(project.id);
  touchProjectLastOpened(project.id);

  if (project.projectType === 'quick_build' && project.linkedChatId) {
    navigate(`/chat/${project.linkedChatId}`);
    return;
  }

  isProjectDashboardOpenStore.set(true);
}

/**
 * Landing Redesign — the project the hero's "Open Recent Project" link should open: the
 * most-recently-touched project that actually has somewhere to go (see `canOpenProject`).
 * Undefined when there is none, which is how the hero knows to hide that link entirely.
 */
export function getMostRecentOpenableProject(projects: Project[]): Project | undefined {
  return sortByRecency(projects).find(canOpenProject);
}

// ── Section: Continue Working ────────────────────────────────────────────

function ContinueWorkingCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;
  const projectType = getProjectTypeDefinition(project.projectType);
  const status = getApplicationStatusMeta(project);
  const openable = canOpenProject(project);
  const ctaLabel = !openable
    ? 'Chat Unavailable'
    : project.projectType === 'quick_build'
      ? 'Open Legacy Quick Build'
      : 'Continue Project';
  const handleActivate = () => {
    if (openable) {
      openProject(project, navigate);
    }
  };

  return (
    <div
      role="button"
      tabIndex={openable ? 0 : -1}
      aria-disabled={!openable}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate();
        }
      }}
      className={classNames(
        'group flex flex-col gap-3 rounded-2xl border border-bolt-elements-borderColor/40 p-5 text-left',
        'bg-bolt-elements-background-depth-2/60 backdrop-blur-md shadow-sm',
        openable
          ? 'cursor-pointer hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-3/60 hover:shadow-md'
          : 'cursor-not-allowed opacity-60',
        'transition-all duration-200',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={classNames(
            'flex items-center justify-center w-10 h-10 rounded-full ring-1 shrink-0',
            colorClasses.bg,
            colorClasses.ring,
          )}
        >
          <span className="text-base leading-none">{project.icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary truncate">{project.name}</div>
          <div className="text-[11px] text-bolt-elements-textTertiary">
            {projectType.icon} {projectType.displayName}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20">
          {getCurrentStageLabel(project)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-bolt-elements-background-depth-3/80 border border-bolt-elements-borderColor/40 text-bolt-elements-textSecondary">
          <span className={classNames('w-1.5 h-1.5 rounded-full', STATUS_TONE_CLASSES[status.tone])} />
          {status.label}
        </span>
      </div>

      <div className="text-[11px] text-bolt-elements-textTertiary space-y-0.5">
        <div className="truncate">
          {project.workspaceState?.lastActivity ?? 'No activity yet'} · {formatRelativeTime(lastTouchedIso(project))}
        </div>
        <div>Profile: {getGenerationProfileName(project)}</div>
      </div>

      <div className="mt-auto pt-1">
        <span
          className={classNames(
            'inline-flex items-center gap-1.5 text-xs font-medium transition-all',
            openable ? 'text-purple-600 dark:text-purple-300 group-hover:gap-2' : 'text-bolt-elements-textTertiary',
          )}
        >
          {ctaLabel}
          <span className={classNames(openable ? 'i-ph:arrow-right' : 'i-ph:warning-duotone', 'w-3.5 h-3.5')} />
        </span>
      </div>
    </div>
  );
}

export function ContinueWorkingSection() {
  const projects = useStore(projectsStore);
  const continueWorking = useMemo(() => sortByRecency(projects).slice(0, CONTINUE_WORKING_LIMIT), [projects]);

  if (continueWorking.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 lg:px-0 py-8">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-3 px-1">
        Continue Working
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {continueWorking.map((project) => (
          <ContinueWorkingCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}

// ── Section: Quick Stats ─────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 bg-bolt-elements-background-depth-2/60 backdrop-blur-md shadow-sm px-4 py-3">
      <div className="text-xl font-semibold text-bolt-elements-textPrimary">{value}</div>
      <div className="text-[11px] text-bolt-elements-textTertiary mt-0.5">{label}</div>
    </div>
  );
}

export function BuildersStatsSection() {
  const projects = useStore(projectsStore);

  if (projects.length === 0) {
    return null;
  }

  /*
   * Phase 1 (Software Factory) — Quick Build is frozen and excluded from factory
   * statistics: the standalone "Quick Builds" stat card was removed and the former
   * "Guided Engineering" count is now the flagship "Software Factory Projects" metric.
   */
  const stats = [
    { label: 'Projects', value: projects.length },
    {
      label: 'Software Factory Projects',
      value: projects.filter((project) => project.projectType === 'guided_engineering').length,
    },
    {
      label: 'Applications Generated',
      value: projects.filter((project) => project.workspaceState?.generatedApplicationExists).length,
    },
    {
      label: 'Repairs Completed',
      value: projects.filter((project) => project.workspaceState?.lastRepairStatus === 'succeeded').length,
    },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto px-4 lg:px-0 pb-8">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>
    </div>
  );
}

// ── Section: Recent Projects ─────────────────────────────────────────────

function RecentProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const colorClasses = PROJECT_COLOR_CLASSES[project.color] || PROJECT_COLOR_CLASSES.purple;
  const projectType = getProjectTypeDefinition(project.projectType);
  const status = getApplicationStatusMeta(project);
  const openable = canOpenProject(project);

  return (
    <button
      type="button"
      disabled={!openable}
      title={openable ? undefined : 'This Quick Build project has no linked chat yet.'}
      onClick={() => openable && openProject(project, navigate)}
      className={classNames(
        'flex items-center gap-3 rounded-xl border border-bolt-elements-borderColor/40 px-4 py-3 text-left',
        'bg-bolt-elements-background-depth-2/60 backdrop-blur-md shadow-sm',
        openable
          ? 'hover:border-purple-500/30 hover:bg-bolt-elements-background-depth-3/60 hover:shadow-md'
          : 'opacity-60 cursor-not-allowed',
        'transition-all duration-200',
      )}
    >
      <span
        className={classNames(
          'flex items-center justify-center w-9 h-9 rounded-full ring-1 shrink-0',
          colorClasses.bg,
          colorClasses.ring,
        )}
      >
        <span className="text-sm leading-none">{project.icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-bolt-elements-textPrimary truncate">{project.name}</span>
          <span className={classNames('w-1.5 h-1.5 rounded-full shrink-0', STATUS_TONE_CLASSES[status.tone])} />
        </span>
        <span className="block text-[11px] text-bolt-elements-textTertiary truncate">
          {projectType.icon} {projectType.displayName} · {getCurrentStageLabel(project)}
        </span>
        <span className="block text-[10px] text-bolt-elements-textTertiary/80 truncate">
          {formatRelativeTime(lastTouchedIso(project))}
        </span>
      </span>
    </button>
  );
}

export function RecentProjectsSection() {
  const projects = useStore(projectsStore);
  const recent = useMemo(() => {
    const sorted = sortByRecency(projects);
    return sorted.slice(CONTINUE_WORKING_LIMIT, CONTINUE_WORKING_LIMIT + RECENT_PROJECTS_LIMIT);
  }, [projects]);

  if (recent.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 lg:px-0 py-8">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-3 px-1">
        Recent Projects
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {recent.map((project) => (
          <RecentProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}

// ── Section: Builders Activity ───────────────────────────────────────────

interface ActivityEntry {
  activityType: string;
  description: string;
  createdAt: string;
  projectName: string;
}

function activityDateGroup(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays <= 0) {
    return 'Today';
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupActivityByDay(entries: ActivityEntry[]): [string, ActivityEntry[]][] {
  const groups = new Map<string, ActivityEntry[]>();

  for (const entry of entries) {
    const key = activityDateGroup(entry.createdAt);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return Array.from(groups.entries());
}

/** Fetches getProjectActivity (buildersDbRepository.ts, already used by ProjectHistoryPanel.tsx) for the few most-recently-touched projects only — bounded, not a scan of every project. */
export function BuildersActivitySection() {
  const projects = useStore(projectsStore);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const scanProjects = useMemo(() => sortByRecency(projects).slice(0, ACTIVITY_PROJECT_SCAN_LIMIT), [projects]);

  useEffect(() => {
    if (!isBuildersDbAvailable() || scanProjects.length === 0) {
      setEntries([]);
      return undefined;
    }

    let cancelled = false;

    Promise.all(
      scanProjects.map((project) =>
        getProjectActivity(project.id).then((activity) =>
          activity.map((entry) => ({ ...entry, projectName: project.name })),
        ),
      ),
    ).then((perProject) => {
      if (cancelled) {
        return;
      }

      const merged = perProject
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, ACTIVITY_ENTRY_LIMIT);

      setEntries(merged);
    });

    return () => {
      cancelled = true;
    };
  }, [scanProjects]);

  if (entries === null) {
    return null;
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 lg:px-0 py-8">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-3 px-1">
        My Activity
      </div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-bolt-elements-borderColor/40 bg-bolt-elements-background-depth-2/60 backdrop-blur-md px-4 py-6 text-center text-xs text-bolt-elements-textTertiary">
          No recent activity yet — it appears here once you generate, review, or repair something.
        </div>
      ) : (
        <div className="rounded-xl border border-bolt-elements-borderColor/40 bg-bolt-elements-background-depth-2/60 backdrop-blur-md shadow-sm divide-y divide-bolt-elements-borderColor/20">
          {groupActivityByDay(entries).map(([group, items]) => (
            <div key={group} className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
                {group}
              </div>
              <div className="space-y-2.5">
                {items.map((entry, index) => (
                  <div key={`${entry.createdAt}-${index}`} className="flex items-start gap-2.5">
                    <div
                      className={classNames(
                        ACTIVITY_ICON[entry.activityType] ?? DEFAULT_ACTIVITY_ICON,
                        'w-3.5 h-3.5 mt-0.5 shrink-0',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-bolt-elements-textPrimary truncate">{entry.description}</div>
                      <div className="text-[10px] text-bolt-elements-textTertiary">
                        {entry.projectName} · {formatRelativeTime(entry.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section: Coming Soon ─────────────────────────────────────────────────

const COMING_SOON_ITEMS: { icon: string; label: string }[] = [
  { icon: 'i-ph:folder-simple-plus-duotone', label: 'Import Existing Project' },
  { icon: 'i-ph:package-duotone', label: 'Start from Template' },
  { icon: 'i-ph:storefront-duotone', label: 'Marketplace' },
  { icon: 'i-ph:cursor-click-duotone', label: 'Browser Use' },
];

export function ComingSoonStrip() {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 lg:px-0 py-8">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-3 px-1">
        Coming to Builders
      </div>
      <div className="flex flex-wrap gap-2">
        {COMING_SOON_ITEMS.map((item) => (
          <div
            key={item.label}
            className={classNames(
              'flex items-center gap-2 rounded-full border border-bolt-elements-borderColor/40 px-3.5 py-2',
              'bg-bolt-elements-background-depth-2/40 backdrop-blur-md text-bolt-elements-textTertiary',
            )}
          >
            <span className={classNames(item.icon, 'w-3.5 h-3.5')} />
            <span className="text-xs">{item.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bolt-elements-background-depth-3/80 border border-bolt-elements-borderColor/40">
              Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
