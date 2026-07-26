import { describe, expect, it } from 'vitest';
import type { GeneratedProject } from './codeGenerationTypes';
import { validateBuildReadiness } from './generationValidator';

function makeProject(files: GeneratedProject['files']): GeneratedProject {
  return {
    projectId: 'proj-1',
    templateId: 'react-vite-ts',
    files,
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

const VALID_PACKAGE_JSON = JSON.stringify({
  dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.26.2' },
  devDependencies: { vite: '^5.4.8', '@vitejs/plugin-react': '^4.3.2', typescript: '^5.5.4' },
});

describe('validateBuildReadiness — package.json presence/parseability', () => {
  it('fails when package.json is missing entirely', () => {
    const project = makeProject([{ path: 'src/App.tsx', content: 'export default function App() { return null; }' }]);
    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('No package.json'))).toBe(true);
  });

  it('fails when package.json is not valid JSON', () => {
    const project = makeProject([{ path: 'package.json', content: '{ not valid json' }]);
    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('not valid JSON'))).toBe(true);
  });
});

describe('validateBuildReadiness — dependency/import checks (the Sprint 85 blocker)', () => {
  it('fails when generated code imports a package this pipeline has never heard of (no version to fall back on)', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      { path: 'src/pages/HomePage.tsx', content: "import something from 'a-package-nobody-registered';" },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('a-package-nobody-registered'))).toBe(true);
  });

  it('does not fail merely because a KNOWN package (e.g. @supabase/supabase-js) is imported but not yet in this package.json — projectScaffolder.ts is expected to have already resolved it before assembly reaches this check', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      {
        path: 'src/features/appointments/repository.ts',
        content: "import { createClient } from '@supabase/supabase-js';",
      },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: true });
    expect(result.ok).toBe(true);
  });

  it('passes when every imported package is already declared, in either dependencies or devDependencies', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      {
        path: 'vite.config.ts',
        content: "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';",
      },
      {
        path: 'src/App.tsx',
        content: "import { BrowserRouter } from 'react-router-dom';\nexport default function App() { return null; }",
      },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });
    expect(result.ok).toBe(true);
  });

  it('fails on a broken relative import to a file that was never generated', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      {
        path: 'src/App.tsx',
        content: "import HomePage from './pages/HomePage';\nexport default function App() { return null; }",
      },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Broken import'))).toBe(true);
  });

  it('resolves a relative import against .tsx/index.ts variants rather than only an exact match', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      {
        path: 'src/App.tsx',
        content: "import HomePage from './pages/HomePage';\nexport default function App() { return null; }",
      },
      { path: 'src/pages/HomePage.tsx', content: 'export default function HomePage() { return null; }' },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });
    expect(result.issues.some((issue) => issue.message.includes('Broken import'))).toBe(false);
  });
});

describe('validateBuildReadiness — non-blocking heuristic checks', () => {
  it('warns, but does not fail, when a page/component file has no default export', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      { path: 'src/pages/HomePage.tsx', content: 'export function HomePage() { return null; }' },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });
    expect(result.ok).toBe(true);
    expect(
      result.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('export default')),
    ).toBe(true);
  });

  it('warns, but does not fail, when .env.example is missing', () => {
    const project = makeProject([{ path: 'package.json', content: VALID_PACKAGE_JSON }]);
    const result = validateBuildReadiness({ project, needsSupabaseEnv: false });

    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('.env.example'))).toBe(true);
  });

  it('warns when a Supabase-needing project has an .env.example missing the Supabase placeholders', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      { path: '.env.example', content: 'VITE_ENV=development\n' },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: true });
    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Supabase placeholders'))).toBe(true);
  });

  it('has no environment-template warning when the Supabase placeholders are present', () => {
    const project = makeProject([
      { path: 'package.json', content: VALID_PACKAGE_JSON },
      { path: '.env.example', content: 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n' },
    ]);

    const result = validateBuildReadiness({ project, needsSupabaseEnv: true });
    expect(result.issues.some((issue) => issue.message.includes('Supabase placeholders'))).toBe(false);
  });
});
