import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { checkTelemetrySchema } from './telemetrySchemaCheck';
import { telemetryStatusStore, type TelemetryStatus } from './telemetryStatus';

/**
 * Runs the telemetry schema check once per page load and exposes the resulting status.
 *
 * Module-level `hasRun` rather than component state: several components subscribe to telemetry
 * status (the header widget, the health panel, the dashboard banner) and the check must not run
 * once per subscriber. The first mount performs it; everyone else reads the published result.
 *
 * Read-only and non-blocking — nothing waits on this, and a failure only downgrades a badge.
 */

let hasRun = false;
let inFlight: Promise<unknown> | null = null;

export function runTelemetryStartupCheck(): void {
  if (hasRun || inFlight) {
    return;
  }

  inFlight = checkTelemetrySchema()
    .catch(() => undefined)
    .finally(() => {
      hasRun = true;
      inFlight = null;
    });
}

export function useTelemetryStatus(): TelemetryStatus {
  const status = useStore(telemetryStatusStore);

  useEffect(() => {
    runTelemetryStartupCheck();
  }, []);

  return status;
}

/** Test seam only — lets a test re-run the once-per-load check. */
export function resetTelemetryStartupCheck(): void {
  hasRun = false;
  inFlight = null;
}
