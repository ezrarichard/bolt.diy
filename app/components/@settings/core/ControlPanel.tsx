import { useState, useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import { TabTile } from '~/components/@settings/shared/components/TabTile';
import { useFeatures } from '~/lib/hooks/useFeatures';
import { useNotifications } from '~/lib/hooks/useNotifications';
import { useConnectionStatus } from '~/lib/hooks/useConnectionStatus';
import { tabConfigurationStore, resetTabConfiguration } from '~/lib/stores/settings';
import { profileStore } from '~/lib/stores/profile';
import type { TabType, Profile } from './types';
import { observabilityTabIds } from '~/lib/observability/observabilityModules';
import { TAB_LABELS, DEFAULT_TAB_CONFIG, TAB_DESCRIPTIONS } from './constants';
import { DialogTitle } from '~/components/ui/Dialog';
import { AvatarDropdown } from './AvatarDropdown';
import BackgroundRays from '~/components/ui/BackgroundRays';

// Import all tab components
import ProfileTab from '~/components/@settings/tabs/profile/ProfileTab';
import SettingsTab from '~/components/@settings/tabs/settings/SettingsTab';
import NotificationsTab from '~/components/@settings/tabs/notifications/NotificationsTab';
import FeaturesTab from '~/components/@settings/tabs/features/FeaturesTab';
import { DataTab } from '~/components/@settings/tabs/data/DataTab';
import { EventLogsTab } from '~/components/@settings/tabs/event-logs/EventLogsTab';
import GitHubTab from '~/components/@settings/tabs/github/GitHubTab';
import GitLabTab from '~/components/@settings/tabs/gitlab/GitLabTab';
import SupabaseTab from '~/components/@settings/tabs/supabase/SupabaseTab';
import VercelTab from '~/components/@settings/tabs/vercel/VercelTab';
import NetlifyTab from '~/components/@settings/tabs/netlify/NetlifyTab';
import CloudProvidersTab from '~/components/@settings/tabs/providers/cloud/CloudProvidersTab';
import LocalProvidersTab from '~/components/@settings/tabs/providers/local/LocalProvidersTab';
import McpTab from '~/components/@settings/tabs/mcp/McpTab';
import AiUsageTab from '~/components/@settings/tabs/observability/AiUsageTab';

interface ControlPanelProps {
  open: boolean;
  onClose: () => void;
}

/*
 * Groups the control panel grid into labeled sections, purely for presentation.
 * This does not affect tab visibility/order logic — visibleTabs (driven by
 * tabConfigurationStore) is still the single source of truth for what renders;
 * this just buckets that same list under headings.
 *
 * Control Panel Modernization — ordered Workspace -> AI -> Infrastructure, nearest-to-daily-use
 * first. Section membership is unchanged; only the order of the three groups moved. There is no
 * "Developer" section because this build ships no diagnostics/feature-flag/system-info tab — the
 * `More` fallback below still catches any tab type that is not listed here, so nothing can be
 * silently dropped by adding a section.
 */
const PANEL_SECTIONS: { id: string; label: string; icon: string; tabs: TabType[] }[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'i-ph:squares-four-duotone',
    tabs: ['features', 'data', 'notifications', 'event-logs'],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'i-ph:brain-duotone',
    tabs: ['cloud-providers', 'local-providers', 'mcp'],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    icon: 'i-ph:cloud-arrow-up-duotone',
    tabs: ['github', 'gitlab', 'supabase', 'vercel', 'netlify'],
  },

  /*
   * Observability owns no tab list of its own here — it takes it from the module registry
   * (app/lib/observability/observabilityModules.ts), so a future module becomes visible in this
   * section by flipping its status there rather than by editing this array.
   */
  {
    id: 'observability',
    label: 'Observability',
    icon: 'i-ph:chart-line-up-duotone',
    tabs: observabilityTabIds(),
  },
];

/** Badge text per tab. Only states the app can actually back with data — no invented "Connected"/"Coming Soon". */
const TAB_BADGES: Partial<Record<TabType, string>> = {
  'local-providers': 'Beta',
  mcp: 'Beta',
};

