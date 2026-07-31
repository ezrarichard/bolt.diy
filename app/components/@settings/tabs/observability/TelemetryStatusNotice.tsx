import { classNames } from '~/utils/classNames';
import {
  TELEMETRY_NOT_CONFIGURED_MESSAGE,
  TELEMETRY_STATE_LABEL,
  type TelemetryStatus,
} from '~/lib/observability/telemetry/telemetryStatus';

/**
 * Builders Observability — telemetry status notice.
 *
 * The admin-facing counterpart to the silent failure that hid the missing ledger. Shown at the top
 * of the Observability modules whenever telemetry is not fully healthy, with the exact objects to
 * create and where to look.
 *
 * Deliberately informational, never blocking: telemetry being broken does not stop anyone using
 * Builders, and the copy says so outright so nobody reads it as an outage.
 */
export function TelemetryStatusNotice({ status }: { status: TelemetryStatus }) {
  if (status.state === 'healthy' || status.state === 'unknown') {
    return null;
  }

  const unavailable = status.state === 'unavailable';

  return (
    <div
      role="status"
      className={classNames(
        'rounded-xl border px-4 py-3',
        unavailable
          ? 'border-builders-status-error-border/40 bg-builders-status-error-bg'
          : 'border-builders-status-warning-border/40 bg-builders-status-warning-bg',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={classNames(
            'w-4 h-4 mt-0.5 shrink-0',
            unavailable ? 'i-ph:warning-octagon-duotone' : 'i-ph:warning-duotone',
            unavailable ? 'text-builders-status-error-text' : 'text-builders-status-warning-text',
          )}
        />
        <div className="min-w-0 text-xs">
          <p
            className={classNames(
              'font-semibold',
              unavailable ? 'text-builders-status-error-text' : 'text-builders-status-warning-text',
            )}
          >
            Telemetry {TELEMETRY_STATE_LABEL[status.state]}
          </p>

          <p className="mt-1 text-bolt-elements-textPrimary leading-relaxed">
            {unavailable ? TELEMETRY_NOT_CONFIGURED_MESSAGE : 'Usage logging has reported failures.'}
          </p>

          {unavailable && status.schema && status.schema.missing.length > 0 && (
            <p className="mt-1.5 text-bolt-elements-textSecondary">
              Missing:{' '}
              <code className="font-mono text-[11px] text-bolt-elements-textPrimary">
                {status.schema.missing.join(', ')}
              </code>
              . Apply <code className="font-mono text-[11px]">supabase/migrations/</code>
              <code className="font-mono text-[11px]">20260813100000_ai_usage_ledger_repair.sql</code>.
            </p>
          )}

          {status.lastError && (
            <p className="mt-1.5 text-bolt-elements-textSecondary">
              Last error ({status.lastError.source}) at {new Date(status.lastError.at).toLocaleString()}:{' '}
              <span className="text-bolt-elements-textPrimary">{status.lastError.message}</span>
            </p>
          )}

          <p className="mt-1.5 text-bolt-elements-textSecondary">
            AI generation is unaffected — only Observability data is impacted. See docs/10-Operations/Observability.md
            for troubleshooting.
          </p>
        </div>
      </div>
    </div>
  );
}
