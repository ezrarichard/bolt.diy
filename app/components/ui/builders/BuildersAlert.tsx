import * as React from 'react';
import { classNames } from '~/utils/classNames';
import { BUILDERS_STATUS_META } from './statusMeta';

/**
 * Builders Design System (Sprint 69) — a token-driven alert/inline-notice block. Replaces the
 * pattern independently retyped in `WebSearch.client.tsx`, `LLMApiAlert.tsx`, `ChatAlert.tsx`,
 * and `DeployAlert.tsx` (each hand-rolling `rounded-lg border ... bg-...` for what is
 * structurally the same "alert" concept) — not migrated in this sprint (out of the Part 12
 * adoption list), but available for those and future call sites.
 */

export type BuildersAlertVariant = 'success' | 'warning' | 'error' | 'info';

export interface BuildersAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: BuildersAlertVariant;
  title?: string;
}

const BuildersAlert = React.forwardRef<HTMLDivElement, BuildersAlertProps>(
  ({ variant, title, className, children, ...props }, ref) => {
    const meta = BUILDERS_STATUS_META[variant];

    return (
      <div
        ref={ref}
        role="alert"
        className={classNames(
          'builders-radius-md border px-4 py-3 flex gap-3',
          meta.bgClass,
          meta.borderClass,
          className,
        )}
        {...props}
      >
        <span className={classNames(meta.icon, meta.textClass, 'w-4 h-4 shrink-0 mt-0.5')} aria-hidden="true" />
        <div className="flex flex-col gap-0.5 min-w-0">
          {title && <div className={classNames('text-sm font-semibold', meta.textClass)}>{title}</div>}
          {children && <div className="text-sm text-builders-text-secondary">{children}</div>}
        </div>
      </div>
    );
  },
);
BuildersAlert.displayName = 'BuildersAlert';

export { BuildersAlert };
