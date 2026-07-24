import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — the base surface primitive every elevated/recessed
 * panel, card, or popover-like block should build on, so surface hierarchy (Part 2 of the
 * sprint brief: primary / elevated / recessed) is expressed through one shared component
 * instead of each feature retyping `rounded-xl border ... bg-...` (the audit found this pattern
 * duplicated independently in `WebSearch.client.tsx`, `LLMApiAlert.tsx`, `ChatAlert.tsx`,
 * `DeployAlert.tsx`, and others).
 */

const buildersSurfaceVariants = cva('builders-transition text-builders-text-primary', {
  variants: {
    elevation: {
      primary: 'bg-builders-surface-primary',
      elevated: 'bg-builders-surface-elevated',
      recessed: 'bg-builders-surface-recessed',
    },
    border: {
      none: '',
      subtle: 'border border-builders-border-subtle',
      default: 'border border-builders-border-default',
      selected: 'border border-builders-border-selected',
    },
    radius: {
      sm: 'builders-radius-sm',
      md: 'builders-radius-md',
      lg: 'builders-radius-lg',
    },
    shadow: {
      none: '',
      sm: 'builders-shadow-sm',
      md: 'builders-shadow-md',
      lg: 'builders-shadow-lg',
    },
  },
  defaultVariants: {
    elevation: 'elevated',
    border: 'default',
    radius: 'lg',
    shadow: 'none',
  },
});

export interface BuildersSurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof buildersSurfaceVariants> {}

const BuildersSurface = React.forwardRef<HTMLDivElement, BuildersSurfaceProps>(
  ({ className, elevation, border, radius, shadow, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={classNames(buildersSurfaceVariants({ elevation, border, radius, shadow }), className)}
        {...props}
      />
    );
  },
);
BuildersSurface.displayName = 'BuildersSurface';

export { BuildersSurface, buildersSurfaceVariants };
