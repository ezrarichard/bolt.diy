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
        'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 backdrop-blur-xl',
        'shadow-sm',
        'transition-all duration-300 hover:-translate-y-0.5 hover:border-builders-brand-primary/40 hover:bg-bolt-elements-background-depth-2',
      )}
    >
      <span className={classNames(stage.icon, 'w-4 h-4 text-builders-brand-primary shrink-0')} />
      <span className="text-xs font-medium text-bolt-elements-textSecondary whitespace-nowrap">{stage.label}</span>
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
        'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 backdrop-blur-xl',
        'transition-all duration-300',
        'hover:-translate-y-0.5 hover:border-builders-brand-primary/50 hover:bg-bolt-elements-background-depth-2',
        'hover:shadow-lg hover:shadow-builders-brand-primary/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
      )}
    >
      <span
        className={classNames(
          'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
          'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
          'transition-colors duration-300 group-hover:border-builders-brand-primary/50 group-hover:bg-builders-brand-subtleSurface',
        )}
      >
        <span className={classNames(icon, 'w-5 h-5 text-builders-brand-primary')} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-bolt-elements-textPrimary">{title}</span>
        <span className="block text-xs text-bolt-elements-textSecondary mt-1 leading-relaxed">{description}</span>
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
    <div className="relative isolate shrink-0 overflow-hidden bg-[var(--builders-hero-surface)] -mx-4 lg:mx-0">
      {/*
        ── Background: masked tech grid, two glow orbs, and a fade into the app surface ──

        Every colour here comes from a `--builders-hero-*` token (app/styles/builders-tokens.scss),
        which is defined once per theme. That is what makes light mode a designed bright surface
        rather than an inverted dark one, and it is why nothing below hardcodes an rgba.
      */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-60 dark:opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--builders-hero-grid-line) 1px, transparent 1px),' +
            'linear-gradient(to bottom, var(--builders-hero-grid-line) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 30%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 30%, black, transparent 75%)',
        }}
      />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full blur-[130px] opacity-70 dark:opacity-50"
        style={{ background: 'radial-gradient(circle, var(--builders-hero-glow-primary) 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-24 w-[620px] h-[420px] rounded-full blur-[130px] opacity-60 dark:opacity-35"
        style={{ background: 'radial-gradient(circle, var(--builders-hero-glow-secondary) 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-bolt-elements-background-depth-1"
      />

      <div className="relative z-10 flex flex-col">
        {/* Top bar — brand only. This is an app homepage, not a marketing site. */}
        <div className="max-w-5xl mx-auto w-full px-6 sm:px-8 py-6 flex items-center justify-between">
          <span className="text-bolt-elements-textPrimary font-semibold tracking-tight">Builders</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-builders-brand-primary border border-builders-brand-primary/30 rounded-full px-3 py-1">
            AI Software Factory
          </span>
        </div>

        {/* ── Hero ── */}
        <div className="max-w-5xl mx-auto w-full px-6 sm:px-8 pt-16 pb-14 sm:pt-24 sm:pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08]">
            {/* Gradient built from the two text tokens, so it reads dark-on-light and light-on-dark without a second definition. */}
            <span className="bg-gradient-to-b from-[var(--bolt-elements-textPrimary)] via-[var(--bolt-elements-textPrimary)] to-[var(--bolt-elements-textSecondary)] bg-clip-text text-transparent">
              Where ideas become software.
            </span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-bolt-elements-textSecondary">
            Plan, build, review and ship — all in one platform.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
            <button
              type="button"
              onClick={requestNewProjectDialog}
              className={classNames(
                'group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl',
                'text-sm font-semibold text-white',

                /*
                 * A SOLID background-color, not a gradient. The gradient this replaced left
                 * `background-color` resolving to the browser's native `buttonface` (#efefef) —
                 * white-on-#efefef is 1.08:1, i.e. invisible, any time the gradient did not paint.
                 *
                 * purple-600/700/800 rather than `bg-builders-brand-primary`: that token resolves
                 * to purple-500 in dark theme, and purple-500 against white text is 3.3:1, under
                 * the 4.5:1 AA floor for this 14px label. These three all clear it (4.9 / 6.5 / 8.6)
                 * and are identical in both themes, so the CTA never depends on the surface behind it.
                 */
                'bg-purple-600 hover:bg-purple-700 active:bg-purple-800',
                'shadow-lg shadow-purple-600/30',
                'transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--builders-hero-surface)]',
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
                className="inline-flex items-center gap-1.5 bg-transparent border-0 p-0 appearance-none text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors focus-visible:outline-none focus-visible:text-bolt-elements-textPrimary focus-visible:underline"
              >
                Open Recent Project
                <span className="i-ph:arrow-up-right w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* textSecondary, not textTertiary: at 11px the tertiary token measures 4.43:1 on the hero surface, just under the 4.5:1 AA floor. */}
          <div className="mt-7 inline-flex items-center gap-2 text-[11px] text-bolt-elements-textSecondary">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-builders-status-success-border/70 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-builders-status-success-border" />
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
                    className="hidden lg:block h-px w-7 xl:w-10 shrink-0 bg-gradient-to-r from-transparent via-builders-brand-primary/60 to-transparent"
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
