import { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import {
  requestChatInputFocus,
  getRoadmapItemStatus,
  getProjectKnowledge,
  getTaskReview,
  hydrateProjectData,
  hydrateWorkspaceState,
  updateProjectWorkspaceState,
} from '~/lib/stores/projects';
import { getProjectArtifacts } from '~/lib/stores/projects';
import { shouldHydrateProjectData } from '~/lib/projects/hydration';
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
import { useDiscoveryIntelligence } from '~/lib/hooks/useDiscoveryIntelligence';
import { useBlueprintRecommendation } from '~/lib/hooks/useBlueprintRecommendation';
import { BusinessDiscoveryCard } from './BusinessDiscoveryCard';
import { BlueprintRecommendationCard } from './BlueprintRecommendationCard';
import { ProjectWorkflowBar, type WorkflowStage, type WorkflowStageStatus } from './ProjectWorkflowBar';
import {
  ARTIFACT_TYPES,
  getLatestArtifact,
  formatArtifactTimestamp,
  type ProjectArtifact,
} from '~/lib/projects/artifacts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/Tabs';
import { ProjectRequirementsDialog } from './ProjectRequirementsDialog';
import { InterviewChatDialog } from './InterviewChatDialog';
import { ProjectDocumentImportDialog } from './ProjectDocumentImportDialog';
import { ProjectTaskCard } from './ProjectTaskCard';
import { TaskDetailsDialog } from './TaskDetailsDialog';
import { ReviewQueueCard } from './ReviewComponents';
import { RequirementsDraftPanel } from './RequirementsDraftPanel';
import { ProductOwnerDraftPanel } from './ProductOwnerDraftPanel';
import { ArchitectureDraftPanel } from './ArchitectureDraftPanel';
import { DatabaseDraftPanel } from './DatabaseDraftPanel';
import { UiUxDraftPanel } from './UIUXDraftPanel';
import { BackendDraftPanel } from './BackendDraftPanel';
import { FrontendDraftPanel } from './FrontendDraftPanel';
import { QaDraftPanel } from './QADraftPanel';
import { DevOpsDraftPanel } from './DevOpsDraftPanel';
import { AiEngineeringTeamPanel } from './AIEngineeringTeamPanel';
import { ProjectDefinitionWorkspace } from './ProjectDefinitionWorkspace';
import { isProjectDefinitionApproved, isAutoEngineeringComplete } from '~/lib/projects/autoEngineeringEngine';
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

  /** Sprint UX-2 — Phosphor icon class for a small accent chip beside the title, matching the workflow bar's per-stage icon so each tab's section heading visually echoes its node. Omitted for secondary headings within a tab (e.g. "Engineering Readiness"). */
  icon?: string;
}

/**
 * Sprint 25 — Dashboard Reorganization, reworked Sprint 30.5, restyled Sprint UX-2. Every
 * top-level section shares this heading style, one visual level above each existing panel's
 * own sub-heading. Sprint UX-2 adds an optional icon chip and a touch more breathing room
 * (mb-5 -> mb-7, subtitle capped to a readable line length) — presentation only, no data, no
 * behavior.
 */
function GroupHeading({ title, subtitle, badge, icon }: GroupHeadingProps) {
  return (
    <div className="mb-7">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
            <span className={classNames(icon, 'w-4 h-4 text-purple-600 dark:text-purple-300')} />
          </span>
        )}
        <h2 className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary">{title}</h2>
        {badge && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary">
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <p
          className={classNames(
            'text-[13px] text-bolt-elements-textTertiary mt-1.5 leading-relaxed max-w-[640px]',
            icon && 'ml-[42px]',
          )}
        >
          {subtitle}
        </p>
      )}
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
 * Product Experience Sprint — Dashboard Workflow Shell. Replaces Sprint 38.5's role-oriented
 * tabs (Overview/Engineering/Package/Workspace/History) with tabs organized around the
 * customer's actual journey through Builders: Business Discovery -> Business Understanding ->
 * Blueprint -> Business Analysis -> Product Ownership -> Engineering -> Generate & Deploy. Each
 * tab is a new container around existing, unchanged panels — see the render below for exactly
 * which "*Card"/"*Panel"/"*Workspace" component moved into which tab. Workspace and History
 * remain as their own tabs (connections/config and the activity timeline aren't part of the
 * customer's product journey, but are still needed).
 */
const DASHBOARD_TABS = ['business', 'blueprint', 'plan', 'engineering', 'application', 'workspace', 'history'] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number];

