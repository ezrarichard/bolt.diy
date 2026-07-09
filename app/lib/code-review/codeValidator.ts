import type { GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { CodeReviewIssue, ValidatorDefinition, ValidatorRunResult } from './codeReviewTypes';

/**
 * Static Validator Registry — Sprint 39 (Code Reviewer role).
 *
 * Deterministic, no-LLM checks over the fully-assembled `GeneratedProject` (post-scaffold,
 * pre-write) — the same "no need for a full compiler" scope generationPipeline.ts's own
 * `validateGeneratedFiles` already commits to, but run one layer up so it can also see the
 * deterministic scaffold files (package.json, src/main.tsx, src/App.tsx) alongside the
 * AI-generated ones, and so it can be re-run against a patched project after a repair
 * without re-running the whole generation pipeline.
 *
 * Deliberately a REGISTRY of small, independent validators rather than one function: every
 * future validator (Browser, Visual QA, Accessibility, Performance, Security, ...) is just
 * another `ValidatorDefinition` pushed onto `STATIC_VALIDATORS` (or a new array for a new
 * stage) — `runStaticValidators` below, the timeline wiring, and the persistence layer
 * (repairHistoryRepository.ts's builders_validation_runs) never need to change shape.
 */

const RESOLVABLE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }

    if (segment === '..') {
      parts.pop();
      continue;
    }

    parts.push(segment);
  }

  return parts.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function resolveImportPath(fromFile: string, importSpecifier: string): string {
  return normalizePath(`${dirname(fromFile)}/${importSpecifier}`);
}

/** Extracts every `from '...'`/`from "..."` import specifier in a TS/TSX/JS/JSX source, keeping only relative ones (`./`, `../`) — bare package imports (react, react-router-dom, ...) are out of scope. */
function extractRelativeImports(content: string): { specifier: string; named: string[]; hasDefault: boolean }[] {
  const results: { specifier: string; named: string[]; hasDefault: boolean }[] = [];
  const importRegex = /import\s+([^;]*?)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;

  for (const match of content.matchAll(importRegex)) {
    const clause = match[1];
    const specifier = match[2];
    const namedMatch = clause.match(/\{([^}]*)\}/);
    const named = namedMatch
      ? namedMatch[1]
          .split(',')
          .map((entry) =>
            entry
              .trim()
              .split(/\s+as\s+/)[0]
              .trim(),
          )
          .filter(Boolean)
      : [];
    const beforeBrace = clause.split('{')[0].trim();
    const hasDefault = beforeBrace.length > 0 && !beforeBrace.startsWith('*');

    results.push({ specifier, named, hasDefault });
  }

  return results;
}

function hasDefaultExport(content: string): boolean {
  return /export\s+default\b/.test(content);
}

