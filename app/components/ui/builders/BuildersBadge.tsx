import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — a generic, non-status badge/chip (counts, labels,
 * categories). For status-specific badges (approved / pending / blocked / ...), use
 * `BuildersStatusBadge` instead, which pairs color with an icon and label so status is never
 * communicated by color alone.
 */

const buildersBadgeVariants = cva(
  'builders-radius-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border',
  {
    variants: {
      variant: {
        neutral: 'bg-builders-surface-elevated text-builders-text-secondary border-builders-border-default',
        brand: 'bg-builders-brand-subtleSurface text-builders-brand-primary border-transparent',
        outline: 'bg-transparent text-builders-text-primary border-builders-border-default',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BuildersBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof buildersBadgeVariants> {}

const BuildersBadge = React.forwardRef<HTMLSpanElement, BuildersBadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={classNames(buildersBadgeVariants({ variant }), className)} {...props} />
));
BuildersBadge.displayName = 'BuildersBadge';

export { BuildersBadge, buildersBadgeVariants };
