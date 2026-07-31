/**
 * Builders Observability — telemetry self-monitoring.
 *
 * The AI usage ledger silently did not exist for weeks. It went unnoticed because
 * `recordAiUsage()` is deliberately fail-open — a telemetry problem must never break a generation
 * — and "fail-open" had been implemented as "fail silent". This module keeps the fail-open
 * behaviour and removes the silence.
 *
 * Nothing here can affect an AI request. It only records what already happened, so the worst
 * outcome of a bug in this file is a wrong badge in the Control Panel.
 *
 * The state machine is a pure function (`resolveTelemetryState`) so every transition is testable
 * without a database or a rendered component.
 */

import { atom } from 'nanostores';

export type TelemetryState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

/*
 * healthy      — schema verified and no recent failures.
 * degraded     — schema looks fine but reads/writes have been failing; something is wrong at runtime.
 * unavailable  — the ledger objects themselves are missing; nothing is being recorded at all.
 * unknown      — not checked yet. Never shown as a problem.
 */

export type SchemaObjectState = 'present' | 'missing' | 'unverifiable';

export interface TelemetrySchemaReport {
  /** `builders_ai_usage_events` — the ledger table. Definitive. */
  table: SchemaObjectState;

  /** `builders_ai_usage_daily` — the rollup view. Definitive. */
  dailyView: SchemaObjectState;

  /**
   * `builders_record_ai_usage()` — the write RPC.
   *
   * `unverifiable` is the honest answer whenever the table is present: PostgREST reports both "no
   * such function" and "function exists with a different signature" as PGRST202, its OpenAPI
   * listing requires a service-role key the browser must never hold, and calling the function for
   * real would write a row. When the table is MISSING we report the RPC missing too — both are
   * created by the same migration, so that inference is sound.
   */
  rpc: SchemaObjectState;

  /** Human-readable names of the objects known to be missing. Empty when nothing is missing. */
  missing: string[];
  checkedAt: string;
}

export interface TelemetryFailure {
  /** Which part of the pipeline reported it, e.g. 'ledger-read' or 'schema-check'. */
  source: string;
  message: string;
  at: string;
}

export interface TelemetryStatus {
  state: TelemetryState;
  schema?: TelemetrySchemaReport;
  lastError?: TelemetryFailure;

  /** Failures observed this session. Reset by a success, so a transient blip clears itself. */
  failureCount: number;
}

const INITIAL: TelemetryStatus = { state: 'unknown', failureCount: 0 };

export const telemetryStatusStore = atom<TelemetryStatus>(INITIAL);

/**
 * The single place the badge's meaning is decided.
 *
 * A missing schema object outranks everything: no number of successful reads makes a
 * non-existent ledger healthy. Otherwise any observed failure means degraded, and only a verified
 * schema with no failures earns healthy.
 */
export function resolveTelemetryState(status: Omit<TelemetryStatus, 'state'>): TelemetryState {
  if (status.schema && status.schema.missing.length > 0) {
    return 'unavailable';
  }

  if (status.failureCount > 0) {
    return 'degraded';
  }

  return status.schema ? 'healthy' : 'unknown';
}

function apply(next: Omit<TelemetryStatus, 'state'>): void {
  telemetryStatusStore.set({ ...next, state: resolveTelemetryState(next) });
}

/**
 * Records a telemetry failure. ALWAYS logs — this is the "never silently swallow" guarantee.
 * `console.warn` rather than `error` because, by design, nothing is broken for the user.
 */
export function reportTelemetryFailure(source: string, message: string): void {
  const current = telemetryStatusStore.get();
  const failure: TelemetryFailure = { source, message, at: new Date().toISOString() };

  console.warn('[Builders][telemetry] failure recorded — AI generation is unaffected.', {
    source,
    message,
    at: failure.at,
    failureCount: current.failureCount + 1,
  });

  apply({ schema: current.schema, lastError: failure, failureCount: current.failureCount + 1 });
}

/**
 * Records a healthy telemetry interaction, clearing a previous degraded state. Deliberately does
 * NOT clear `lastError`: "recovered, and here is what went wrong earlier" is more useful than a
 * status that erases its own history.
 */
export function reportTelemetrySuccess(): void {
  const current = telemetryStatusStore.get();

  if (current.failureCount === 0) {
    return;
  }

  apply({ schema: current.schema, lastError: current.lastError, failureCount: 0 });
}

export function recordSchemaReport(schema: TelemetrySchemaReport): void {
  const current = telemetryStatusStore.get();

  if (schema.missing.length > 0) {
    console.warn(
      '[Builders][telemetry] AI usage telemetry is not configured — the ledger objects are missing. ' +
        'Observability data will not be recorded until the migration is applied.',
      { missing: schema.missing, checkedAt: schema.checkedAt },
    );
  }

  apply({ schema, lastError: current.lastError, failureCount: current.failureCount });
}

/** Test seam only. */
export function resetTelemetryStatus(): void {
  telemetryStatusStore.set(INITIAL);
}

export const TELEMETRY_STATE_LABEL: Record<TelemetryState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  unknown: 'Not checked',
};

/** The message the brief specifies, shown verbatim wherever the admin warning appears. */
export const TELEMETRY_NOT_CONFIGURED_MESSAGE =
  'AI Usage telemetry is not configured. Observability data will not be recorded until the migration is applied.';