const DASHBOARD_TAB_LABELS: Record<DashboardTabId, string> = {
  business: 'Business',
  blueprint: 'Blueprint',
  plan: 'Plan',
  engineering: 'Engineering',
  application: 'Application',
  workspace: 'Workspace',
  history: 'History',
};

type WorkflowStageId = 'business' | 'blueprint' | 'plan' | 'engineering' | 'application';

const WORKFLOW_STAGE_ORDER: WorkflowStageId[] = ['business', 'blueprint', 'plan', 'engineering', 'application'];

const WORKFLOW_STAGE_LABELS: Record<WorkflowStageId, string> = {
  business: 'Business',
  blueprint: 'Blueprint',
  plan: 'MVP',
  engineering: 'Engineering',
  application: 'Application',
};

/** Sprint UX-2 — one meaningful Phosphor icon per journey stage, shown inside each workflow bar node. */
const WORKFLOW_STAGE_ICONS: Record<WorkflowStageId, string> = {
  business: 'i-ph:briefcase-duotone',
  blueprint: 'i-ph:stack-duotone',
  plan: 'i-ph:clipboard-text-duotone',
  engineering: 'i-ph:code-duotone',
  application: 'i-ph:rocket-launch-duotone',
};

/** Sprint UX-2 — one-line, business-friendly description per stage, shown in the workflow bar's tooltip and (on wide screens) under the label. */
const WORKFLOW_STAGE_DESCRIPTIONS: Record<WorkflowStageId, string> = {
  business: 'Tell us about your business',
  blueprint: 'Pick your product’s starting shape',
  plan: 'Approve your Business Analysis & MVP',
  engineering: 'Your AI team builds it automatically',
  application: 'Generate, package & deploy',
};

