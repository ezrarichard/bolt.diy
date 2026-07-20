import { describe, expect, it } from 'vitest';
import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import type { ApplicationManifestFileDraft } from './manifestTypes';
import { buildApplicationManifest, computeManifestChecksum, validateManifestFileDrafts } from './manifestBuilder';

function makeFile(overrides: Partial<ApplicationManifestFileDraft> = {}): ApplicationManifestFileDraft {
  return {
    path: 'src/App.tsx',
    fileType: 'tsx',
    category: 'entry',
    generationOrder: 0,
    dependencies: [],
    required: true,
    sourceKind: 'scaffold',
    featureIds: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<GenerationPlan> = {}): GenerationPlan {
  return {
    pages: [
      { name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' },
      { name: 'About', componentName: 'AboutPage', routePath: '/about', fileName: 'AboutPage.tsx' },
    ],
    sharedComponents: ['Navbar', 'Footer'],
    entities: ['Product'],
    apiEndpoints: ['/api/products'],
    fingerprints: {
      types: 'fnv1a:types0000',
      services: 'fnv1a:svc00000',
      pages: 'fnv1a:pages0000',
      components: 'fnv1a:comp0000',
    },
    scope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
    ...overrides,
  };
}

describe('buildApplicationManifest', () => {
  it('includes the complete planned file set: scaffold, entry, types, services, pages, and components', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });

    expect(result.ok).toBe(true);

    const paths = result.files.map((file) => file.path).sort();

    expect(paths).toEqual(
      [
        'README.md',
        'index.html',
        'package.json',
        'src/App.tsx',
        'src/components/Footer.tsx',
        'src/components/Navbar.tsx',
        'src/index.css',
        'src/main.tsx',
        'src/pages/AboutPage.tsx',
        'src/pages/HomePage.tsx',
        'src/services/api.ts',
        'src/types/index.ts',
        'tsconfig.json',
        'tsconfig.node.json',
        'vite.config.ts',
      ].sort(),
    );
  });

  it('marks every file required and sources scaffold vs ai_generated correctly', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    expect(byPath.get('package.json')?.sourceKind).toBe('scaffold');
    expect(byPath.get('src/pages/HomePage.tsx')?.sourceKind).toBe('ai_generated');
    expect(byPath.get('src/components/Navbar.tsx')?.sourceKind).toBe('ai_generated');
    expect(result.files.every((file) => file.required)).toBe(true);
  });

  it('sets component names on pages and shared components', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    expect(byPath.get('src/pages/HomePage.tsx')?.componentName).toBe('HomePage');
    expect(byPath.get('src/components/Navbar.tsx')?.componentName).toBe('Navbar');
  });

  it('produces a stable generation order matching the pipeline call order (types, services, pages, components, scaffold)', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const ordered = [...result.files].sort((a, b) => a.generationOrder - b.generationOrder).map((file) => file.path);

    expect(ordered[0]).toBe('src/types/index.ts');
    expect(ordered[1]).toBe('src/services/api.ts');
    expect(ordered.slice(2, 4)).toEqual(['src/pages/HomePage.tsx', 'src/pages/AboutPage.tsx']);
    expect(ordered.slice(4, 6)).toEqual(['src/components/Navbar.tsx', 'src/components/Footer.tsx']);
    expect(ordered.slice(6)).toEqual([
      'package.json',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.node.json',
      'index.html',
      'src/main.tsx',
      'src/index.css',
      'src/App.tsx',
      'README.md',
    ]);
  });

  it('sets dependencies for pages (types + services) and App.tsx (every page)', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    expect(byPath.get('src/pages/HomePage.tsx')?.dependencies).toEqual(['src/types/index.ts', 'src/services/api.ts']);
    expect(byPath.get('src/App.tsx')?.dependencies).toEqual(['src/pages/HomePage.tsx', 'src/pages/AboutPage.tsx']);
  });

  it('resolves a component-name collision between two shared components with a numeric suffix', () => {
    const result = buildApplicationManifest({
      projectId: 'proj-1',
      plan: makePlan({ sharedComponents: ['Nav Bar!', 'Nav Bar?'] }),
    });

    const componentPaths = result.files.filter((file) => file.category === 'components').map((file) => file.path);
    expect(new Set(componentPaths).size).toBe(componentPaths.length);
  });

  it('is deterministic — building the same plan twice produces the same checksum', () => {
    const plan = makePlan();
    const first = buildApplicationManifest({ projectId: 'proj-1', plan });
    const second = buildApplicationManifest({ projectId: 'proj-1', plan });

    expect(first.manifest?.planChecksum).toBe(second.manifest?.planChecksum);
  });

  it('produces a different checksum when the plan materially changes', () => {
    const first = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const second = buildApplicationManifest({
      projectId: 'proj-1',
      plan: makePlan({
        pages: [
          { name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' },
          { name: 'Contact', componentName: 'ContactPage', routePath: '/contact', fileName: 'ContactPage.tsx' },
        ],
      }),
    });

    expect(first.manifest?.planChecksum).not.toBe(second.manifest?.planChecksum);
  });

  it('still succeeds with zero pages — the scaffold always emits App.tsx/main.tsx/package.json/index.html', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan({ pages: [] }) });

    expect(result.ok).toBe(true);
    expect(result.files.some((file) => file.path === 'src/App.tsx')).toBe(true);
  });

  it('computeManifestChecksum ignores file order', () => {
    const result = buildApplicationManifest({ projectId: 'proj-1', plan: makePlan() });
    const reversed = [...result.files].reverse();

    expect(computeManifestChecksum(result.files)).toBe(computeManifestChecksum(reversed));
  });
});

