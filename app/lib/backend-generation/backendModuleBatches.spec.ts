import { describe, expect, it } from 'vitest';
import { backendModuleBatches, splitBatch } from './backendModuleBatches';
import { backendModuleFilePathList } from './backendModuleTypes';

/**
 * Sprint 99, Checkpoint A — batching is the mechanical half of the AR2-BUG-008 fix. A controlled
 * replication of the old six-file prompt at the pipeline's own 8192-token ceiling returned
 * `finishReason: "length"`, cut off mid-string; asking for two files at a time is what makes the
 * request fit.
 */
describe('backendModuleBatches', () => {
  it('covers exactly the six canonical module paths, with no gaps or duplicates', () => {
    const batched = backendModuleBatches('FEAT-005').flatMap((batch) => batch.paths);
    expect([...batched].sort()).toEqual([...backendModuleFilePathList('FEAT-005')].sort());
    expect(new Set(batched).size).toBe(6);
  });

  it('never asks for more than three files in one call', () => {
    for (const batch of backendModuleBatches('FEAT-005')) {
      expect(batch.paths.length).toBeGreaterThan(0);
      expect(batch.paths.length).toBeLessThanOrEqual(3);
    }
  });

  it('orders batches so a file is generated after the files it depends on', () => {
    const batches = backendModuleBatches('FEAT-005');
    expect(batches.map((batch) => batch.id)).toEqual(['contract', 'data', 'surface']);

    // types/validators before repository/service before routes/adapter.
    expect(batches[0].paths).toContain('src/features/FEAT-005/types.ts');
    expect(batches[1].paths).toContain('src/features/FEAT-005/repository.ts');
    expect(batches[2].paths).toContain('api/FEAT-005/index.ts');
  });
});

describe('splitBatch', () => {
  it('splits a multi-file batch into single-file batches for the one permitted retry', () => {
    const [contract] = backendModuleBatches('FEAT-005');
    const split = splitBatch(contract);

    expect(split).toBeDefined();
    expect(split).toHaveLength(2);
    expect(split!.every((batch) => batch.paths.length === 1)).toBe(true);
    expect(split!.flatMap((batch) => batch.paths)).toEqual(contract.paths);
  });

  it('returns undefined for a single-file batch so the retry loop stays bounded', () => {
    expect(splitBatch({ id: 'x', label: 'one', paths: ['src/features/FEAT-005/types.ts'] })).toBeUndefined();
  });
});
