import * as React from 'react';
import { classNames } from '~/utils/classNames';

/**
 * Builders Design System (Sprint 69) — a token-driven text input. Deliberately resets every
 * native browser affordance the audit flagged as a leak risk (autofill's light-blue background,
 * the default light-mode focus outline, native border/shadow) so no light/native-browser
 * surface can appear in dark mode. Always renders a real `<label>` — `label` is a required
 * prop, not optional, so a Builders input can't ship unlabeled.
 */

export interface BuildersInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;

  /** Visually hides the label while keeping it in the accessibility tree (for compact layouts where a placeholder communicates purpose well enough visually). */
  hideLabel?: boolean;
  error?: string;
  hint?: string;
}

const BuildersInput = React.forwardRef<HTMLInputElement, BuildersInputProps>(
  ({ className, label, hideLabel = false, error, hint, id, disabled, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className={classNames('text-xs font-medium text-builders-text-secondary', hideLabel && 'sr-only')}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={classNames(hintId, errorId) || undefined}
          className={classNames(
            'builders-transition builders-focus-ring builders-radius-md h-9 px-3 text-sm w-full',
            'bg-builders-surface-recessed text-builders-text-primary placeholder:text-builders-text-muted',
            'border appearance-none',
            error ? 'border-builders-status-error-border' : 'border-builders-border-default',
            'disabled:opacity-50 disabled:cursor-not-allowed',

            // Neutralizes native autofill's light-blue background so no browser-default surface leaks through in dark mode.
            '[&:-webkit-autofill]:[-webkit-text-fill-color:var(--builders-text-primary)] [&:-webkit-autofill]:[-webkit-box-shadow:0_0_0px_1000px_var(--builders-surface-recessed)_inset]',
            className,
          )}
          {...props}
        />
        {hint && !error && (
          <span id={hintId} className="text-xs text-builders-text-tertiary">
            {hint}
          </span>
        )}
        {error && (
          <span id={errorId} className="text-xs text-builders-status-error-text">
            {error}
          </span>
        )}
      </div>
    );
  },
);
BuildersInput.displayName = 'BuildersInput';

export { BuildersInput };
