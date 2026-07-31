import { useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { currentProjectIdStore, projectsStore } from '~/lib/stores/projects';
import {
  breakdownByProvider,
  breakdownByRole,
  formatProviderLabel,
  formatRoleLabel,
  startOfLocalDay,
  startOfLocalMonth,
  sumCostSince,
  summarizeUsage,
} from '~/lib/observability/ai-usage/aiUsageAggregations';
import {
  analyzeProjects,
  groupIntoGenerations,
  topExpensiveOperations,
  topModels,
  topRoles,
  type GenerationSummary,
} from '~/lib/observability/ai-usage/aiUsageAnalytics';
import type { AiUsageEvent } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
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
import { EmptyNote, Panel, ProportionBar, Stat, StatusBadge } from './ObservabilityPrimitives';
import { ObservabilityFilterBar } from './ObservabilityFilterBar';
import {
  DEFAULT_FILTERS,
  SESSION_STARTED_AT,
  useObservabilityData,
  type ObservabilityFilters,
} from './useObservabilityData';
import { RequestInspector } from './RequestInspector';
import { SystemHealthPanel } from './SystemHealthPanel';
import { PricingSettingsPanel } from './PricingSettingsPanel';

/**
 * Builders Observability — AI Usage dashboard.
 *
 * Read-only view over `builders_ai_usage_events`, the ledger every AI call already writes to. It
 * records nothing and knows nothing about any specific provider: every provider, model and role
 * shown is whatever the ledger contains, so a new provider or AI role appears with no change here.
 *
 * Fetching, filtering and cost enrichment live in useObservabilityData; every number comes from
 * the pure helpers in aiUsageAggregations/aiUsageAnalytics, which is why this file holds layout
 * and almost no arithmetic. Missing data renders as "—" throughout — never as 0 or $0.00.
 */

const RECENT_LIMIT = 100;

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return EMPTY_VALUE;
  }

  if (ms < 1_000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1_000;

  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function relativeDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? EMPTY_VALUE
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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
          onClick={() => {
            setAiUsageBudget({
              dailyUsd: daily === '' ? undefined : Number(daily),
              monthlyUsd: monthly === '' ? undefined : Number(monthly),
            });
            onDone();
          }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium appearance-none border-0 bg-purple-600 hover:bg-purple-700 text-white transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Generations ──────────────────────────────────────────────────────────

function GenerationRow({ generation, projectName }: { generation: GenerationSummary; projectName: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-3/50">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-3 py-2 text-left bg-transparent border-0 appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus rounded-lg"
      >
        <span
          aria-hidden
          className={classNames(
            'i-ph:caret-right w-3 h-3 shrink-0 text-bolt-elements-textTertiary transition-transform',
            expanded ? 'rotate-90' : '',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-bolt-elements-textPrimary truncate">{projectName}</span>
            {generation.grouping === 'inferred' && (
              <span
                title="Grouped by project and time proximity because these requests predate exact generation tracking"
                className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium uppercase tracking-wide border border-bolt-elements-borderColor/60 text-bolt-elements-textSecondary"
              >
                Inferred
              </span>
            )}
          </span>
          <span className="block text-[10px] text-bolt-elements-textSecondary">
            {relativeDay(generation.startedAt)} · {generation.stages.length} stages
          </span>
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-bolt-elements-textSecondary text-right">
          {formatTokens(generation.totals.totalTokens)} · {formatCostUsd(generation.totals.estimatedCostUsd)}
          <br />
          {formatDuration(generation.elapsedMs)}
        </span>
        <StatusBadge status={generation.status} />
      </button>

      {expanded && (
        <ul className="px-3 pb-2.5 pt-0.5 space-y-1 border-t border-bolt-elements-borderColor/40">
          {generation.stages.map((stage) => (
            <li key={stage.roleKey} className="flex items-center justify-between gap-3 text-[11px] pt-1.5">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden
                  className={classNames(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    stage.failed ? 'bg-builders-status-error-border' : 'bg-builders-status-success-border',
                  )}
                />
                <span className="text-bolt-elements-textPrimary truncate">{stage.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-bolt-elements-textSecondary">
                {formatCount(stage.requests)} · {formatTokens(stage.totalTokens)} ·{' '}
                {formatCostUsd(stage.estimatedCostUsd)} · {formatDuration(stage.durationMs)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 text-[10px] pt-1.5 mt-1 border-t border-bolt-elements-borderColor/30 text-bolt-elements-textSecondary">
            <span>
              AI time {formatDuration(generation.aiTimeMs)} of {formatDuration(generation.elapsedMs)} elapsed
            </span>
            <span className="tabular-nums">{formatCount(generation.totals.requests)} requests</span>
          </li>
        </ul>
      )}
    </li>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────

export default function AiUsageTab() {
  const projects = useStore(projectsStore);
  const currentProjectId = useStore(currentProjectIdStore);
  const budget = useStore(aiUsageBudgetStore);

  const [filters, setFilters] = useState<ObservabilityFilters>(DEFAULT_FILTERS);
  const [editingBudget, setEditingBudget] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [inspecting, setInspecting] = useState<AiUsageEvent | null>(null);

  const { events, summaryEvents, available, loading, enrichedCount } = useObservabilityData(filters);

  const projectName = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project.name]));
    return (projectId: string | null) => (projectId ? (byId.get(projectId) ?? projectId) : 'No project');
  }, [projects]);

  // Fixed-context summaries, all from the one wide summary query.
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

  const filteredTotals = useMemo(() => summarizeUsage(events), [events]);
  const providerRows = useMemo(() => breakdownByProvider(events), [events]);
  const roleRows = useMemo(() => breakdownByRole(events), [events]);
  const projectRows = useMemo(() => analyzeProjects(events), [events]);
  const generations = useMemo(() => groupIntoGenerations(events), [events]);
  const recent = useMemo(() => events.slice(0, RECENT_LIMIT), [events]);

  const modelRows = useMemo(() => topModels(events), [events]);
  const roleTop = useMemo(() => topRoles(events), [events]);
  const expensiveRows = useMemo(() => topExpensiveOperations(events), [events]);

  const observedModels = useMemo(
    () => [...new Set(summaryEvents.map((event) => event.modelKey ?? event.apiModel))],
    [summaryEvents],
  );

  const latest = summaryEvents[0];
  const recentFailures = summaryEvents.slice(0, 20).filter((event) => event.status === 'failed').length;

  const unpricedModels = useMemo(
    () => [...new Set(events.filter((e) => e.estimatedCostUsd === null).map((e) => e.modelKey ?? e.apiModel))],
    [events],
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
          <button
            type="button"
            onClick={() => setShowPricing((value) => !value)}
            className="bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
          >
            {showPricing ? 'Hide pricing' : 'Configure pricing'}
          </button>
        </div>

        <ObservabilityFilterBar filters={filters} onChange={setFilters} summaryEvents={summaryEvents} />
      </div>

      {showPricing && <PricingSettingsPanel observedModels={observedModels} />}

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
        <Panel title={currentProjectId ? `Project · ${projectName(currentProjectId)}` : 'Current Project'}>
          {currentProjectId ? (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Requests" value={formatCount(projectTotals.requests)} />
              <Stat label="Tokens" value={formatTokens(projectTotals.totalTokens)} />
              <Stat label="Cost" value={formatCostUsd(projectTotals.estimatedCostUsd)} />
            </div>
          ) : (
            <EmptyNote>Open a project to see its usage.</EmptyNote>
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

      {/* Projects — clicking a row filters the whole dashboard to that project */}
      <Panel title="Projects">
        {projectRows.length === 0 ? (
          <EmptyNote>No project-attributed requests in this period.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-bolt-elements-textSecondary">
                  <th className="font-medium py-1.5 pr-3">Project</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Requests</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Tokens</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Cost</th>
                  <th className="font-medium py-1.5 pr-3 text-right">Avg Latency</th>
                  <th className="font-medium py-1.5 text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bolt-elements-borderColor/40">
                {projectRows.map((row) => (
                  <tr
                    key={row.projectId}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        projectId: current.projectId === row.projectId ? '' : row.projectId,
                      }))
                    }
                    className={classNames(
                      'cursor-pointer transition-colors text-bolt-elements-textSecondary',
                      filters.projectId === row.projectId
                        ? 'bg-builders-brand-subtleSurface'
                        : 'hover:bg-bolt-elements-background-depth-3/60',
                    )}
                  >
                    <td className="py-1.5 pr-3 text-bolt-elements-textPrimary max-w-[220px] truncate">
                      {projectName(row.projectId)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(row.requests)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCostUsd(row.estimatedCostUsd)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatLatency(row.averageLatencyMs)}</td>
                    <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                      {formatEventTime(row.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-bolt-elements-textSecondary">Select a row to filter the dashboard.</p>
          </div>
        )}
      </Panel>

      {/* Generations */}
      <Panel
        title="Generations"
        action={
          <span className="text-[11px] text-bolt-elements-textSecondary">
            {generations.filter((generation) => generation.grouping === 'inferred').length > 0
              ? 'Older runs are grouped by time and marked Inferred'
              : 'Grouped exactly by generation'}
          </span>
        }
      >
        {generations.length === 0 ? (
          <EmptyNote>No generations in this period.</EmptyNote>
        ) : (
          <ul className="space-y-1.5">
            {generations.slice(0, 15).map((generation) => (
              <GenerationRow
                key={generation.id}
                generation={generation}
                projectName={projectName(generation.projectId)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {/* Breakdowns + top lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(
          [
            ['Provider Breakdown', providerRows],
            ['Role Breakdown', roleRows],
            ['Most Used Models', modelRows],
            ['Top AI Roles', roleTop],
          ] as const
        ).map(([title, rows]) => {
          const max = Math.max(...rows.map((row) => row.requests), 1);

          return (
            <Panel key={title} title={title}>
              {rows.length === 0 ? (
                <EmptyNote>No AI requests in this period.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.key}>
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-bolt-elements-textPrimary truncate">{row.label}</span>
                        <span className="shrink-0 tabular-nums text-bolt-elements-textSecondary">
                          {formatCount(row.requests)} · {formatTokens(row.totalTokens)} ·{' '}
                          {formatCostUsd(row.estimatedCostUsd)}
                        </span>
                      </div>
                      <ProportionBar value={row.requests} max={max} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}

        <Panel title="Most Expensive Operations">
          {expensiveRows.length === 0 ? (
            <EmptyNote>No AI requests in this period.</EmptyNote>
          ) : (
            <ul className="space-y-1.5">
              {expensiveRows.map((row) => (
                <li key={row.key} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-bolt-elements-textPrimary truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-bolt-elements-textSecondary">
                    {formatCostUsd(row.estimatedCostUsd)} · {formatCount(row.requests)} req
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <SystemHealthPanel events={summaryEvents} ledgerReachable={available} />
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
          <EmptyNote>{loading ? 'Loading…' : 'No AI requests match these filters.'}</EmptyNote>
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
                  <tr
                    key={event.id}
                    onClick={() => setInspecting(event)}
                    title="Open request inspector"
                    className="cursor-pointer text-bolt-elements-textSecondary transition-colors hover:bg-bolt-elements-background-depth-3/60"
                  >
                    <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatEventTime(event.createdAt)}</td>
                    <td className="py-1.5 pr-3 text-bolt-elements-textPrimary whitespace-nowrap">
                      {formatRoleLabel(event.roleKey ?? event.requestType)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatProviderLabel(event.provider)}</td>
                    <td className="py-1.5 pr-3 max-w-[180px] truncate" title={event.apiModel}>
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
                      <StatusBadge status={event.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-bolt-elements-textSecondary">Select a row to inspect the request.</p>
          </div>
        )}
      </Panel>

      {/* Footnotes — why a cost might be "—", and the opt-in budget entry point. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-bolt-elements-textSecondary">
        <span>
          {unpricedModels.length > 0
            ? `Cost shows "${EMPTY_VALUE}" for models with no configured price: ${unpricedModels.slice(0, 3).join(', ')}${unpricedModels.length > 3 ? '…' : ''}.`
            : 'Costs are estimates based on configured model pricing.'}
          {enrichedCount > 0 ? ` ${enrichedCount} request(s) priced from configured overrides.` : ''}
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

      <RequestInspector
        event={inspecting}
        projectName={inspecting ? projectName(inspecting.projectId) : null}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}