export function ProjectDashboard({ project, open, onClose }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const [isRequirementsDialogOpen, setIsRequirementsDialogOpen] = useState(false);

  /** Sprint 56 — Interview Mode Foundation. Sibling to `isRequirementsDialogOpen`, same open/onClose/onSaved contract (UX spec §10: switching between modes should feel like changing the view of one thing, not switching products). */
  const [isInterviewDialogOpen, setIsInterviewDialogOpen] = useState(false);

  /** Sprint 58 — Business Knowledge Completion (Document Discovery). Third sibling to `isRequirementsDialogOpen`/`isInterviewDialogOpen`, same contract. */
  const [isDocumentImportDialogOpen, setIsDocumentImportDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTabId>('business');

  /** Sprint 54.1 — bumped once `ProjectRequirementsDialog`'s save settles, re-triggering `useDiscoveryIntelligence`'s fetch below. Not persisted, not read anywhere else — purely a "fetch again" trigger. */
  const [discoveryRefreshKey, setDiscoveryRefreshKey] = useState(0);

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

    setActiveTab((project.workspaceState?.lastSelectedTab as DashboardTabId | undefined) ?? 'business');
    hydrateWorkspaceState(project.id);

    /*
     * Sprint 46 — Quick Build has its own restore path (workspaceResumeOrchestrator.ts) and
     * must stay untouched; only guided_engineering projects have role outputs/tasks/reviews
     * to restore into `project.artifacts` etc. before the AI Engineering Team panel decides
     * which role to resume from (see useAutoEngineeringPipeline.ts).
     */
    if (shouldHydrateProjectData(project.projectType)) {
      hydrateProjectData(project.id);
    }
  }, [open, project?.id, project?.projectType]);

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

  /*
   * Sprint 54.1 — Discovery Intelligence (Requirements Session -> Business Understanding
   * Model -> Business Assessment -> Discovery Decision), read via the same repository
   * functions the write path (`requirementsSessionOrchestrator.ts`) already uses. Only
   * fetches while the dashboard is actually open, mirroring `isBuildersDbConnected` above;
   * `discoveryRefreshKey` is bumped by `ProjectRequirementsDialog`'s `onSaved` once a form
   * save's BuildersDB write settles, re-triggering this fetch without a full reload.
   */
  const discoveryIntelligence = useDiscoveryIntelligence(open ? project?.id : undefined, discoveryRefreshKey);

  /**
   * Product Experience Sprint — read only for the workflow bar's "Blueprint" node status
   * below; BlueprintRecommendationCard still resolves/records its own copy of this state
   * independently (its header comment explains why that must stay self-contained). Calling
   * the same read-only hook twice is deliberate, not a bug — it avoids changing that
   * component's props/contract, which is out of scope for this sprint.
   */
  const blueprintRecommendation = useBlueprintRecommendation(open ? project?.id : undefined, discoveryIntelligence);

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

  /** Sprint 54.1 — passed to `RequirementsDraftPanel` for display-only pipeline-gating copy; `undefined` for a legacy project (no session/model yet) or before the decision has been computed, in which case that panel behaves exactly as it did before this sprint. */
  const discoveryDecisionState =
    discoveryIntelligence.status === 'ready' ? discoveryIntelligence.model.decision.state : undefined;

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
  const productOwnerArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT);
  const architectureArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
  const databaseArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.DATABASE_DRAFT);
  const uiuxArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.UIUX_DRAFT);
  const backendArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.BACKEND_DRAFT);
  const frontendArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.FRONTEND_DRAFT);
  const qaArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.QA_DRAFT);
  const devopsArtifact = getLatestArtifact(projectArtifacts, ARTIFACT_TYPES.DEVOPS_DRAFT);

  /**
   * Product Experience Sprint — workflow bar status per stage. Every input here is a value
   * this component already computes for its own gating (requirementsCaptured,
   * isProjectDefinitionApproved, productOwnerArtifact, isAutoEngineeringComplete,
   * workspaceState.generatedApplicationExists) — this only maps them to a
   * complete/active/pending reading, no new state and no new business rule.
   */
  const businessAnalysisApproved = isProjectDefinitionApproved(project);
  const productOwnerApproved = productOwnerArtifact?.status === 'approved';
  const engineeringComplete = isAutoEngineeringComplete(project);
  const applicationGenerated = Boolean(workspaceState?.generatedApplicationExists);

  const businessStageStatus: WorkflowStageStatus = requirementsCaptured
    ? 'complete'
    : discoveryIntelligence.status === 'ready' || discoveryIntelligence.status === 'loading'
      ? 'active'
      : 'pending';
  const blueprintStageStatus: WorkflowStageStatus =
    blueprintRecommendation.state.status === 'ready' ? 'complete' : requirementsCaptured ? 'active' : 'pending';
  const planStageStatus: WorkflowStageStatus = productOwnerApproved
    ? 'complete'
    : requirementsCaptured
      ? 'active'
      : 'pending';
  const engineeringStageStatus: WorkflowStageStatus = engineeringComplete
    ? 'complete'
    : productOwnerApproved
      ? 'active'
      : 'pending';
  const applicationStageStatus: WorkflowStageStatus = applicationGenerated
    ? 'complete'
    : engineeringComplete
      ? 'active'
      : 'pending';

  const workflowStageStatusById: Record<WorkflowStageId, WorkflowStageStatus> = {
    business: businessStageStatus,
    blueprint: blueprintStageStatus,
    plan: planStageStatus,
    engineering: engineeringStageStatus,
    application: applicationStageStatus,
  };

  const workflowStages: WorkflowStage[] = WORKFLOW_STAGE_ORDER.map((id) => ({
    id,
    label: WORKFLOW_STAGE_LABELS[id],
    status: workflowStageStatusById[id],
    icon: WORKFLOW_STAGE_ICONS[id],
    description: WORKFLOW_STAGE_DESCRIPTIONS[id],
  }));

  /** Sprint UX-2 — the header's "Stage X of 5" and the hero panel's "Continue" jump target: the first stage that isn't complete yet, or the last stage once everything is. */
  const currentWorkflowStageIndex = (() => {
    const firstPending = WORKFLOW_STAGE_ORDER.findIndex((id) => workflowStageStatusById[id] !== 'complete');
    return firstPending === -1 ? WORKFLOW_STAGE_ORDER.length - 1 : firstPending;
  })();
  const currentWorkflowStageId = WORKFLOW_STAGE_ORDER[currentWorkflowStageIndex];

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
                  {/*
                    Sprint UX-2 — Project Header, redesigned to read at a glance: what project,
                    what blueprint, where we are, when it started. Every value here (blueprint,
                    workflowStages, project.createdAt) was already computed above for other
                    purposes — this section only presents it, no new data or logic.
                  */}
                  <div className="flex items-start justify-between px-6 sm:px-8 py-6 border-b border-bolt-elements-borderColor/60">
                    <div className="flex items-center gap-4 min-w-0">
                      <div
                        className={classNames(
                          'flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 ring-1',
                          colorClasses.bg,
                          colorClasses.ring,
                        )}
                      >
                        <span className="text-2xl leading-none">{project.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <RadixDialog.Title className="text-xl font-semibold tracking-tight text-bolt-elements-textPrimary truncate">
                            {project.name}
                          </RadixDialog.Title>
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 ring-1 ring-green-500/20 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-[10.5px] font-medium text-green-600 dark:text-green-400">Active</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-bolt-elements-textTertiary">
                          <span className="flex items-center gap-1 font-medium text-bolt-elements-textSecondary">
                            <span className="text-sm leading-none">{blueprint.icon}</span>
                            {blueprint.name}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-bolt-elements-borderColor/70 shrink-0" />
                          <span>
                            Stage {currentWorkflowStageIndex + 1} of {WORKFLOW_STAGE_ORDER.length}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-bolt-elements-borderColor/70 shrink-0" />
                          <span>Started {formatArtifactTimestamp(project.createdAt)}</span>
                        </div>
                        {project.description && (
                          <div className="text-sm text-bolt-elements-textTertiary mt-1.5 truncate max-w-[520px]">
                            {project.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={onClose}
                      className="flex items-center justify-center w-8 h-8 rounded-full bg-transparent hover:bg-purple-500/10 dark:hover:bg-purple-500/20 group transition-all duration-200 shrink-0"
                    >
                      <div className="i-ph:x w-4 h-4 text-bolt-elements-textTertiary group-hover:text-purple-500 transition-colors" />
                    </button>
                  </div>

                  {/*
                    Persistent workflow shell. The progress bar and the "Current Stage" hero
                    (ProjectManagerPanel — engine untouched, Sprint UX-2 only restyled its own
                    JSX) stay visible no matter which tab below is open, so "where am I / what's
                    next" never depends on navigating to a specific tab.
                  */}
                  <ProjectWorkflowBar stages={workflowStages} activeTab={activeTab} onSelect={handleTabChange} />
                  <div className="px-6 sm:px-8 pt-6">
                    <div
                      key={currentWorkflowStageId}
                      className={classNames(
                        'hero-panel-enter rounded-2xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5 sm:p-6',
                        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md shadow-sm',
                      )}
                    >
                      <ProjectManagerPanel
                        project={project}
                        onContinue={() => handleTabChange(currentWorkflowStageId)}
                      />
                    </div>
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
                      {/* STEP 1 — Understand Your Business: Discovery, Interview, Forms, Documents, Business Understanding. */}
                      <TabsContent value="business" className="!mt-0 space-y-10">
                        <section>
                          <GroupHeading
                            title="Understand Your Business"
                            icon={WORKFLOW_STAGE_ICONS.business}
                            subtitle="Tell us about your business — by form, conversation, or document — and we'll build a picture of what you need before anything is generated."
                          />
                          <div
                            className={classNames(
                              'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
                              'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                            )}
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
                                {requirementsCaptured
                                  ? 'Business Understanding captured'
                                  : 'Business Understanding missing'}
                              </span>
                            </div>

                            {/*
                              Sprint 54.1 — Business Discovery / Business Understanding Model. Separate
                              from, and never merged with, the "% complete" figure above (that's
                              `projectKnowledgeEngine`'s legacy ProjectKnowledge completion; this is the
                              Sprint 54 Discovery Decision Engine's own completeness score).
                            */}
                            <div className="mb-5">
                              <BusinessDiscoveryCard state={discoveryIntelligence} />
                            </div>

                            {!requirementsCaptured ? (
                              <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                                <span className="i-ph:clipboard-text-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                                <div className="text-sm font-medium text-bolt-elements-textSecondary">
                                  No business information captured yet.
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
                                  {/* Sprint 56 — Interview Mode entry point, UX spec §1 ("Talk it through instead"). */}
                                  <button
                                    type="button"
                                    onClick={() => setIsInterviewDialogOpen(true)}
                                    className="flex gap-2 items-center bg-transparent border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-500/40 rounded-lg px-4 py-2 transition-colors"
                                  >
                                    <span className="inline-block i-ph:chat-circle-dots h-4 w-4" />
                                    <span className="text-sm font-medium">Talk it through instead</span>
                                  </button>
                                  {/* Sprint 58 — Document Import entry point, third Discovery method alongside Form/Interview. */}
                                  <button
                                    type="button"
                                    onClick={() => setIsDocumentImportDialogOpen(true)}
                                    className="flex gap-2 items-center bg-transparent border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-500/40 rounded-lg px-4 py-2 transition-colors"
                                  >
                                    <span className="inline-block i-ph:file-arrow-up h-4 w-4" />
                                    <span className="text-sm font-medium">Import a document</span>
                                  </button>
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
                                  {/* Sprint 56 — Interview Mode remains reachable after the Form has already been used (UX spec §1: "Method cards are re-enterable"). */}
                                  <button
                                    type="button"
                                    onClick={() => setIsInterviewDialogOpen(true)}
                                    className="flex gap-2 items-center bg-transparent border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-500/40 rounded-lg px-4 py-2 transition-colors"
                                  >
                                    <span className="inline-block i-ph:chat-circle-dots h-4 w-4" />
                                    <span className="text-sm font-medium">Continue via Interview</span>
                                  </button>
                                  {/* Sprint 58 — Document Import remains reachable the same way, for adding more source material later. */}
                                  <button
                                    type="button"
                                    onClick={() => setIsDocumentImportDialogOpen(true)}
                                    className="flex gap-2 items-center bg-transparent border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-500/40 rounded-lg px-4 py-2 transition-colors"
                                  >
                                    <span className="inline-block i-ph:file-arrow-up h-4 w-4" />
                                    <span className="text-sm font-medium">Import a document</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </section>
                      </TabsContent>

                      {/* STEP 2 — Choose Your Blueprint: Recommendation, Confidence, Alternatives, Manual Override, Blueprint Details (Sprint 62, fully reused). */}
                      <TabsContent value="blueprint" className="!mt-0 space-y-10">
                        <section>
                          <GroupHeading
                            title="Choose Your Blueprint"
                            icon={WORKFLOW_STAGE_ICONS.blueprint}
                            subtitle="Once Business Understanding has enough to go on, we recommend a Blueprint — the starting shape for your product. Accept it, or pick a different one."
                          />
                          {requirementsCaptured || discoveryIntelligence.status === 'ready' ? (
                            <BlueprintRecommendationCard projectId={project.id} discovery={discoveryIntelligence} />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                              <span className="i-ph:stack-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                              <div className="text-sm font-medium text-bolt-elements-textSecondary">
                                No Blueprint recommendation yet.
                              </div>
                              <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[360px]">
                                Complete Business Understanding first — a Blueprint is recommended once there's enough
                                to go on.
                              </div>
                            </div>
                          )}
                        </section>
                      </TabsContent>

                      {/* STEP 3 — Plan Your Product: Business Analysis, Product Owner, MVP, User Stories, Roadmap. */}
                      <TabsContent value="plan" className="!mt-0 space-y-10">
                        <section>
                          <GroupHeading
                            title="Plan Your Product"
                            icon={WORKFLOW_STAGE_ICONS.plan}
                            subtitle="The AI Project Manager drafts your Business Analysis for you to review and approve. Once approved, the AI Product Owner plans your first MVP — user stories, priorities, and roadmap — for your approval too."
                          />
                          {!requirementsCaptured ? (
                            <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                              <span className="i-ph:notebook-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                              <div className="text-sm font-medium text-bolt-elements-textSecondary">
                                Complete Business Understanding first.
                              </div>
                              <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[360px]">
                                Business Analysis is drafted from what you capture in the Business step.
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {/* Business Analysis draft — RequirementsDraftPanel, unchanged (generate/regenerate/save). */}
                              <EngineeringStageSection
                                title="Business Analysis"
                                artifact={requirementsArtifact}
                                footnote="The AI Project Manager drafts your Business Analysis (Project Definition) here — nothing downstream starts until you approve it below."
                                navSectionId="business-analysis"
                                sectionRef={registerSection('business-analysis')}
                              >
                                <RequirementsDraftPanel
                                  project={project}
                                  discoveryDecisionState={discoveryDecisionState}
                                />
                              </EngineeringStageSection>

                              <PipelineConnector />

                              {/*
                                Business Analysis approval checkpoint — ProjectDefinitionWorkspace,
                                unchanged. This is the STOP: Business Analysis Complete -> Review ->
                                Approve/Edit/Regenerate. Product Owner never starts until the customer
                                explicitly approves here.
                              */}
                              {businessAnalysisApproved ? (
                                <>
                                  {/* Product Owner — Sprint 46B, unchanged. Product Planning, not Engineering — Gate A (Roadmap/Scope Approval) happens here; Engineering never begins until this is approved. */}
                                  <EngineeringStageSection
                                    title="Product Owner — MVP Roadmap & Scope"
                                    artifact={productOwnerArtifact}
                                    footnote="The Product Owner Draft is stored locally for this project only. Approving it (Gate A) creates MVP 1 in BuildersDB and unlocks Engineering — nothing is generated or deployed by this approval itself."
                                    navSectionId="product-owner"
                                    sectionRef={registerSection('product-owner')}
                                  >
                                    <ProductOwnerDraftPanel project={project} />
                                  </EngineeringStageSection>
                                </>
                              ) : (
                                <ProjectDefinitionWorkspace project={project} />
                              )}
                            </div>
                          )}
                        </section>
                      </TabsContent>

                      {/* STEP 4 — Engineer Your Solution: container only this sprint. Architecture/Database/UI-UX/Backend/Frontend/QA keep generating, reviewing, and approving themselves automatically exactly as before (AiEngineeringTeamPanel + each "*DraftPanel", unchanged) — this tab is the new home for that unchanged content, gated on Product Owner approval instead of starting the moment Requirements exists. */}
                      <TabsContent value="engineering" className="!mt-0 space-y-10">
                        <section>
                          <GroupHeading
                            title="Engineer Your Solution"
                            icon={WORKFLOW_STAGE_ICONS.engineering}
                            subtitle="Once your MVP roadmap is approved, your AI Engineering Team builds Architecture, Database, UI/UX, Backend, Frontend, and QA automatically — no approval needed at each stage, just one summary when it's done."
                          />
                          {!productOwnerApproved ? (
                            <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
                              <span className="i-ph:hammer-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
                              <div className="text-sm font-medium text-bolt-elements-textSecondary">
                                Engineering hasn't started yet.
                              </div>
                              <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[360px]">
                                Approve your MVP Roadmap & Scope in the Plan tab to unlock Architecture, Database,
                                UI/UX, Backend, Frontend, and QA.
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-6">
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

                              {/* SECTION — Engineering Readiness (review queue) */}
                              <section className="pt-10 border-t border-bolt-elements-borderColor/40">
                                <GroupHeading
                                  title="Engineering Readiness"
                                  subtitle="The review queue, now that every engineering stage above is visible."
                                />
                                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
                                  Review Summary
                                </h3>
                                <ReviewQueueCard summary={reviewSummary} />
                                <div className="mt-4 text-[11px] text-bolt-elements-textTertiary">
                                  Pending task reviews across the Task Execution Plan in the Workspace tab — approving
                                  or rejecting a review still happens from each task's own details.
                                </div>
                              </section>
                            </div>
                          )}
                        </section>
                      </TabsContent>

                      {/* STEP 5 — Generate & Deploy: Application, Package, Prototype, Deployment. */}
                      <TabsContent value="application" className="!mt-0 space-y-10">
                        <section ref={registerSection('package')} data-nav-section="package">
                          <GroupHeading
                            title="Generate & Deploy"
                            icon={WORKFLOW_STAGE_ICONS.application}
                            subtitle="Assembles every approved (or latest draft) AI role output into a structured set of Markdown files, then can generate a real React app from it into the Preview tab."
                          />
                          <ProductPackagePanel project={project} />
                          <div className="mt-6">
                            <InfoCard
                              icon="i-ph:rocket-launch-duotone"
                              label="Deployment"
                              rows={[
                                { label: 'Status', value: project.deploymentTarget ? 'Connected' : 'Not Connected' },
                                { label: 'Target', value: project.deploymentTarget || 'Not set' },
                              ]}
                            />
                          </div>
                        </section>
                      </TabsContent>

                      <TabsContent value="workspace" className="!mt-0 space-y-10">
                        {/* Sprint 38.5 — Status strip: Status/Current Stage/Last Activity/Application Status, plus BuildersDB/GitHub/Deployment quick badges. Moved here (Product Experience Sprint) — this is implementation-facing diagnostic detail, not part of the customer's journey; ProjectManagerPanel (persistent, above the tabs) is the business-friendly equivalent. */}
                        <section>
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
        onSaved={() => setDiscoveryRefreshKey((key) => key + 1)}
        onSwitchToInterview={() => {
          setIsRequirementsDialogOpen(false);
          setIsInterviewDialogOpen(true);
        }}
      />

      <InterviewChatDialog
        project={project}
        open={isInterviewDialogOpen}
        onClose={() => setIsInterviewDialogOpen(false)}
        onSaved={() => setDiscoveryRefreshKey((key) => key + 1)}
        onSwitchToForm={() => setIsRequirementsDialogOpen(true)}
      />

      <ProjectDocumentImportDialog
        project={project}
        open={isDocumentImportDialogOpen}
        onClose={() => setIsDocumentImportDialogOpen(false)}
        onSaved={() => setDiscoveryRefreshKey((key) => key + 1)}
        onSwitchToForm={() => setIsRequirementsDialogOpen(true)}
        onSwitchToInterview={() => setIsInterviewDialogOpen(true)}
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
