import { describe, expect, it } from 'vitest';
import type { GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
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

describe('runImportsExportsValidator (Sprint 43B.1 regression)', () => {
  it('does NOT flag a correct, semicolon-less main.tsx that imports StrictMode from react and App separately', () => {
    /*
     * This is the exact live-reproduced root cause: without semicolons (Vite's own default
     * template style, and how most LLM-generated files come out), the old regex's
     * non-greedy, unbounded clause group backtracked across the newline between these two
     * independent import statements and reported "StrictMode is imported from './App.tsx'"
     * — a string that never appeared anywhere in the file. The deterministic repair, the
     * disk-consistency check, and 3 LLM repair attempts were all being asked to fix a bug
     * that never existed.
     */
    const p = project({
      'package.json': '{}',
      'vite.config.ts': 'export default {}',
      'src/main.tsx': [
        "import { StrictMode } from 'react'",
        "import { createRoot } from 'react-dom/client'",
        "import App from './App.tsx'",
        "import './index.css'",
        '',
        "createRoot(document.getElementById('root')!).render(",
        '  <StrictMode>',
        '    <App />',
        '  </StrictMode>,',
        ')',
      ].join('\n'),
      'src/App.tsx': 'export default function App() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);

    expect(issues.filter((issue) => issue.category === 'react-runtime-import')).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it('still correctly flags a GENUINE StrictMode-from-App.tsx import when it actually occurs, semicolon-less', () => {
    const p = project({
      'package.json': '{}',
      'src/main.tsx': ["import { StrictMode } from './App'", "import App from './App'"].join('\n'),
      'src/App.tsx': 'export default function App() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'react-runtime-import');

    expect(issue).toBeDefined();
    expect(issue?.importedSymbol).toBe('StrictMode');
    expect(issue?.invalidSource).toBe('./App');
  });

  it('correctly parses a multi-line named import list (e.g. a long lucide-react icon list) without bleeding into the next statement', () => {
    const p = project({
      'package.json': '{}',
      'src/App.tsx': [
        "import React from 'react';",
        'import {',
        '  Church,',
        '  Calendar,',
        '  Heart,',
        "} from 'lucide-react';",
        "import Header from './components/Header';",
        'export default function App() { return null; }',
      ].join('\n'),
      'src/components/Header.tsx': 'export default function Header() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    expect(issues.filter((issue) => issue.validatorId === 'imports-exports')).toHaveLength(0);
  });

  it('still detects a genuine broken relative import unrelated to React runtime symbols', () => {
    const p = project({
      'package.json': '{}',
      'src/main.tsx': "import App from './App'",
      'src/App.tsx': "import { Missing } from './DoesNotExist'\nexport default function App() { return null; }",
    });

    const { issues } = runStaticValidators(p);
    const missingFileIssue = issues.find((issue) => issue.message.includes('DoesNotExist'));
    expect(missingFileIssue).toBeDefined();
  });
});
