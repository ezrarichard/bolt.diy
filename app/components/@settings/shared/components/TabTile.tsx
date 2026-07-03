import * as Tooltip from '@radix-ui/react-tooltip';
import { classNames } from '~/utils/classNames';
import type { TabVisibilityConfig } from '~/components/@settings/core/types';
import { TAB_LABELS, TAB_ICONS } from '~/components/@settings/core/constants';
import { GlowingEffect } from '~/components/ui/GlowingEffect';

interface TabTileProps {
  tab: TabVisibilityConfig;
  onClick?: () => void;
  isActive?: boolean;
  hasUpdate?: boolean;
  statusMessage?: string;
  description?: string;
  isLoading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const TabTile: React.FC<TabTileProps> = ({
  tab,
  onClick,
  isActive,
  hasUpdate,
  statusMessage,
  description,
  isLoading,
  className,
  children,
}: TabTileProps) => {
  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className={classNames('min-h-[160px] list-none', className || '')}>
            <div className="relative h-full rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-0.5">
              <GlowingEffect
                blur={0}
                borderWidth={1}
                spread={20}
                glow={true}
                disabled={false}
                proximity={40}
                inactiveZone={0.3}
                movementDuration={0.4}
              />
              <div
                onClick={onClick}
                role="button"
                tabIndex={isLoading ? -1 : 0}
                onKeyDown={(event) => {
                  if (!isLoading && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onClick?.();
                  }
                }}
                className={classNames(
                  'relative flex flex-col items-center justify-center h-full p-5 rounded-xl',
                  'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
                  'border border-black/[0.05] dark:border-white/[0.05]',
                  'group cursor-pointer',
                  'shadow-sm hover:shadow-lg hover:shadow-purple-500/5 dark:hover:shadow-black/20',
                  'hover:-translate-y-0.5 hover:border-purple-500/25 dark:hover:border-purple-500/20',
                  'hover:bg-[#F1EFFB]/90 dark:hover:bg-[#1e1e1e]/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bolt-elements-background-depth-1',
                  'transition-all duration-200 ease-out',
                  isActive
                    ? 'bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/30 dark:border-purple-500/25'
                    : '',
                  isLoading ? 'cursor-wait opacity-70 pointer-events-none' : '',
                )}
              >
                {/* Icon */}
                <div
                  className={classNames(
                    'relative',
                    'w-12 h-12',
                    'flex items-center justify-center',
                    'rounded-full',
                    'bg-purple-500/8 dark:bg-purple-500/10',
                    'ring-1 ring-purple-500/10 dark:ring-purple-500/15',
                    'group-hover:bg-purple-500/15 dark:group-hover:bg-purple-500/20',
                    'group-hover:ring-purple-500/30 dark:group-hover:ring-purple-500/30',
                    'group-hover:scale-105',
                    'transition-all duration-200 ease-out',
                    isActive ? 'bg-purple-500/15 dark:bg-purple-500/20 ring-purple-500/40 dark:ring-purple-500/40' : '',
                  )}
                >
                  {(() => {
                    const IconComponent = TAB_ICONS[tab.id];
                    return (
                      <IconComponent
                        className={classNames(
                          'w-6 h-6',
                          'text-purple-600/80 dark:text-purple-400/80',
                          'group-hover:text-purple-600 dark:group-hover:text-purple-300',
                          'transition-colors duration-200 ease-out',
                          isActive ? 'text-purple-600 dark:text-purple-300' : '',
                        )}
                      />
                    );
                  })()}
                </div>

                {/* Label and Description */}
                <div className="flex flex-col items-center mt-4 w-full">
                  <h3
                    className={classNames(
                      'text-[14px] font-semibold tracking-tight leading-snug mb-1.5',
                      'text-bolt-elements-textPrimary',
                      'group-hover:text-purple-600 dark:group-hover:text-purple-300/90',
                      'transition-colors duration-200 ease-out',
                      isActive ? 'text-purple-600 dark:text-purple-400/90' : '',
                    )}
                  >
                    {TAB_LABELS[tab.id]}
                  </h3>
                  {description && (
                    <p
                      className={classNames(
                        'text-[12px] leading-relaxed',
                        'text-bolt-elements-textTertiary',
                        'max-w-[85%]',
                        'text-center',
                        'group-hover:text-purple-500/80 dark:group-hover:text-purple-400/70',
                        'transition-colors duration-200 ease-out',
                        isActive ? 'text-purple-400 dark:text-purple-400/80' : '',
                      )}
                    >
                      {description}
                    </p>
                  )}
                </div>

                {/* Update Indicator with Tooltip */}
                {hasUpdate && (
                  <>
                    <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-purple-500 dark:bg-purple-400 animate-pulse" />
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className={classNames(
                          'px-3 py-1.5 rounded-lg',
                          'bg-[#18181B] text-white',
                          'text-sm font-medium',
                          'select-none',
                          'z-[100]',
                        )}
                        side="top"
                        sideOffset={5}
                      >
                        {statusMessage}
                        <Tooltip.Arrow className="fill-[#18181B]" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </>
                )}

                {/* Children (e.g. Beta Label) */}
                {children}
              </div>
            </div>
          </div>
        </Tooltip.Trigger>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
