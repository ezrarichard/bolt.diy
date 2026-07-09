import { motion, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { SettingsButton, HelpButton } from '~/components/ui/SettingsButton';
import { cubicEasingFn } from '~/utils/easings';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import { projectsStore, currentProjectIdStore, isProjectDashboardOpenStore } from '~/lib/stores/projects';
import { ProjectList } from './ProjectList';
import { ProjectDashboard } from './ProjectDashboard';

/**
 * Sprint 32 UI polish — fixed desktop-panel width (VS Code / Cursor / Claude Desktop
 * style), kept within the requested 340–380px range. Referenced by both the closed
 * variant's offset and the inline `width` style below so the two can never drift apart.
 */
const SIDEBAR_WIDTH_PX = 360;

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: `-${SIDEBAR_WIDTH_PX}px`,
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

export const Menu = () => {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const profile = useStore(profileStore);
  const projects = useStore(projectsStore);
  const currentProjectId = useStore(currentProjectIdStore);
  const currentProject = currentProjectId ? projects.find((project) => project.id === currentProjectId) : null;

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

  useEffect(() => {
    const enterThreshold = 20;
    const exitThreshold = 20;

    function onMouseMove(event: MouseEvent) {
      if (isSettingsOpen) {
        return;
      }

      if (event.pageX < enterThreshold) {
        setOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isSettingsOpen]);

  /*
   * Sprint 32 UI polish — clicking anywhere outside the sidebar closes it, so
   * interacting with the workspace (e.g. the Project Dashboard) behind it no
   * longer requires first dragging the mouse past the hover-exit threshold.
   */
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  /*
   * Sprint 32 UI polish — Escape closes the sidebar, matching the desktop
   * panel behavior of VS Code / Cursor / Claude Desktop.
   */
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
    setOpen(false);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  return (
    <>
      <motion.div
        ref={menuRef}
        initial="closed"
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ width: `${SIDEBAR_WIDTH_PX}px` }}
        className={classNames(
          'flex selection-accent flex-col side-menu fixed top-0 h-full rounded-r-2xl',
          'bg-white dark:bg-gray-950 border-r border-bolt-elements-borderColor',
          'shadow-sm text-sm',
          isSettingsOpen ? 'z-40' : 'z-sidebar',
        )}
      >
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/50 rounded-tr-2xl">
          <div className="text-gray-900 dark:text-white font-medium">Builders</div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => window.open('https://stackblitz-labs.github.io/bolt.diy/', '_blank')} />
            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {profile?.username || 'Guest User'}
            </span>
            {/* Sprint 32 UI polish — Settings moved here from the sidebar footer for one-click access. */}
            <SettingsButton onClick={handleSettingsClick} />
            <div className="flex items-center justify-center w-[32px] h-[32px] overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-500 rounded-full shrink-0">
              {profile?.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile?.username || 'User'}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="sync"
                />
              ) : (
                <div className="i-ph:user-fill text-lg" />
              )}
            </div>
          </div>
        </div>
        <CurrentDateTime />
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col">
            <ProjectList onSelectProject={handleSelectProject} />
          </div>
          <div className="flex items-center justify-end border-t border-gray-200 dark:border-gray-800 px-4 py-3">
            <ThemeSwitch />
          </div>
        </div>
      </motion.div>

      <ProjectDashboard
        project={currentProject || null}
        open={isProjectDashboardOpen}
        onClose={() => isProjectDashboardOpenStore.set(false)}
      />
      <ControlPanel open={isSettingsOpen} onClose={handleSettingsClose} />
    </>
  );
};
