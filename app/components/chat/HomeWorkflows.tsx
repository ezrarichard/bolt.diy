import type { ReactNode } from 'react';
import { classNames } from '~/utils/classNames';
import { requestNewProjectDialog } from '~/lib/stores/projects';

/**
 * Sprint 24 — Builders Home Experience Refresh. Sprint 39.6 — Video Hero Refresh.
 * Sprint 39.7 — Home Page UI Refinement (compact cards, prompt box moved inside hero).
 * Sprint 39.8 — Quick Actions grid (4 cards, 2 disabled); Continue Working/Recent
 * Projects/Activity/Stats moved to HomeDashboardSections.tsx, rendered by BaseChat.tsx
 * below this hero.
 *
 * Two working entry points into the same existing product, rendered on the home screen
 * as a video hero (only when `!chatStarted` — see BaseChat.tsx):
 *
 *   Quick Build          -> focuses the existing prompt textarea, nothing else.
 *   Guided Engineering   -> opens the existing New Project dialog via
 *                           requestNewProjectDialog() (~/lib/stores/projects),
 *                           which ProjectList.tsx (sidebar) already renders.
 *
 * Neither card generates anything, calls an LLM, or creates fake data — both just point
 * at flows that already exist. The other two cards (Import Existing Project, Start from
 * Template) are Sprint 39.8 placeholders: `disabled`, no `onClick`, render a muted
 * "Coming Soon" pill instead of a button, so nothing is a broken/dead click target.
 * Deliberately does NOT add a Start/Workflow/Projects/Benefits/FAQ marketing nav — this
 * is an app homepage, not a marketing site.
 *
 * `children` (Sprint 39.7) is the existing chat prompt box — BaseChat.tsx passes it in so
 * it renders inside this hero's content column, below the four cards, rather than as a
 * separate section after the hero. `HomeWorkflows` never touches the prompt box's own
 * markup/handlers, it only decides WHERE in the tree it renders.
 */

const HERO_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_091828_e240eb17-6edc-4129-ad9d-98678e3fd238.mp4';

interface WorkflowCardProps {
  icon: string;
  title: string;
  subtitle: string;
  cta: string;
  onClick?: () => void;
  disabled?: boolean;
}

/** Compact glassmorphism workflow card (Sprint 39.7) — icon/title/one-line subtitle/action only, no extra content, so all four cards stay equal height. Sprint 39.8: `disabled` swaps the action button for a muted "Coming Soon" pill. */
function WorkflowCard({ icon, title, subtitle, cta, onClick, disabled }: WorkflowCardProps) {
  return (
    <div
      className={classNames(
        'h-full flex flex-col rounded-2xl border border-white/15 p-4 text-left',
        'bg-white/10 backdrop-blur-md shadow-sm',
        disabled ? 'opacity-70' : 'hover:bg-white/15 hover:shadow-md transition-all duration-200',
      )}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/20 ring-1 ring-purple-300/30 shrink-0">
          <div className={classNames(icon, 'w-4 h-4 text-purple-200')} />
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <p className="text-xs text-white/70 mb-3">{subtitle}</p>
      {disabled ? (
        <span
          aria-disabled="true"
          className="mt-auto inline-flex items-center justify-center gap-1.5 self-start px-3.5 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/60 border border-white/10"
        >
          Coming Soon
        </span>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="mt-auto inline-flex items-center justify-center gap-1.5 self-start px-3.5 py-2 rounded-lg text-xs font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors"
        >
          {cta}
          <span className="i-ph:arrow-right w-3.5 h-3.5" />
        </button>
      )}
    </div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-3xl mx-auto items-stretch">
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
              <WorkflowCard
                icon="i-ph:folder-simple-plus-duotone"
                title="Import Existing Project"
                subtitle="Bring in a GitHub repository. (Coming later)"
                cta="Import"
                disabled
              />
              <WorkflowCard
                icon="i-ph:package-duotone"
                title="Start from Template"
                subtitle="Launch from a ready-made starter."
                cta="Browse Templates"
                disabled
              />
            </div>

            {children && <div className="mt-6">{children}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