describe('validateManifestFileDrafts', () => {
  it('rejects duplicate paths — first occurrence kept, the rest dropped and reported', () => {
    const { files, issues } = validateManifestFileDrafts([
      makeFile({ path: 'src/App.tsx' }),
      makeFile({ path: 'src/main.tsx' }),
      makeFile({ path: 'package.json' }),
      makeFile({ path: 'index.html' }),
      makeFile({ path: 'src/App.tsx' }),
    ]);

    expect(files.filter((file) => file.path === 'src/App.tsx')).toHaveLength(1);
    expect(issues.some((issue) => issue.severity === 'error' && issue.message.includes('Duplicate path'))).toBe(true);
  });

  it('rejects unsafe traversal paths', () => {
    const { files, issues } = validateManifestFileDrafts([makeFile({ path: '../../etc/passwd' })]);

    expect(files).toHaveLength(0);
    expect(issues.some((issue) => issue.message.includes('Unsafe/traversal path'))).toBe(true);
  });

  it('rejects absolute paths', () => {
    const { files, issues } = validateManifestFileDrafts([makeFile({ path: '/etc/passwd' })]);

    expect(files).toHaveLength(0);
    expect(issues.some((issue) => issue.message.includes('Unsafe/traversal path'))).toBe(true);
  });

  it('rejects excessively long paths', () => {
    const { files, issues } = validateManifestFileDrafts([makeFile({ path: `src/pages/${'A'.repeat(150)}.tsx` })]);

    expect(files).toHaveLength(0);
    expect(issues.some((issue) => issue.message.includes('Excessively long path'))).toBe(true);
  });

  it('warns (does not drop) on a dependency reference to a path that is not itself planned', () => {
    const { files, issues } = validateManifestFileDrafts([
      makeFile({ path: 'src/App.tsx', dependencies: ['src/pages/GhostPage.tsx'] }),
      makeFile({ path: 'src/main.tsx' }),
      makeFile({ path: 'package.json' }),
      makeFile({ path: 'index.html' }),
    ]);

    expect(files).toHaveLength(4);
    expect(
      issues.some((issue) => issue.severity === 'warning' && issue.message.includes('is not itself a planned file')),
    ).toBe(true);
  });

  it('reports an error for every missing mandatory entry file', () => {
    const { issues } = validateManifestFileDrafts([makeFile({ path: 'README.md', category: 'documentation' })]);

    const missing = issues.filter((issue) => issue.message.startsWith('Missing mandatory entry file'));
    expect(missing).toHaveLength(4); // src/main.tsx, src/App.tsx, package.json, index.html
  });
});
