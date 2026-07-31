import type { AiUsageEvent } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
import { HEALTH_LABEL, HealthDot, Panel } from './ObservabilityPrimitives';
import { useSystemHealth } from './useSystemHealth';

/**
 * Builders Observability — compact system health widget.
 *
 * One row per component, each a dot plus a label. Deliberately dense: health is a glance, not a
 * screen. The hover title carries the reason, so nothing is hidden but nothing shouts either.
 */
export function SystemHealthPanel({ events, ledgerReachable }: { events: AiUsageEvent[]; ledgerReachable: boolean }) {
  const { components, overall } = useSystemHealth(events, ledgerReachable);

  return (
    <Panel
      title="System Health"
      action={
        <span className="inline-flex items-center gap-1.5 text-[11px] text-bolt-elements-textSecondary">
          <HealthDot status={overall} />
          {HEALTH_LABEL[overall]}
        </span>
      }
    >
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {components.map((component) => (
          <li key={component.id} className="flex items-center justify-between gap-2 text-xs" title={component.detail}>
            <span className="inline-flex items-center gap-2 min-w-0">
              <HealthDot status={component.status} />
              <span className="text-bolt-elements-textPrimary truncate">{component.label}</span>
            </span>
            <span className="shrink-0 text-[10px] text-bolt-elements-textSecondary">
              {HEALTH_LABEL[component.status]}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
