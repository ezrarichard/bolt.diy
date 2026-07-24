import * as React from 'react';
import { classNames } from '~/utils/classNames';
import { BUILDERS_STATUS_META, type BuildersStatus } from './statusMeta';

/**
 * Builders Design System (Sprint 69) — the single shared status badge, replacing the five
 * independently hand-rolled status-color maps the audit found (see `statusMeta.ts`'s header
 * comment for the full list). Always renders an icon AND a text label alongside color — status
 * is never color-only, per the sprint's Accessibility section.
 */

export interface BuildersStatusBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: BuildersStatus;

  /** Overrides the default label from `statusMeta.ts` (e.g. "Changes Requested" instead of the generic "Error"). The icon and color still come from `status`. */
  label?: string;

  /** Renders only the icon + a screen-reader-only label — for dense rows (e.g. a table cell) where the full pill would be too wide. The status is still announced to assistive tech, just not shown visually as text. */
  compact?: boolean;
}

const BuildersStatusBadge = React.forwardRef<HTMLSpanElement, BuildersStatusBadgeProps>(
  ({ status, label, compact = false, className, ...props }, ref) => {
    const meta = BUILDERS_STATUS_META[status];
    const displayLabel = label ?? meta.label;

    return (
      <span
        ref={ref}
        className={classNames(
          'builders-radius-pill inline-flex items-center gap-1.5 border text-xs font-medium',
          compact ? 'w-6 h-6 justify-center' : 'px-2 py-0.5',
          meta.textClass,
          meta.borderClass,
          meta.bgClass,
          className,
        )}
        {...props}
      >
        <span
          className={classNames(
            meta.icon,
            'w-3.5 h-3.5 shrink-0',
            meta.animated && 'animate-spin motion-reduce:animate-none',
          )}
          aria-hidden="true"
        />
        {compact ? <span className="sr-only">{displayLabel}</span> : displayLabel}
      </span>
    );
  },
);
BuildersStatusBadge.displayName = 'BuildersStatusBadge';

export { BuildersStatusBadge };
export type { BuildersStatus };
