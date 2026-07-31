import { describe, expect, it } from 'vitest';
import { EMPTY_VALUE, formatCostUsd, formatCount, formatLatency, formatTokens } from './observabilityFormat';

/**
 * These formatters are the last line of the "never invent a number" rule: whatever the
 * aggregations decided was unknown has to reach the screen as "—", and a genuine zero has to
 * reach it as a zero. Everything else here is presentation detail.
 */

describe('missing values', () => {
  it('renders null and undefined as the empty placeholder, never as zero', () => {
    for (const format of [formatCount, formatTokens, formatCostUsd, formatLatency]) {
      expect(format(null)).toBe(EMPTY_VALUE);
      expect(format(undefined)).toBe(EMPTY_VALUE);
    }
  });

  it('renders a genuine zero as a zero, not as the placeholder', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatTokens(0)).toBe('0');
    expect(formatCostUsd(0)).toBe('$0.00');
    expect(formatLatency(0)).toBe('0ms');
  });
});

describe('formatTokens', () => {
  it('is exact below 1000 and compact above it', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(2_400_000)).toBe('2.4M');
  });
});

describe('formatCostUsd', () => {
  it('keeps four decimals for sub-cent amounts so small real costs are not rounded to $0.00', () => {
    expect(formatCostUsd(0.0031)).toBe('$0.0031');
  });

  it('uses two decimals at or above a cent', () => {
    expect(formatCostUsd(1.239)).toBe('$1.24');
  });
});

describe('formatLatency', () => {
  it('switches from ms to seconds at 1000ms', () => {
    expect(formatLatency(999)).toBe('999ms');
    expect(formatLatency(1_500)).toBe('1.5s');
  });
});
