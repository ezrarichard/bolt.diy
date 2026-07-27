import { describe, expect, it } from 'vitest';
import { StallWatchdog, assessStall } from './stallWatchdog';

/**
 * Sprint 98A, BUG-014 / BUG-007. The regression: two silent stalls in Acceptance Round 1 that no
 * signal in the product distinguished from healthy work.
 */

/** A controllable clock — the watchdog must never depend on real time or on timers. */
function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceMinutes: (m: number) => {
      now += m * 60_000;
    },
  };
}

describe('StallWatchdog', () => {
  it('is healthy immediately after construction', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now });

    expect(watchdog.assess()).toMatchObject({ state: 'healthy', silentForMs: 0, message: '' });
  });

  it('stays healthy inside the normal duration of one unit of work', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now });

    // A single role generation took 1-5 minutes in Round 1; 2 minutes must not alarm.
    clock.advanceMinutes(2);

    expect(watchdog.assess().state).toBe('healthy');
  });

  it('reports slow — informational, not alarming — after the slow threshold', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now, label: 'Frontend Engineer' });

    clock.advanceMinutes(4);

    const assessment = watchdog.assess();

    expect(assessment.state).toBe('slow');
    expect(assessment.message).toContain('Frontend Engineer');
    expect(assessment.message).toContain('no action needed yet');
  });

  it('reports stalled with actionable guidance past the stall threshold', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now, label: 'QA Engineer' });

    // The BUG-007 shape: a stage sitting in "Waiting..." indefinitely.
    clock.advanceMinutes(10);

    const assessment = watchdog.assess();

    expect(assessment.state).toBe('stalled');
    expect(assessment.message).toContain('QA Engineer');
    expect(assessment.message).toContain('stalled');
    expect(assessment.message).toContain('will not recover on its own');
  });

  it('resets to healthy when progress is recorded', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now });

    clock.advanceMinutes(10);
    expect(watchdog.assess().state).toBe('stalled');

    watchdog.recordProgress('src/pages/LoginPage.tsx');
    expect(watchdog.assess()).toMatchObject({ state: 'healthy', silentForMs: 0 });
  });

  it('flags `changed` only on transition, so callers alert once instead of every poll', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now });

    clock.advanceMinutes(4);
    expect(watchdog.assess().changed).toBe(true);
    expect(watchdog.assess().changed).toBe(false);
    expect(watchdog.assess().changed).toBe(false);

    clock.advanceMinutes(6);
    expect(watchdog.assess().changed).toBe(true);
  });

  it('adopts the label from the most recent progress report', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now, label: 'Generation' });

    watchdog.recordProgress('src/services/api.ts');
    clock.advanceMinutes(10);

    expect(watchdog.assess().message).toContain('src/services/api.ts');
  });

  it('honours custom thresholds', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now, slowAfterMs: 1000, stalledAfterMs: 2000 });

    clock.advanceMinutes(1);

    expect(watchdog.assess().state).toBe('stalled');
  });

  it('never reports negative silence if the clock moves backwards', () => {
    let now = 10_000;
    const watchdog = new StallWatchdog({ clock: () => now });
    now = 0;

    expect(watchdog.assess().silentForMs).toBe(0);
  });

  it('uses no timers — assessment is driven entirely by the injected clock', () => {
    const clock = fakeClock();
    const watchdog = new StallWatchdog({ clock: clock.now });

    // No fake timers installed, no waiting: a throttled tab must not be able to disable the watchdog.
    clock.advanceMinutes(30);

    expect(watchdog.assess().state).toBe('stalled');
  });
});

describe('assessStall', () => {
  it('assesses a single timestamp without holding an instance', () => {
    const now = 1_000_000;
    const result = assessStall(now - 10 * 60_000, { clock: () => now, label: 'DevOps Engineer' });

    expect(result.state).toBe('stalled');
    expect(result.message).toContain('DevOps Engineer');
  });

  it('reports healthy for a recent timestamp', () => {
    const now = 1_000_000;

    expect(assessStall(now - 5_000, { clock: () => now }).state).toBe('healthy');
  });
});
