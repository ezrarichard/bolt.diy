import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { projectsStore } from '~/lib/stores/projects';
import { formatProviderLabel, formatRoleLabel } from '~/lib/observability/ai-usage/aiUsageAggregations';
import type { AiUsageEvent, AiUsageRange } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
import type { ObservabilityFilters } from './useObservabilityData';

/**
 * Shared filter bar for every Observability module, so AI Usage and Performance filter the same
 * way rather than each defining its own controls.
 *
 * Role and provider options are derived from the data, never hardcoded — a new provider or a newly
 * added AI role becomes filterable the first time it appears in the ledger.
 */

const RANGE_OPTIONS: { value: AiUsageRange; label: string }[] = [
  { value: 'session', label: 'Session' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];

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
          'appearance-none rounded-lg px-2 py-1 text-[11px] max-w-[160px]',
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

export function ObservabilityFilterBar({
  filters,
  onChange,
  summaryEvents,
}: {
  filters: ObservabilityFilters;
  onChange: (next: ObservabilityFilters) => void;
  summaryEvents: AiUsageEvent[];
}) {
  const projects = useStore(projectsStore);

  const providerOptions = useMemo(
    () => [...new Set(summaryEvents.map((event) => event.provider))].sort(),
    [summaryEvents],
  );
  const roleOptions = useMemo(
    () => [...new Set(summaryEvents.map((event) => event.roleKey ?? event.requestType))].sort(),
    [summaryEvents],
  );

  const isFiltered = Boolean(filters.projectId || filters.roleKey || filters.provider);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-bolt-elements-borderColor/60 overflow-hidden">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange({ ...filters, range: option.value })}
            className={classNames(
              'px-2.5 py-1 text-[11px] appearance-none border-0 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
              filters.range === option.value
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
        value={filters.projectId}
        onChange={(projectId) => onChange({ ...filters, projectId })}
        options={[
          { value: '', label: 'All' },
          ...projects.map((project) => ({ value: project.id, label: project.name })),
        ]}
      />
      <FilterSelect
        label="Role"
        value={filters.roleKey}
        onChange={(roleKey) => onChange({ ...filters, roleKey })}
        options={[
          { value: '', label: 'All' },
          ...roleOptions.map((key) => ({ value: key, label: formatRoleLabel(key) })),
        ]}
      />
      <FilterSelect
        label="Provider"
        value={filters.provider}
        onChange={(provider) => onChange({ ...filters, provider })}
        options={[
          { value: '', label: 'All' },
          ...providerOptions.map((provider) => ({ value: provider, label: formatProviderLabel(provider) })),
        ]}
      />

      {isFiltered && (
        <button
          type="button"
          onClick={() => onChange({ ...filters, projectId: '', roleKey: '', provider: '' })}
          className="text-[11px] px-2 py-1 rounded-lg bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
