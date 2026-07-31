import { useEffect, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { requestControlPanel } from '~/lib/stores/controlPanel';
import { fetchAiUsageEvents } from '~/lib/observability/ai-usage/aiUsageQueries';
import { startOfLocalDay, summarizeUsage } from '~/lib/observability/ai-usage/aiUsageAggregations';
import { overallHealth, resolveSystemHealth, detectStorageAvailable } from '~/lib/observability/health/systemHealth';
import { isBuildersDbConfigured } from '~/lib/builders-db/client';
import type { AiUsageEvent } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '~/components/@settings/tabs/observability/ObservabilityPrimitives';
import { EMPTY_VALUE, formatCostUsd, formatCount } from '~/components/@settings/tabs/observability/observabilityFormat';

/**
 * Builders Observability — always-visible status widget.
 *
 * Today's AI activity at a glance, in the header. Clicking it opens the Control Panel on AI Usage
 * via `requestControlPanel()` — the header sits outside the sidebar that owns the panel, so it
 * cannot open it directly.
 *
 * Deliberately cheap: ONE query for today's rows on mount, refreshed on a slow interval. It is a
 * status line, not a live feed — a fast poll would put avoidable load on the ledger for a number
 * that changes only when the user themselves runs something.
 *
 * Renders nothing at all when BuildersDB is unconfigured or no request has ever been recorded.
 * An empty widget in the header is worse than no widget.
 */

const REFRESH_MS = 60_000;

export function ObservabilityStatusBar() {
  const [events, setEvents] = useState<AiUsageEvent[] | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    if (!isBuildersDbConfigured()) {
      setEvents([]);
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      const result = await fetchAiUsageEvents({
        range: 'today',
        sessionStartedAt: startOfLocalDay(),
        sinceIso: startOfLocalDay(),
        limit: 200,
      });

      if (cancelled) {
        return;
      }

      setEvents(result.events);
      setReachable(result.available);
    };

    void load();

    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const summary = useMemo(() => (events ? summarizeUsage(events) : null), [events]);

  const health = useMemo(() => {
    if (!events) {
      return null;
    }

    return overallHealth(
      resolveSystemHealth({
        recentAiStatuses: events.slice(0, 20).map((event) => event.status),
        aiProvider: events[0]?.provider ?? null,
        buildersDbConfigured: isBuildersDbConfigured(),
        buildersDbReachable: reachable,

        /*
         * The header widget judges only what it can see cheaply — the AI provider, BuildersDB and
         * storage. Integration health (Supabase/GitHub/deployment) needs stores this component has
         * no reason to subscribe to, and is reported in full inside the dashboard.
         */
        supabaseConfigured: false,
        supabaseConnected: false,
        githubConnected: false,
        deploymentProvider: null,
        deploymentConnected: false,
        storageAvailable: detectStorageAvailable(),
      }),
    );
  }, [events, reachable]);

  /* Nothing recorded yet (or no ledger) — stay out of the header entirely. */
  if (!events || events.length === 0 || !summary || !health) {
    return null;
  }

  const latest = events[0];

  return (
    <button
      type="button"
      onClick={() => requestControlPanel('ai-usage')}
      title={`Open AI Usage — provider ${latest.provider}, ${HEALTH_LABEL[health]}`}
      className={classNames(
        'hidden md:inline-flex items-center gap-2.5 shrink-0 px-2.5 py-1 rounded-lg',
        'appearance-none border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70',
        'text-[11px] text-bolt-elements-textSecondary',
        'transition-colors hover:border-builders-brand-primary/50 hover:text-bolt-elements-textPrimary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
      )}
    >
      <span aria-hidden className={classNames('w-1.5 h-1.5 rounded-full shrink-0', HEALTH_DOT_CLASS[health])} />
      <span className="max-w-[110px] truncate">{latest.apiModel}</span>
      <span className="text-bolt-elements-borderColor">|</span>
      <span className="tabular-nums">{formatCount(summary.requests)} today</span>
      <span className="tabular-nums">
        {summary.estimatedCostUsd === null ? EMPTY_VALUE : formatCostUsd(summary.estimatedCostUsd)}
      </span>
    </button>
  );
}
