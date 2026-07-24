import * as React from 'react';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — a section-level heading with an optional trailing
 * action slot (e.g. a "View all" link or filter control). Uses the "Section title" step of the
 * typography scale (`docs/design-system/Builders-Design-System.md`); for page-level headings
 * use `BuildersPageHeader` instead, which sits one step up ("Page title").
 */

export interface BuildersSectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const BuildersSectionHeader = React.forwardRef<HTMLDivElement, BuildersSectionHeaderProps>(
  ({ title, description, action, className, ...props }, ref) => (
    <div ref={ref} className={classNames('flex items-start justify-between gap-4 mb-3', className)} {...props}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-builders-text-primary tracking-tight">{title}</h2>
        {description && <p className="text-xs text-builders-text-secondary mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  ),
);
BuildersSectionHeader.displayName = 'BuildersSectionHeader';

export { BuildersSectionHeader };
