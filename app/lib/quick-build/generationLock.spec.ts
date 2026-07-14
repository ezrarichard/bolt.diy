import { describe, expect, it, vi } from 'vitest';
import { createGenerationLock } from './generationLock';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('createGenerationLock', () => {
  it('runs fn exactly once for concurrent calls with the same id, and both callers get the same promise', async () => {
    const lock = createGenerationLock<string>();
    const fn = vi.fn(async () => 'result');

    const [a, b] = [lock.run('gen-1', fn), lock.run('gen-1', fn)];

    expect(a).toBe(b);
    await expect(a).resolves.toBe('result');
    await expect(b).resolves.toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores a late duplicate call after the first has already resolved — no second execution', async () => {
    const lock = createGenerationLock<string>();
    const fn = vi.fn(async () => 'result');

    await lock.run('gen-1', fn);
    await lock.run('gen-1', fn);
    await lock.run('gen-1', fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a different id (e.g. a retry) runs its own fresh execution', async () => {
    const lock = createGenerationLock<string>();
    const fn = vi.fn(async () => 'result');

    await lock.run('gen-1', fn);
    await lock.run('gen-2', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('two different ids run independently and concurrently — neither blocks the other', async () => {
    const lock = createGenerationLock<string>();
    const first = deferred<string>();
    const second = deferred<string>();

    const p1 = lock.run('gen-a', () => first.promise);
    const p2 = lock.run('gen-b', () => second.promise);

    second.resolve('b-done');
    await expect(p2).resolves.toBe('b-done');

    first.resolve('a-done');
    await expect(p1).resolves.toBe('a-done');
  });

  it('has() reflects tracked ids', async () => {
    const lock = createGenerationLock<string>();
    expect(lock.has('gen-1')).toBe(false);

    const promise = lock.run('gen-1', async () => 'result');
    expect(lock.has('gen-1')).toBe(true);

    await promise;
    expect(lock.has('gen-1')).toBe(true);
  });

  it('evicts the oldest entry once maxTracked is exceeded', async () => {
    const lock = createGenerationLock<number>(2);

    await lock.run('gen-1', async () => 1);
    await lock.run('gen-2', async () => 2);
    await lock.run('gen-3', async () => 3);

    expect(lock.has('gen-1')).toBe(false);
    expect(lock.has('gen-2')).toBe(true);
    expect(lock.has('gen-3')).toBe(true);
  });
});
