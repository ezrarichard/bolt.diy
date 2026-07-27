/**
 * Generation Stall Watchdog — Sprint 98A, BUG-014 / BUG-007.
 *
 * WHAT ACCEPTANCE TEST ROUND 1 ACTUALLY PROVED. Two different silent stalls, and in both cases the
 * UI's only signals were a progress line and an elapsed counter that both kept looking healthy:
 *
 *   BUG-007  The autonomous engineering pipeline reached `IDLE` with QA and DevOps showing
 *            "Waiting…" and stayed there. No error, no failed state, no timeout.
 *   BUG-014  Code generation appeared frozen for ten minutes. The elapsed counter was in fact
 *            under-reporting (see `useElapsedSeconds`), but nothing in the product could tell an
 *            operator whether work was slow or genuinely dead.
 *
 * "Slow" and "stuck" look identical unless something measures the gap between units of progress.
 * That is the whole job of this module: it is a pure, injectable clock-driven observer with no
 * React, no network and no timers of its own — callers report progress, and ask whether the run
 * has gone quiet for longer than it should have.
 *
 * WHY NOT A `setTimeout` WATCHDOG. Because a timer is precisely the thing browsers throttle. A
 * watchdog built on `setTimeout` would fall asleep in exactly the background tab where a stall is
 * hardest to notice. Reading `Date.now()` when asked is immune to that.
 */

export type StallState = 'healthy' | 'slow' | 'stalled';

export interface StallAssessment {
  state: StallState;

  /** Milliseconds since the last recorded unit of progress. */
  silentForMs: number;

  /** Populated for `slow` and `stalled`; empty when healthy. */
  message: string;

  /** True the first time a given state is reached, so callers can log or alert once rather than every poll. */
  changed: boolean;
}

export interface StallWatchdogOptions {
  /** Quiet longer than this and the run is reported as `slow`. Default 3 minutes. */
  slowAfterMs?: number;

  /** Quiet longer than this and the run is reported as `stalled`. Default 8 minutes. */
  stalledAfterMs?: number;

  /** What the run is doing, used in the operator-facing message ("Frontend Engineer", "src/pages/LoginPage.tsx"). */
  label?: string;
  clock?: () => number;
}

/**
 * Defaults sized from real measurements in Acceptance Round 1: a single role generation took
 * 1–5 minutes and a single file 2–5 minutes. `slow` at 3 minutes therefore fires during a normal
 * long unit and is informational only; `stalled` at 8 minutes is roughly twice the longest
 * legitimate gap observed, so it means something is genuinely wrong rather than merely slow.
 */
const DEFAULT_SLOW_AFTER_MS = 3 * 60 * 1000;
const DEFAULT_STALLED_AFTER_MS = 8 * 60 * 1000;

export class StallWatchdog {
  private _lastProgressAt: number;
  private _lastState: StallState = 'healthy';
  private readonly _slowAfterMs: number;
  private readonly _stalledAfterMs: number;
  private readonly _clock: () => number;
  private _label: string;

  constructor(options: StallWatchdogOptions = {}) {
    this._clock = options.clock ?? (() => Date.now());
    this._slowAfterMs = options.slowAfterMs ?? DEFAULT_SLOW_AFTER_MS;
    this._stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
    this._label = options.label ?? 'Generation';
    this._lastProgressAt = this._clock();
  }

  /** Call whenever a real unit of work completes — a role approved, a file persisted. Resets the clock. */
  recordProgress(label?: string): void {
    this._lastProgressAt = this._clock();
    this._lastState = 'healthy';

    if (label) {
      this._label = label;
    }
  }

  /** Non-mutating except for `changed` bookkeeping; safe to call as often as a UI refresh wants. */
  assess(): StallAssessment {
    const silentForMs = Math.max(0, this._clock() - this._lastProgressAt);

    const state: StallState =
      silentForMs >= this._stalledAfterMs ? 'stalled' : silentForMs >= this._slowAfterMs ? 'slow' : 'healthy';

    const changed = state !== this._lastState;
    this._lastState = state;

    return { state, silentForMs, changed, message: this._describe(state, silentForMs) };
  }

  private _describe(state: StallState, silentForMs: number): string {
    if (state === 'healthy') {
      return '';
    }

    const minutes = Math.floor(silentForMs / 60000);

    if (state === 'slow') {
      return `${this._label} has been running for ${minutes} minute(s) without completing a step. This is usually normal for a large step — no action needed yet.`;
    }

    return `${this._label} has made no progress for ${minutes} minute(s) and appears to have stalled. Check the browser console for errors, then stop and restart the run — leaving it will not recover on its own.`;
  }
}

/** Convenience for a single check without holding an instance. */
export function assessStall(
  lastProgressAt: number,
  options: StallWatchdogOptions = {},
): Omit<StallAssessment, 'changed'> {
  const watchdog = new StallWatchdog(options);
  (watchdog as unknown as { _lastProgressAt: number })._lastProgressAt = lastProgressAt;

  const { state, silentForMs, message } = watchdog.assess();

  return { state, silentForMs, message };
}
