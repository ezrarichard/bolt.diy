import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { currentProjectIdStore, projectsStore } from '~/lib/stores/projects';
import {
  breakdownByProvider,
  breakdownByRole,
  formatProviderLabel,
  formatRoleLabel,
  resolveRangeStart,
  startOfLocalDay,
  startOfLocalMonth,
  sumCostSince,
  summarizeUsage,
} from '~/lib/observability/ai-usage/aiUsageAggregations';
import { fetchAiUsageEvents } from '~/lib/observability/ai-usage/aiUsageQueries';
import type { AiUsageEvent, AiUsageRange } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
import {
  aiUsageBudgetStore,
  hasAnyBudget,
  resolveBudgetProgress,
  setAiUsageBudget,
} from '~/lib/observability/ai-usage/aiUsageBudget';
import {
  EMPTY_VALUE,
  formatCostUsd,
  formatCount,
  formatEventTime,
  formatLatency,
  formatTokens,
} from './observabilityFormat';

/**
 * Builders Observability — AI Usage dashboard.
 *
 * Read-only view over `builders_ai_usage_events`, the ledger every AI call already writes to via
 * `recordAiUsage()`. This component never records anything and knows nothing about any specific
 * provider: every provider/model/role shown is whatever the ledger contains, so a new provider
 * or a new AI role appears here with no change to this file.
 *
 * Two queries, not one per card:
 *  - a SUMMARY query covering the widest window any fixed widget needs (30 days, or the start of
 *    this month when that is earlier), from which Session / Today / Project / budget figures are
 *    all derived client-side by the pure helpers in aiUsageAggregations.ts;
 *  - a FILTERED query driving the breakdowns and the recent-requests table.
 *
 * Missing data is rendered as "—" throughout (see observabilityFormat.ts). A null cost means the
 * model has no configured price in modelPricingRegistry.ts — deliberately not a fabricated
 * estimate — and the panel says so explicitly rather than showing $0.00.
 */

/** Captured once per page load. The ledger has no session column; "this session" is simply "since the app opened". */
const SESSION_STARTED_AT = new Date().toISOString();

