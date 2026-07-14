import { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import {
  requestChatInputFocus,
  getRoadmapItemStatus,
  getProjectKnowledge,
  getTaskReview,
  hydrateWorkspaceState,
  updateProjectWorkspaceState,
} from '~/lib/stores/projects';
import { getProjectArtifacts } from '~/lib/stores/projects';
import type { Project } from '~/lib/stores/projects';
import { PROJECT_COLOR_CLASSES } from './ProjectListItem';
import { getProjectTypeDefinition } from '~/lib/project-types/projectTypeRegistry';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { blueprintEngine, type RoadmapItemStatus } from '~/lib/blueprints';
import { isRequirementsCaptured } from '~/lib/projects/knowledge';
import { projectKnowledgeEngine } from '~/lib/projects/projectKnowledgeEngine';
import { projectTaskEngine } from '~/lib/projects/taskEngine';
import { executionEngine } from '~/lib/projects/executionEngine';
import { reviewEngine } from '~/lib/projects/reviewEngine';
import { checkBuildersDbConnection } from '~/lib/builders-db/client';
import {
  ARTIFACT_TYPES,
  getLatestArtifact,
  formatArtifactTimestamp,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/Tabs';
import { ProjectRequirementsDialog } from './ProjectRequirementsDialog';
import { ProjectTaskCard } from './ProjectTaskCard';
import { TaskDetailsDialog } from './TaskDetailsDialog';
import { ReviewQueueCard } from './ReviewComponents';
import { RequirementsDraftPanel } from './RequirementsDraftPanel';
import { ArchitectureDraftPanel } from './ArchitectureDraftPanel';
import { DatabaseDraftPanel } from './DatabaseDraftPanel';
import { UiUxDraftPanel } from './UIUXDraftPanel';
import { BackendDraftPanel } from './BackendDraftPanel';
import { FrontendDraftPanel } from './FrontendDraftPanel';
import { QaDraftPanel } from './QADraftPanel';
import { DevOpsDraftPanel } from './DevOpsDraftPanel';
import { AiEngineeringTeamPanel } from './AIEngineeringTeamPanel';
import { ProjectManagerPanel } from './ProjectManagerPanel';
import { ProductPackagePanel } from './ProductPackagePanel';
import { ProjectHistoryPanel } from './ProjectHistoryPanel';
import { SharedProviderStatusCard } from './SharedProviderStatusCard';
import { GenerationProfileSelector } from './GenerationProfileSelector';
import { DEFAULT_GENERATION_PROFILE_ID, DEFAULT_GENERATION_PROFILES } from '~/lib/generation-profiles/defaultProfiles';
import { saveSelectedProfileForProject } from '~/lib/generation-profiles/generationProfileRepository';

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
 * One "Workspace" tile. Values are read straight off the Project object's
 * optional integration fields (githubRepo/supabaseProjectId/
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

/** Sprint 38.5 — one Overview status stat (Current Stage/Application Status/Last Build/Last Activity). Reads project.workspaceState fields directly; `tone` only ever highlights the one field (Application Status) where "generated" is meaningfully different from every other plain-text status. */
function StatusMiniCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success';
}) {
  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-3.5 bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
        {label}
      </div>
      <div
        className={classNames(
          'text-sm font-medium truncate',
          tone === 'success' ? 'text-green-600 dark:text-green-400' : 'text-bolt-elements-textPrimary',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Sprint 38.5 — a small connected/not-connected pill, same semantics as InfoCard's rows but condensed for the Overview status strip. */
function QuickStatusBadge({ icon, label, connected }: { icon: string; label: string; connected: boolean }) {
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border',
        connected
          ? 'border-green-500/30 text-green-600 dark:text-green-400 bg-green-500/5'
          : 'border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary',
      )}
    >
      <div className={classNames(icon, 'w-3 h-3')} />
      {label}: {connected ? 'Connected' : 'Not Connected'}
    </span>
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

interface ExecutionStatProps {
  label: string;
  value: number;
  valueClassName?: string;
}

/** One stat in the Execution Progress panel (Sprint 11, Task 7) — a count and its label. */
function ExecutionStat({ label, value, valueClassName }: ExecutionStatProps) {
  return (
    <div>
      <div className={classNames('text-lg font-semibold', valueClassName ?? 'text-bolt-elements-textPrimary')}>
        {value}
      </div>
      <div className="text-[11px] text-bolt-elements-textTertiary">{label}</div>
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

interface GroupHeadingProps {
  title: string;
  subtitle?: string;
  badge?: string;
}

/**
 * Sprint 25 — Dashboard Reorganization, reworked Sprint 30.5. Every top-level
 * section (Next Recommended Action, Engineering Journey, Engineering
 * Readiness, Generation Center, Workspace, Project Execution, Internal /
 * Developer) shares this heading style, one visual level above each existing
 * panel's own sub-heading (still the original `text-[13px] uppercase` style,
 * now on an <h3> instead of <h2> to reflect the new nesting). Presentation
 * only — no data, no behavior.
 */
function GroupHeading({ title, subtitle, badge }: GroupHeadingProps) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary">{title}</h2>
        {badge && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary">
            {badge}
          </span>
        )}
      </div>
      {subtitle && <p className="text-xs text-bolt-elements-textTertiary mt-1">{subtitle}</p>}
    </div>
  );
}

/** Small ↓ connector between Engineering Journey stages — purely decorative, visualizes the fixed Requirements → ... → DevOps order. */
function PipelineConnector() {
  return (
    <div className="flex justify-center py-1">
      <span className="i-ph:arrow-down w-4 h-4 text-bolt-elements-textTertiary/40" />
    </div>
  );
}

interface EngineeringStageSectionProps {
  title: string;
  artifact: ProjectArtifact | undefined;
  footnote: string;
  children: React.ReactNode;
  navSectionId?: string;
  sectionRef?: (el: HTMLElement | null) => void;

  /** Sprint 31.1 — when true, always renders full content, skipping the collapsed "Approved vN · Expand" summary entirely. Used only inside AiEngineeringTeamPanel's "View AI Decisions" — a section the user opens specifically to review real generated content, where a second layer of per-stage collapsing on top of that toggle reads as "nothing was generated" even though it was. Every other caller (Requirements) is unaffected — omitting this prop keeps today's collapse-on-approve behavior exactly as is. */
  alwaysExpanded?: boolean;
}

/**
 * Sprint 30.5 — Dashboard UX Refactor. Wraps one Engineering Journey stage
 * (Requirements/Architecture/Database/UI-UX/Backend/Frontend/QA/DevOps).
 * Reuses each stage's existing "*DraftPanel" component completely unchanged
 * (passed in as `children`) — this only decides whether to show it in full
 * or collapse it to a one-line "Approved" summary once its latest artifact
 * is approved, so approving a stage doesn't force scrolling past its full
 * detail to reach the next one. `artifact` is read the exact same way every
 * DraftPanel already reads it internally (getLatestArtifact over
 * getProjectArtifacts) — no new business logic, no store write, nothing
 * here ever approves/discards/generates anything itself.
 */
function EngineeringStageSection({
  title,
  artifact,
  footnote,
  children,
  navSectionId,
  sectionRef,
  alwaysExpanded,
}: EngineeringStageSectionProps) {
  const isApproved = artifact?.status === 'approved';
  const [isExpanded, setIsExpanded] = useState(alwaysExpanded ? true : !isApproved);

  // Re-sync only when the approval boolean itself flips (approve/discard/regenerate) — a user's manual expand/collapse choice is never overridden by an unrelated re-render.
  useEffect(() => {
    if (!alwaysExpanded) {
      setIsExpanded(!isApproved);
    }
  }, [isApproved, alwaysExpanded]);

  return (
    <div ref={sectionRef} data-nav-section={navSectionId}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">{title}</h3>
        {isApproved && !alwaysExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
            <span
              className={classNames(
                'i-ph:caret-down w-3 h-3 transition-transform duration-150',
                isExpanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </div>

      {isApproved && !isExpanded && !alwaysExpanded ? (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className={classNames(
            'w-full flex items-center justify-between gap-3 rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] px-5 py-3.5 text-left',
            'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md hover:border-green-500/30 transition-colors',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
            <span className="i-ph:check-circle-duotone w-4 h-4" />
            Approved
          </div>
          <div className="flex items-center gap-3 text-xs text-bolt-elements-textTertiary">
            <span>v{artifact?.version ?? 1}</span>
            {artifact && <span>{formatArtifactTimestamp(artifact.updatedAt)}</span>}
            <span className="text-purple-600 dark:text-purple-300 font-medium">Expand</span>
          </div>
        </button>
      ) : (
        <div
          className={classNames(
            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
            'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
          )}
        >
          {children}
        </div>
      )}

      <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">{footnote}</div>
    </div>
  );
}

/**
 * Sprint 38.5 — Dashboard Simplification. Five real tabs (converted from Sprint 30.5's
 * sticky-nav/scroll-to-anchor single-page layout) grouping the same underlying panels —
 * see the audit that drove this: Overview = at-a-glance status + next action; Engineering
 * = the 8 AI-role draft panels + readiness/reviews; Package = Product Package + generated
 * application status; Workspace = connections/config; History = generation timeline +
 * activity, reading BuildersDB's activity log for the first time (see
 * ProjectHistoryPanel.tsx — `getProjectActivity` had zero callers before this).
 */
const DASHBOARD_TABS = ['overview', 'engineering', 'package', 'workspace', 'history'] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number];

const DASHBOARD_TAB_LABELS: Record<DashboardTabId, string> = {
  overview: 'Overview',
  engineering: 'Engineering',
  package: 'Package',
  workspace: 'Workspace',
  history: 'History',
};

export function ProjectDashboard({ project, open, onClose }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const [isRequirementsDialogOpen, setIsRequirementsDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');

  const handleTabChange = (value: string) => {
    const tab = value as DashboardTabId;
    setActiveTab(tab);

    if (project) {
      updateProjectWorkspaceState(project.id, { lastSelectedTab: tab });
    }
  };

  /**
   * Sprint 38.5 — resume the tab the user was last on, and hydrate this project's
   * persisted workspace state (see workspaceState.ts) the moment the dashboard opens for
   * it. `hydrateWorkspaceState` is best-effort/fire-and-forget (BuildersDB-unavailable
   * environments simply never get past `project.workspaceState` staying undefined, which
   * every reader already treats as "nothing generated yet") — it never blocks opening
   * the dialog.
   */
  useEffect(() => {
    if (!open || !project) {
      return;
    }

    setActiveTab((project.workspaceState?.lastSelectedTab as DashboardTabId | undefined) ?? 'overview');
    hydrateWorkspaceState(project.id);
  }, [open, project?.id]);

  /*
   * Sprint 38.5 — `EngineeringStageSection` still accepts a `sectionRef`/`navSectionId`
   * pair from Sprint 30.5's scroll-to-anchor nav (harmless now that section content lives
   * inside Tabs instead of one long scroll container) — left as a no-op rather than
   * touched at each of its 8 call sites below, since removing the prop entirely would
   * mean editing every EngineeringStageSection usage for a purely cosmetic ref that no
   * longer does anything.
   */
  const registerSection = (_id: string) => () => undefined;

  /*
   * Sprint 25 — Dashboard Reorganization; verified live as of Sprint 38.3. Whether
   * BuildersDB (Builders' own control-plane persistence for Projects/Knowledge/
   * Artifacts/Tasks/Reviews — never the product being built's own database) is actually
   * reachable right now, not just "configured" — a set-but-wrong URL/key, an unreachable
   * network, or a misconfigured table would previously still have shown "Connected".
   * Re-checked every time the dashboard opens (a Supabase project can go from
   * unreachable to reachable, or back, between visits). Declared above the `!project`
   * guard below, alongside every other hook in this component — hooks can never follow a
   * conditional return.
   */
  const [isBuildersDbConnected, setIsBuildersDbConnected] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;

    checkBuildersDbConnection().then((connected) => {
      if (!cancelled) {
        setIsBuildersDbConnected(connected);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

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
   * Sprint 11 — Task Execution Plan. Task definitions (title/category/
   * dependencies/required knowledge/output type/estimate) always come from
   * projectTaskEngine, never a registry import. Status/progress/blocked
   * reasons/the recommended next task all come from executionEngine, which
   * resolves each task's status from its own manual lifecycle stage
   * (project.taskStatus) plus dependency completion — a different, more
   * granular signal than the Project Roadmap's roadmapStatus above.
   */
  const executionTasks = executionEngine.getExecutionTasks(project);
  const executionProgress = executionEngine.getExecutionProgress(project);

  const selectedTask = selectedTaskId ? (executionTasks.find((task) => task.id === selectedTaskId) ?? null) : null;

  /*
   * Sprint 12 — Review Queue. reviewSummary now feeds the Review Queue
   * card inside the Engineering Readiness section (Sprint 30.5 moved it
   * there from Task Execution Plan) — never recomputed, same reviewEngine
   * call as before.
   */
  const reviewSummary = reviewEngine.getReviewSummary(project);

  /*
   * Phase 2 Sprint 9 — Requirements & Knowledge. Read straight off the
   * project (getProjectKnowledge is a trivial accessor — see
   * app/lib/stores/projects.ts). No AI call, no generation; this is just
   * whatever the user has saved via the Requirements dialog.
   */
  const knowledge = getProjectKnowledge(project);
  const requirementsCaptured = isRequirementsCaptured(knowledge);

  /** Sprint 38.5 — persisted resume state (see workspaceState.ts), hydrated from BuildersDB when this dashboard opened (see hydrateWorkspaceState above). `undefined` until hydration resolves or BuildersDB is unavailable — every reader below already treats that as "nothing generated yet". */
  const workspaceState = project.workspaceState;

  /*
   * Sprint 30.5 — Engineering Journey collapse state. Each stage's latest
   * artifact is read the exact same way every "*DraftPanel" component
   * already reads it internally (getLatestArtifact over
   * getProjectArtifacts) — a pure, read-only lookup that drives nothing
   * more than EngineeringStageSection's collapse/expand default above.
   */
  const projectArtifacts = getProjectArtifacts(project);
  const requirementsArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.REQUIREMENTS_DRAFT);
  const architectureArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const databaseArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.DATABASE_DRAFT);
  const uiuxArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.UIUX_DRAFT);
  const backendArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.BACKEND_DRAFT);
  const frontendArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.FRONTEND_DRAFT);
  const qaArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.QA_DRAFT);
  const devopsArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.DEVOPS_DRAFT);

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
                  {/* SECTION 1 — Project Header */}
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
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary">
                            {project.name}
                          </RadixDialog.Title>
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 ring-1 ring-green-500/20">
                            <span className="i-ph:circle-duotone w-2.5 h-2.5 text-green-500" />
                            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">
                              Active Project
                            </span>
                          </span>
                          {/* Blueprint/template pill, reads the same `blueprint` value already computed above; no new logic. */}
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50">
                            <span className="text-sm leading-none">{blueprint.icon}</span>
                            <span className="text-[11px] font-medium text-bolt-elements-textTertiary">
                              {blueprint.name}
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

                  {/* Sprint 38.5 — Dashboard Simplification: real tabs replace Sprint 30.5's scroll-to-anchor nav. */}
                  <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <div className="sticky top-0 z-20 px-8 py-2 bg-bolt-elements-background-depth-1/95 backdrop-blur-md border-b border-bolt-elements-borderColor/40">
                      <TabsList className="!h-auto !bg-transparent !border-0 !p-0 !justify-start gap-1 overflow-x-auto">
                        {DASHBOARD_TABS.map((id) => (
                          <TabsTrigger
                            key={id}
                            value={id}
                            className="shrink-0 !rounded-full !px-2.5 !py-1 !text-[11px] !font-medium whitespace-nowrap data-[state=active]:!bg-purple-500/15 data-[state=active]:!text-purple-600 dark:data-[state=active]:!text-purple-300 !shadow-none"
                          >
                            {DASHBOARD_TAB_LABELS[id]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>

                    <div className="flex-1 px-8 py-6 space-y-10">
                      <TabsContent value="overview" className="!mt-0 space-y-10">
                        {/* SECTION 2 — Project Status (business-friendly summary; engineering detail collapsed inside, Sprint 44.1) */}
                        <section>
                          <GroupHeading
                            title="Project Status"
                            subtitle="How your AI engineering team is progressing on your product."
                          />
                          <div
                            className={classNames(
                              'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                              'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                            )}
                          >
                            <ProjectManagerPanel project={project} />
                          </div>
                        </section>

                        {/* Sprint 38.5 — Overview status strip: Status/Current Stage/Last Activity/Application Status, plus BuildersDB/GitHub/Deployment quick badges. Reads project.workspaceState (hydrated on open, see hydrateWorkspaceState above) — every field falls back to a "not generated yet" reading when unset, so a project that has never been generated shows exactly what it showed before this sprint. */}
                        <section className="pt-10 border-t border-bolt-elements-borderColor/40">
                          <GroupHeading
                            title="Status"
                            subtitle="Where this project's workspace actually is right now."
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <StatusMiniCard
                              label="Project Type"
                              value={`${getProjectTypeDefinition(project.projectType).icon} ${getProjectTypeDefinition(project.projectType).displayName}`}
                            />
                            <StatusMiniCard
                              label="Current Stage"
                              value={workspaceState?.currentStage ?? 'Not started'}
                            />
                            <StatusMiniCard
                              label="Application Status"
                              value={workspaceState?.generatedApplicationExists ? 'Generated' : 'Not Generated'}
                              tone={workspaceState?.generatedApplicationExists ? 'success' : 'neutral'}
                            />
                            <StatusMiniCard
                              label="Last Build"
                              value={
                                workspaceState?.lastGenerationTime
                                  ? formatArtifactTimestamp(workspaceState.lastGenerationTime)
                                  : 'Never'
                              }
                            />
                            <StatusMiniCard
                              label="Last Activity"
                              value={workspaceState?.lastActivity ?? 'No activity yet'}
                            />
                            <StatusMiniCard
                              label="Generation Profile"
                              value={
                                DEFAULT_GENERATION_PROFILES.find(
                                  (profile) =>
                                    profile.id ===
                                    (workspaceState?.selectedGenerationProfileId ?? DEFAULT_GENERATION_PROFILE_ID),
                                )?.name ?? 'Balanced'
                              }
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <QuickStatusBadge
                              icon="i-ph:cloud-duotone"
                              label="BuildersDB"
                              connected={isBuildersDbConnected}
                            />
                            <QuickStatusBadge
                              icon="i-ph:github-logo-duotone"
                              label="GitHub"
                              connected={Boolean(project.githubRepo)}
                            />
                            <QuickStatusBadge
                              icon="i-ph:rocket-launch-duotone"
                              label="Deployment"
                              connected={Boolean(project.deploymentTarget)}
                            />
                          </div>
                        </section>
                      </TabsContent>

                      <TabsContent value="engineering" className="!mt-0 space-y-10">
                        {/* SECTION 3 — Engineering Journey (the main workflow: Requirements -> ... -> DevOps) */}
                        <section className="pt-10 border-t border-bolt-elements-borderColor/40">
                          <GroupHeading
                            title="Engineering Journey"
                            subtitle="Requirements & Knowledge is the only manual stage. Once it's captured, the AI Engineering Team (Architecture → Database → UI/UX → Backend → Frontend → QA → DevOps) generates, reviews, and approves every stage automatically."
                          />
                          <div className="space-y-6">
                            {/* Requirements & Knowledge — Phase 2 Sprint 9, collapsible since Sprint 30.5 */}
                            <EngineeringStageSection
                              title="Requirements & Knowledge"
                              artifact={requirementsArtifact}
                              footnote="Requirements are stored locally for this project only — nothing here is sent to AI or generated automatically yet."
                              navSectionId="requirements"
                              sectionRef={registerSection('requirements')}
                            >
                              <div className="flex items-center justify-end gap-2 mb-4">
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
                                  </div>
                                  <div className="mt-4 w-full max-w-2xl mx-auto text-left">
                                    <RequirementsDraftPanel project={project} />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <RequirementsRow label="Project Vision" value={knowledge?.projectVision} />
                                    <RequirementsRow label="Target Users" value={knowledge?.targetUsers} />
                                    <RequirementsRow label="Core Features" value={knowledge?.coreFeatures} />
                                    <RequirementsRow label="Pages / Screens" value={knowledge?.pagesOrScreens} />
                                    <RequirementsRow label="Integrations" value={knowledge?.integrations} />
                                    <RequirementsRow
                                      label="Payments / Compliance"
                                      value={[
                                        ...(knowledge?.paymentNeeds ?? []),
                                        ...(knowledge?.complianceNeeds ?? []),
                                      ]}
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
                                  </div>
                                  <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
                                    <RequirementsDraftPanel project={project} />
                                  </div>
                                </>
                              )}
                            </EngineeringStageSection>

                            <PipelineConnector />

                            {/* AI Engineering Team — Sprint 31 (Autonomous AI Engineering Pipeline). Architecture through DevOps now generate, review, and approve themselves automatically once Requirements is captured; the per-stage panels below are unchanged, just moved behind "View AI Decisions". */}
                            <AiEngineeringTeamPanel
                              project={project}
                              requirementsCaptured={requirementsCaptured}
                              requirementsArtifact={requirementsArtifact}
                            >
                              {/* Architecture — Sprint 14 */}
                              <EngineeringStageSection
                                title="Architecture"
                                artifact={architectureArtifact}
                                footnote="The Architecture Draft is stored locally for this project only — approving it never updates Project Knowledge or generates a database, frontend, or backend."
                                navSectionId="architecture"
                                sectionRef={registerSection('architecture')}
                              >
                                <ArchitectureDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* Database Design — Sprint 15 */}
                              <EngineeringStageSection
                                title="Database Design"
                                artifact={databaseArtifact}
                                footnote="The Database Design Draft is stored locally for this project only — approving it never generates SQL, connects to Supabase, or creates a database."
                                navSectionId="database"
                                sectionRef={registerSection('database')}
                              >
                                <DatabaseDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* UI/UX Design — Sprint 16 */}
                              <EngineeringStageSection
                                title="UI / UX Design"
                                artifact={uiuxArtifact}
                                footnote="The UI/UX Draft is stored locally for this project only — approving it never generates HTML, CSS, Tailwind, React, Figma files, or images."
                                navSectionId="uiux"
                                sectionRef={registerSection('uiux')}
                              >
                                <UiUxDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* Backend Design — Sprint 19 */}
                              <EngineeringStageSection
                                title="Backend Design"
                                artifact={backendArtifact}
                                footnote="The Backend Draft is stored locally for this project only — approving it never generates backend code, SQL, Prisma/Drizzle/Supabase schemas, connects to GitHub, or deploys anything."
                                navSectionId="backend"
                                sectionRef={registerSection('backend')}
                              >
                                <BackendDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* Frontend Design — Sprint 20 */}
                              <EngineeringStageSection
                                title="Frontend Design"
                                artifact={frontendArtifact}
                                footnote="The Frontend Draft is stored locally for this project only — approving it never generates React, Next.js, Remix, Vue, Angular, Flutter, HTML, CSS, or Tailwind code."
                                navSectionId="frontend"
                                sectionRef={registerSection('frontend')}
                              >
                                <FrontendDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* QA Strategy — Sprint 21 */}
                              <EngineeringStageSection
                                title="QA Strategy"
                                artifact={qaArtifact}
                                footnote="The QA Draft is stored locally for this project only — approving it never generates test code, connects to GitHub, or deploys anything."
                                navSectionId="qa"
                                sectionRef={registerSection('qa')}
                              >
                                <QaDraftPanel project={project} />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/* DevOps Strategy — Sprint 22 */}
                              <EngineeringStageSection
                                title="DevOps Strategy"
                                artifact={devopsArtifact}
                                footnote="The DevOps Draft is stored locally for this project only — approving it never generates a Dockerfile, GitHub Actions workflow, Kubernetes manifest, Terraform configuration, or shell script, and never deploys or provisions anything."
                                navSectionId="devops"
                                sectionRef={registerSection('devops')}
                              >
                                <DevOpsDraftPanel project={project} />
                              </EngineeringStageSection>
                            </AiEngineeringTeamPanel>
                          </div>
                        </section>

                        {/* SECTION 4 — Engineering Readiness (after every engineering draft above) */}
                        <section className="pt-10 border-t border-bolt-elements-borderColor/40">
                          <GroupHeading
                            title="Engineering Readiness"
                            subtitle="The review queue, now that every engineering stage above is visible."
                          />
                          <div className="space-y-8">
                            <div>
                              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                                Review Summary
                              </h3>
                              <ReviewQueueCard summary={reviewSummary} />
                              <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                                Pending task reviews across the Task Execution Plan in the Workspace tab — approving or
                                rejecting a review still happens from each task's own details.
                              </div>
                            </div>
                          </div>
                        </section>
                      </TabsContent>

                      <TabsContent value="package" className="!mt-0 space-y-10">
                        {/* SECTION 4.5 — Product Package (Sprint 37: assembles every approved/latest-draft AI role output into a structured, previewable package) */}
                        <section
                          className="pt-10 border-t border-bolt-elements-borderColor/40"
                          ref={registerSection('package')}
                          data-nav-section="package"
                        >
                          <GroupHeading
                            title="Product Package"
                            subtitle="Assembles every approved (or latest draft) AI role output into a structured set of Markdown files, then can generate a real React app from it into the Preview tab."
                          />
                          <ProductPackagePanel project={project} />
                        </section>
                      </TabsContent>

                      <TabsContent value="workspace" className="!mt-0 space-y-10">
                        {/* SECTION 6 — Workspace (connections + project configuration) */}
                        <section
                          className="pt-10 border-t border-bolt-elements-borderColor/40"
                          ref={registerSection('workspace')}
                          data-nav-section="workspace"
                        >
                          <GroupHeading title="Workspace" subtitle="Connections and configuration for this project." />
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
                              icon="i-ph:cloud-duotone"
                              label="BuildersDB"
                              rows={[
                                {
                                  label: 'Status',
                                  value: isBuildersDbConnected ? 'Connected' : 'Local Only',
                                },
                                {
                                  label: 'Provider',
                                  value: isBuildersDbConnected ? 'Supabase' : 'Browser Storage',
                                },
                              ]}
                            />
                            <InfoCard
                              icon="i-ph:database-duotone"
                              label="Customer Supabase"
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
                              label="Team Members"
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
                            <InfoCard
                              icon="i-ph:waveform-duotone"
                              label="Preview Status"
                              rows={[
                                {
                                  label: 'Status',
                                  value: workspaceState?.previewAvailable
                                    ? 'Available'
                                    : (workspaceState?.lastPreviewStatus ?? 'Not Available'),
                                },
                              ]}
                            />
                            <InfoCard
                              icon="i-ph:clock-clockwise-duotone"
                              label="Last Build"
                              rows={[
                                {
                                  label: 'When',
                                  value: workspaceState?.lastGenerationTime
                                    ? formatArtifactTimestamp(workspaceState.lastGenerationTime)
                                    : 'Never',
                                },
                              ]}
                            />
                            {/* Sprint 39 — Code Reviewer/Repair Engineer/Build Validator status, read from the same workspaceState the other Workspace cards already use. */}
                            <InfoCard
                              icon="i-ph:wrench-duotone"
                              label="Self-Healing"
                              rows={[
                                {
                                  label: 'Status',
                                  value:
                                    workspaceState?.lastRepairStatus === 'succeeded'
                                      ? 'Repaired'
                                      : workspaceState?.lastRepairStatus === 'failed'
                                        ? 'Needs Attention'
                                        : workspaceState?.lastRepairStatus === 'repairing'
                                          ? 'Repairing…'
                                          : 'Not Needed',
                                },
                                { label: 'Attempts', value: String(workspaceState?.repairAttempts ?? 0) },
                              ]}
                            />
                          </div>

                          {/* Sprint 39.5 — small Generation Profile card, same footprint as the Self-Healing card above. Changing it here only affects future AI Engineering Team generations for this project — Quick Chat's own model dropdown is untouched. */}
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div
                              className={classNames(
                                'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
                                'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                              )}
                            >
                              <div className="flex items-center gap-2.5 mb-3">
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
                                  <div className="i-ph:sliders-horizontal-duotone w-4 h-4 text-purple-600/80 dark:text-purple-400/80" />
                                </div>
                                <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">
                                  Generation Profile
                                </div>
                              </div>
                              <GenerationProfileSelector
                                value={workspaceState?.selectedGenerationProfileId ?? DEFAULT_GENERATION_PROFILE_ID}
                                onChange={(profileId) => saveSelectedProfileForProject(project.id, profileId)}
                              />
                            </div>
                          </div>

                          {/* Sprint 38.5 — Shared AI Provider status, reads /api/shared-key-status (see SharedProviderStatusCard.tsx) — booleans only, never a key value. */}
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <SharedProviderStatusCard />
                          </div>

                          {/* Blueprint Overview */}
                          {blueprint && (
                            <div className="mt-6">
                              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                                Blueprint Overview
                              </h3>
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
                        </section>

                        {/* SECTION 7 — Project Execution (Roadmap, Progress, Tasks, Quick Actions) */}
                        <section
                          className="pt-10 border-t border-bolt-elements-borderColor/40"
                          ref={registerSection('execution')}
                          data-nav-section="execution"
                        >
                          <GroupHeading
                            title="Project Execution"
                            subtitle="Roadmap, task breakdown, and quick actions."
                          />
                          <div className="space-y-8">
                            {/* Project Roadmap — Sprint 8 */}
                            <div>
                              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                                Project Roadmap
                              </h3>
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
                                  <ProjectProgressCard
                                    completed={completedRoadmapCount}
                                    total={roadmapWithStatus.length}
                                  />
                                </div>
                              </div>

                              <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                                Roadmap status is stored locally for this project only — nothing here is generated,
                                connected, or deployed automatically.
                              </div>
                            </div>

                            {/* Task Execution Plan — Sprint 11 (Review Queue moved to Engineering Readiness, Sprint 30.5) */}
                            <div>
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary">
                                  Task Execution Plan
                                </h3>
                                <span className="text-[11px] font-medium text-bolt-elements-textTertiary">
                                  {executionProgress.percentComplete}% complete
                                </span>
                              </div>

                              <div
                                className={classNames(
                                  'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 mb-4',
                                  'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                                  'grid grid-cols-3 sm:grid-cols-6 gap-4',
                                )}
                              >
                                <ExecutionStat label="Tasks" value={executionProgress.total} />
                                <ExecutionStat
                                  label="Completed"
                                  value={executionProgress.completed}
                                  valueClassName="text-green-600 dark:text-green-400"
                                />
                                <ExecutionStat
                                  label="In Review"
                                  value={executionProgress.needsReview}
                                  valueClassName="text-purple-600 dark:text-purple-400"
                                />
                                <ExecutionStat
                                  label="In Progress"
                                  value={executionProgress.inProgress}
                                  valueClassName="text-amber-600 dark:text-amber-400"
                                />
                                <ExecutionStat
                                  label="Ready"
                                  value={executionProgress.ready}
                                  valueClassName="text-blue-600 dark:text-blue-400"
                                />
                                <ExecutionStat
                                  label="Blocked"
                                  value={executionProgress.blocked}
                                  valueClassName="text-red-600 dark:text-red-400"
                                />
                              </div>

                              {executionTasks.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {executionTasks.map((task) => (
                                    <ProjectTaskCard
                                      key={task.id}
                                      projectId={project.id}
                                      task={task}
                                      dependencyTitles={projectTaskEngine
                                        .getDependencies(project.blueprintId, task.id)
                                        .map((dependency) => dependency.title)}
                                      blockedBy={executionEngine.getBlockedReason(project, task.id)}
                                      latestReview={getTaskReview(project, task.id)}
                                      onOpenDetails={() => setSelectedTaskId(task.id)}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-bolt-elements-textTertiary">
                                  No tasks defined for this blueprint yet
                                </div>
                              )}

                              <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                                Task status is stored locally for this project only — nothing here is generated by AI
                                yet. This is the execution model future AI generation will use. Completed tasks reflect
                                an approved review — see Review Summary in the Engineering tab.
                              </div>
                            </div>
                          </div>
                        </section>
                      </TabsContent>

                      <TabsContent value="history" className="!mt-0 space-y-10">
                        {/* Sprint 38.5 — History tab: reads real BuildersDB activity (getProjectActivity had zero callers anywhere in the app before this — see ProjectHistoryPanel.tsx) alongside the generation timeline, newest first. */}
                        <ProjectHistoryPanel project={project} />
                      </TabsContent>
                    </div>
                  </Tabs>

                  <div className="px-8 py-6 space-y-10">
                    {/* SECTION 9 — Recent Chats */}
                    <div
                      className="pt-10 border-t border-bolt-elements-borderColor/40"
                      ref={registerSection('chats')}
                      data-nav-section="chats"
                    >
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

      <TaskDetailsDialog
        project={project}
        task={selectedTask}
        dependencyTitles={
          selectedTask
            ? projectTaskEngine.getDependencies(project.blueprintId, selectedTask.id).map((d) => d.title)
            : []
        }
        nextTaskTitles={
          selectedTask ? projectTaskEngine.getNextTasks(project.blueprintId, selectedTask.id).map((t) => t.title) : []
        }
        blockedBy={selectedTask ? executionEngine.getBlockedReason(project, selectedTask.id) : []}
        open={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
      />
    </>
  );
}
