/**
 * Builders Observability / AI Usage — project, generation and performance analytics.
 *
 * An extension of aiUsageAggregations.ts, not a replacement: the shared helpers there
 * (`summarizeUsage`, `formatRoleLabel`, …) are reused rather than reimplemented, and nothing here
 * queries or stores anything. Same rule throughout — a value nobody reported stays `null`, never
 * becomes `0`.
 *
 * All of it derives from the SINGLE existing ledger. No new table, no duplicate write path.
 */

import { formatRoleLabel, summarizeUsage } from './aiUsageAggregations';
import type { AiUsageEvent, AiUsageTotals } from './aiUsageQueryTypes';

/** Shared null-preserving sum — a total is null only when EVERY contributing value was null. */
function sumNullable(values: (number | null | undefined)[]): number | null {
  let sawValue = false;
  let total = 0;

  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    sawValue = true;
    total += value;
  }

  return sawValue ? Math.round(total * 1e8) / 1e8 : null;
}

// ── Project analytics ────────────────────────────────────────────────────

export interface ProjectUsageRow {
  projectId: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  averageLatencyMs: number | null;

  /** ISO timestamp of the most recent request for this project. */
  lastActivityAt: string;
  failures: number;
}

/**
 * One row per project, highest usage first. Events with no `project_id` (e.g. a chat message sent
 * outside any project) are excluded rather than bucketed under a placeholder project.
 */
export function analyzeProjects(events: AiUsageEvent[]): ProjectUsageRow[] {
  const buckets = new Map<string, AiUsageEvent[]>();

  for (const event of events) {
    if (!event.projectId) {
      continue;
    }

    const bucket = buckets.get(event.projectId);

    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(event.projectId, [event]);
    }
  }

  return [...buckets.entries()]
    .map(([projectId, projectEvents]) => {
      const totals = summarizeUsage(projectEvents);

      return {
        projectId,
        requests: totals.requests,
        totalTokens: totals.totalTokens,
        estimatedCostUsd: totals.estimatedCostUsd,
        averageLatencyMs: totals.averageLatencyMs,
        lastActivityAt: projectEvents.reduce(
          (latest, event) => (event.createdAt > latest ? event.createdAt : latest),
          projectEvents[0].createdAt,
        ),
        failures: totals.failures,
      };
    })
    .sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens);
}

// ── Generation analytics ─────────────────────────────────────────────────

/**
 * `exact` — every request carried the same `operation_id`, minted by aiOperationScope.ts when the
 * generation started. `inferred` — the requests predate that instrumentation (`operation_id` is
 * null on every historical row), so they were grouped by project and time proximity instead.
 *
 * The UI labels inferred generations explicitly. As new generations run they arrive exact, and
 * the view transitions on its own with no migration and no backfill.
 */
export type GenerationGrouping = 'exact' | 'inferred';

export interface GenerationStage {
  roleKey: string;
  label: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  failed: boolean;
}

export interface GenerationSummary {
  id: string;
  grouping: GenerationGrouping;
  projectId: string | null;
  startedAt: string;
  endedAt: string;

  /** Wall-clock span from first to last request, which includes the gaps between AI calls. */
  elapsedMs: number;

  /** Summed provider-reported durations — the time actually spent inside AI calls. */
  aiTimeMs: number | null;
  stages: GenerationStage[];
  totals: AiUsageTotals;
  status: 'success' | 'failed' | 'cancelled';
}

/**
 * Requests more than this far apart (same project) are treated as different generations when
 * falling back to inference. Chosen to sit well above the gap between consecutive roles in a run
 * — roles follow each other in seconds — while staying below the gap between separate sittings.
 */
export const INFERRED_GENERATION_GAP_MS = 10 * 60 * 1000;

