import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry';

describe('withRetry — Sprint 76', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1 });

    expect(result).toEqual({ ok: true, value: 'ok', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure until it succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 5 });

    expect(result).toEqual({ ok: true, value: 'ok', attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying once maxAttempts is exhausted and returns the last error', async () => {
    const error = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(error);

    const result = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 3 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries when isRetryable returns false, even with attempts remaining', async () => {
    const error = new Error('permanent');
    const fn = vi.fn().mockRejectedValue(error);

    const result = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 5, isRetryable: () => false });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('defaults to 3 max attempts when not specified', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));

    const result = await withRetry(fn, { baseDelayMs: 1 });

    expect(result.attempts).toBe(3);
  });
});
