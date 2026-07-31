import type { ReactNode } from 'react';
import { classNames } from '~/utils/classNames';
import type { HealthStatus } from '~/lib/observability/health/systemHealth';

/**
 * Builders Observability — shared presentational primitives.
 *
 * Extracted so AI Usage, Performance and every future Observability module render the same
 * surfaces rather than each growing its own `Panel`/`Stat`. Purely presentational: no data
 * fetching, no stores, no module-specific knowledge.
 */

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 backdrop-blur-sm',
        className || '',
      )}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-bolt-elements-borderColor/50">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bolt-elements-textSecondary">
          {title}
        </h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-bolt-elements-textSecondary truncate">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-bolt-elements-textPrimary tabular-nums truncate">{value}</div>
      {hint && <div className="text-[10px] text-bolt-elements-textSecondary truncate">{hint}</div>}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-bolt-elements-textSecondary">{children}</p>;
}

/**
 * Health dot. `not-configured` is a neutral grey, never red — an integration the user chose not to
 * set up is not a fault, and colouring it as one trains people to ignore the indicator.
 */
export const HEALTH_DOT_CLASS: Record<HealthStatus, string> = {
  healthy: 'bg-builders-status-success-border',
  warning: 'bg-builders-status-warning-border',
  offline: 'bg-builders-status-error-border',
  'not-configured': 'bg-bolt-elements-textTertiary/50',
};

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  offline: 'Offline',
  'not-configured': 'Not configured',
};

export function HealthDot({ status, className }: { status: HealthStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={classNames(
        'inline-block w-1.5 h-1.5 rounded-full shrink-0',
        HEALTH_DOT_CLASS[status],
        className || '',
      )}
    />
  );
}

/** A horizontal proportion bar. Always shows a sliver for a non-zero value so small rows stay visible. */
export function ProportionBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-1 h-1 rounded-full bg-bolt-elements-background-depth-3 overflow-hidden">
      <div
        className="h-full rounded-full bg-builders-brand-primary/70"
        style={{ width: `${max <= 0 ? 0 : Math.max((value / max) * 100, 2)}%` }}
      />
    </div>
  );
}

export function StatusBadge({ status }: { status: 'success' | 'failed' | 'cancelled' }) {
  return (
    <span
      className={classNames(
        'px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap',
        status === 'success'
          ? 'text-builders-status-success-text border-builders-status-success-border/40 bg-builders-status-success-bg'
          : status === 'failed'
            ? 'text-builders-status-error-text border-builders-status-error-border/40 bg-builders-status-error-bg'
            : 'text-bolt-elements-textSecondary border-bolt-elements-borderColor/50',
      )}
    >
      {status}
    </span>
  );
}
