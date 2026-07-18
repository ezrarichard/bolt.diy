import { describe, expect, it } from 'vitest';
import type { GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import { runStaticValidators } from './codeValidator';
import {
  applyAssemblyDeterministicRepairs,
  applyBarrelExportRepairs,
  applyWrongImportPathRepairs,
  computeRelativeSpecifier,
  planBarrelExportRepairs,
  planWrongImportPathRepairs,
} from './assemblyRepair';

function project(files: Record<string, string>): GeneratedProject {
  return {
    projectId: 'p1',
    templateId: 'quick-build',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

describe('computeRelativeSpecifier', () => {
  it('computes a same-directory relative specifier', () => {
    expect(computeRelativeSpecifier('src/types/index.ts', 'src/types/product.ts')).toBe('./product');
  });

  it('computes a specifier that needs to go up a directory', () => {
    expect(computeRelativeSpecifier('src/pages/HomePage.tsx', 'src/types/product.ts')).toBe('../types/product');
  });
});

describe('missing barrel export — Case A (real StyleHub Coimbatore repro)', () => {
  const brokenProject = () =>
    project({
      'package.json': '{}',
      'src/main.tsx': "import App from './App'\nexport {}",
      'src/App.tsx': 'export default function App() { return null; }\n',
      'src/types/product.ts': 'export interface Product {\n  id: string;\n  name: string;\n}\n',
      'src/types/index.ts': 'export interface CartItem {\n  id: string;\n}\n',
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        '',
        'export default function CollectionsPage() {',
        '  const items: Product[] = [];',
        '  return null;',
        '}',
      ].join('\n'),
    });

  it('the validator flags it as a repairable missing-export issue with structured detail', () => {
    const { issues } = runStaticValidators(brokenProject());
    const issue = issues.find((i) => i.category === 'missing-export');

    expect(issue).toBeDefined();
    expect(issue?.importedSymbol).toBe('Product');
    expect(issue?.targetPath).toBe('src/types/index.ts');
    expect(issue?.repairable).toBe(true);
  });

  it('plans a re-export from the file that actually defines Product', () => {
    const p = brokenProject();
    const { issues } = runStaticValidators(p);
    const fixes = planBarrelExportRepairs(issues, p);

    expect(fixes).toHaveLength(1);
    expect(fixes[0].targetPath).toBe('src/types/index.ts');
    expect(fixes[0].symbols).toEqual([{ name: 'Product', kind: 'type', sourcePath: 'src/types/product.ts' }]);
  });

  it('applyBarrelExportRepairs (called directly, not just through the orchestrator) adds the re-export', () => {
    const p = brokenProject();
    const { issues } = runStaticValidators(p);
    const fixes = planBarrelExportRepairs(issues, p);
    const { project: repaired, repairedFiles } = applyBarrelExportRepairs(p, fixes);

    expect(repairedFiles).toEqual(['src/types/index.ts']);
    expect(repaired.files.find((f) => f.path === 'src/types/index.ts')!.content).toContain(
      "export type { Product } from './product';",
    );
  });

  it('repairs the barrel file with a type-only re-export and re-validation then passes', () => {
    const p = brokenProject();
    const { issues } = runStaticValidators(p);
    const { project: repaired, repairedFiles } = applyAssemblyDeterministicRepairs(p, issues);

    expect(repairedFiles).toEqual(['src/types/index.ts']);

    const barrel = repaired.files.find((f) => f.path === 'src/types/index.ts')!;
    expect(barrel.content).toContain("export type { Product } from './product';");

    const { issues: remaining } = runStaticValidators(repaired);
    expect(remaining.filter((i) => i.category === 'missing-export')).toHaveLength(0);
  });

  it('never invents a placeholder type when the symbol is not defined anywhere', () => {
    const p = project({
      'src/pages/CollectionsPage.tsx':
        "import type { Product } from '../types';\nexport default function X() { return null; }",
      'src/types/index.ts': 'export interface CartItem { id: string; }\n',
    });
    const { issues } = runStaticValidators(p);
    const fixes = planBarrelExportRepairs(issues, p);

    expect(fixes).toHaveLength(0);

    const { repairedFiles } = applyAssemblyDeterministicRepairs(p, issues);
    expect(repairedFiles).toHaveLength(0);
  });

  it('does not duplicate an export line already present in the barrel file', () => {
    const p = project({
      'src/types/product.ts': 'export interface Product { id: string; }\n',
      'src/types/index.ts': "export interface CartItem { id: string; }\nexport type { Product } from './product';\n",
      'src/pages/CollectionsPage.tsx':
        "import type { Product } from '../types';\nexport default function X() { return null; }",
    });

    // The barrel already re-exports Product, so the validator shouldn't even flag this as missing.
    const { issues } = runStaticValidators(p);
    expect(issues.filter((i) => i.category === 'missing-export')).toHaveLength(0);
  });

  it('re-exports a VALUE (const/function) with a plain export, not export type', () => {
    const p = project({
      'src/lib/format.ts': 'export function formatPrice(n: number) { return String(n); }\n',
      'src/lib/index.ts': 'export const VERSION = 1;\n',
      'src/pages/HomePage.tsx': [
        "import { formatPrice } from '../lib';",
        'export default function HomePage() { return formatPrice(1); }',
      ].join('\n'),
    });

    const { issues } = runStaticValidators(p);
    const { project: repaired } = applyAssemblyDeterministicRepairs(p, issues);
    const barrel = repaired.files.find((f) => f.path === 'src/lib/index.ts')!;

    expect(barrel.content).toContain("export { formatPrice } from './format';");
    expect(barrel.content).not.toContain('export type { formatPrice }');
  });
});

describe('wrong import path — mechanical specifier rewrite', () => {
  it('detects and repairs an import pointing at the wrong (but findable) file', () => {
    const p = project({
      'src/components/cards/ProductCard.tsx': 'export default function ProductCard() { return null; }\n',
      'src/pages/HomePage.tsx': [
        "import ProductCard from '../components/ProductCard';",
        'export default function HomePage() { return null; }',
      ].join('\n'),
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'wrong-import-path');
    expect(issue).toBeDefined();
    expect(issue?.correctPath).toBe('src/components/cards/ProductCard.tsx');

    const fixes = planWrongImportPathRepairs(issues);
    expect(fixes).toEqual([
      {
        filePath: 'src/pages/HomePage.tsx',
        oldSpecifier: '../components/ProductCard',
        newSpecifier: '../components/cards/ProductCard',
      },
    ]);

    const { project: repaired, repairedFiles } = applyWrongImportPathRepairs(p, fixes);
    expect(repairedFiles).toEqual(['src/pages/HomePage.tsx']);
    expect(repaired.files.find((f) => f.path === 'src/pages/HomePage.tsx')!.content).toContain(
      "from '../components/cards/ProductCard'",
    );

    const { issues: remaining } = runStaticValidators(repaired);
    expect(remaining.filter((i) => i.category === 'wrong-import-path')).toHaveLength(0);
  });

  it('leaves an ambiguous broken import (two equally-good candidates) unrepaired rather than guessing', () => {
    const p = project({
      'src/components/a/Widget.tsx': 'export default function Widget() { return null; }\n',
      'src/components/b/Widget.tsx': 'export default function Widget() { return null; }\n',
      'src/pages/HomePage.tsx': [
        "import Widget from '../components/Widget';",
        'export default function HomePage() { return null; }',
      ].join('\n'),
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'wrong-import-path');
    expect(issue?.correctPath).toBeUndefined();
    expect(issue?.repairable).toBeUndefined();

    const fixes = planWrongImportPathRepairs(issues);
    expect(fixes).toHaveLength(0);
  });
});

describe('barrel export repair — tie-break determinism', () => {
  it('prefers the file in the same directory as the barrel when multiple files export the same symbol', () => {
    const p = project({
      'src/types/product.ts': 'export interface Product { id: string; }\n',
      'src/shared/product.ts': 'export interface Product { id: string; legacy: true; }\n',
      'src/types/index.ts': 'export {};\n',
      'src/pages/CollectionsPage.tsx':
        "import type { Product } from '../types';\nexport default function X() { return null; }",
    });

    const { issues } = runStaticValidators(p);
    const fixes = planBarrelExportRepairs(issues, p);

    expect(fixes[0].symbols[0].sourcePath).toBe('src/types/product.ts');
  });
});
