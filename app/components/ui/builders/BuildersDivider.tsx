import * as React from 'react';
import { classNames } from '~/utils/classNames';

/** Builders Design System (Sprint 69) — a token-driven divider, horizontal or vertical. */

export interface BuildersDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

const BuildersDivider = React.forwardRef<HTMLDivElement, BuildersDividerProps>(
  ({ orientation = 'horizontal', className, ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      className={classNames(
        'bg-builders-border-subtle',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className,
      )}
      {...props}
    />
  ),
);
BuildersDivider.displayName = 'BuildersDivider';

export { BuildersDivider };
