import { useMemo, useState } from 'react';
import { analyzePerformance } from '~/lib/observability/ai-usage/aiUsageAnalytics';
import { formatRoleLabel } from '~/lib/observability/ai-usage/aiUsageAggregations';
import { EMPTY_VALUE, formatCostUsd, formatCount, formatLatency, formatTokens } from './observabilityFormat';
import { EmptyNote, Panel, ProportionBar, Stat } from './ObservabilityPrimitives';
import { ObservabilityFilterBar } from './ObservabilityFilterBar';
import { DEFAULT_FILTERS, useObservabilityData, type ObservabilityFilters } from './useObservabilityData';
import { SystemHealthPanel } from './SystemHealthPanel';

/**
 * Builders Observability — Performance module.
 *
 * The second Observability module. It stores nothing of its own and adds no query: every figure is
 * derived from the SAME `builders_ai_usage_events` rows AI Usage reads, through the same shared
 * hook and the same pure `analyzePerformance()` (unit-tested in aiUsageAnalytics.spec.ts).
 *
 * Rates over an empty set render as "—" rather than a confident 100%.
 */

function percent(value: number | null): string {
  return value === null ? EMPTY_VALUE : `${value}%`;
}

export default function PerformanceTab() {
  const [filters, setFilters] = useState<ObservabilityFilters>({ ...DEFAULT_FILTERS, range: '7d' });
  const { events, summaryEvents, available, loading } = useObservabilityData(filters);

  const metrics = useMemo(() => analyzePerformance(events), [events]);

  const roleLatencies = useMemo(() => {
    const byRole = new Map<string, { total: number; count: number }>();

    for (const event of events) {
      if (event.durationMs === null) {
        continue;
      }

      const key = event.roleKey ?? event.requestType;
      const entry = byRole.get(key) ?? { total: 0, count: 0 };
      entry.total += event.durationMs;
      entry.count += 1;
      byRole.set(key, entry);
    }

    return [...byRole.entries()]
      .map(([key, entry]) => ({ key, average: Math.round(entry.total / entry.count), requests: entry.count }))
      .sort((a, b) => b.average - a.average);
  }, [events]);

  if (!available && !loading) {
    return (
      <div className="rounded-xl border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 px-4 py-8 text-center">
        <div className="i-ph:cloud-slash-duotone w-6 h-6 mx-auto text-bolt-elements-textSecondary" />
        <p className="mt-2 text-sm text-bolt-elements-textPrimary">Performance data is unavailable</p>
        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
          Builders could not reach the usage ledger. This does not affect AI generation.
        </p>
      </div>
    );
  }

  const maxLatency = roleLatencies[0]?.average ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-bolt-elements-textSecondary">
          Derived from the same AI usage ledger — no separate metrics are stored.
        </p>
        <ObservabilityFilterBar filters={filters} onChange={setFilters} summaryEvents={summaryEvents} />
      </div>

      <Panel title="Throughput & Reliability">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Requests" value={formatCount(metrics.requests)} />
          <Stat label="Avg Latency" value={formatLatency(metrics.averageLatencyMs)} />
          <Stat label="Success Rate" value={percent(metrics.successRatePercent)} />
          <Stat label="Failure Rate" value={percent(metrics.failureRatePercent)} />
          <Stat
            label="Requests / min"
            value={metrics.requestsPerMinute === null ? EMPTY_VALUE : String(metrics.requestsPerMinute)}
          />
          <Stat
            label="Avg Tokens"
            value={formatTokens(metrics.averageTokensPerRequest)}
            hint={`${formatCostUsd(metrics.averageCostPerRequest)} avg cost`}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="Role Latency">
          {roleLatencies.length === 0 ? (
            <EmptyNote>No requests reported a duration in this period.</EmptyNote>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b border-bolt-elements-borderColor/40">
                <Stat
                  label="Fastest Role"
                  value={metrics.fastestRole?.label ?? EMPTY_VALUE}
                  hint={metrics.fastestRole ? formatLatency(metrics.fastestRole.averageLatencyMs) : undefined}
                />
                <Stat
                  label="Slowest Role"
                  value={metrics.slowestRole?.label ?? EMPTY_VALUE}
                  hint={metrics.slowestRole ? formatLatency(metrics.slowestRole.averageLatencyMs) : undefined}
                />
              </div>
              <ul className="space-y-2">
                {roleLatencies.map((role) => (
                  <li key={role.key}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-bolt-elements-textPrimary truncate">{formatRoleLabel(role.key)}</span>
                      <span className="shrink-0 tabular-nums text-bolt-elements-textSecondary">
                        {formatLatency(role.average)} · {formatCount(role.requests)}
                      </span>
                    </div>
                    <ProportionBar value={role.average} max={maxLatency} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel title="Failure Signals">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Retries" value={formatCount(metrics.retryCount)} hint="Same role repeated in a generation" />
              <Stat label="Repairs" value={formatCount(metrics.repairCount)} hint="Automatic repair attempts" />
              <Stat label="Timeouts" value={formatCount(metrics.timeoutCount)} hint="Failures reporting a timeout" />
              <Stat label="Cancelled" value={formatCount(metrics.cancelledCount)} hint="Stopped by an operator" />
            </div>
          </Panel>
          <SystemHealthPanel events={summaryEvents} ledgerReachable={available} />
        </div>
      </div>
    </div>
  );
}
