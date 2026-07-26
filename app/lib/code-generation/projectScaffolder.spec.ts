import { describe, expect, it } from 'vitest';
import { resolveTemplate, REACT_VITE_TS_TEMPLATE_ID } from './templateResolver';
import { scaffoldReactViteProject, type ScaffoldInput } from './projectScaffolder';

function baseInput(overrides: Partial<ScaffoldInput> = {}): ScaffoldInput {
  return {
    projectName: 'Test Project',
    template: resolveTemplate(REACT_VITE_TS_TEMPLATE_ID),
    pages: [{ name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' }],
    ...overrides,
  };
}

function fileContent(files: ReturnType<typeof scaffoldReactViteProject>, path: string): string | undefined {
  return files.find((file) => file.path === path)?.content;
}

describe('scaffoldReactViteProject — package.json dependency resolution (Sprint 86 Part 1)', () => {
  it('uses the template dependencies unchanged when no resolvedDependencies is supplied', () => {
    const files = scaffoldReactViteProject(baseInput());
    const packageJson = JSON.parse(fileContent(files, 'package.json') ?? '{}');

    expect(packageJson.dependencies).toEqual(resolveTemplate(REACT_VITE_TS_TEMPLATE_ID).dependencies);
  });

  it('writes resolvedDependencies verbatim when supplied (e.g. including a detected @supabase/supabase-js)', () => {
    const resolvedDependencies = {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'react-router-dom': '^6.26.2',
      '@supabase/supabase-js': '^2.45.4',
    };
    const files = scaffoldReactViteProject(baseInput({ resolvedDependencies }));
    const packageJson = JSON.parse(fileContent(files, 'package.json') ?? '{}');

    expect(packageJson.dependencies).toEqual(resolvedDependencies);
  });
});

describe('scaffoldReactViteProject — .env.example generation (Sprint 86 Part 3)', () => {
  it('always generates a .env.example with generic placeholders, never secrets', () => {
    const files = scaffoldReactViteProject(baseInput());
    const envContent = fileContent(files, '.env.example');

    expect(envContent).toBeDefined();
    expect(envContent).toContain('VITE_ENV=development');
    expect(envContent).toContain('VITE_API_URL=');
  });

  it('omits Supabase placeholders for a project with no backend/database need', () => {
    const files = scaffoldReactViteProject(baseInput({ needsSupabaseEnv: false }));
    expect(fileContent(files, '.env.example')).not.toContain('VITE_SUPABASE_URL');
  });

  it('includes Supabase placeholders when needsSupabaseEnv is true', () => {
    const files = scaffoldReactViteProject(baseInput({ needsSupabaseEnv: true }));
    const envContent = fileContent(files, '.env.example');

    expect(envContent).toContain('VITE_SUPABASE_URL=');
    expect(envContent).toContain('VITE_SUPABASE_ANON_KEY=');
  });
});
