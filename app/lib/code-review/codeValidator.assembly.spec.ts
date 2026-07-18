import { describe, expect, it } from 'vitest';
import type { GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import { hasBlockingIssues, runStaticValidators } from './codeValidator';

function project(files: Record<string, string>): GeneratedProject {
  return {
    projectId: 'p1',
    templateId: 'quick-build',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

describe('runDuplicateSymbolsValidator', () => {
  it('flags a file that imports the same local name from two different specifiers', () => {
    const p = project({
      'src/pages/HomePage.tsx': [
        "import Card from '../components/Card';",
        "import Card from '../components/ProductCard';",
        'export default function HomePage() { return null; }',
      ].join('\n'),
      'src/components/Card.tsx': 'export default function Card() { return null; }\n',
      'src/components/ProductCard.tsx': 'export default function ProductCard() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'duplicate-symbol');
    expect(issue).toBeDefined();
    expect(issue?.importedSymbol).toBe('Card');
  });

  it('does not flag a normal file with unique bindings', () => {
    const p = project({
      'src/pages/HomePage.tsx': [
        "import Header from '../components/Header';",
        "import Footer from '../components/Footer';",
        'export default function HomePage() { return null; }',
      ].join('\n'),
      'src/components/Header.tsx': 'export default function Header() { return null; }\n',
      'src/components/Footer.tsx': 'export default function Footer() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    expect(issues.filter((i) => i.category === 'duplicate-symbol')).toHaveLength(0);
  });
});

describe('runDuplicateComponentNamesValidator', () => {
  it('flags two different page files whose default export resolves to the same name', () => {
    const p = project({
      'src/pages/HomePage.tsx': 'export default function HomePage() { return null; }\n',
      'src/pages/HomePage2.tsx': 'export default function HomePage() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'duplicate-component-name');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('src/pages/HomePage.tsx');
    expect(issue?.message).toContain('src/pages/HomePage2.tsx');
  });

  it('does not flag two files with different component names', () => {
    const p = project({
      'src/pages/HomePage.tsx': 'export default function HomePage() { return null; }\n',
      'src/pages/AboutPage.tsx': 'export default function AboutPage() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    expect(issues.filter((i) => i.category === 'duplicate-component-name')).toHaveLength(0);
  });
});

describe('runRouteValidator', () => {
  it('flags a <Route> element referencing a component that is never imported or declared in App.tsx', () => {
    const p = project({
      'src/App.tsx': [
        "import { Routes, Route } from 'react-router-dom';",
        "import HomePage from './pages/HomePage';",
        'export default function App() {',
        '  return (',
        '    <Routes>',
        '      <Route path="/" element={<HomePage />} />',
        '      <Route path="/about" element={<AboutPage />} />',
        '    </Routes>',
        '  );',
        '}',
      ].join('\n'),
      'src/pages/HomePage.tsx': 'export default function HomePage() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    const issue = issues.find((i) => i.category === 'missing-route-component');
    expect(issue).toBeDefined();
    expect(issue?.importedSymbol).toBe('AboutPage');
  });

  it('does not flag a fully-wired route table', () => {
    const p = project({
      'src/App.tsx': [
        "import { Routes, Route } from 'react-router-dom';",
        "import HomePage from './pages/HomePage';",
        "import AboutPage from './pages/AboutPage';",
        'export default function App() {',
        '  return (',
        '    <Routes>',
        '      <Route path="/" element={<HomePage />} />',
        '      <Route path="/about" element={<AboutPage />} />',
        '    </Routes>',
        '  );',
        '}',
      ].join('\n'),
      'src/pages/HomePage.tsx': 'export default function HomePage() { return null; }\n',
      'src/pages/AboutPage.tsx': 'export default function AboutPage() { return null; }\n',
    });

    const { issues } = runStaticValidators(p);
    expect(issues.filter((i) => i.category === 'missing-route-component')).toHaveLength(0);
  });
});

describe('hasBlockingIssues', () => {
  it('treats error-severity issues as blocking', () => {
    expect(hasBlockingIssues([{ validatorId: 'x', severity: 'error', message: 'bad' }])).toBe(true);
  });

  it('does not treat warning-only issues as blocking', () => {
    expect(hasBlockingIssues([{ validatorId: 'x', severity: 'warning', message: 'fyi' }])).toBe(false);
  });

  it('treats an empty issue list as non-blocking', () => {
    expect(hasBlockingIssues([])).toBe(false);
  });
});