export const ControlPanel = ({ open, onClose }: ControlPanelProps) => {
  // State
  const [activeTab, setActiveTab] = useState<TabType | null>(null);
  const [loadingTab, setLoadingTab] = useState<TabType | null>(null);
  const [showTabManagement, setShowTabManagement] = useState(false);

  // Store values
  const tabConfiguration = useStore(tabConfigurationStore);
  const profile = useStore(profileStore) as Profile;

  // Status hooks
  const { hasNewFeatures, unviewedFeatures, acknowledgeAllFeatures } = useFeatures();
  const { hasUnreadNotifications, unreadNotifications, markAllAsRead } = useNotifications();
  const { hasConnectionIssues, currentIssue, acknowledgeIssue } = useConnectionStatus();

  // Memoize the base tab configurations to avoid recalculation
  const baseTabConfig = useMemo(() => {
    return new Map(DEFAULT_TAB_CONFIG.map((tab) => [tab.id, tab]));
  }, []);

  // Add visibleTabs logic using useMemo with optimized calculations
  const visibleTabs = useMemo(() => {
    if (!tabConfiguration?.userTabs || !Array.isArray(tabConfiguration.userTabs)) {
      console.warn('Invalid tab configuration, resetting to defaults');
      resetTabConfiguration();

      return [];
    }

    const notificationsDisabled = profile?.preferences?.notifications === false;

    // Optimize user mode tab filtering
    return tabConfiguration.userTabs
      .filter((tab) => {
        if (!tab?.id) {
          return false;
        }

        if (tab.id === 'notifications' && notificationsDisabled) {
          return false;
        }

        return tab.visible && tab.window === 'user';
      })
      .sort((a, b) => a.order - b.order);
  }, [tabConfiguration, profile?.preferences?.notifications, baseTabConfig]);

  // Reset to default view when modal opens/closes
  useEffect(() => {
    if (!open) {
      // Reset when closing
      setActiveTab(null);
      setLoadingTab(null);
      setShowTabManagement(false);
    } else {
      // When opening, set to null to show the main view
      setActiveTab(null);
    }
  }, [open]);

  // Handle closing
  const handleClose = () => {
    setActiveTab(null);
    setLoadingTab(null);
    setShowTabManagement(false);
    onClose();
  };

  // Handlers
  const handleBack = () => {
    if (showTabManagement) {
      setShowTabManagement(false);
    } else if (activeTab) {
      setActiveTab(null);
    }
  };

  const getTabComponent = (tabId: TabType) => {
    switch (tabId) {
      case 'profile':
        return <ProfileTab />;
      case 'settings':
        return <SettingsTab />;
      case 'notifications':
        return <NotificationsTab />;
      case 'features':
        return <FeaturesTab />;
      case 'data':
        return <DataTab />;
      case 'cloud-providers':
        return <CloudProvidersTab />;
      case 'local-providers':
        return <LocalProvidersTab />;
      case 'github':
        return <GitHubTab />;
      case 'gitlab':
        return <GitLabTab />;
      case 'supabase':
        return <SupabaseTab />;
      case 'vercel':
        return <VercelTab />;
      case 'netlify':
        return <NetlifyTab />;
      case 'event-logs':
        return <EventLogsTab />;
      case 'mcp':
        return <McpTab />;
      case 'ai-usage':
        return <AiUsageTab />;

      default:
        return null;
    }
  };

  const getTabUpdateStatus = (tabId: TabType): boolean => {
    switch (tabId) {
      case 'features':
        return hasNewFeatures;
      case 'notifications':
        return hasUnreadNotifications;
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        return hasConnectionIssues;
      default:
        return false;
    }
  };

  const getStatusMessage = (tabId: TabType): string => {
    switch (tabId) {
      case 'features':
        return `${unviewedFeatures.length} new feature${unviewedFeatures.length === 1 ? '' : 's'} to explore`;
      case 'notifications':
        return `${unreadNotifications.length} unread notification${unreadNotifications.length === 1 ? '' : 's'}`;
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        return currentIssue === 'disconnected'
          ? 'Connection lost'
          : currentIssue === 'high-latency'
            ? 'High latency detected'
            : 'Connection issues detected';
      default:
        return '';
    }
  };

  const handleTabClick = (tabId: TabType) => {
    setLoadingTab(tabId);
    setActiveTab(tabId);
    setShowTabManagement(false);

    // Acknowledge notifications based on tab
    switch (tabId) {
      case 'features':
        acknowledgeAllFeatures();
        break;
      case 'notifications':
        markAllAsRead();
        break;
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        acknowledgeIssue();
        break;
    }

    // Clear loading state after a delay
    setTimeout(() => setLoadingTab(null), 500);
  };

  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <div className="fixed inset-0 flex items-center justify-center z-[100] modern-scrollbar">
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />

          <RadixDialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={handleClose}
            onPointerDownOutside={handleClose}
            className="relative z-[101]"
          >
            {/*
              Height follows content up to a ceiling instead of always claiming 90vh. With the
              compact cards the landing grid is ~600px tall, so a fixed 90vh left a large empty
              band under the last section; drilled-into tabs still grow to the full 88vh.
            */}
            <div
              className={classNames(
                'w-[min(1120px,94vw)] max-h-[88vh] min-h-[420px]',
                'bg-bolt-elements-background-depth-1',
                'rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor',
                'flex flex-col overflow-hidden',
                'relative',
                'transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              <div className="absolute inset-0 overflow-hidden rounded-2xl">
                <BackgroundRays />
              </div>
              {/*
                `flex-1 min-h-0`, not `h-full`. The panel's height is now capped by `max-h` rather than
                fixed, so it has no definite height for a percentage to resolve against — `h-full`
                silently became `auto`, the scroller below grew to its content instead of scrolling, and
                the outer `overflow-hidden` clipped the final card with no way to reach it. `min-h-0` is
                what lets the scroller shrink below its content inside this flex column.
              */}
              <div className="relative z-10 flex flex-col flex-1 min-h-0">
                {/* Header — title carries a subtitle on the landing view only; a drilled-into tab keeps its own name alone. */}
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-bolt-elements-borderColor/60">
                  <div className="flex items-start gap-3 min-w-0">
                    {(activeTab || showTabManagement) && (
                      <button
                        onClick={handleBack}
                        aria-label="Back"
                        className="flex items-center justify-center w-8 h-8 mt-0.5 shrink-0 rounded-lg bg-transparent border-0 appearance-none hover:bg-builders-brand-subtleSurface group transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
                      >
                        <div className="i-ph:arrow-left w-4 h-4 text-bolt-elements-textSecondary group-hover:text-builders-brand-primary transition-colors" />
                      </button>
                    )}
                    <div className="min-w-0">
                      <DialogTitle className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary truncate">
                        {showTabManagement ? 'Tab Management' : activeTab ? TAB_LABELS[activeTab] : 'Control Panel'}
                      </DialogTitle>
                      {!activeTab && !showTabManagement && (
                        <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">
                          Configure Builders, AI providers, infrastructure and workspace preferences.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <AvatarDropdown onSelectTab={handleTabClick} />

                    <button
                      onClick={handleClose}
                      aria-label="Close control panel"
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-transparent border-0 appearance-none hover:bg-builders-brand-subtleSurface group transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
                    >
                      <div className="i-ph:x w-4 h-4 text-bolt-elements-textSecondary group-hover:text-builders-brand-primary transition-colors" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div
                  className={classNames(
                    'flex-1 min-h-0',
                    'overflow-y-auto',
                    'hover:overflow-y-auto',
                    'scrollbar scrollbar-w-2',
                    'scrollbar-track-transparent',
                    'scrollbar-thumb-bolt-elements-borderColor hover:scrollbar-thumb-purple-500/30',
                    'dark:scrollbar-thumb-[#333333] dark:hover:scrollbar-thumb-purple-500/30',
                    'will-change-scroll',
                    'touch-auto',
                  )}
                >
                  <div className="px-6 py-5">
                    {activeTab ? (
                      getTabComponent(activeTab)
                    ) : (
                      <div className="flex flex-col gap-6">
                        {(() => {
                          let tileIndex = 0;
                          const sectioned = PANEL_SECTIONS.map((section) => ({
                            ...section,
                            items: visibleTabs.filter((tab) => section.tabs.includes(tab.id as TabType)),
                          })).filter((section) => section.items.length > 0);

                          /*
                           * Anything not covered by a named section (e.g. a future tab type)
                           * still renders, grouped under "More", so nothing is ever silently hidden.
                           */
                          const sectionedIds = new Set(PANEL_SECTIONS.flatMap((section) => section.tabs));
                          const remaining = visibleTabs.filter((tab) => !sectionedIds.has(tab.id as TabType));

                          if (remaining.length > 0) {
                            sectioned.push({
                              id: 'more',
                              label: 'More',
                              icon: 'i-ph:dots-three-circle-duotone',
                              tabs: remaining.map((tab) => tab.id as TabType),
                              items: remaining,
                            });
                          }

                          return sectioned.map((section) => (
                            <div key={section.id}>
                              <div className="flex items-center gap-2 mb-3">
                                <div className={classNames(section.icon, 'w-4 h-4 text-builders-brand-primary')} />
                                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bolt-elements-textSecondary">
                                  {section.label}
                                </h2>
                                {/* textSecondary, not textTertiary: tertiary measures 4.18:1 here in dark theme, under the AA floor for 11px text. */}
                                <span className="text-[11px] text-bolt-elements-textSecondary tabular-nums">
                                  {section.items.length}
                                </span>
                                <div className="flex-1 h-px bg-bolt-elements-borderColor/50" />
                              </div>
                              {/*
                                Two columns, not three. The dialog is width-capped, so a third column only
                                narrows each card to ~355px — enough to truncate the longer descriptions
                                ("Configure MCP (Model Context Protocol) servers") without buying any
                                vertical space worth having. At two columns every description fits whole and
                                all twelve cards still land on one screen.
                              */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {section.items.map((tab) => {
                                  const index = tileIndex++;

                                  return (
                                    <div
                                      key={tab.id}
                                      style={{
                                        animationDelay: `${index * 20}ms`,
                                        animation: open ? 'fadeInUp 180ms ease-out forwards' : 'none',
                                      }}
                                    >
                                      <TabTile
                                        tab={tab}
                                        onClick={() => handleTabClick(tab.id as TabType)}
                                        isActive={activeTab === tab.id}
                                        hasUpdate={getTabUpdateStatus(tab.id)}
                                        statusMessage={getStatusMessage(tab.id)}
                                        description={TAB_DESCRIPTIONS[tab.id]}
                                        isLoading={loadingTab === tab.id}
                                        badge={TAB_BADGES[tab.id as TabType]}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};
