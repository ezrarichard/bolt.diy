import type { GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { CodeReviewIssue, ValidatorDefinition, ValidatorRunResult } from './codeReviewTypes';
import { REACT_RUNTIME_EXPORTS } from './reactImportRepair';

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

/**
 * Sprint 43B.1 — the previous pattern's clause group, `([^;]*?)`, is unbounded across
 * newlines: for source with no semicolons (the common case — Vite/Prettier `semi: false`,
 * and simply how most LLM-generated files come out), a non-greedy `[^;]*?` will happily
 * expand PAST the end of one whole `import ... from '...'` statement and into the START of
 * the next one, as long as doing so is what it takes to reach a `from` clause with a relative
 * specifier. Concretely, for
 *   import { StrictMode } from 'react'
 *   import App from './App.tsx'
 * the old regex's first match attempt (starting at the first `import`) fails to satisfy the
 * relative-specifier requirement against `'react'`, so it backtracks by consuming MORE
 * characters into group 1 — straight through the newline and the second import's own
 * `import App` — until it reaches `from './App.tsx'`, which DOES look relative. The overall
 * match then reports "StrictMode is imported from './App.tsx'": a real string that appears
 * nowhere in the source, entirely an artifact of two independent, individually-correct import
 * statements being merged by the regex. This was Sprint 43B.1's actual, sole root cause — not
 * a WebContainer write race, not a lost repair; the deterministic repair pass, the read-back
 * consistency check, and 3 LLM repair attempts were all being asked to fix a bug that never
 * existed in the file, which is exactly why none of them could make it go away.
 *
 * The fix: each of the four alternatives below is a legal, SELF-TERMINATING import clause
 * (`* as x`, `x, { ... }`, `{ ... }`, or bare `x`) — none of them can contain another
 * `import` keyword, and the `\{[^}]*\}` alternative still spans multiple lines fine (for a
 * long multi-line named-import list) while still stopping at that clause's own closing `}`.
 * If a specifier isn't relative, the match for that whole statement fails outright — the
 * clause alternatives give the engine nothing further to consume, so it correctly moves on to
 * the next `import` keyword instead of bleeding into it.
 */
/** Strips a leading `type` modifier — `import { type Product }` (inline type-only named import) and `import type { Product }` (whole-statement type-only import) both need this before the remaining text is treated as an ordinary identifier/clause. */
function stripLeadingTypeKeyword(text: string): string {
  return text.replace(/^type\s+/, '');
}

function extractRelativeImports(content: string): { specifier: string; named: string[]; hasDefault: boolean }[] {
  const results: { specifier: string; named: string[]; hasDefault: boolean }[] = [];

  /*
   * Assembly Auto-Repair — the previous version of this regex had no `(?:type\s+)?` here, so
   * `import type { Product } from '../types'` (an extremely common, entirely valid TS
   * construct in generated code — this exact statement is what the StyleHub Coimbatore smoke
   * test's real failure came from) silently matched NOTHING: "type" itself satisfied the bare
   * `[\w$]+` clause alternative, leaving " { Product }" where "from" was expected, so the
   * whole statement failed to match and was never validated at all. A type-only import that
   * points at a real missing export was therefore invisible to this validator — worse than a
   * false positive, a false negative that let the exact bug this sprint fixes go undetected.
   */
  const importRegex =
    /import\s+(?:type\s+)?((?:\*\s+as\s+[\w$]+)|(?:[\w$]+\s*,\s*\{[^}]*\})|(?:\{[^}]*\})|(?:[\w$]+))\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;

  for (const match of content.matchAll(importRegex)) {
    const clause = match[1];
    const specifier = match[2];
    const namedMatch = clause.match(/\{([^}]*)\}/);
    const named = namedMatch
      ? namedMatch[1]
          .split(',')
          .map((entry) =>
            stripLeadingTypeKeyword(entry.trim())
              .split(/\s+as\s+/)[0]
              .trim(),
          )
          .filter(Boolean)
      : [];
    const beforeBrace = stripLeadingTypeKeyword(clause.split('{')[0].trim());
    const hasDefault = beforeBrace.length > 0 && !beforeBrace.startsWith('*');

    results.push({ specifier, named, hasDefault });
  }

  return results;
}

/** Exported for reuse by assemblyRepair.ts — same "does this file export X as its default" check the imports-exports validator uses. */
export function hasDefaultExport(content: string): boolean {
  return /export\s+default\b/.test(content);
}

