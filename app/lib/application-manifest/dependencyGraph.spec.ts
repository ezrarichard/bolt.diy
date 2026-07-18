import { describe, expect, it } from 'vitest';
import { computeDependencyGraph, getDependencyEntry } from './dependencyGraph';

function files() {
  return [
    {
      path: 'src/pages/HomePage.tsx',
      dependencies: ['src/types/index.ts', 'src/services/api.ts', 'src/components/Header.tsx'],
    },
    { path: 'src/pages/AboutPage.tsx', dependencies: ['src/types/index.ts', 'src/components/Header.tsx'] },
    { path: 'src/components/Header.tsx', dependencies: [] },
    { path: 'src/types/index.ts', dependencies: [] },
    { path: 'src/services/api.ts', dependencies: ['src/types/index.ts'] },
  ];
}

describe('computeDependencyGraph', () => {
  it('preserves depends_on exactly as declared', () => {
    const graph = computeDependencyGraph(files());
    expect(graph.get('src/pages/HomePage.tsx')?.dependsOn).toEqual([
      'src/types/index.ts',
      'src/services/api.ts',
      'src/components/Header.tsx',
    ]);
  });

  it('computes used_by as the exact inverse of every depends_on edge', () => {
    const graph = computeDependencyGraph(files());

    expect(graph.get('src/types/index.ts')?.usedBy).toEqual([
      'src/pages/HomePage.tsx',
      'src/pages/AboutPage.tsx',
      'src/services/api.ts',
    ]);
    expect(graph.get('src/components/Header.tsx')?.usedBy).toEqual([
      'src/pages/HomePage.tsx',
      'src/pages/AboutPage.tsx',
    ]);
  });

  it('gives a file with no dependents an empty used_by list', () => {
    const graph = computeDependencyGraph(files());
    expect(graph.get('src/pages/HomePage.tsx')?.usedBy).toEqual([]);
  });

  it('ignores a dependency edge pointing at a path not present in the file set (never throws)', () => {
    const graph = computeDependencyGraph([{ path: 'a.ts', dependencies: ['ghost.ts'] }]);
    expect(graph.get('a.ts')?.dependsOn).toEqual(['ghost.ts']);
    expect(graph.size).toBe(1);
  });
});

describe('getDependencyEntry', () => {
  it('returns the entry for a known path', () => {
    const entry = getDependencyEntry(files(), 'src/services/api.ts');
    expect(entry.dependsOn).toEqual(['src/types/index.ts']);
    expect(entry.usedBy).toEqual(['src/pages/HomePage.tsx']);
  });

  it('returns an empty entry for an unknown path rather than throwing', () => {
    const entry = getDependencyEntry(files(), 'src/pages/DoesNotExist.tsx');
    expect(entry).toEqual({ path: 'src/pages/DoesNotExist.tsx', dependsOn: [], usedBy: [] });
  });
});