function hasNamedExport(content: string, name: string): boolean {
  const patterns = [
    new RegExp(`export\\s+(?:const|function|class|let|var)\\s+${name}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
  ];

  return patterns.some((pattern) => pattern.test(content));
}

function isSourceFile(path: string): boolean {
  return /\.(tsx?|jsx?)$/.test(path);
}

/** Structure & entry points — package.json/main/App present, no duplicate or empty files. */
function runStructureValidator(project: GeneratedProject): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];
  const filesByPath = new Map<string, GeneratedFile>(project.files.map((file) => [file.path, file]));
  const seenPaths = new Set<string>();

  for (const file of project.files) {
    if (seenPaths.has(file.path)) {
      issues.push({
        validatorId: 'structure',
        severity: 'error',
        message: `Duplicate file path: ${file.path}`,
        filePath: file.path,
      });
      continue;
    }

    seenPaths.add(file.path);

    if (file.content.trim().length === 0) {
      issues.push({
        validatorId: 'structure',
        severity: 'error',
        message: `Empty file: ${file.path}`,
        filePath: file.path,
      });
    }
  }

  if (!filesByPath.has('package.json')) {
    issues.push({ validatorId: 'structure', severity: 'error', message: 'package.json is missing.' });
  }

  if (!filesByPath.has('src/main.tsx')) {
    issues.push({
      validatorId: 'structure',
      severity: 'error',
      message: 'src/main.tsx (the app entry point) is missing.',
    });
  }

  if (!filesByPath.has('src/App.tsx')) {
    issues.push({ validatorId: 'structure', severity: 'error', message: 'src/App.tsx is missing.' });
  }

  return issues;
}

/** Every relative import resolves to a real generated file, and the named/default symbols it imports actually exist there. Directly targets this sprint's motivating example ("Failed to resolve import ... because the generated page filename did not exist"). */
function runImportsExportsValidator(project: GeneratedProject): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];
  const filesByPath = new Map<string, GeneratedFile>(project.files.map((file) => [file.path, file]));

  for (const file of project.files) {
    if (!isSourceFile(file.path)) {
      continue;
    }

    for (const { specifier, named, hasDefault } of extractRelativeImports(file.content)) {
      const resolvedBase = resolveImportPath(file.path, specifier);
      const resolvedPath = RESOLVABLE_EXTENSIONS.map((ext) => `${resolvedBase}${ext}`).find((candidate) =>
        filesByPath.has(candidate),
      );

      if (!resolvedPath) {
        issues.push({
          validatorId: 'imports-exports',
          severity: 'error',
          message: `${file.path} imports "${specifier}" but no matching generated file exists.`,
          filePath: file.path,
        });
        continue;
      }

      const target = filesByPath.get(resolvedPath)!;

      if (hasDefault && !hasDefaultExport(target.content)) {
        issues.push({
          validatorId: 'imports-exports',
          severity: 'error',
          message: `${file.path} imports a default export from "${specifier}", but ${target.path} has no default export.`,
          filePath: file.path,
        });
      }

      for (const name of named) {
        if (!hasNamedExport(target.content, name)) {
          issues.push({
            validatorId: 'imports-exports',
            severity: 'error',
            message: `${file.path} imports "${name}" from "${specifier}", but ${target.path} doesn't export it.`,
            filePath: file.path,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * The pluggable registry — every entry is attributed to the Code Reviewer role. Appending a
 * future validator (Browser, Visual QA, Accessibility, Performance, Security) here is the
 * entire integration; `runStaticValidators` and every caller already iterate this array
 * generically.
 */
export const STATIC_VALIDATORS: ValidatorDefinition[] = [
  {
    id: 'structure',
    label: 'Structure & Entry Points',
    stage: 'static',
    roleKey: 'code-reviewer',
    run: runStructureValidator,
  },
  {
    id: 'imports-exports',
    label: 'Imports & Exports',
    stage: 'static',
    roleKey: 'code-reviewer',
    run: runImportsExportsValidator,
  },
];

/**
 * Metadata for the one build-stage check this sprint implements. Its actual "run" is the
 * live install/dev-server flow (errorCollector.ts + repairEngine.ts's runBuildRepairLoop),
 * not a pure function — declared here only so its result persists through the same
 * `ValidatorRunResult` shape as the static ones (see codeReviewTypes.ts's header comment).
 */
export const NPM_INSTALL_AND_BOOT_VALIDATOR: ValidatorDefinition = {
  id: 'npm-install-and-boot',
  label: 'Install & Dev Server Boot',
  stage: 'build',
  roleKey: 'build-validator',
};

/** Runs every registered static validator over `project`, returning both the aggregated issue list and one `ValidatorRunResult` per validator (for builders_validation_runs — see repairHistoryRepository.ts). */
export function runStaticValidators(project: GeneratedProject): {
  issues: CodeReviewIssue[];
  runs: ValidatorRunResult[];
} {
  const allIssues: CodeReviewIssue[] = [];
  const runs: ValidatorRunResult[] = [];

  for (const validator of STATIC_VALIDATORS) {
    const issues = validator.run ? validator.run(project) : [];
    allIssues.push(...issues);
    runs.push({
      validatorId: validator.id,
      validatorLabel: validator.label,
      stage: validator.stage,
      roleKey: validator.roleKey,
      status: issues.length === 0 ? 'passed' : 'failed',
      issueCount: issues.length,
      issues,
    });
  }

  return { issues: allIssues, runs };
}

/** Retained for any direct/test caller that just wants the flat issue list without per-validator breakdown. */
export function validateGeneratedCode(project: GeneratedProject): CodeReviewIssue[] {
  return runStaticValidators(project).issues;
}