/** Exported for reuse by assemblyRepair.ts — same named-export check the imports-exports validator uses, kept as the single source of truth for "does this file export X by name" (also covers `export interface X`/`export type X`, needed for assemblyRepair.ts's barrel-repair to recognize type-only exports). */
export function hasNamedExport(content: string, name: string): boolean {
  const patterns = [
    new RegExp(`export\\s+(?:const|function|class|let|var|interface|type)\\s+${name}\\b`),

    /*
     * Covers both a local export list (`export { X }`) and a re-export (`export { X } from
     * '...'`), with or without the `type` modifier (`export type { X } from '...'` — the exact
     * shape assemblyRepair.ts's barrel-export repair writes).
     */
    new RegExp(`export\\s*(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`),
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
        /*
         * Assembly Auto-Repair — before giving up, look for a DIFFERENT generated file that
         * actually satisfies this whole import (every named symbol requested, plus a default
         * export if one was requested). If exactly one candidate does, this is a "right file,
         * wrong path" mistake (e.g. the AI wrote "./ProductCard" when the file actually landed
         * at "./cards/ProductCard") that assemblyRepair.ts can fix mechanically by rewriting the
         * specifier — no LLM call needed. Multiple equally-good candidates are deliberately left
         * unrepaired (ambiguous) rather than guessing.
         */
        const candidates = project.files.filter((candidate) => {
          if (!isSourceFile(candidate.path) || candidate.path === file.path) {
            return false;
          }

          if (hasDefault && !hasDefaultExport(candidate.content)) {
            return false;
          }

          return named.every((name) => hasNamedExport(candidate.content, name.split(/\s+as\s+/)[0].trim()));
        });

        issues.push({
          validatorId: 'imports-exports',
          severity: 'error',
          message: `${file.path} imports "${specifier}" but no matching generated file exists.`,
          filePath: file.path,
          category: 'wrong-import-path',
          invalidSource: specifier,
          ...(candidates.length === 1 ? { correctPath: candidates[0].path, repairable: true } : {}),
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
          const symbolName = name.split(/\s+as\s+/)[0].trim();
          const isReactRuntimeImport = REACT_RUNTIME_EXPORTS.has(symbolName) && specifier !== 'react';

          issues.push({
            validatorId: 'imports-exports',
            severity: 'error',
            message: isReactRuntimeImport
              ? `${file.path} imports "${name}" from "${specifier}", but that's a React runtime export — it should come from "react" instead.`
              : `${file.path} imports "${name}" from "${specifier}", but ${target.path} doesn't export it.`,
            filePath: file.path,
            ...(isReactRuntimeImport
              ? {
                  category: 'react-runtime-import',
                  importedSymbol: symbolName,
                  invalidSource: specifier,
                  expectedSource: 'react',
                  repairable: true,
                  suggestedAction: `Move ${symbolName} import to react`,
                }
              : {
                  /*
                   * Assembly Auto-Repair — every "target doesn't export it" case (barrel files
                   * like src/types/index.ts included) is generically `category: 'missing-export'`
                   * with enough structured detail (targetPath/importedSymbol/invalidSource) for
                   * assemblyRepair.ts to attempt a deterministic fix before any LLM repair
                   * attempt is spent. `repairable: true` here means "worth attempting a
                   * deterministic repair", not "guaranteed fixable" — assemblyRepair.ts still
                   * has to find the symbol defined somewhere else in the project first.
                   */
                  category: 'missing-export',
                  importedSymbol: symbolName,
                  invalidSource: specifier,
                  targetPath: target.path,
                  repairable: true,
                  suggestedAction: `Export ${symbolName} from ${target.path}, or fix the import in ${file.path}`,
                }),
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Every top-level identifier a file BINDS at module scope — import default/namespace/named
 * local names, plus top-level `const`/`function`/`class`/`interface`/`type` declarations
 * (exported or not). Two different bindings of the same name in the same file is a real
 * TypeScript "Cannot redeclare block-scoped variable" error, not a style nit — this is what
 * `runDuplicateSymbolsValidator` below checks for. Deliberately conservative (regex over the
 * same subset of syntax `extractRelativeImports`/`hasNamedExport` already commit to) — a
 * binding this misses is a false negative, never a false positive that would block a clean file.
 */
function collectTopLevelBindings(content: string): string[] {
  const bindings: string[] = [];

  for (const match of content.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = match[1];
    const namespaceMatch = clause.match(/^\*\s+as\s+([\w$]+)/);

    if (namespaceMatch) {
      bindings.push(namespaceMatch[1]);
      continue;
    }

    const namedMatch = clause.match(/\{([^}]*)\}/);
    const beforeBrace = stripLeadingTypeKeyword(clause.split('{')[0].replace(/,\s*$/, '').trim());

    if (beforeBrace.length > 0) {
      bindings.push(beforeBrace);
    }

    if (namedMatch) {
      for (const entry of namedMatch[1].split(',')) {
        const localName = stripLeadingTypeKeyword(entry.trim())
          .split(/\s+as\s+/)
          .pop()
          ?.trim();

        if (localName) {
          bindings.push(localName);
        }
      }
    }
  }

  for (const match of content.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:const|function|class|interface|type)\s+([\w$]+)/g,
  )) {
    bindings.push(match[1]);
  }

  return bindings;
}

/** Duplicate top-level bindings within one file — e.g. a page importing two components under the same local name, or an import shadowing a locally-declared component of the same name. Cross-file "two pages both named HomePage" is a naming-quality issue, not a compile error, and is covered separately by `runDuplicateComponentNamesValidator`. */
function runDuplicateSymbolsValidator(project: GeneratedProject): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];

  for (const file of project.files) {
    if (!isSourceFile(file.path)) {
      continue;
    }

    const seen = new Map<string, number>();

    for (const name of collectTopLevelBindings(file.content)) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }

    for (const [name, count] of seen) {
      if (count > 1) {
        issues.push({
          validatorId: 'duplicate-symbols',
          severity: 'error',
          message: `${file.path} declares or imports "${name}" more than once — TypeScript will reject this as a duplicate declaration.`,
          filePath: file.path,
          category: 'duplicate-symbol',
          importedSymbol: name,
        });
      }
    }
  }

  return issues;
}

