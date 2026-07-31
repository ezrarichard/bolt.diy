/**
 * Builders Observability / AI Usage — pure aggregation.
 *
 * Deliberately dependency-free (types only): no Supabase client, no store, no React. Every
 * number the dashboard shows is computed here, so the arithmetic can be tested directly rather
 * than through a rendered component — the same reasoning as
 * `app/components/sidebar/businessDiscoveryDisplay.ts`.
 *
 * The one rule running through all of it: **never invent a number.** A total is `null` when no
 * event in the set carried that value, which is a different statement from `0`. The dashboard
 * renders `null` as "-" and `0` as "0", so an unpriced model can never masquerade as free and a
 * provider that omits token counts can never masquerade as having used none.
 */

import type { AiUsageBreakdownRow, AiUsageEvent, AiUsageRange, AiUsageTotals } from './aiUsageQueryTypes';

/** Sums a nullable field, returning null when EVERY value was null. `0` means "really zero". */
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

  /* Rounded to the cent-fraction the ledger itself stores (numeric(14,8)) so repeated addition can't drift. */
  return sawValue ? Math.round(total * 1e8) / 1e8 : null;
}

function averageNullable(values: (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined);
  return present.length === 0 ? null : Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

export function summarizeUsage(events: AiUsageEvent[]): AiUsageTotals {
  return {
    requests: events.length,
    inputTokens: events.reduce((sum, event) => sum + event.inputTokens, 0),
    outputTokens: events.reduce((sum, event) => sum + event.outputTokens, 0),
    cachedTokens: events.reduce((sum, event) => sum + event.cachedInputTokens + event.cachedOutputTokens, 0),
    totalTokens: events.reduce((sum, event) => sum + event.totalTokens, 0),
    estimatedCostUsd: sumNullable(events.map((event) => event.estimatedCostUsd)),
    failures: events.filter((event) => event.status === 'failed').length,
    averageLatencyMs: averageNullable(events.map((event) => event.durationMs)),
  };
}

/** Groups by an arbitrary key, dropping events whose key is absent rather than bucketing them under a made-up label. */
function groupBy(
  events: AiUsageEvent[],
  keyOf: (event: AiUsageEvent) => string | null,
  labelOf: (key: string) => string,
): AiUsageBreakdownRow[] {
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
    .sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));
}

export function breakdownByProvider(events: AiUsageEvent[]): AiUsageBreakdownRow[] {
  return groupBy(events, (event) => event.provider, formatProviderLabel);
}

export function breakdownByRole(events: AiUsageEvent[]): AiUsageBreakdownRow[] {
  return groupBy(events, (event) => event.roleKey ?? event.requestType, formatRoleLabel);
}

/**
 * `role_key` is the artifact type the role produces (see useDraftPanel.ts /
 * useAutoEngineeringPipeline.ts, which both pass `roleKey: artifactType`), e.g.
 * `architecture-draft`. This maps the ones we know to their human role name and degrades to a
 * title-cased version of the raw key for anything added later — so a NEW AI role appears in the
 * dashboard correctly without this map being updated first.
 */
const ROLE_LABELS: Record<string, string> = {
  'requirements-draft': 'Business Analyst',
  'product-owner-draft': 'Product Owner',
  'architecture-draft': 'Solution Architect',
  'technical-architecture': 'Solution Architect',
  'database-draft': 'Database Engineer',
  'database-schema': 'Database Engineer',
  'uiux-draft': 'UI/UX Engineer',
  'backend-draft': 'Backend Engineer',
  'frontend-draft': 'Frontend Engineer',
  'qa-draft': 'QA Engineer',
  'devops-draft': 'DevOps Engineer',
  'product-review-analysis': 'Business Analyst (Review)',
  'roadmap-review-analysis': 'Product Owner (Review)',

  /* request_type fallbacks — used when a call carried no role_key at all. */
  quick_chat: 'Chat',
  code_generation: 'Code Generation',
  code_review: 'Code Review',
  repair: 'Repair',
  build_validation: 'Build Validation',
  runtime_debug: 'Runtime Debug',
};

export function formatRoleLabel(key: string): string {
  return ROLE_LABELS[key] ?? titleCase(key);
}

/** Provider ids arrive as the provider's own registered name (e.g. `Anthropic`, `OpenAI`, `Google`); only normalise casing for ones stored lower-case. */
export function formatProviderLabel(key: string): string {
  return /^[a-z0-9_-]+$/.test(key) ? titleCase(key) : key;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Inclusive lower bound for a range, as an ISO string. `session` uses the timestamp the app
 * loaded; the others are whole days in the VIEWER's local timezone, because "today" means the
 * user's today, not UTC's.
 */
export function resolveRangeStart(range: AiUsageRange, sessionStartedAt: string, now: Date = new Date()): string {
  if (range === 'session') {
    return sessionStartedAt;
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === 'today') {
    return startOfToday.toISOString();
  }

  const days = range === '7d' ? 6 : 29;
  const start = new Date(startOfToday);
  start.setDate(start.getDate() - days);

  return start.toISOString();
}

/** Start of the current local day / month — used only by the budget widgets. */
export function startOfLocalDay(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export function startOfLocalMonth(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function sumCostSince(events: AiUsageEvent[], sinceIso: string): number | null {
  const since = new Date(sinceIso).getTime();
  return sumNullable(
    events.filter((event) => new Date(event.createdAt).getTime() >= since).map((event) => event.estimatedCostUsd),
  );
}
