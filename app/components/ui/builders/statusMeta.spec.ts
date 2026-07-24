import { describe, expect, it } from 'vitest';
import { BUILDERS_STATUS_META } from './statusMeta';

const EXPECTED_STATUSES = [
  'success',
  'warning',
  'error',
  'info',
  'active',
  'pending',
  'completed',
  'blocked',
  'approval',
  'working',
];

describe('BUILDERS_STATUS_META', () => {
  it('defines exactly the statuses required by the sprint brief', () => {
    expect(Object.keys(BUILDERS_STATUS_META).sort()).toEqual([...EXPECTED_STATUSES].sort());
  });

  it('gives every status a non-empty label, icon, and token class trio (never color alone)', () => {
    for (const [status, meta] of Object.entries(BUILDERS_STATUS_META)) {
      expect(meta.label, `${status} label`).toBeTruthy();
      expect(meta.icon, `${status} icon`).toBeTruthy();
      expect(meta.textClass, `${status} textClass`).toContain(
        `text-builders-status-${status === 'approval' ? 'approval' : status}-text`,
      );
      expect(meta.borderClass, `${status} borderClass`).toContain('border-builders-status-');
      expect(meta.bgClass, `${status} bgClass`).toContain('bg-builders-status-');
    }
  });

  it('only marks "working" as animated', () => {
    const animatedStatuses = Object.entries(BUILDERS_STATUS_META)
      .filter(([, meta]) => meta.animated)
      .map(([status]) => status);

    expect(animatedStatuses).toEqual(['working']);
  });

  it('gives "blocked" a distinct token trio from "error" so the two never render identically', () => {
    expect(BUILDERS_STATUS_META.blocked.textClass).not.toEqual(BUILDERS_STATUS_META.error.textClass);
    expect(BUILDERS_STATUS_META.blocked.icon).not.toEqual(BUILDERS_STATUS_META.error.icon);
  });
});
