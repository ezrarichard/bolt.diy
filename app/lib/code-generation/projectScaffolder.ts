import type { GeneratedFile, GenerationPlanPage } from './codeGenerationTypes';
import type { ProjectTemplate } from './templateResolver';

/**
 * Project Scaffolder — Sprint 38.
 *
 * Deterministic (no AI call) template files for the React + Vite + TypeScript path:
 * package.json, Vite/TS config, index.html, main.tsx, index.css, README.md, and —
 * deliberately deterministic rather than AI-generated — App.tsx, which only ever wires
 * already-planned routes to already-generated page components. Structural wiring like
 * this is exactly the kind of mechanical, correctness-critical file this sprint keeps
 * out of the AI's hands (see generationPipeline.ts's header comment on why planning is
 * deterministic): a hallucinated import path here would break the entire app, whereas a
 * page's own content (genuinely creative work) is what the AI calls are for.
 */

function toPackageName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'generated-app';
}

export interface ScaffoldInput {
  projectName: string;
  description?: string;
  template: ProjectTemplate;
  pages: GenerationPlanPage[];
}

function packageJsonFile(input: ScaffoldInput): GeneratedFile {
  const content = {
    name: toPackageName(input.projectName),
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite --host',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: input.template.dependencies,
    devDependencies: input.template.devDependencies,
  };

  return { path: 'package.json', content: `${JSON.stringify(content, null, 2)}\n` };
}

function viteConfigFile(): GeneratedFile {
  return {
    path: 'vite.config.ts',
    content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
});
`,
  };
}

function tsconfigFile(): GeneratedFile {
  const content = {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noFallthroughCasesInSwitch: true,
    },
    include: ['src'],
    references: [{ path: './tsconfig.node.json' }],
  };

  return { path: 'tsconfig.json', content: `${JSON.stringify(content, null, 2)}\n` };
}

function tsconfigNodeFile(): GeneratedFile {
  const content = {
    compilerOptions: {
      composite: true,
      skipLibCheck: true,
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowSyntheticDefaultImports: true,
    },
    include: ['vite.config.ts'],
  };

  return { path: 'tsconfig.node.json', content: `${JSON.stringify(content, null, 2)}\n` };
}

function indexHtmlFile(input: ScaffoldInput): GeneratedFile {
  return {
    path: 'index.html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${input.projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  };
}

function mainTsxFile(): GeneratedFile {
  return {
    path: 'src/main.tsx',
    content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  };
}

function indexCssFile(): GeneratedFile {
  return {
    path: 'src/index.css',
    content: `:root {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light dark;
}

body {
  margin: 0;
  min-height: 100vh;
}

a {
  color: inherit;
}
`,
  };
}

/** The one file this scaffolder writes that depends on the generation plan — every import path here is derived directly from `pages`, never guessed. */
function appTsxFile(input: ScaffoldInput): GeneratedFile {
  const imports = input.pages
    .map((page) => `import ${page.componentName} from './pages/${page.componentName}';`)
    .join('\n');

  const routes = input.pages
    .map((page) => `        <Route path="${page.routePath}" element={<${page.componentName} />} />`)
    .join('\n');

  return {
    path: 'src/App.tsx',
    content: `import { BrowserRouter, Routes, Route } from 'react-router-dom';
${imports}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
${routes}
      </Routes>
    </BrowserRouter>
  );
}
`,
  };
}

function readmeFile(input: ScaffoldInput): GeneratedFile {
  return {
    path: 'README.md',
    content: `# ${input.projectName}

${input.description ?? 'Generated by Builders from the assembled Product Package.'}

## Pages

${input.pages.map((page) => `- \`${page.routePath}\` — ${page.name}`).join('\n')}

## Getting started

\`\`\`bash
npm install
npm run dev
\`\`\`

This project was generated by Builders' Code Generation & Live Preview Pipeline (Sprint 38) from the project's assembled Product Package (Requirements, Architecture, UI/UX, Backend, and Frontend plans). It is a starting point, not a finished product — review and extend it like any other generated scaffold.
`,
  };
}

/** All deterministic scaffold files for the React + Vite + TypeScript template. `pages` must already be planned (see generationPipeline.ts) — App.tsx's routing is built directly from it. */
export function scaffoldReactViteProject(input: ScaffoldInput): GeneratedFile[] {
  return [
    packageJsonFile(input),
    viteConfigFile(),
    tsconfigFile(),
    tsconfigNodeFile(),
    indexHtmlFile(input),
    mainTsxFile(),
    indexCssFile(),
    appTsxFile(input),
    readmeFile(input),
  ];
}
