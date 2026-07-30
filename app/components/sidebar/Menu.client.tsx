import { motion, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { SettingsButton, HelpButton } from '~/components/ui/SettingsButton';
import { IconButton } from '~/components/ui/IconButton';
import { cubicEasingFn } from '~/utils/easings';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { projectsStore, currentProjectIdStore, isProjectDashboardOpenStore } from '~/lib/stores/projects';
import { sidebarCollapsedStore, setSidebarCollapsed, toggleSidebarCollapsed } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';
import { shouldHideSidebarForWorkbench } from '~/lib/stores/workbenchViewVisibility';
import { useAuth } from '~/lib/auth/AuthProvider';
import { firstNameFromFullName } from '~/lib/auth/deriveName';
import { BuildersLogoMark } from '~/components/branding/BuildersLogo';
import { ProjectList } from './ProjectList';
import { ProjectDashboard } from './ProjectDashboard';
import useViewport from '~/lib/hooks';

/**
 * Sprint 41.1 — Sidebar Layout Refresh.
 *
 * Below `MOBILE_BREAKPOINT_PX` the sidebar keeps its pre-existing overlay/drawer behavior
 * (hover-to-open, click-outside/Escape-to-close, fixed positioning, Framer Motion slide) —
 * explicitly left alone per this sprint's "do not redesign mobile" instruction. At or above
 * that width it's a normal, non-overlay flex sibling (VS Code/Linear-style) whose width
 * transitions between `EXPANDED_WIDTH_PX` and `COLLAPSED_WIDTH_PX` via a plain CSS
 * transition — no Framer Motion — and pushes the rest of the layout instead of covering it.
 */
const MOBILE_BREAKPOINT_PX = 768;
const MOBILE_DRAWER_WIDTH_PX = 360;
const EXPANDED_WIDTH_PX = 320;
const COLLAPSED_WIDTH_PX = 72;
const WIDTH_TRANSITION = 'width 280ms cubic-bezier(0.4, 0, 0.2, 1)';

const mobileMenuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: `-${MOBILE_DRAWER_WIDTH_PX}px`,
    transition: {
      duration: 0.25,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.25,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

function CurrentDateTime() {
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/50">
      <div className="h-4 w-4 i-ph:clock opacity-80" />
      <div className="flex gap-2">
        <span>{dateTime.toLocaleDateString()}</span>
        <span>{dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

/**
 * Sprint 41.2 — sidebar greeting; Sprint 41.6 — prefers the centralized `public.profiles`
 * row over the auth-derived fallback. Resolution order: `profile.displayName` (e.g. "Mary
 * Ann Thomas" -> "Mary") -> `user.firstName` (metadata/email-derived, see deriveName.ts) ->
 * a name-less greeting. `profile` is `null` until AuthProvider's upsert/fetch resolves (or if
 * BuildersDB is unconfigured), so this always has a sane fallback rather than flashing empty.
 * The subtitle is intentionally constant across every state per the sprint spec.
 */
function useGreeting() {
  const { status, user, profile } = useAuth();
  const firstName = firstNameFromFullName(profile?.displayName) ?? user?.firstName ?? null;

  const title =
    status === 'loading'
      ? 'Loading...'
      : firstName
        ? `Hi, ${firstName} 👋`
        : status === 'authenticated'
          ? 'Hi there 👋'
          : 'Welcome';

  return { title, subtitle: 'AI Product Engineer' };
}

export const Menu = () => {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const isMobile = useViewport(MOBILE_BREAKPOINT_PX);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useStore(sidebarCollapsedStore);
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const projects = useStore(projectsStore);
  const currentProjectId = useStore(currentProjectIdStore);
  const currentProject = currentProjectId ? projects.find((project) => project.id === currentProjectId) : null;
  const greeting = useGreeting();

  /*
   * Sprint 6: lifted to a store (isProjectDashboardOpenStore) so other
   * components — e.g. the Current Project badge near the chat input — can
   * reopen the dashboard for the active project without prop-drilling.
   */
  const isProjectDashboardOpen = useStore(isProjectDashboardOpenStore);

  /*
   * Sprint 39.7 — every project appears here now, both projectType: 'quick_build' and
   * 'guided_engineering'. Quick Build projects have no dashboard content (no
   * Requirements/Architecture/etc. tabs), so selecting one opens its linked chat
   * instead of the Project Dashboard modal.
   */
  const handleSelectProject = (id: string) => {
    const project = projects.find((candidate) => candidate.id === id);
    currentProjectIdStore.set(id);

    if (project?.projectType === 'quick_build' && project.linkedChatId) {
      navigate(`/chat/${project.linkedChatId}`);
      return;
    }

    isProjectDashboardOpenStore.set(true);
  };

  /*
   * Sprint 32 UI polish, preserved as-is for mobile only (Sprint 41.1 leaves mobile's drawer
   * interaction untouched) — hover-to-open near the left edge, hover-to-close past the
   * sidebar's right edge, click-outside-to-close, and Escape-to-close.
   */
  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const enterThreshold = 20;
    const exitThreshold = 20;

    function onMouseMove(event: MouseEvent) {
      if (isSettingsOpen) {
        return;
      }

      if (event.pageX < enterThreshold) {
        setMobileOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setMobileOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isMobile, isSettingsOpen]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) {
      return undefined;
    }

    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, mobileOpen]);

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
    setMobileOpen(false);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  const handleExpandRequest = () => {
    if (collapsed) {
      setSidebarCollapsed(false);
    }
  };

  /*
   * Sprint 41.2 — header shows the authenticated-user greeting instead of the generic "Builders"
   * label (still available via BuildersLogoMark's tooltip/aria-label).
   *
   * Landing Redesign follow-up — that sprint pinned this strip to a fixed dark `bg-[#171128]` so
   * its hardcoded `text-white`/`text-white/50` stayed legible in light theme. The side effect was
   * a dark band left across the top of an otherwise light sidebar. Fixed at the root instead: the
   * typography now uses the same `--bolt-elements-text*` tokens as the rest of the sidebar, so the
   * background is free to follow the theme like every other surface.
   */
  const collapsedDesktop = !isMobile && collapsed;

  /*
   * Workbench-open layout — the icon sidebar reserves real width (it's a normal flex
   * sibling, not an overlay — see this file's Sprint 41.1 header comment) and makes Code,
   * Diff, and Preview all feel cramped alike whenever the Workbench is open, not only
   * Preview. Hidden for the whole time the Workbench is open, regardless of which of the
   * three views is selected, so switching between them never briefly restores it;
   * `ProjectDashboard`/`ControlPanel` below are unaffected so an open dialog never gets
   * force-closed by opening the Workbench. Shared identically by Quick Build and Software
   * Factory, since `showWorkbench` is the same global store for both.
   */
  const isWorkbenchOpen = shouldHideSidebarForWorkbench(showWorkbench);

  const header = (
    <div
      className={classNames(
        'flex items-center border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shrink-0',
        collapsedDesktop ? 'flex-col gap-2 py-3' : 'h-16 justify-between gap-2 px-4',
      )}
    >
      {collapsedDesktop ? (
        <BuildersLogoMark size={28} title="Builders" />
      ) : (
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <BuildersLogoMark size={30} title="Builders" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-bolt-elements-textPrimary truncate leading-tight">
              {greeting.title}
            </div>
            {/* textSecondary, not textTertiary: tertiary measures 3.78:1 on this surface, under the AA floor. */}
            <div className="text-xs text-bolt-elements-textSecondary uppercase tracking-wider truncate">
              {greeting.subtitle}
            </div>
          </div>
        </div>
      )}
      {isMobile ? (
        <IconButton
          icon="i-ph:x"
          size="xl"
          title="Close"
          onClick={() => setMobileOpen(false)}
          className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary shrink-0"
        />
      ) : (
        <IconButton
          icon={collapsed ? 'i-ph:sidebar-simple' : 'i-ph:sidebar-simple-fill'}
          size="xl"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleSidebarCollapsed}
          className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 transition-colors shrink-0"
        />
      )}
    </div>
  );

  // Theme/Settings/Help shortcut row — moved out of the header (Change 6) into the body footer.
  const footer = (
    <div
      className={classNames(
        'flex items-center border-t border-gray-200 dark:border-gray-800 px-4 py-3 shrink-0',
        !isMobile && collapsed ? 'flex-col gap-2 px-0' : 'justify-end gap-1',
      )}
    >
      <HelpButton onClick={() => window.open('https://stackblitz-labs.github.io/bolt.diy/', '_blank')} />
      <SettingsButton onClick={handleSettingsClick} />
      <ThemeSwitch />
    </div>
  );

  const body = (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
      {!isMobile && collapsed ? null : <CurrentDateTime />}
      <div className="flex-1 min-h-0 flex flex-col">
        <ProjectList
          onSelectProject={handleSelectProject}
          collapsed={!isMobile && collapsed}
          onRequestExpand={handleExpandRequest}
        />
      </div>
      {footer}
    </div>
  );

  return (
    <>
      {!isWorkbenchOpen &&
        (isMobile ? (
          <motion.div
            ref={menuRef}
            initial="closed"
            animate={mobileOpen ? 'open' : 'closed'}
            variants={mobileMenuVariants}
            style={{ width: `${MOBILE_DRAWER_WIDTH_PX}px` }}
            className={classNames(
              'flex selection-accent flex-col side-menu fixed top-0 h-full rounded-r-2xl',
              'bg-white dark:bg-gray-950 border-r border-bolt-elements-borderColor',
              'shadow-sm text-sm',
              isSettingsOpen ? 'z-40' : 'z-sidebar',
            )}
          >
            {header}
            {body}
          </motion.div>
        ) : (
          <div
            ref={menuRef}
            data-testid="desktop-sidebar"
            style={{ width: `${collapsed ? COLLAPSED_WIDTH_PX : EXPANDED_WIDTH_PX}px`, transition: WIDTH_TRANSITION }}
            className={classNames(
              'flex selection-accent flex-col side-menu h-full shrink-0 overflow-hidden',
              'bg-white dark:bg-gray-950 border-r border-bolt-elements-borderColor',
              'text-sm',
            )}
          >
            {header}
            {body}
          </div>
        ))}

      <ProjectDashboard
        project={currentProject || null}
        open={isProjectDashboardOpen}
        onClose={() => isProjectDashboardOpenStore.set(false)}
      />
      <ControlPanel open={isSettingsOpen} onClose={handleSettingsClose} />
    </>
  );
};