function buildGeneration(id: string, grouping: GenerationGrouping, events: AiUsageEvent[]): GenerationSummary {
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const totals = summarizeUsage(ordered);

  const stageMap = new Map<string, AiUsageEvent[]>();

  for (const event of ordered) {
    const key = event.roleKey ?? event.requestType;
    const bucket = stageMap.get(key);

    if (bucket) {
      bucket.push(event);
    } else {
      stageMap.set(key, [event]);
    }
  }

  const stages: GenerationStage[] = [...stageMap.entries()].map(([roleKey, stageEvents]) => ({
    roleKey,
    label: formatRoleLabel(roleKey),
    requests: stageEvents.length,
    totalTokens: stageEvents.reduce((sum, event) => sum + event.totalTokens, 0),
    estimatedCostUsd: sumNullable(stageEvents.map((event) => event.estimatedCostUsd)),
    durationMs: sumNullable(stageEvents.map((event) => event.durationMs)),
    failed: stageEvents.some((event) => event.status === 'failed'),
  }));

  const startedAt = ordered[0].createdAt;
  const endedAt = ordered[ordered.length - 1].createdAt;

  /* A cancelled run reads as cancelled only when nothing in it failed — a failure is the more important signal. */
  const status = ordered.some((event) => event.status === 'failed')
    ? 'failed'
    : ordered.some((event) => event.status === 'cancelled')
      ? 'cancelled'
      : 'success';

  return {
    id,
    grouping,
    projectId: ordered[0].projectId,
    startedAt,
    endedAt,
    elapsedMs: Math.max(new Date(endedAt).getTime() - new Date(startedAt).getTime(), 0),
    aiTimeMs: sumNullable(ordered.map((event) => event.durationMs)),
    stages,
    totals,
    status,
  };
}

/**
 * Groups requests into generations, newest first.
 *
 * Rows WITH an `operation_id` group exactly on it. Rows without are sessionized per project: they
 * are sorted by time and split wherever consecutive requests are more than
 * `INFERRED_GENERATION_GAP_MS` apart. The two never mix — an exact generation is never extended by
 * a nearby legacy row, so instrumented data is never contaminated by a guess.
 */
