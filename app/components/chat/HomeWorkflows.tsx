import { Fragment } from 'react';
import { useStore } from '@nanostores/react';
import { useNavigate } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { projectsStore, requestNewProjectDialog } from '~/lib/stores/projects';
import {
  HOME_ACTIVITY_ANCHOR_ID,
  HOME_PROJECTS_ANCHOR_ID,
  getMostRecentOpenableProject,
  openProject,
} from './HomeDashboardSections';

/**
 * Builders Software Factory — home hero + quick access (Landing Redesign).
 *
 * A command center, not a marketing page. The redesign removed the background video, the
 * oversized two-line headline, the long paragraph, the role-chip pipeline, and (from
 * BaseChat.tsx) the Import Chat / Import Folder / Clone-a-repo row and the template prompt
 * chips — Builders exposes exactly ONE way in, the Software Factory, and every one of those
 * removed surfaces was a shortcut into the frozen Quick Build path.
 *
 * Everything below is CSS — gradients, a masked grid, and blurred glow orbs. No video, no
 * image asset, no animation library, and no new global stylesheet.
 *
 * The quick access grid is deliberately THREE cards, not the six an early draft of the
 * redesign sketched. Builders has no standalone Reviews, Artifacts, or Settings destination:
 * reviews and artifacts exist only as tabs inside a specific project's dashboard, and
 * settings is a sidebar-owned ControlPanel (see _index.tsx's note and Menu.client.tsx). Cards
 * for those would either dead-end or silently pick a project on the user's behalf, so this
 * grid carries only actions that are genuinely global. Add a card here when — and only when —
 * the destination it points at actually exists.
 */

interface FactoryStage {
  icon: string;
  label: string;
}

/**
 * The five customer-facing journey stages, matching ProjectWorkflowBar's own stage order
 * (Business → Blueprint → MVP → Engineering → Application) so the home page and the project
 * dashboard describe the same pipeline in the same order. Line-weight Phosphor icons, not the
 * duotone set used elsewhere — the redesign calls for minimal, line-based iconography.
 */
const FACTORY_STAGES: FactoryStage[] = [
  { icon: 'i-ph:magnifying-glass', label: 'Discovery' },
  { icon: 'i-ph:stack', label: 'Blueprint' },
  { icon: 'i-ph:clipboard-text', label: 'MVP Generation' },
  { icon: 'i-ph:code', label: 'Engineering' },
  { icon: 'i-ph:rocket-launch', label: 'Application Ready' },
];

/** Smooth-scrolls to one of the home dashboard sections below the fold. No-op if that section rendered nothing. */
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** One stage panel in the hero rail — a glass surface that lifts slightly on hover. Presentational only. */
function StagePanel({ stage }: { stage: FactoryStage }) {
  return (
    <div
      className={classNames(
        'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 shrink-0',
        'border border-white/10 bg-white/[0.04] backdrop-blur-xl',
        'shadow-[0_8px_24px_-16px_rgba(0,0,0,0.9)]',
        'transition-all duration-300 hover:-translate-y-0.5 hover:border-purple-400/30 hover:bg-white/[0.07]',
      )}
    >
      <span className={classNames(stage.icon, 'w-4 h-4 text-purple-200/90 shrink-0')} />
      <span className="text-xs font-medium text-white/80 whitespace-nowrap">{stage.label}</span>
    </div>
  );
}

interface QuickAccessCardProps {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}

function QuickAccessCard({ icon, title, description, onClick }: QuickAccessCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'group flex items-start gap-4 rounded-2xl p-5 text-left w-full',
        'border border-white/10 bg-white/[0.03] backdrop-blur-xl',
        'transition-all duration-300',
        'hover:-translate-y-0.5 hover:border-purple-400/40 hover:bg-white/[0.06]',
        'hover:shadow-[0_0_40px_-12px_rgba(168,85,247,0.45)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60',
      )}
    >
      <span
        className={classNames(
          'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
          'border border-white/10 bg-white/[0.05]',
          'transition-colors duration-300 group-hover:border-purple-400/40 group-hover:bg-purple-500/10',
        )}
      >
        <span className={classNames(icon, 'w-5 h-5 text-purple-200/90')} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block text-xs text-white/50 mt-1 leading-relaxed">{description}</span>
      </span>
    </button>
  );
}