function extractDefaultExportName(content: string): string | undefined {
  const directPatterns = [
    /export\s+default\s+function\s+([\w$]+)/,
    /export\s+default\s+class\s+([\w$]+)/,
    /export\s+default\s+([\w$]+)\s*;/,
  ];

  for (const pattern of directPatterns) {
    const match = content.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Cross-file naming collision: two different generated pages/components whose default export
 * resolves to the same identifier (e.g. both named "HomePage" after truncation — see
 * generationPipeline.ts's `toComponentName`). Each individual file is valid TypeScript on its
 * own; the collision only bites once App.tsx (or another consumer) imports both under the same
 * local name, which is exactly the "duplicate declaration" runDuplicateSymbolsValidator catches
 * — this validator exists to surface the ROOT naming collision directly, with a message that
 * names both files, rather than waiting for it to surface indirectly and confusingly in App.tsx.
 */
function runDuplicateComponentNamesValidator(project: GeneratedProject): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];
  const byName = new Map<string, string[]>();

  for (const file of project.files) {
    if (!/^src\/(pages|components)\//.test(file.path) || !isSourceFile(file.path)) {
      continue;
    }

    const name = extractDefaultExportName(file.content);

    if (!name) {
      continue;
    }

    const paths = byName.get(name) ?? [];
    paths.push(file.path);
    byName.set(name, paths);
  }

  for (const [name, paths] of byName) {
    if (paths.length > 1) {
      issues.push({
        validatorId: 'duplicate-component-names',
        severity: 'error',
        message: `Component name "${name}" is the default export of multiple files: ${paths.join(', ')} — component names must be unique.`,
        filePath: paths[0],
        category: 'duplicate-component-name',
        importedSymbol: name,
      });
    }
  }

  return issues;
}

const ROUTE_ELEMENT_RE = /<Route\b[^>]*\belement=\{\s*<\s*([A-Z][\w$]*)\b/g;

/**
 * Every `<Route element={<X .../>} />` in the app's route table (src/App.tsx by convention —
 * see projectScaffolder.ts) must reference a component that's actually bound (imported or
 * locally declared) in that same file. A route pointing at a name nothing binds renders a
 * blank/crashing page at runtime rather than failing at generation time, so this is checked
 * explicitly instead of relying on `runImportsExportsValidator` (which only inspects import
 * statements, not JSX usage).
 */
function runRouteValidator(project: GeneratedProject): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];
  const appFile = project.files.find((file) => file.path === 'src/App.tsx');

  if (!appFile) {
    return issues;
  }

  const bound = new Set(collectTopLevelBindings(appFile.content));

  for (const match of appFile.content.matchAll(ROUTE_ELEMENT_RE)) {
    const componentName = match[1];

    if (!bound.has(componentName)) {
      issues.push({
        validatorId: 'routes',
        severity: 'error',
        message: `src/App.tsx has a <Route> that renders "${componentName}", but that component is never imported or declared in src/App.tsx.`,
        filePath: appFile.path,
        category: 'missing-route-component',
        importedSymbol: componentName,
      });
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
  {
    id: 'duplicate-symbols',
    label: 'Duplicate Symbols',
    stage: 'static',
    roleKey: 'code-reviewer',
    run: runDuplicateSymbolsValidator,
  },
  {
    id: 'duplicate-component-names',
    label: 'Duplicate Component Names',
    stage: 'static',
    roleKey: 'code-reviewer',
    run: runDuplicateComponentNamesValidator,
  },
  {
    id: 'routes',
    label: 'Route References',
    stage: 'static',
    roleKey: 'code-reviewer',
    run: runRouteValidator,
  },
];

/** Only `severity: 'error'` issues gate generation — a validator that only ever wants to warn (naming quality, etc.) can be added to `STATIC_VALIDATORS` without also blocking otherwise-clean generations on cosmetic issues. */
export function hasBlockingIssues(issues: CodeReviewIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

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
