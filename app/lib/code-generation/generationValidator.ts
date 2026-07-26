import type { GeneratedFile, GeneratedProject, GenerationIssue } from './codeGenerationTypes';
import { validateDependencies } from './dependencyValidation';

/**
 * Build Validation — Sprint 86 (Generation Reliability & Deployment Foundation, Part 4).
 *
 * A post-assembly pass over the FULL `GeneratedProject` (AI-generated files + the
 * deterministic scaffold, already merged — see `generationPipeline.ts`'s final assembling
 * step), checking exactly the things Sprint 85's assessment identified as silently broken
 * today: an unresolvable dependency, or a relative import pointing at a file that was
 * never actually generated. Deliberately regex/path-based, not a TypeScript compiler pass
 * (same "no need for a full compiler" convention `validateGeneratedFiles` in
 * `generationPipeline.ts` already established) — this catches the class of error that
 * guarantees a broken `npm run build`, not every possible type error.
 *
 * Two severities, used consistently with the rest of this pipeline's own convention
 * (`GenerationIssue.severity`): an `'error'` here is something this function is CONFIDENT
 * would break the build (an import with no known package version, or a relative import to
 * a path that doesn't exist anywhere in the project) — `ok: false` is returned only for
 * these. A `'warning'` (missing default export on a page/component, a project that needs
 * Supabase env vars but has no `.env.example`) is a real, worth-surfacing risk that this
 * function is NOT confident enough about to block an entire generation run over — a page
 * whose AI output happens to use a named rather than default export, for instance, may
 * still be perfectly fine depending on how `App.tsx` imports it. Never throws.
 */

export interface BuildValidationResult {
  ok: boolean;
  issues: GenerationIssue[];
}

const RELATIVE_IMPORT_PREFIX = /^\.{1,2}\//;
const RESOLVABLE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

function extractRelativeImports(content: string): string[] {
  const specifiers: string[] = [];
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const match of content.matchAll(pattern)) {
    if (RELATIVE_IMPORT_PREFIX.test(match[1])) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/** Resolves a relative import specifier against the importing file's own directory into a normalized project-root-relative path (collapsing "." and ".." segments) — no filesystem access, pure string/array manipulation. */
function resolveRelativePath(fromPath: string, specifier: string): string {
  const fromDir = fromPath.split('/').slice(0, -1);
  const segments = [...fromDir];

  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') {
      continue;
    }

    if (part === '..') {
      segments.pop();
    } else {
      segments.push(part);
    }
  }

  return segments.join('/');
}

/** Checks broken relative imports across every `.ts`/`.tsx`/`.js`/`.jsx` file — a specifier that resolves (with any of `RESOLVABLE_EXTENSIONS` appended) to a path present in `knownPaths` is fine; otherwise it's a broken import. */
function validateImportPaths(files: GeneratedFile[]): GenerationIssue[] {
  const knownPaths = new Set(files.map((file) => file.path));
  const issues: GenerationIssue[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) {
      continue;
    }

    for (const specifier of extractRelativeImports(file.content)) {
      const resolvedBase = resolveRelativePath(file.path, specifier);
      const resolves = RESOLVABLE_EXTENSIONS.some((extension) => knownPaths.has(`${resolvedBase}${extension}`));

      if (!resolves) {
        issues.push({
          severity: 'error',
          stage: 'validating',
          message: `Broken import in ${file.path}: "${specifier}" does not resolve to any generated file.`,
          filePath: file.path,
        });
      }
    }
  }

  return issues;
}

/** Every page/component file lacking a recognizable `export default` — a heuristic warning, not a hard failure (see this file's header on why). */
function validateExports(files: GeneratedFile[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];

  for (const file of files) {
    const isComponentFile = file.path.startsWith('src/pages/') || file.path.startsWith('src/components/');

    if (!isComponentFile || !file.path.endsWith('.tsx')) {
      continue;
    }

    if (!/export\s+default\b/.test(file.content)) {
      issues.push({
        severity: 'warning',
        stage: 'validating',
        message: `${file.path} has no "export default" — components/pages are expected to default-export.`,
        filePath: file.path,
      });
    }
  }

  return issues;
}

/** Confirms `.env.example` exists (and, when Supabase env vars are expected, that it actually mentions them) whenever the project needs runtime environment configuration — a warning, since a missing/incomplete template is easy for a human to fix but shouldn't nuke an otherwise-successful generation. */
function validateEnvironmentTemplate(files: GeneratedFile[], needsSupabaseEnv: boolean): GenerationIssue[] {
  const envFile = files.find((file) => file.path === '.env.example');

  if (!envFile) {
    return [
      {
        severity: 'warning',
        stage: 'validating',
        message: 'No .env.example was generated for this project.',
      },
    ];
  }

  if (needsSupabaseEnv && !/VITE_SUPABASE_URL/.test(envFile.content)) {
    return [
      {
        severity: 'warning',
        stage: 'validating',
        message:
          '.env.example is missing Supabase placeholders even though this project has a generated backend/database schema.',
        filePath: '.env.example',
      },
    ];
  }

  return [];
}

export interface ValidateBuildReadinessInput {
  project: GeneratedProject;
  needsSupabaseEnv: boolean;
}

/**
 * The full Part 4 validation pass. `ok: false` only for the two error-severity checks
 * (unresolved dependency, broken relative import) — see this file's header for why every
 * other check stays a non-blocking warning.
 */
export function validateBuildReadiness(input: ValidateBuildReadinessInput): BuildValidationResult {
  const { project } = input;
  const packageJsonFile = project.files.find((file) => file.path === 'package.json');

  const packageJsonIssues: GenerationIssue[] = [];
  let dependencyIssues: GenerationIssue[] = [];

  if (!packageJsonFile) {
    packageJsonIssues.push({
      severity: 'error',
      stage: 'validating',
      message: 'No package.json was generated — the project cannot be installed or built.',
    });
  } else {
    try {
      const parsed = JSON.parse(packageJsonFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      /*
       * Build-time-only imports (vite.config.ts's "vite"/"@vitejs/plugin-react",
       * tsconfig's implicit "typescript") are legitimately devDependencies, never runtime
       * "dependencies" — merging both here (rather than checking "dependencies" alone)
       * avoids flagging config-file imports as unresolved just because they belong in the
       * other bucket of the same package.json.
       */
      const allDeclaredDependencies = { ...parsed.dependencies, ...parsed.devDependencies };
      const dependencyValidation = validateDependencies(project.files, allDeclaredDependencies);

      dependencyIssues = dependencyValidation.unresolvedImports.map((packageName) => ({
        severity: 'error' as const,
        stage: 'validating' as const,
        message: `Generated code imports "${packageName}", which has no known version and is not in package.json — add it to the dependency registry or remove the import.`,
      }));
    } catch {
      packageJsonIssues.push({
        severity: 'error',
        stage: 'validating',
        message: 'package.json is not valid JSON.',
      });
    }
  }

  const issues: GenerationIssue[] = [
    ...packageJsonIssues,
    ...dependencyIssues,
    ...validateImportPaths(project.files),
    ...validateExports(project.files),
    ...validateEnvironmentTemplate(project.files, input.needsSupabaseEnv),
  ];

  return { ok: issues.every((issue) => issue.severity !== 'error'), issues };
}
