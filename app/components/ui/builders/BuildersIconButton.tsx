import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — an icon-only button. Separate from `BuildersButton`
 * (rather than just `BuildersButton size="icon"`) because an icon-only control has a hard
 * accessibility requirement `BuildersButton` doesn't: it MUST have an accessible label, since
 * there's no visible text for assistive tech to read. `aria-label` is a required prop here, not
 * optional, so this can't ship without one.
 */

const buildersIconButtonVariants = cva(
  'builders-transition builders-focus-ring builders-radius-md inline-flex items-center justify-center disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost:
          'bg-transparent text-builders-text-secondary hover:bg-builders-surface-hover hover:text-builders-text-primary',
        outline:
          'bg-transparent text-builders-text-primary border border-builders-border-default hover:bg-builders-surface-hover',
      },
      size: {
        sm: 'w-7 h-7 text-sm',
        md: 'w-9 h-9 text-base',
        lg: 'w-11 h-11 text-lg',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
);

export interface BuildersIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buildersIconButtonVariants> {
  /** The icon class, e.g. `"i-ph:x"`. Rendered as a decorative `<span>` — the accessible name comes from `aria-label` below. */
  icon: string;
  ariaLabel: string;
}

const BuildersIconButton = React.forwardRef<HTMLButtonElement, BuildersIconButtonProps>(
  ({ className, variant, size, icon, ariaLabel, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        className={classNames(buildersIconButtonVariants({ variant, size }), className)}
        {...props}
      >
        <span className={icon} aria-hidden="true" />
      </button>
    );
  },
);
BuildersIconButton.displayName = 'BuildersIconButton';

export { BuildersIconButton, buildersIconButtonVariants };
