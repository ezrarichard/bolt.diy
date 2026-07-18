import type { ApplicationManifestFile } from './manifestTypes';

/**
 * Dependency Graph — Sprint 44.2, Phase 4.
 *
 * `depends_on` already exists as `ApplicationManifestFile.dependencies` (Phase 1's
 * manifestBuilder.ts declares real edges: pages depend on types+services, App.tsx
 * depends on every page — see that file's `buildFileDrafts`). This module adds the
 * OTHER direction, `used_by`, computed as the mathematical inverse of `dependencies`
 * rather than a second stored column — storing both risks the two drifting out of sync;
 * deriving `used_by` from `depends_on` at read time cannot.
 *
 * Deterministic inference only, per this phase's own instruction ("the graph does NOT
 * need to be perfect... do not use AI") — exactly the edges manifestBuilder.ts already
 * declares, nothing more. A page that imports a shared component isn't captured (Phase 1
 * doesn't declare that edge — components have no declared dependents today), which is a
 * known, honest gap, not a silent inaccuracy: this graph only ever shows edges the
 * manifest itself asserts.
 */
export interface DependencyGraphEntry {
  path: string;
  dependsOn: string[];
  usedBy: string[];
}

export function computeDependencyGraph(
  files: Pick<ApplicationManifestFile, 'path' | 'dependencies'>[],
): Map<string, DependencyGraphEntry> {
  const graph = new Map<string, DependencyGraphEntry>();

  for (const file of files) {
    graph.set(file.path, { path: file.path, dependsOn: file.dependencies, usedBy: [] });
  }

  for (const file of files) {
    for (const dependencyPath of file.dependencies) {
      const dependency = graph.get(dependencyPath);

      if (dependency) {
        dependency.usedBy.push(file.path);
      }
    }
  }

  return graph;
}

export function getDependencyEntry(
  files: Pick<ApplicationManifestFile, 'path' | 'dependencies'>[],
  path: string,
): DependencyGraphEntry {
  return computeDependencyGraph(files).get(path) ?? { path, dependsOn: [], usedBy: [] };
}