export function groupIntoGenerations(events: AiUsageEvent[], gapMs = INFERRED_GENERATION_GAP_MS): GenerationSummary[] {
  const exact = new Map<string, AiUsageEvent[]>();
  const legacyByProject = new Map<string, AiUsageEvent[]>();

  for (const event of events) {
    if (event.operationId) {
      const bucket = exact.get(event.operationId);

      if (bucket) {
        bucket.push(event);
      } else {
        exact.set(event.operationId, [event]);
      }

      continue;
    }

    /* No project id and no operation id — nothing reliable to group on, so it is left out entirely. */
    if (!event.projectId) {
      continue;
    }

    const bucket = legacyByProject.get(event.projectId);

    if (bucket) {
      bucket.push(event);
    } else {
      legacyByProject.set(event.projectId, [event]);
    }
  }

  const generations: GenerationSummary[] = [...exact.entries()].map(([operationId, bucket]) =>
    buildGeneration(operationId, 'exact', bucket),
  );

  for (const [projectId, bucket] of legacyByProject) {
    const ordered = [...bucket].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let cluster: AiUsageEvent[] = [];
    let clusterIndex = 0;

    const flush = () => {
      if (cluster.length > 0) {
        generations.push(
          buildGeneration(`inferred:${projectId}:${clusterIndex++}:${cluster[0].createdAt}`, 'inferred', cluster),
        );
        cluster = [];
      }
    };

    for (const event of ordered) {
      const previous = cluster[cluster.length - 1];

      if (previous && new Date(event.createdAt).getTime() - new Date(previous.createdAt).getTime() > gapMs) {
        flush();
      }

      cluster.push(event);
    }

    flush();
  }

  return generations.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ── Performance analytics ────────────────────────────────────────────────

export interface RoleLatency {
  roleKey: string;
  label: string;
  averageLatencyMs: number;
  requests: number;
}

export interface PerformanceMetrics {
  requests: number;
  averageLatencyMs: number | null;
  fastestRole: RoleLatency | null;
  slowestRole: RoleLatency | null;
  averageTokensPerRequest: number | null;
  averageCostPerRequest: number | null;

  /** Null rather than 100% when there were no requests at all — a rate over nothing is meaningless. */
  successRatePercent: number | null;
  failureRatePercent: number | null;
  retryCount: number;
  repairCount: number;
  timeoutCount: number;
  cancelledCount: number;

  /** Over the observed span (first to last request). Null when the span is zero or unknown. */
  requestsPerMinute: number | null;
}

/**
 * A retry is a repeat of the same role inside the same generation — the ledger has no explicit
 * "attempt" flag for the role pipeline, but `repair_attempt_number` covers the repair path and is
 * counted separately below.
 */
function countRetries(events: AiUsageEvent[]): number {
  const seen = new Map<string, number>();
  let retries = 0;

  for (const event of events) {
    const scope = event.operationId ?? `${event.projectId ?? 'none'}`;
    const key = `${scope}::${event.roleKey ?? event.requestType}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);

    if (count > 1) {
      retries += 1;
    }
  }

  return retries;
}

export function analyzePerformance(events: AiUsageEvent[]): PerformanceMetrics {
  const totals = summarizeUsage(events);

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

  const roleLatencies: RoleLatency[] = [...byRole.entries()]
    .map(([roleKey, entry]) => ({
      roleKey,
      label: formatRoleLabel(roleKey),
      averageLatencyMs: Math.round(entry.total / entry.count),
      requests: entry.count,
    }))
    .sort((a, b) => a.averageLatencyMs - b.averageLatencyMs);

  const costs = events.map((event) => event.estimatedCostUsd);
  const pricedCount = costs.filter((cost) => cost !== null && cost !== undefined).length;

  let requestsPerMinute: number | null = null;

  if (events.length > 1) {
    const times = events.map((event) => new Date(event.createdAt).getTime()).filter((time) => Number.isFinite(time));
    const spanMs = Math.max(...times) - Math.min(...times);
    requestsPerMinute = spanMs > 0 ? Math.round((events.length / (spanMs / 60_000)) * 100) / 100 : null;
  }

  return {
    requests: events.length,
    averageLatencyMs: totals.averageLatencyMs,
    fastestRole: roleLatencies[0] ?? null,
    slowestRole: roleLatencies.length > 0 ? roleLatencies[roleLatencies.length - 1] : null,
    averageTokensPerRequest: events.length === 0 ? null : Math.round(totals.totalTokens / events.length),

    /* Averaged over PRICED requests only — dividing a partial cost by every request would understate it. */
    averageCostPerRequest: pricedCount === 0 ? null : Math.round(((sumNullable(costs) ?? 0) / pricedCount) * 1e8) / 1e8,
    successRatePercent:
      events.length === 0
        ? null
        : Math.round((events.filter((event) => event.status === 'success').length / events.length) * 1000) / 10,
    failureRatePercent: events.length === 0 ? null : Math.round((totals.failures / events.length) * 1000) / 10,
    retryCount: countRetries(events),
    repairCount: events.filter((event) => event.requestType === 'repair').length,

    /* Timeouts are not a distinct status — they surface as a failure whose error text says so. */
    timeoutCount: events.filter(
      (event) => event.status === 'failed' && /timeout|timed out|deadline/i.test(event.errorMessage ?? ''),
    ).length,
    cancelledCount: events.filter((event) => event.status === 'cancelled').length,
    requestsPerMinute,
  };
}

// ── Top lists ────────────────────────────────────────────────────────────

export interface TopEntry {
  key: string;
  label: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

function topBy(
  events: AiUsageEvent[],
  keyOf: (event: AiUsageEvent) => string | null,
  labelOf: (key: string) => string,
  sortBy: 'requests' | 'cost',
  limit: number,
): TopEntry[] {
  const buckets = new Map<string, AiUsageEvent[]>();

  for (const event of events) {
    const key = keyOf(event);

    if (!key) {
      continue;
    }

    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(key, [event]);
    }
  }

  return [...buckets.entries()]
    .map(([key, bucketEvents]) => ({
      key,
      label: labelOf(key),
      requests: bucketEvents.length,
      totalTokens: bucketEvents.reduce((sum, event) => sum + event.totalTokens, 0),
      estimatedCostUsd: sumNullable(bucketEvents.map((event) => event.estimatedCostUsd)),
    }))
    .sort((a, b) =>
      sortBy === 'cost'
        ? (b.estimatedCostUsd ?? -1) - (a.estimatedCostUsd ?? -1) || b.requests - a.requests
        : b.requests - a.requests,
    )
    .slice(0, limit);
}

export function topModels(events: AiUsageEvent[], limit = 5): TopEntry[] {
  return topBy(
    events,
    (event) => event.apiModel,
    (key) => key,
    'requests',
    limit,
  );
}

export function topRoles(events: AiUsageEvent[], limit = 5): TopEntry[] {
  return topBy(events, (event) => event.roleKey ?? event.requestType, formatRoleLabel, 'requests', limit);
}

/**
 * Costliest operation TYPES, not individual requests: a single expensive call is noise, whereas
 * "code generation is where the money goes" is actionable. Unpriced groups sort last (via the -1
 * fallback) rather than appearing to be the cheapest.
 */
export function topExpensiveOperations(events: AiUsageEvent[], limit = 5): TopEntry[] {
  return topBy(events, (event) => event.requestType, formatRoleLabel, 'cost', limit);
}
