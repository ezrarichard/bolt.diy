import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { resolveRangeStart, startOfLocalMonth } from '~/lib/observability/ai-usage/aiUsageAggregations';
import { fetchAiUsageEvents } from '~/lib/observability/ai-usage/aiUsageQueries';
import { enrichEventCosts } from '~/lib/observability/ai-usage/enrichEventCosts';
import { pricingOverridesStore } from '~/lib/observability/pricing/pricingOverrides';
import type { AiUsageEvent, AiUsageRange } from '~/lib/observability/ai-usage/aiUsageQueryTypes';

/**
 * Shared Observability data source.
 *
 * Every module (AI Usage, Performance, and future ones) reads the SAME ledger with the SAME
 * filters, so this owns the fetching once rather than each tab growing its own copy.
 *
 * Two queries per load:
 *  - `summaryEvents` — a wide, unfiltered window (30 days, or the start of this month when that is
 *    earlier) backing the fixed Session/Today/Project cards, budgets and health.
 *  - `events` — the filtered set backing everything the filters drive.
 *
 * Configured pricing overrides are applied to both at read time (see enrichEventCosts.ts), so a
 * cost appears everywhere consistently or nowhere at all.
 */

/** Captured once per page load — the ledger has no session column, so "this session" is "since the app opened". */
export const SESSION_STARTED_AT = new Date().toISOString();

export interface ObservabilityFilters {
  range: AiUsageRange;
  projectId: string;
  roleKey: string;
  provider: string;
}

export const DEFAULT_FILTERS: ObservabilityFilters = { range: 'today', projectId: '', roleKey: '', provider: '' };

export interface ObservabilityData {
  events: AiUsageEvent[];
  summaryEvents: AiUsageEvent[];
  available: boolean;
  loading: boolean;

  /** Rows that had no recorded cost and were priced here from configured overrides. */
  enrichedCount: number;
  reload: () => void;
}

export function useObservabilityData(filters: ObservabilityFilters): ObservabilityData {
  const overrides = useStore(pricingOverridesStore);

  const [events, setEvents] = useState<AiUsageEvent[]>([]);
  const [summaryEvents, setSummaryEvents] = useState<AiUsageEvent[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  /* Guards against a slow earlier response overwriting a newer one when filters change quickly. */
  const requestIdRef = useRef(0);

  const { range, projectId, roleKey, provider } = filters;

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    const monthStart = startOfLocalMonth();
    const thirtyDayStart = resolveRangeStart('30d', SESSION_STARTED_AT);
    const summarySince = monthStart < thirtyDayStart ? monthStart : thirtyDayStart;

    const [summary, filtered] = await Promise.all([
      fetchAiUsageEvents({ range: '30d', sessionStartedAt: SESSION_STARTED_AT, sinceIso: summarySince }),
      fetchAiUsageEvents({
        range,
        sessionStartedAt: SESSION_STARTED_AT,
        projectId: projectId || undefined,
        roleKey: roleKey || undefined,
        provider: provider || undefined,
      }),
    ]);

    if (requestId !== requestIdRef.current) {
      return;
    }

    setSummaryEvents(summary.events);
    setEvents(filtered.events);
    setAvailable(summary.available && filtered.available);
    setLoading(false);
  }, [range, projectId, roleKey, provider, reloadNonce]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Enrichment is derived, not stored — editing a price re-costs immediately with no refetch. */
  const enrichedFiltered = useMemo(() => enrichEventCosts(events, overrides), [events, overrides]);
  const enrichedSummary = useMemo(() => enrichEventCosts(summaryEvents, overrides), [summaryEvents, overrides]);

  return {
    events: enrichedFiltered.events,
    summaryEvents: enrichedSummary.events,
    available,
    loading,
    enrichedCount: enrichedFiltered.enrichedCount,
    reload: () => setReloadNonce((nonce) => nonce + 1),
  };
}
