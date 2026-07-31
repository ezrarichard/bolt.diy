import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordSchemaReport,
  reportTelemetryFailure,
  reportTelemetrySuccess,
  resetTelemetryStatus,
  resolveTelemetryState,
  telemetryStatusStore,
  type TelemetrySchemaReport,
} from './telemetryStatus';

/**
 * The guarantees under test:
 *  - a missing ledger can never be reported healthy, however well reads are going;
 *  - a failure is never swallowed — it always logs AND is retained;
 *  - fail-open still holds: none of these calls throw.
 */

function schema(overrides: Partial<TelemetrySchemaReport> = {}): TelemetrySchemaReport {
  return {
    table: 'present',
    dailyView: 'present',
    rpc: 'unverifiable',
    missing: [],
    checkedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetTelemetryStatus();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('resolveTelemetryState', () => {
  it('is unknown before any check has run', () => {
    expect(resolveTelemetryState({ failureCount: 0 })).toBe('unknown');
  });

  it('is healthy once the schema is verified with no failures', () => {
    expect(resolveTelemetryState({ schema: schema(), failureCount: 0 })).toBe('healthy');
  });

  it('is degraded when failures were observed but the schema is intact', () => {
    expect(resolveTelemetryState({ schema: schema(), failureCount: 2 })).toBe('degraded');
  });

  it('is unavailable when a schema object is missing', () => {
    expect(
      resolveTelemetryState({
        schema: schema({ table: 'missing', missing: ['builders_ai_usage_events'] }),
        failureCount: 0,
      }),
    ).toBe('unavailable');
  });

  it('a missing ledger outranks successful reads — never healthy, never merely degraded', () => {
    const state = resolveTelemetryState({
      schema: schema({ table: 'missing', missing: ['builders_ai_usage_events'] }),
      failureCount: 0,
    });

    expect(state).toBe('unavailable');
  });
});

describe('reportTelemetryFailure', () => {
  it('always logs — this is the anti-silence guarantee', () => {
    reportTelemetryFailure('ledger-read', 'relation does not exist');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('records the message, source and a timestamp', () => {
    reportTelemetryFailure('ledger-read', 'boom');

    const { lastError } = telemetryStatusStore.get();
    expect(lastError?.source).toBe('ledger-read');
    expect(lastError?.message).toBe('boom');
    expect(Number.isNaN(new Date(lastError?.at ?? '').getTime())).toBe(false);
  });

  it('moves an otherwise-healthy telemetry to degraded', () => {
    recordSchemaReport(schema());
    expect(telemetryStatusStore.get().state).toBe('healthy');

    reportTelemetryFailure('ledger-read', 'boom');
    expect(telemetryStatusStore.get().state).toBe('degraded');
  });

  it('counts repeated failures', () => {
    reportTelemetryFailure('ledger-read', 'one');
    reportTelemetryFailure('ledger-read', 'two');
    expect(telemetryStatusStore.get().failureCount).toBe(2);
  });

  it('never throws — telemetry must stay fail-open', () => {
    expect(() => reportTelemetryFailure('x', 'y')).not.toThrow();
  });
});

describe('reportTelemetrySuccess', () => {
  it('clears a degraded state', () => {
    recordSchemaReport(schema());
    reportTelemetryFailure('ledger-read', 'boom');
    reportTelemetrySuccess();

    expect(telemetryStatusStore.get().state).toBe('healthy');
    expect(telemetryStatusStore.get().failureCount).toBe(0);
  });

  it('retains the previous error for context after recovery', () => {
    recordSchemaReport(schema());
    reportTelemetryFailure('ledger-read', 'boom');
    reportTelemetrySuccess();

    expect(telemetryStatusStore.get().lastError?.message).toBe('boom');
  });

  it('cannot mask a missing ledger', () => {
    recordSchemaReport(schema({ table: 'missing', missing: ['builders_ai_usage_events'] }));
    reportTelemetrySuccess();

    expect(telemetryStatusStore.get().state).toBe('unavailable');
  });
});

describe('recordSchemaReport', () => {
  it('warns loudly when ledger objects are missing', () => {
    recordSchemaReport(schema({ table: 'missing', missing: ['builders_ai_usage_events'] }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('not configured');
  });

  it('stays quiet when everything is present', () => {
    recordSchemaReport(schema());
    expect(warn).not.toHaveBeenCalled();
  });
});
