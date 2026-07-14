import { describe, expect, it } from 'vitest';
import type { GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { CodeReviewIssue } from './codeReviewTypes';
import {
  applyDeterministicReactImportRepairs,
  findUnrepairedReactRuntimeImports,
  repairReactImportsInFile,
} from './reactImportRepair';
import { runStaticValidators } from './codeValidator';

function project(files: Record<string, string>): GeneratedProject {
  return {
    projectId: 'p1',
    templateId: 'quick-build',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

describe('reactImportRepair', () => {
  it('classifies StrictMode-from-App.tsx as a repairable react-runtime-import issue', () => {
    const p = project({
      'src/main.tsx': `import { StrictMode } from './App';\nimport App from './App';\n`,
      'src/App.tsx': `export default function App() { return null; }\n`,
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'react-runtime-import');

    expect(issue).toBeDefined();
    expect(issue?.importedSymbol).toBe('StrictMode');
    expect(issue?.invalidSource).toBe('./App');
    expect(issue?.expectedSource).toBe('react');
    expect(issue?.repairable).toBe(true);
  });

  it('rewrites a bad StrictMode import to react, preserving the default App import', () => {
    const content = `import { StrictMode } from './App';\nimport App from './App';\n\nconsole.log(App);\n`;
    const { content: fixed, changed } = repairReactImportsInFile(content, [
      { invalidSource: './App', symbol: 'StrictMode' },
    ]);

    expect(changed).toBe(true);
    expect(fixed).toContain(`import { StrictMode } from 'react';`);
    expect(fixed).toContain(`import App from './App';`);
    expect(fixed).not.toMatch(/StrictMode.*from ['"]\.\/App['"]/);
  });

  it('merges into an existing react import instead of duplicating it', () => {
    const content = `import { useState } from 'react';\nimport { StrictMode } from './App';\nimport App from './App';\n`;
    const { content: fixed, changed } = repairReactImportsInFile(content, [
      { invalidSource: './App', symbol: 'StrictMode' },
    ]);

    expect(changed).toBe(true);
    expect(fixed.match(/from 'react'/g)?.length).toBe(1);
    expect(fixed).toContain(`import { useState, StrictMode } from 'react';`);
  });

  it('does not touch genuinely local named imports', () => {
    const content = `import { Header } from './components/Header';\n`;
    const { content: fixed, changed } = repairReactImportsInFile(content, [
      { invalidSource: './App', symbol: 'StrictMode' },
    ]);

    expect(changed).toBe(false);
    expect(fixed).toBe(content);
  });

  it('end-to-end: applyDeterministicReactImportRepairs fixes main.tsx and re-validation passes', () => {
    const p = project({
      'package.json': '{}',
      'src/main.tsx': `import { StrictMode } from './App';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n`,
      'src/App.tsx': `export default function App() { return <div>Hi</div>; }\n`,
    });

    const before = runStaticValidators(p);
    expect(before.issues.some((i) => i.category === 'react-runtime-import')).toBe(true);

    const { project: repaired, repairedFiles } = applyDeterministicReactImportRepairs(p, before.issues);
    expect(repairedFiles).toEqual(['src/main.tsx']);

    const mainFile = repaired.files.find((f) => f.path === 'src/main.tsx');
    expect(mainFile?.content).toContain(`import { StrictMode } from 'react';`);

    const after = runStaticValidators(repaired);
    expect(after.issues.filter((i) => i.category === 'react-runtime-import')).toHaveLength(0);
  });

  it('is a no-op when there is nothing repairable', () => {
    const p = project({
      'src/main.tsx': `import App from './App';\n`,
      'src/App.tsx': `export default function App() { return null; }\n`,
    });

    const { issues } = runStaticValidators(p);
    const { project: repaired, repairedFiles } = applyDeterministicReactImportRepairs(p, issues as CodeReviewIssue[]);

    expect(repairedFiles).toHaveLength(0);
    expect(repaired).toBe(p);
  });
});

describe('findUnrepairedReactRuntimeImports (Sprint 43B.1 disk-consistency check)', () => {
  it('flags content that still imports a React runtime export from a local path', () => {
    const content = `import { StrictMode } from './App';\nimport App from './App';\n`;
    const found = findUnrepairedReactRuntimeImports(content);

    expect(found).toEqual([{ symbol: 'StrictMode', specifier: './App' }]);
  });

  it('finds nothing once the import has actually been moved to react', () => {
    const content = `import { StrictMode } from 'react';\nimport App from './App';\n`;
    expect(findUnrepairedReactRuntimeImports(content)).toHaveLength(0);
  });

  it('does not flag genuinely local named imports', () => {
    const content = `import { Header } from './components/Header';\n`;
    expect(findUnrepairedReactRuntimeImports(content)).toHaveLength(0);
  });
});
