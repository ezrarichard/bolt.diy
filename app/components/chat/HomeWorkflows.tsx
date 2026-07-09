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
 * Sprint 24 — Builders Home Experience Refresh. Sprint 39.6 — Video Hero Refresh.
 * Sprint 39.7 — Home Page UI Refinement (compact cards, prompt box moved inside hero).
 *
 * Two entry points into the same existing product, rendered on the home
 * screen as a video hero (only when `!chatStarted` — see BaseChat.tsx):
 *
 *   Quick Build          -> focuses the existing prompt textarea, nothing else.
 *   Guided Engineering   -> opens the existing New Project dialog via
 *                           requestNewProjectDialog() (~/lib/stores/projects),
 *                           which ProjectList.tsx (sidebar) already renders.
 *
 * Neither card generates anything, calls an LLM, or creates fake data —
 * both just point at flows that already exist; this sprint only restyles the
 * chrome around them. Deliberately does NOT add a Start/Workflow/Projects/
 * Benefits/FAQ marketing nav — this is an app homepage, not a marketing site.
 *
 * `children` (Sprint 39.7) is the existing chat prompt box — BaseChat.tsx
 * passes it in so it renders inside this hero's content column, below the two
 * cards, rather than as a separate section after the hero. `HomeWorkflows`
 * never touches the prompt box's own markup/handlers, it only decides WHERE
 * in the tree it renders.
 *
 * `ContinueProjectSection` (Sprint 39.7) is exported separately so
 * BaseChat.tsx can render it AFTER the hero/prompt box, per that sprint's
 * "Continue Project below hero" requirement — it reads `projectsStore`
 * itself (already the single source of truth for the sidebar's project
 * list) and opens the Project Dashboard via the same two store writes
 * Menu.client.tsx's handleSelectProject / CurrentProjectBadge.tsx's click
 * handler already use — no new dashboard-opening logic.
 */

const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_091828_e240eb17-6edc-4129-ad9d-98678e3fd238.mp4';

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
}

/** Compact glassmorphism workflow card (Sprint 39.7) — icon/title/one-line subtitle/button only, no extra content, so both cards stay equal height. */
function WorkflowCard({ icon, title, subtitle, cta, onClick }: WorkflowCardProps) {
  return (
    <div
      className={classNames(
        'h-full flex flex-col rounded-2xl border border-white/15 p-4 text-left',
        'bg-white/10 backdrop-blur-md',
        'hover:bg-white/15 transition-colors duration-200',
      )}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/20 ring-1 ring-purple-300/30 shrink-0">
          <div className={classNames(icon, 'w-4 h-4 text-purple-200')} />
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <p className="text-xs text-white/70 mb-3">{subtitle}</p>
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

  /** The existing chat prompt box (see BaseChat.tsx) — rendered inside the hero, below the two cards. */
  children?: ReactNode;
}

export function HomeWorkflows({ onFocusPrompt, children }: HomeWorkflowsProps) {
  return (
    <div
      className="relative min-h-screen bg-gray-950 overflow-hidden -mx-4 lg:mx-0"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <video
        autoPlay
        muted
        loop
        playsInline
        crossOrigin="anonymous"
        className="absolute inset-0 w-full h-full object-cover"
        src={HERO_VIDEO_URL}
      />
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-purple-950/20 to-black/70" />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top nav — brand only; this is an app homepage, not a marketing site */}
        <div className="max-w-7xl mx-auto w-full px-8 py-6 flex items-center justify-between">
          <span className="text-white font-semibold tracking-tight">Builders</span>
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center text-center py-8">
          <div className="max-w-3xl mx-auto px-8 w-full">
            <div className="text-sm uppercase tracking-wider text-purple-200/80 mb-4">
              AI Product Engineering Workspace
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-white mb-4">
              Build software.
              <br />
              <span className="text-purple-300">Like an AI company.</span>
            </h1>
            <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto mb-8">
              Turn ideas into requirements, engineering plans, product packages, runnable apps, reviews, repairs, and
              previews — all inside one workspace.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto items-stretch">
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
              />
            </div>

            {children && <div className="mt-6">{children}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sprint 39.7 — rendered by BaseChat.tsx below the hero/prompt box, not inside HomeWorkflows. */
export function ContinueProjectSection() {
  const projects = useStore(projectsStore);
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_PROJECTS_LIMIT);

  if (recentProjects.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 lg:px-0 py-12">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2.5 px-1">
        Continue a Project
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {recentProjects.map((project) => (
          <RecentProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
