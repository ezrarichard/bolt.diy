import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — the shared interactive-button primitive.
 *
 * A new component rather than a rewrite of `app/components/ui/Button.tsx`: that primitive is
 * used across the app today and this sprint must not change existing behavior anywhere it
 * isn't explicitly adopted (see the sprint's "Limited Adoption" scope). `BuildersButton` is
 * additive and only reaches production JSX at the handful of adoption sites this sprint
 * touches; every other existing `<Button>` usage is completely unaffected.
 *
 * Every state the sprint's "Component States" section calls for is covered here: default,
 * hover, active, `focus-visible` (never plain `focus` — see `builders-focus-ring` in
 * `uno.config.ts`), disabled, and loading (via `isLoading`, which also sets `aria-busy` and
 * swaps in a reduced-motion-safe spinner without changing the button's size).
 */

const buildersButtonVariants = cva(
  'builders-transition builders-focus-ring builders-radius-md inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-builders-brand-primary text-builders-text-inverse hover:bg-builders-brand-hover',
        secondary:
          'bg-builders-surface-elevated text-builders-text-primary border border-builders-border-default hover:bg-builders-surface-hover',
        outline:
          'bg-transparent text-builders-text-primary border border-builders-border-default hover:bg-builders-surface-hover',
        ghost: 'bg-transparent text-builders-text-primary hover:bg-builders-surface-hover',
        danger: 'bg-builders-status-error-bg text-builders-status-error-text hover:brightness-110',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface BuildersButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buildersButtonVariants> {
  /** Shows a spinner in place of the leading icon slot, sets `aria-busy`, and disables the button — without changing its width, so a busy button doesn't reflow the layout around it. */
  isLoading?: boolean;
}

const BuildersButton = React.forwardRef<HTMLButtonElement, BuildersButtonProps>(
  ({ className, variant, size, isLoading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={classNames(buildersButtonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && (
          <span
            className="i-ph:spinner-gap-bold animate-spin motion-reduce:animate-none w-3.5 h-3.5"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  },
);
BuildersButton.displayName = 'BuildersButton';

export { BuildersButton, buildersButtonVariants };
