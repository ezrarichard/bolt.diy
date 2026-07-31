import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import type { AiUsageEvent } from '~/lib/observability/ai-usage/aiUsageQueryTypes';
import { formatRoleLabel, formatProviderLabel } from '~/lib/observability/ai-usage/aiUsageAggregations';
import { EMPTY_VALUE, formatCostUsd, formatCount, formatLatency } from './observabilityFormat';
import { StatusBadge } from './ObservabilityPrimitives';

/**
 * Builders Observability — AI request inspector.
 *
 * The debugging screen for one AI call. A right-hand drawer rather than a centred modal: the
 * Control Panel is itself a dialog, and a drawer keeps the request list visible behind it so you
 * can scan and inspect without losing your place.
 *
 * Read-only, and shows only what the ledger holds. Prompts and responses are deliberately never
 * recorded (see recordAiUsage.ts's DO NOT STORE list), so they cannot appear here — the panel says
 * so explicitly rather than leaving an unexplained gap where a developer might expect them.
 */

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-bolt-elements-borderColor/30 last:border-0">
      <dt className="text-[11px] text-bolt-elements-textSecondary shrink-0">{label}</dt>
      <dd
        className={classNames(
          'text-xs text-bolt-elements-textPrimary text-right min-w-0 break-words',
          mono ? 'font-mono text-[11px]' : '',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-bolt-elements-textSecondary mb-1.5">
        {title}
      </h4>
      <dl>{children}</dl>
    </div>
  );
}

export function RequestInspector({
  event,
  projectName,
  onClose,
}: {
  event: AiUsageEvent | null;
  projectName: string | null;
  onClose: () => void;
}) {
  if (!event) {
    return null;
  }

  const timestamp = new Date(event.createdAt);
  const cachedTotal = event.cachedInputTokens + event.cachedOutputTokens;

  return (
    <RadixDialog.Root open onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        {/* z-index sits above the Control Panel dialog (z-101), which this opens on top of. */}
        <RadixDialog.Overlay className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={classNames(
            'fixed right-0 top-0 z-[201] h-full w-[min(460px,94vw)]',
            'bg-bolt-elements-background-depth-1 border-l border-bolt-elements-borderColor',
            'shadow-2xl flex flex-col',
          )}
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-bolt-elements-borderColor/60">
            <div className="min-w-0">
              <RadixDialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary truncate">
                {formatRoleLabel(event.roleKey ?? event.requestType)}
              </RadixDialog.Title>
              <p className="text-[11px] text-bolt-elements-textSecondary">{timestamp.toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={event.status} />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close request inspector"
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-transparent border-0 appearance-none hover:bg-builders-brand-subtleSurface group transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus"
              >
                <div className="i-ph:x w-3.5 h-3.5 text-bolt-elements-textSecondary group-hover:text-builders-brand-primary" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
            <Section title="Request">
              <Row label="Timestamp" value={timestamp.toISOString()} mono />
              <Row label="Project" value={projectName ?? event.projectId ?? EMPTY_VALUE} />
              <Row label="AI Role" value={formatRoleLabel(event.roleKey ?? event.requestType)} />
              <Row label="Role key" value={event.roleKey ?? EMPTY_VALUE} mono />
              <Row label="Operation" value={event.operationId ?? EMPTY_VALUE} mono />
              <Row label="Request type" value={event.requestType} mono />
            </Section>

            <Section title="Model">
              <Row label="Provider" value={formatProviderLabel(event.provider)} />
              <Row label="Model" value={event.apiModel} mono />
              <Row label="Model key" value={event.modelKey ?? EMPTY_VALUE} mono />
            </Section>

            <Section title="Usage">
              <Row label="Input tokens" value={formatCount(event.inputTokens)} />
              <Row label="Output tokens" value={formatCount(event.outputTokens)} />
              <Row label="Cached tokens" value={formatCount(cachedTotal)} />
              <Row label="Total tokens" value={formatCount(event.totalTokens)} />
              <Row
                label="Estimated cost"
                value={
                  event.estimatedCostUsd === null
                    ? `${EMPTY_VALUE} (no configured price)`
                    : `${formatCostUsd(event.estimatedCostUsd)}${event.costSource === 'override' ? ' (override)' : ''}`
                }
              />
            </Section>

            <Section title="Execution">
              <Row label="Latency" value={formatLatency(event.durationMs)} />
              <Row label="Status" value={event.status} />
            </Section>

            {event.errorMessage && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-builders-status-error-text mb-1.5">
                  Error
                </h4>
                <p className="text-[11px] font-mono leading-relaxed text-bolt-elements-textPrimary bg-builders-status-error-bg border border-builders-status-error-border/40 rounded-lg p-2.5 break-words">
                  {event.errorMessage}
                </p>
              </div>
            )}

            <p className="text-[10px] leading-relaxed text-bolt-elements-textSecondary border-t border-bolt-elements-borderColor/40 pt-3">
              Prompts and responses are never recorded, so they cannot be shown here. The ledger stores request metadata
              only — see the Observability documentation.
            </p>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
