/**
 * Builders Observability — display formatting.
 *
 * One rule, applied everywhere: a `null`/`undefined` value renders as `—`, never as `0`,
 * `$0.00` or `0ms`. A provider that reports no token counts, or a model with no configured
 * price, must be visibly distinct from one that genuinely used nothing. Kept in a plain `.ts`
 * module so it is unit-testable without rendering the dashboard.
 */

/** The single placeholder for "we don't have this value". */
export const EMPTY_VALUE = '—';

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY_VALUE : value.toLocaleString();
}

/** Compact token counts: 1234 -> 1.2K, 1234567 -> 1.2M. Exact below 1000, so small numbers stay readable. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY_VALUE;
  }

  if (value < 1_000) {
    return String(value);
  }

  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * USD. Sub-cent amounts keep four decimals — a single AI call often costs less than $0.01, and
 * rounding those to `$0.00` would make a working cost tracker look broken.
 */
export function formatCostUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY_VALUE;
  }

  if (value === 0) {
    return '$0.00';
  }

  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return EMPTY_VALUE;
  }

  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`;
}

/** Time-of-day for the recent-requests table; the range filter already establishes the day. */
export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? EMPTY_VALUE
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
