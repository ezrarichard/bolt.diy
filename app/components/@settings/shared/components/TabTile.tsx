import * as Tooltip from '@radix-ui/react-tooltip';
import { classNames } from '~/utils/classNames';
import type { TabVisibilityConfig } from '~/components/@settings/core/types';
import { TAB_LABELS, TAB_ICONS } from '~/components/@settings/core/constants';

/**
 * Control Panel settings card — Control Panel Modernization.
 *
 * Was a ~370x250px centre-aligned tile (a 12x12 icon medallion stacked over a centred title and
 * wrapped description, held to `aspect-[1.5/1]` by the caller) which fitted five cards in a
 * 1440x900 viewport. This is the same card as a compact horizontal row — icon, title, one-line
 * description, optional badge, chevron — at a fixed ~68px height, so the whole settings surface is
 * legible at a glance the way Linear/Vercel/Raycast settings are.
 *
 * Behaviour is deliberately unchanged: same props, same `onClick`, same loading/active/update
 * states, same Radix tooltip carrying `statusMessage`. Only presentation moved.
 *
 * Two structural changes worth naming:
 *  - It renders a real `<button>` rather than a `<div role="button">`, so keyboard activation,
 *    focus order and disabled semantics come from the platform instead of hand-rolled key
 *    handling. `appearance-none` + an explicit background are required with it — a bare `<button>`
 *    paints the native `buttonface` grey, the bug ProjectWorkflowBar.tsx documents.
 *  - `GlowingEffect` (a per-card pointer-tracking canvas) is gone in favour of a CSS hover glow:
 *    twelve simultaneous pointer listeners cost more than the effect was worth at this size, and
 *    the CSS version themes correctly from tokens. The component itself is untouched and still
 *    exported for other callers.
 */

interface TabTileProps {
  tab: TabVisibilityConfig;
  onClick?: () => void;
  isActive?: boolean;
  hasUpdate?: boolean;
  statusMessage?: string;
  description?: string;
  isLoading?: boolean;
  className?: string;

  /** Short qualifier shown top-right, e.g. "Beta". Rendered only when provided. */
  badge?: string;
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
  badge,
}: TabTileProps) => {
  const IconComponent = TAB_ICONS[tab.id];

  const card = (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      aria-current={isActive ? 'page' : undefined}
      className={classNames(
        'group relative flex items-center gap-3 w-full h-[68px] px-3.5 rounded-xl text-left',
        'appearance-none border bg-bolt-elements-background-depth-2/70 backdrop-blur-sm',
        'transition-all duration-200 ease-out',
        'hover:-translate-y-px hover:bg-bolt-elements-background-depth-2',
        'hover:border-builders-brand-primary/50 hover:shadow-lg hover:shadow-builders-brand-primary/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bolt-elements-background-depth-1',
        isActive
          ? 'border-builders-brand-primary/60 bg-builders-brand-subtleSurface'
          : 'border-bolt-elements-borderColor/60',
        isLoading ? 'cursor-wait opacity-60' : 'cursor-pointer',
        className || '',
      )}
    >
      <span
        className={classNames(
          'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
          'transition-colors duration-200 ease-out',
          isActive
            ? 'border-builders-brand-primary/50 bg-builders-brand-subtleSurface'
            : 'border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
          'group-hover:border-builders-brand-primary/50 group-hover:bg-builders-brand-subtleSurface',
        )}
      >
        <IconComponent className="w-[18px] h-[18px] text-builders-brand-primary" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block text-[13px] font-semibold leading-tight text-bolt-elements-textPrimary truncate">
            {TAB_LABELS[tab.id]}
          </span>
          {hasUpdate && (
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-builders-brand-primary shrink-0 animate-pulse" />
          )}
        </span>
        {description && (
          <span className="block mt-0.5 text-[11px] leading-tight text-bolt-elements-textSecondary truncate">
            {description}
          </span>
        )}
      </span>

      {badge && (
        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-builders-brand-subtleSurface text-builders-brand-primary border border-builders-brand-primary/30">
          {badge}
        </span>
      )}

      {/* Click affordance — nudges right on hover, the one bit of icon motion in the card. */}
      <span
        aria-hidden
        className="i-ph:caret-right w-3.5 h-3.5 shrink-0 text-bolt-elements-textTertiary transition-all duration-200 group-hover:text-builders-brand-primary group-hover:translate-x-0.5"
      />
    </button>
  );

  /* Only cards that actually have something to say get a tooltip — previously every card mounted a Provider/Root pair. */
  if (!hasUpdate || !statusMessage) {
    return card;
  }

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{card}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className={classNames(
              'px-2.5 py-1.5 rounded-lg z-[110] select-none',
              'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary',
              'border border-bolt-elements-borderColor shadow-lg',
              'text-xs font-medium',
            )}
            side="top"
            sideOffset={6}
          >
            {statusMessage}
            <Tooltip.Arrow className="fill-bolt-elements-borderColor" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
