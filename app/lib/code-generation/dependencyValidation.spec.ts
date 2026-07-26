import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from './codeGenerationTypes';
import {
  KNOWN_DEPENDENCY_VERSIONS,
  detectImportedPackages,
  resolveRequiredDependencies,
  validateDependencies,
} from './dependencyValidation';

function file(path: string, content: string): GeneratedFile {
  return { path, content };
}

describe('detectImportedPackages', () => {
  it('detects a bare package import', () => {
    const files = [file('src/features/x/validators.ts', "import { z } from 'zod';")];
    expect(detectImportedPackages(files)).toEqual(['zod']);
  });

  it('detects a scoped package import, keeping the full scope/name', () => {
    const files = [file('src/features/x/repository.ts', "import { createClient } from '@supabase/supabase-js';")];
    expect(detectImportedPackages(files)).toEqual(['@supabase/supabase-js']);
  });

  it('resolves a deep import to its top-level package name', () => {
    const files = [file('src/pages/HomePage.tsx', "import { format } from 'date-fns/format';")];
    expect(detectImportedPackages(files)).toEqual(['date-fns']);
  });

  it('never reports a relative import as a package', () => {
    const files = [file('src/App.tsx', "import HomePage from './pages/HomePage';\nimport { X } from '../types';")];
    expect(detectImportedPackages(files)).toEqual([]);
  });

  it('dedupes the same package imported from multiple files', () => {
    const files = [file('src/a.ts', "import { z } from 'zod';"), file('src/b.ts', "import { z } from 'zod';")];
    expect(detectImportedPackages(files)).toEqual(['zod']);
  });

  it('ignores non-code files entirely (README, package.json, css)', () => {
    const files = [file('README.md', "import 'not-real'"), file('src/index.css', 'body { color: red; }')];
    expect(detectImportedPackages(files)).toEqual([]);
  });
});

describe('validateDependencies', () => {
  it('is ok and adds nothing when every import is already declared', () => {
    const files = [file('src/App.tsx', "import { BrowserRouter } from 'react-router-dom';")];
    const result = validateDependencies(files, { 'react-router-dom': '^6.26.2' });

    expect(result.ok).toBe(true);
    expect(result.addedDependencies).toEqual([]);
    expect(result.unresolvedImports).toEqual([]);
  });

  /**
   * Sprint 85's own finding, reproduced directly: a generated Backend Module's
   * repository.ts imports "@supabase/supabase-js", but the scaffolded package.json never
   * included it — this is the exact defect Sprint 86 Part 1 exists to close.
   */
  it('auto-resolves a known package that was imported but missing from package.json (the Sprint 85 @supabase/supabase-js defect)', () => {
    const files = [
      file('src/features/appointments/repository.ts', "import { createClient } from '@supabase/supabase-js';"),
    ];
    const result = validateDependencies(files, { react: '^18.3.1' });

    expect(result.ok).toBe(true);
    expect(result.addedDependencies).toEqual(['@supabase/supabase-js']);
    expect(result.resolvedDependencies['@supabase/supabase-js']).toBe(
      KNOWN_DEPENDENCY_VERSIONS['@supabase/supabase-js'],
    );
    expect(result.resolvedDependencies.react).toBe('^18.3.1');
  });

  it('flags an unknown package as unresolved rather than inventing a version for it', () => {
    const files = [file('src/pages/HomePage.tsx', "import something from 'totally-unknown-package';")];
    const result = validateDependencies(files, {});

    expect(result.ok).toBe(false);
    expect(result.unresolvedImports).toEqual(['totally-unknown-package']);
    expect(result.resolvedDependencies['totally-unknown-package']).toBeUndefined();
  });
});

describe('resolveRequiredDependencies', () => {
  it('returns just the resolved dependency map, for callers that only need package.json content', () => {
    const files = [file('src/features/x/repository.ts', "import { createClient } from '@supabase/supabase-js';")];
    const resolved = resolveRequiredDependencies(files, { react: '^18.3.1' });

    expect(resolved).toEqual({
      react: '^18.3.1',
      '@supabase/supabase-js': KNOWN_DEPENDENCY_VERSIONS['@supabase/supabase-js'],
    });
  });
});