export function HomeWorkflows() {
  const navigate = useNavigate();
  const projects = useStore(projectsStore);
  const recentProject = getMostRecentOpenableProject(projects);

  const statusLabel =
    projects.length === 0
      ? 'Ready to build your first project'
      : `Ready to build · ${projects.length} project${projects.length === 1 ? '' : 's'} in the factory`;

  /*
   * No projects yet means there is nothing to scroll to — send the user to the one action that helps.
   *
   * Deliberately does NOT expand the sidebar on the way: doing so re-lays out the scroll container
   * mid-animation, which cancels the smooth scroll (measured: it stopped 117px into an 806px scroll),
   * and force-opening a sidebar the user may have collapsed on purpose is intrusive either way.
   */
  const handleMyProjects = () => {
    if (projects.length === 0) {
      requestNewProjectDialog();
      return;
    }

    scrollToSection(HOME_PROJECTS_ANCHOR_ID);
  };

  return (
    <div className="relative isolate shrink-0 overflow-hidden bg-[#07060d] -mx-4 lg:mx-0">
      {/* ── Background: masked tech grid, two glow orbs, and a fade into the app surface ── */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.09) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(148,163,184,0.09) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 30%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 30%, black, transparent 75%)',
        }}
      />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full blur-[130px] opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(147,51,234,0.55) 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-24 w-[620px] h-[420px] rounded-full blur-[130px] opacity-35"
        style={{ background: 'radial-gradient(circle, rgba(56,132,255,0.45) 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-bolt-elements-background-depth-1"
      />

      <div className="relative z-10 flex flex-col">
        {/* Top bar — brand only. This is an app homepage, not a marketing site. */}
        <div className="max-w-5xl mx-auto w-full px-6 sm:px-8 py-6 flex items-center justify-between">
          <span className="text-white font-semibold tracking-tight">Builders</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-purple-200/70 border border-purple-300/20 rounded-full px-3 py-1">
            AI Software Factory
          </span>
        </div>

        {/* ── Hero ── */}
        <div className="max-w-5xl mx-auto w-full px-6 sm:px-8 pt-16 pb-14 sm:pt-24 sm:pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08]">
            <span className="bg-gradient-to-b from-white via-white to-white/55 bg-clip-text text-transparent">
              Where ideas become software.
            </span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-white/55">Plan, build, review and ship — all in one platform.</p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
            <button
              type="button"
              onClick={requestNewProjectDialog}
              className={classNames(
                'group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl',
                'text-sm font-semibold text-white',
                'bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500',
                'shadow-[0_10px_40px_-12px_rgba(168,85,247,0.75)]',
                'transition-all duration-300 hover:-translate-y-0.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07060d]',
              )}
            >
              Start a New Project
              <span className="i-ph:arrow-right w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </button>

            {/*
              `bg-transparent border-0` below is load-bearing: without it the native `buttonface`
              background paints this as a light-grey chip on the dark hero — the same bug
              ProjectWorkflowBar.tsx documents, and it was live here until it was caught.
            */}
            {recentProject && (
              <button
                type="button"
                onClick={() => openProject(recentProject, navigate)}
                className="inline-flex items-center gap-1.5 bg-transparent border-0 p-0 appearance-none text-sm text-white/50 hover:text-white/85 transition-colors focus-visible:outline-none focus-visible:text-white"
              >
                Open Recent Project
                <span className="i-ph:arrow-up-right w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="mt-7 inline-flex items-center gap-2 text-[11px] text-white/40">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400/70 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            {statusLabel}
          </div>

          {/* The factory pipeline — same stage order as the project dashboard's workflow bar. */}
          <div className="mt-14 flex items-center justify-center gap-2 lg:gap-0 flex-wrap">
            {FACTORY_STAGES.map((stage, index) => (
              <Fragment key={stage.label}>
                <StagePanel stage={stage} />
                {index < FACTORY_STAGES.length - 1 && (
                  <span
                    aria-hidden
                    className="hidden lg:block h-px w-7 xl:w-10 shrink-0 bg-gradient-to-r from-purple-500/10 via-purple-400/50 to-purple-500/10"
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>

        {/* ── Quick access ── */}
        <div className="max-w-5xl mx-auto w-full px-6 sm:px-8 pb-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <QuickAccessCard
              icon="i-ph:folder"
              title="My Projects"
              description="View all your projects and their status."
              onClick={handleMyProjects}
            />
            <QuickAccessCard
              icon="i-ph:plus-circle"
              title="New Project"
              description="Start building something new."
              onClick={requestNewProjectDialog}
            />
            <QuickAccessCard
              icon="i-ph:clock-counter-clockwise"
              title="Recent Activity"
              description="See your latest work and updates."
              onClick={() => scrollToSection(HOME_ACTIVITY_ANCHOR_ID)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
