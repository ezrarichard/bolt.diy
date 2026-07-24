import * as React from 'react';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — the page-level heading primitive ("Page title" step of
 * the typography scale — one step above `BuildersSectionHeader`'s "Section title"). Intended
 * for the top of a workflow/dashboard area, e.g. the Project workflow header this sprint
 * adopts it in (Part 12, target #1).
 */

export interface BuildersPageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;

  /** An icon or small chip rendered before the title, e.g. a status pill. */
  eyebrow?: React.ReactNode;
}

const BuildersPageHeader = React.forwardRef<HTMLDivElement, BuildersPageHeaderProps>(
  ({ title, description, actions, eyebrow, className, ...props }, ref) => (
    <div ref={ref} className={classNames('flex items-start justify-between gap-4', className)} {...props}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-lg font-semibold text-builders-text-primary tracking-tight truncate">{title}</h1>
        {description && <p className="text-sm text-builders-text-secondary mt-1">{description}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  ),
);
BuildersPageHeader.displayName = 'BuildersPageHeader';

export { BuildersPageHeader };