const RANGE_OPTIONS: { value: AiUsageRange; label: string }[] = [
  { value: 'session', label: 'Session' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];

const RECENT_LIMIT = 100;

// ── Small presentational primitives ──────────────────────────────────────

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 backdrop-blur-sm">
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-bolt-elements-textSecondary">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={classNames(
          'appearance-none rounded-lg px-2 py-1 text-[11px] max-w-[170px]',
          'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
          'text-bolt-elements-textPrimary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BreakdownList({ rows, emptyLabel }: { rows: ReturnType<typeof breakdownByProvider>; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-xs text-bolt-elements-textSecondary">{emptyLabel}</p>;
  }

  const maxRequests = Math.max(...rows.map((row) => row.requests), 1);

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-bolt-elements-textPrimary truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums text-bolt-elements-textSecondary">
              {formatCount(row.requests)} · {formatTokens(row.totalTokens)} · {formatCostUsd(row.estimatedCostUsd)}
            </span>
          </div>
          {/* Proportion of requests, not of cost — cost is frequently null and would render most bars empty. */}
          <div className="mt-1 h-1 rounded-full bg-bolt-elements-background-depth-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-builders-brand-primary/70"
              style={{ width: `${Math.max((row.requests / maxRequests) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Budget ───────────────────────────────────────────────────────────────

function BudgetBar({
  label,
  limitUsd,
  usedUsd,
}: {
  label: string;
  limitUsd: number | undefined;
  usedUsd: number | null;
}) {
  const progress = resolveBudgetProgress(limitUsd, usedUsd);

  if (limitUsd === undefined) {
    return null;
  }

  /* Budget set, but nothing in the period had a known price — show the budget, not a false 0%. */
  if (!progress) {
    return (
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-bolt-elements-textPrimary">{label}</span>
          <span className="tabular-nums text-bolt-elements-textSecondary">
            {EMPTY_VALUE} / {formatCostUsd(limitUsd)}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-bolt-elements-textSecondary">No priced requests in this period yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-bolt-elements-textPrimary">{label}</span>
        <span className="tabular-nums text-bolt-elements-textSecondary">
          {formatCostUsd(progress.usedUsd)} / {formatCostUsd(progress.limitUsd)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-bolt-elements-background-depth-3 overflow-hidden">
        <div
          className={classNames(
            'h-full rounded-full transition-all duration-300',
            progress.exceeded ? 'bg-builders-status-error-border' : 'bg-builders-brand-primary',
          )}
          style={{ width: `${Math.min(progress.percentUsed, 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-bolt-elements-textSecondary tabular-nums">
        <span>{progress.percentUsed}% used</span>
        <span>{formatCostUsd(progress.remainingUsd)} remaining</span>
      </div>
    </div>
  );
}

function BudgetEditor({ onDone }: { onDone: () => void }) {
  const budget = useStore(aiUsageBudgetStore);
  const [daily, setDaily] = useState(budget.dailyUsd?.toString() ?? '');
  const [monthly, setMonthly] = useState(budget.monthlyUsd?.toString() ?? '');

  const save = () => {
    setAiUsageBudget({
      dailyUsd: daily === '' ? undefined : Number(daily),
      monthlyUsd: monthly === '' ? undefined : Number(monthly),
    });
    onDone();
  };

  const inputClass = classNames(
    'w-full rounded-lg px-2 py-1 text-xs appearance-none',
    'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
    'text-bolt-elements-textPrimary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
  );

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-bolt-elements-textSecondary">
        Optional. Leave a field empty to disable that budget. Amounts are in USD.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-bolt-elements-textSecondary">Daily</span>
          <input
            inputMode="decimal"
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            className={inputClass}
            placeholder="e.g. 5"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-bolt-elements-textSecondary">Monthly</span>
          <input
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            className={inputClass}
            placeholder="e.g. 100"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="px-2.5 py-1 rounded-lg text-xs bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="px-2.5 py-1 rounded-lg text-xs font-medium appearance-none border-0 bg-purple-600 hover:bg-purple-700 text-white transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────

export default function AiUsageTab() {
  const projects = useStore(projectsStore);
  const currentProjectId = useStore(currentProjectIdStore);
  const budget = useStore(aiUsageBudgetStore);

  const [range, setRange] = useState<AiUsageRange>('today');
  const [projectFilter, setProjectFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [editingBudget, setEditingBudget] = useState(false);

  const [summaryEvents, setSummaryEvents] = useState<AiUsageEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<AiUsageEvent[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  /* Guards against an out-of-order response overwriting a newer one when filters change quickly. */
  const requestIdRef = useRef(0);

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
        projectId: projectFilter || undefined,
        roleKey: roleFilter || undefined,
        provider: providerFilter || undefined,
      }),
    ]);

    if (requestId !== requestIdRef.current) {
      return;
    }

    setSummaryEvents(summary.events);
    setFilteredEvents(filtered.events);
    setAvailable(summary.available && filtered.available);
    setLoading(false);
  }, [range, projectFilter, roleFilter, providerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fixed-context summaries, all derived from the one summary query.
  const sessionTotals = useMemo(
    () => summarizeUsage(summaryEvents.filter((event) => event.createdAt >= SESSION_STARTED_AT)),
    [summaryEvents],
  );
  const todayTotals = useMemo(() => {
    const dayStart = startOfLocalDay();
    return summarizeUsage(summaryEvents.filter((event) => event.createdAt >= dayStart));
  }, [summaryEvents]);
  const projectTotals = useMemo(
    () => summarizeUsage(summaryEvents.filter((event) => currentProjectId && event.projectId === currentProjectId)),
    [summaryEvents, currentProjectId],
  );

  const filteredTotals = useMemo(() => summarizeUsage(filteredEvents), [filteredEvents]);
  const providerRows = useMemo(() => breakdownByProvider(filteredEvents), [filteredEvents]);
  const roleRows = useMemo(() => breakdownByRole(filteredEvents), [filteredEvents]);
  const recent = useMemo(() => filteredEvents.slice(0, RECENT_LIMIT), [filteredEvents]);

  /* Filter options come from the data itself, so a new provider/role needs no code change here. */
  const providerOptions = useMemo(
    () => [...new Set(summaryEvents.map((event) => event.provider))].sort(),
    [summaryEvents],
  );
  const roleOptions = useMemo(
    () => [...new Set(summaryEvents.map((event) => event.roleKey ?? event.requestType))].sort(),
    [summaryEvents],
  );

  /** The provider/model actually in use, taken from the newest event rather than from config. */
  const latest = summaryEvents[0];
  const recentFailures = summaryEvents.slice(0, 20).filter((event) => event.status === 'failed').length;

  const currentProjectName = currentProjectId
    ? (projects.find((project) => project.id === currentProjectId)?.name ?? 'Current project')
    : null;

  const unpricedModels = useMemo(
    () => [...new Set(filteredEvents.filter((e) => e.estimatedCostUsd === null).map((e) => e.modelKey ?? e.apiModel))],
    [filteredEvents],
  );

  if (!available && !loading) {
    return (
      <div className="rounded-xl border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/70 px-4 py-8 text-center">
        <div className="i-ph:cloud-slash-duotone w-6 h-6 mx-auto text-bolt-elements-textSecondary" />
        <p className="mt-2 text-sm text-bolt-elements-textPrimary">AI usage data is unavailable</p>
        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
          Builders could not reach the usage ledger. This does not affect AI generation — only this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-bolt-elements-textSecondary">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={classNames(
                'w-1.5 h-1.5 rounded-full',
                !latest
                  ? 'bg-bolt-elements-textTertiary'
                  : recentFailures === 0
                    ? 'bg-builders-status-success-border'
                    : 'bg-builders-status-warning-border',
              )}
            />
            {latest ? formatProviderLabel(latest.provider) : EMPTY_VALUE}
          </span>
          <span>
            Model: <span className="text-bolt-elements-textPrimary">{latest?.apiModel ?? EMPTY_VALUE}</span>
          </span>
          <span>
            Status:{' '}
            <span className="text-bolt-elements-textPrimary">
              {!latest ? EMPTY_VALUE : recentFailures === 0 ? 'Healthy' : `${recentFailures} recent failures`}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-bolt-elements-borderColor/60 overflow-hidden">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={classNames(
                  'px-2.5 py-1 text-[11px] appearance-none border-0 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
                  range === option.value
                    ? 'bg-builders-brand-subtleSurface text-builders-brand-primary font-medium'
                    : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <FilterSelect
            label="Project"
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              { value: '', label: 'All' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
          <FilterSelect
            label="Role"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: '', label: 'All' },
              ...roleOptions.map((k) => ({ value: k, label: formatRoleLabel(k) })),
            ]}
          />
          <FilterSelect
            label="Provider"
            value={providerFilter}
            onChange={setProviderFilter}
            options={[
              { value: '', label: 'All' },
              ...providerOptions.map((p) => ({ value: p, label: formatProviderLabel(p) })),
            ]}
          />
        </div>
      </div>

      {/* Fixed-context summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel title="Current Session">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Requests" value={formatCount(sessionTotals.requests)} />
            <Stat
              label="Tokens"
              value={formatTokens(sessionTotals.totalTokens)}
              hint={`${formatTokens(sessionTotals.inputTokens)} in · ${formatTokens(sessionTotals.outputTokens)} out`}
            />
            <Stat
              label="Cost"
              value={formatCostUsd(sessionTotals.estimatedCostUsd)}
              hint={`${formatTokens(sessionTotals.cachedTokens)} cached`}
            />
          </div>
        </Panel>
        <Panel title="Today">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Requests" value={formatCount(todayTotals.requests)} />
            <Stat label="Tokens" value={formatTokens(todayTotals.totalTokens)} />
            <Stat label="Cost" value={formatCostUsd(todayTotals.estimatedCostUsd)} />
          </div>
        </Panel>
        <Panel title={currentProjectName ? `Project · ${currentProjectName}` : 'Current Project'}>
          {currentProjectId ? (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Requests" value={formatCount(projectTotals.requests)} />
              <Stat label="Tokens" value={formatTokens(projectTotals.totalTokens)} />
              <Stat label="Cost" value={formatCostUsd(projectTotals.estimatedCostUsd)} />
            </div>
          ) : (
            <p className="text-xs text-bolt-elements-textSecondary">Open a project to see its usage.</p>
          )}
        </Panel>
      </div>

      {/* Budgets — hidden entirely until configured */}
      {(hasAnyBudget(budget) || editingBudget) && (
        <Panel
          title="Budget"
          action={
            !editingBudget && (
              <button
                type="button"
                onClick={() => setEditingBudget(true)}
                className="text-[11px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
              >
                Edit
              </button>
            )
          }
        >
          {editingBudget ? (
            <BudgetEditor onDone={() => setEditingBudget(false)} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <BudgetBar
                label="Daily"
                limitUsd={budget.dailyUsd}
                usedUsd={sumCostSince(summaryEvents, startOfLocalDay())}
              />
              <BudgetBar
                label="Monthly"
                limitUsd={budget.monthlyUsd}
                usedUsd={sumCostSince(summaryEvents, startOfLocalMonth())}
              />
            </div>
          )}
        </Panel>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="Provider Breakdown">
          <BreakdownList rows={providerRows} emptyLabel="No AI requests in this period." />
        </Panel>
        <Panel title="Role Breakdown">
          <BreakdownList rows={roleRows} emptyLabel="No AI requests in this period." />
        </Panel>
      </div>

      {/* Recent requests */}
      <Panel
        title={`Recent Requests${recent.length > 0 ? ` · ${recent.length}` : ''}`}
        action={
          <span className="text-[11px] text-bolt-elements-textSecondary tabular-nums">
            {formatCount(filteredTotals.requests)} requests · {formatTokens(filteredTotals.totalTokens)} tokens ·{' '}
            {formatCostUsd(filteredTotals.estimatedCostUsd)} · avg {formatLatency(filteredTotals.averageLatencyMs)}
          </span>
        }
      >
        {recent.length === 0 ? (
          <p className="text-xs text-bolt-elements-textSecondary">
            {loading ? 'Loading…' : 'No AI requests match these filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-bolt-elements-textSecondary">
                  <th className="font-medium py-1.5 pr-3">Time</th>
                  <th className="font-medium py-1.5 pr-3">Role</th>
                  <th className="font-medium py-1.5 pr-3">Provider</th>
                  <th className="font-medium py-1.5 pr-3">Model</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Tokens</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Cost</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Latency</th>
                  <th className="font-medium py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bolt-elements-borderColor/40">
                {recent.map((event) => (
                  <tr key={event.id} className="text-bolt-elements-textSecondary">
                    <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatEventTime(event.createdAt)}</td>
                    <td className="py-1.5 pr-3 text-bolt-elements-textPrimary whitespace-nowrap">
                      {formatRoleLabel(event.roleKey ?? event.requestType)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatProviderLabel(event.provider)}</td>
                    <td className="py-1.5 pr-3 max-w-[190px] truncate" title={event.apiModel}>
                      {event.apiModel}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatTokens(event.totalTokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatCostUsd(event.estimatedCostUsd)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                      {formatLatency(event.durationMs)}
                    </td>
                    <td className="py-1.5 whitespace-nowrap">
                      <span
                        className={classNames(
                          'px-1.5 py-0.5 rounded-full text-[10px] font-medium border',
                          event.status === 'success'
                            ? 'text-builders-status-success-text border-builders-status-success-border/40 bg-builders-status-success-bg'
                            : event.status === 'failed'
                              ? 'text-builders-status-error-text border-builders-status-error-border/40 bg-builders-status-error-bg'
                              : 'text-bolt-elements-textSecondary border-bolt-elements-borderColor/50',
                        )}
                        title={event.errorMessage ?? undefined}
                      >
                        {event.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Footnotes — why a cost might be "—", and the opt-in budget entry point. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-bolt-elements-textSecondary">
        <span>
          {unpricedModels.length > 0
            ? `Cost shows "${EMPTY_VALUE}" for models with no configured price: ${unpricedModels.slice(0, 3).join(', ')}${unpricedModels.length > 3 ? '…' : ''}. Add pricing in modelPricingRegistry.ts.`
            : 'Costs are estimates based on configured model pricing.'}
        </span>
        {!hasAnyBudget(budget) && !editingBudget && (
          <button
            type="button"
            onClick={() => setEditingBudget(true)}
            className="bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
          >
            Set a budget
          </button>
        )}
      </div>
    </div>
  );
}
