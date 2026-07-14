import type { GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { CodeReviewIssue } from './codeReviewTypes';

/**
 * Deterministic React Import Repair — Sprint 43A.
 *
 * The single most common repair Sonnet 4.5/Haiku 4.5 generations need is also the most
 * mechanically provable: a React runtime export (StrictMode, useState, ...) imported from a
 * local file (typically "./App" or "./App.tsx") instead of from "react" — usually because
 * the model wrote `import { StrictMode } from './App'` by analogy with every other import in
 * main.tsx, rather than actually reasoning about where StrictMode comes from. Sending this to
 * the LLM Repair Engineer (repairEngine.ts) three times over is both slow and, per this
 * sprint's live audit, unreliable — nothing stops the model from "fixing" it by inventing a
 * matching export in the target file instead of fixing the import. Since the correct fix is
 * always the same mechanical rewrite, this module fixes it directly, with zero LLM calls, and
 * only ever touches imports codeValidator.ts already flagged (`category: 'react-runtime-import'`)
 * — see repairEngine.ts's `runDeterministicReactImportRepair` for how this is wired into the
 * static review loop, ahead of the LLM repair path.
 */

/** Every React export this rule recognizes as "must come from 'react'" — see the sprint brief's list. codeValidator.ts also uses this set to classify an issue as `category: 'react-runtime-import'`. */
export const REACT_RUNTIME_EXPORTS: ReadonlySet<string> = new Set([
  'StrictMode',
  'Fragment',
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useContext',
  'createContext',
  'lazy',
  'Suspense',
  'memo',
  'forwardRef',
  'Children',
  'cloneElement',
  'createElement',
  'isValidElement',
  'startTransition',
  'useTransition',
  'useDeferredValue',
  'useId',
  'useReducer',
  'useLayoutEffect',
  'useImperativeHandle',
]);

export const DETERMINISTIC_REACT_IMPORT_REPAIR_SOURCE = 'deterministic-react-import-repair';

/** One (file, specifier, symbol) triple this rule is licensed to fix — sourced only from validator issues, never guessed. */
interface ReactImportFix {
  filePath: string;
  invalidSource: string;
  symbol: string;
}

/** Filters `issues` down to the ones this deterministic rule can act on — anything the validator didn't mark repairable/react-runtime-import is left for the LLM Repair Engineer untouched. */
export function planReactImportRepairs(issues: CodeReviewIssue[]): ReactImportFix[] {
  const fixes: ReactImportFix[] = [];

  for (const issue of issues) {
    if (
      issue.category === 'react-runtime-import' &&
      issue.repairable &&
      issue.filePath &&
      issue.invalidSource &&
      issue.importedSymbol
    ) {
      fixes.push({ filePath: issue.filePath, invalidSource: issue.invalidSource, symbol: issue.importedSymbol });
    }
  }

  return fixes;
}

const IMPORT_STATEMENT_RE = /import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/g;

interface ParsedImportClause {
  hasDefault: boolean;
  defaultName?: string;
  named: string[];
}

function parseClause(clause: string): ParsedImportClause {
  const namedMatch = clause.match(/\{([\s\S]*)\}/);
  const named = namedMatch
    ? namedMatch[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const beforeBrace = clause.split('{')[0].replace(/,\s*$/, '').trim();
  const hasDefault = beforeBrace.length > 0 && !beforeBrace.startsWith('*');

  return { hasDefault, defaultName: hasDefault ? beforeBrace : undefined, named };
}

function renderClause(clause: ParsedImportClause): string {
  const parts: string[] = [];

  if (clause.defaultName) {
    parts.push(clause.defaultName);
  }

  if (clause.named.length > 0) {
    parts.push(`{ ${clause.named.join(', ')} }`);
  }

  return parts.join(', ');
}

function symbolNameOf(token: string): string {
  return token.split(/\s+as\s+/)[0].trim();
}

function dedupeNamed(named: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of named) {
    const key = symbolNameOf(token);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(token);
  }

  return result;
}

/**
 * Rewrites `content`'s import statements to move every flagged (specifier, symbol) pair over
 * to a single `import { ... } from 'react'` — merging into an existing `react` import if one
 * is already present, preserving every unrelated import (including other named symbols still
 * legitimately imported from the same now-partially-fixed specifier), and preserving the rest
 * of the file byte-for-byte. Returns `changed: false` (content unchanged) if none of `fixes`
 * actually matched anything in this file, so the caller never records a no-op patch.
 */
export function repairReactImportsInFile(
  content: string,
  fixes: { invalidSource: string; symbol: string }[],
): { content: string; changed: boolean } {
  if (fixes.length === 0) {
    return { content, changed: false };
  }

  const fixesBySpecifier = new Map<string, Set<string>>();

  for (const fix of fixes) {
    const set = fixesBySpecifier.get(fix.invalidSource) ?? new Set<string>();
    set.add(fix.symbol);
    fixesBySpecifier.set(fix.invalidSource, set);
  }

  const symbolsToMoveToReact = new Set<string>();
  let existingReactNamed: string[] = [];
  let reactStatementMatched = false;
  let changed = false;

  let rewritten = content.replace(IMPORT_STATEMENT_RE, (statement, clauseText, _quote, specifier) => {
    if (specifier === 'react') {
      reactStatementMatched = true;

      const clause = parseClause(clauseText);
      existingReactNamed = clause.named;

      // Leave the existing react import statement as-is for now — merged symbols are added afterward.
      return statement;
    }

    const flaggedSymbols = fixesBySpecifier.get(specifier);

    if (!flaggedSymbols || flaggedSymbols.size === 0) {
      return statement;
    }

    const clause = parseClause(clauseText);
    const remainingNamed: string[] = [];

    for (const token of clause.named) {
      const symbolName = symbolNameOf(token);

      if (flaggedSymbols.has(symbolName)) {
        symbolsToMoveToReact.add(token);
        changed = true;
        continue;
      }

      remainingNamed.push(token);
    }

    if (remainingNamed.length === clause.named.length) {
      // None of this statement's named imports were actually flagged — leave it untouched.
      return statement;
    }

    if (remainingNamed.length === 0 && !clause.defaultName) {
      // Nothing left to import from this specifier — drop the whole statement.
      return '';
    }

    const newClause = renderClause({ ...clause, named: remainingNamed });

    return `import ${newClause} from '${specifier}';`;
  });

  if (!changed) {
    return { content, changed: false };
  }

  // Clean up any now-empty line left behind by a fully-dropped import statement.
  rewritten = rewritten.replace(/\n[ \t]*\n(?=[ \t]*\nimport)/g, '\n');

  const mergedNamed = dedupeNamed([...existingReactNamed, ...Array.from(symbolsToMoveToReact)]);
  const reactImportLine = `import { ${mergedNamed.join(', ')} } from 'react';`;

  if (reactStatementMatched) {
    rewritten = rewritten.replace(IMPORT_STATEMENT_RE, (statement, _clauseText, _quote, specifier) =>
      specifier === 'react' ? reactImportLine : statement,
    );
  } else {
    const firstImportMatch = rewritten.match(IMPORT_STATEMENT_RE);

    if (firstImportMatch) {
      rewritten = rewritten.replace(firstImportMatch[0], `${reactImportLine}\n${firstImportMatch[0]}`);
    } else {
      rewritten = `${reactImportLine}\n${rewritten}`;
    }
  }

  return { content: rewritten, changed: true };
}

/** One remaining bad import `findUnrepairedReactRuntimeImports` found — same shape the validator/repair pass already use, kept minimal since this is only ever used to build a failure message. */
export interface UnrepairedReactRuntimeImport {
  symbol: string;
  specifier: string;
}

/**
 * Sprint 43B.1 — the consistency check `quickBuildOrchestrator.ts` runs on whatever is
 * ACTUALLY on the WebContainer disk immediately before build validation (see
 * webcontainerWriter.ts's `readGeneratedFileFromWebContainer`), not on the in-memory
 * `GeneratedProject` the repair already ran against. Pure text scan, deliberately independent
 * of `repairReactImportsInFile`'s own rewrite logic — this only needs to answer "is there
 * still a known React runtime export being imported from somewhere other than 'react'",
 * which is exactly what a stale/overwritten `main.tsx` would still show.
 */
export function findUnrepairedReactRuntimeImports(content: string): UnrepairedReactRuntimeImport[] {
  const found: UnrepairedReactRuntimeImport[] = [];

  for (const match of content.matchAll(IMPORT_STATEMENT_RE)) {
    const [, clauseText, , specifier] = match;

    if (specifier === 'react') {
      continue;
    }

    const clause = parseClause(clauseText);

    for (const token of clause.named) {
      const symbol = symbolNameOf(token);

      if (REACT_RUNTIME_EXPORTS.has(symbol)) {
        found.push({ symbol, specifier });
      }
    }
  }

  return found;
}

export interface DeterministicReactImportRepairResult {
  project: GeneratedProject;
  repairedFiles: string[];
}

/**
 * Applies `repairReactImportsInFile` across every file `planReactImportRepairs` flagged.
 * Pure — never touches BuildersDB/the WebContainer; repairEngine.ts's caller is responsible
 * for recording the attempt/validation-run rows and re-running static validation afterward.
 */
export function applyDeterministicReactImportRepairs(
  project: GeneratedProject,
  issues: CodeReviewIssue[],
): DeterministicReactImportRepairResult {
  const fixes = planReactImportRepairs(issues);

  if (fixes.length === 0) {
    return { project, repairedFiles: [] };
  }

  const fixesByFile = new Map<string, { invalidSource: string; symbol: string }[]>();

  for (const fix of fixes) {
    const list = fixesByFile.get(fix.filePath) ?? [];
    list.push({ invalidSource: fix.invalidSource, symbol: fix.symbol });
    fixesByFile.set(fix.filePath, list);
  }

  const repairedFiles: string[] = [];
  const files: GeneratedFile[] = project.files.map((file) => {
    const fileFixes = fixesByFile.get(file.path);

    if (!fileFixes) {
      return file;
    }

    const { content, changed } = repairReactImportsInFile(file.content, fileFixes);

    if (!changed) {
      return file;
    }

    repairedFiles.push(file.path);

    return { ...file, content };
  });

  return { project: { ...project, files }, repairedFiles };
}
