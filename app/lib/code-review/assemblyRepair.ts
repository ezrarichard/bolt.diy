import type { GeneratedFile, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import type { CodeReviewIssue } from './codeReviewTypes';
import { hasNamedExport } from './codeValidator';

/**
 * Assembly Auto-Repair — deterministic, zero-LLM repairs for cross-file consistency issues
 * the static validators (codeValidator.ts) can already point at a specific fix for
 * (`category: 'missing-export'` / `category: 'wrong-import-path'`, both carrying enough
 * structured detail — `targetPath`/`correctPath`/`importedSymbol` — to act on directly).
 *
 * Mirrors reactImportRepair.ts's shape exactly (plan* -> apply*, pure functions, no
 * BuildersDB/WebContainer side effects) and is wired into the SAME deterministic pass in
 * repairEngine.ts's `runStaticReviewLoop`, ahead of any LLM repair attempt: given a choice
 * between "guess a fix with an LLM call" and "the fix is mechanically provable from what's
 * already in the generated file set", the latter is always cheaper and more reliable — see
 * this module's two repair kinds below.
 *
 * Repair kind 1 — missing barrel export (spec's "Case A"): a page imports `{ Product }` from
 * `../types`, `Product` is genuinely defined and exported elsewhere in the project (e.g.
 * `src/types/product.ts`), but the barrel file (`src/types/index.ts`) never re-exports it.
 * Fix: add the re-export line to the barrel file. Never invents a definition — if the symbol
 * isn't exported ANYWHERE else in the project, this module does nothing and leaves the issue
 * for the LLM Repair Engineer (spec's "Case B"), which has product-package context this
 * module deliberately doesn't.
 *
 * Repair kind 2 — wrong import path: an import's specifier doesn't resolve to any generated
 * file, but exactly one OTHER generated file exports everything that import asked for (see
 * codeValidator.ts's `runImportsExportsValidator`, which already narrows this to the
 * unambiguous case — `correctPath` is only ever set when there's exactly one candidate). Fix:
 * rewrite the specifier in the importing file.
 */

export const DETERMINISTIC_ASSEMBLY_REPAIR_SOURCE = 'deterministic-assembly-repair';

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function stripExtension(path: string): string {
  return path.replace(/\.(tsx|ts|jsx|js)$/, '');
}

/** Relative specifier from `fromFile`'s own directory to `toFile` (both project-relative, e.g. "src/types/index.ts" -> "src/types/product.ts" => "./product"). Always relative (starts with "./" or "../"), matching every other generated import in this codebase. */
export function computeRelativeSpecifier(fromFile: string, toFile: string): string {
  const fromParts = dirname(fromFile).split('/').filter(Boolean);
  const toParts = stripExtension(toFile).split('/').filter(Boolean);

  let common = 0;

  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common += 1;
  }

  const ups = fromParts.length - common;
  const downs = toParts.slice(common);
  const relative = [...Array(ups).fill('..'), ...downs].join('/');

  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** 'type' for an interface/type-alias export (must be re-exported with `export type { X }` under isolatedModules), 'value' for anything else (const/function/class, or already-ambiguous `export { X }`), undefined if `symbol` isn't exported by `content` at all. */
export function classifyExportKind(content: string, symbol: string): 'type' | 'value' | undefined {
  if (new RegExp(`export\\s+(?:interface|type)\\s+${symbol}\\b`).test(content)) {
    return 'type';
  }

  if (hasNamedExport(content, symbol)) {
    return 'value';
  }

  return undefined;
}

export interface BarrelExportFix {
  targetPath: string;
  symbols: { name: string; kind: 'type' | 'value'; sourcePath: string }[];
}

/**
 * For each `missing-export` issue, looks for exactly the symbol it names, exported by some
 * OTHER file in the project. When more than one file exports the same name, prefers (in
 * order): a file in the same directory as the target barrel, then a file whose own path stem
 * matches the symbol name case-insensitively (e.g. "product.ts" for "Product"), then the
 * shortest path, then lexicographic — fully deterministic, never a coin flip.
 */
export function planBarrelExportRepairs(issues: CodeReviewIssue[], project: GeneratedProject): BarrelExportFix[] {
  const relevant = issues.filter(
    (issue) => issue.category === 'missing-export' && issue.targetPath && issue.importedSymbol,
  );

  if (relevant.length === 0) {
    return [];
  }

  const byTarget = new Map<string, { name: string; kind: 'type' | 'value'; sourcePath: string }[]>();

  for (const issue of relevant) {
    const targetPath = issue.targetPath!;
    const symbol = issue.importedSymbol!;

    const targetDir = dirname(targetPath);
    const candidates = project.files
      .filter((file) => file.path !== targetPath)
      .map((file) => ({ file, kind: classifyExportKind(file.content, symbol) }))
      .filter((entry): entry is { file: GeneratedFile; kind: 'type' | 'value' } => entry.kind !== undefined);

    if (candidates.length === 0) {
      continue;
    }

    const stem = symbol.toLowerCase();
    const best = [...candidates].sort((a, b) => {
      const aSameDir = dirname(a.file.path) === targetDir ? 0 : 1;
      const bSameDir = dirname(b.file.path) === targetDir ? 0 : 1;

      if (aSameDir !== bSameDir) {
        return aSameDir - bSameDir;
      }

      const aStemMatch = stripExtension(a.file.path).toLowerCase().endsWith(stem) ? 0 : 1;
      const bStemMatch = stripExtension(b.file.path).toLowerCase().endsWith(stem) ? 0 : 1;

      if (aStemMatch !== bStemMatch) {
        return aStemMatch - bStemMatch;
      }

      if (a.file.path.length !== b.file.path.length) {
        return a.file.path.length - b.file.path.length;
      }

      return a.file.path.localeCompare(b.file.path);
    })[0];

    const list = byTarget.get(targetPath) ?? [];

    if (!list.some((entry) => entry.name === symbol)) {
      list.push({ name: symbol, kind: best.kind, sourcePath: best.file.path });
    }

    byTarget.set(targetPath, list);
  }

  return Array.from(byTarget.entries()).map(([targetPath, symbols]) => ({ targetPath, symbols }));
}

/** Appends one re-export line per (sourcePath, kind) group to `content` — a single combined `export type { A, B } from '...'` per source file rather than one line per symbol, and never duplicates a line the file already has. */
function appendBarrelExports(targetPath: string, content: string, symbols: BarrelExportFix['symbols']): string {
  const bySource = new Map<string, { kind: 'type' | 'value'; names: string[] }>();

  for (const { name, kind, sourcePath } of symbols) {
    const entry = bySource.get(sourcePath) ?? { kind, names: [] };
    entry.names.push(name);

    // A source re-exported as both a type and a value (unlikely, but not impossible) keeps whichever kind was seen first — each is still added as its own combined line since the two groups have different `sourcePath` map entries only when kind differs, so this simply keeps grouping stable.
    bySource.set(sourcePath, entry);
  }

  const linesToAdd: string[] = [];

  for (const [sourcePath, { kind, names }] of bySource) {
    const specifier = computeRelativeSpecifier(targetPath, sourcePath);
    const uniqueNames = Array.from(new Set(names));
    const line =
      kind === 'type'
        ? `export type { ${uniqueNames.join(', ')} } from '${specifier}';`
        : `export { ${uniqueNames.join(', ')} } from '${specifier}';`;

    if (!content.includes(line)) {
      linesToAdd.push(line);
    }
  }

  if (linesToAdd.length === 0) {
    return content;
  }

  const trimmed = content.endsWith('\n') ? content : `${content}\n`;

  return `${trimmed}${linesToAdd.join('\n')}\n`;
}

export interface DeterministicAssemblyRepairResult {
  project: GeneratedProject;
  repairedFiles: string[];
  summaries: string[];
}

export function applyBarrelExportRepairs(
  project: GeneratedProject,
  fixes: BarrelExportFix[],
): DeterministicAssemblyRepairResult {
  if (fixes.length === 0) {
    return { project, repairedFiles: [], summaries: [] };
  }

  const fixesByTarget = new Map(fixes.map((fix) => [fix.targetPath, fix.symbols]));
  const repairedFiles: string[] = [];
  const summaries: string[] = [];

  const files: GeneratedFile[] = project.files.map((file) => {
    const symbols = fixesByTarget.get(file.path);

    if (!symbols) {
      return file;
    }

    const nextContent = appendBarrelExports(file.path, file.content, symbols);

    if (nextContent === file.content) {
      return file;
    }

    repairedFiles.push(file.path);
    summaries.push(
      `Added missing export(s) for ${symbols.map((s) => s.name).join(', ')} to ${file.path} (re-exported from ${Array.from(new Set(symbols.map((s) => s.sourcePath))).join(', ')})`,
    );

    return { ...file, content: nextContent };
  });

  return { project: { ...project, files }, repairedFiles, summaries };
}

export interface WrongImportPathFix {
  filePath: string;
  oldSpecifier: string;
  newSpecifier: string;
}

/** For each `wrong-import-path` issue codeValidator.ts already resolved to exactly one unambiguous candidate (`correctPath` set), plans a specifier rewrite in the importing file. Takes only `issues` — codeValidator.ts has already done the project-wide search and left the single answer on the issue itself. */
export function planWrongImportPathRepairs(issues: CodeReviewIssue[]): WrongImportPathFix[] {
  const fixes: WrongImportPathFix[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    if (issue.category !== 'wrong-import-path' || !issue.correctPath || !issue.invalidSource || !issue.filePath) {
      continue;
    }

    const key = `${issue.filePath}::${issue.invalidSource}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const newSpecifier = computeRelativeSpecifier(issue.filePath, issue.correctPath);
    fixes.push({ filePath: issue.filePath, oldSpecifier: issue.invalidSource, newSpecifier });
  }

  return fixes;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyWrongImportPathRepairs(
  project: GeneratedProject,
  fixes: WrongImportPathFix[],
): DeterministicAssemblyRepairResult {
  if (fixes.length === 0) {
    return { project, repairedFiles: [], summaries: [] };
  }

  const fixesByFile = new Map<string, WrongImportPathFix[]>();

  for (const fix of fixes) {
    const list = fixesByFile.get(fix.filePath) ?? [];
    list.push(fix);
    fixesByFile.set(fix.filePath, list);
  }

  const repairedFiles: string[] = [];
  const summaries: string[] = [];

  const files: GeneratedFile[] = project.files.map((file) => {
    const fileFixes = fixesByFile.get(file.path);

    if (!fileFixes) {
      return file;
    }

    let content = file.content;
    let changed = false;
    const applied: string[] = [];

    for (const fix of fileFixes) {
      const pattern = new RegExp(`(from\\s+['"])${escapeForRegex(fix.oldSpecifier)}(['"])`, 'g');

      if (!pattern.test(content)) {
        continue;
      }

      content = content.replace(pattern, `$1${fix.newSpecifier}$2`);
      changed = true;
      applied.push(`${fix.oldSpecifier} → ${fix.newSpecifier}`);
    }

    if (!changed) {
      return file;
    }

    repairedFiles.push(file.path);
    summaries.push(`Fixed import path in ${file.path} (${applied.join(', ')})`);

    return { ...file, content };
  });

  return { project: { ...project, files }, repairedFiles, summaries };
}

/**
 * Runs both deterministic repair kinds over `project` in one pass. Order matters only in
 * that barrel-export repairs never touch the SAME file a path-rewrite would (one adds export
 * lines to a target/barrel file, the other rewrites specifiers in an importING file), so
 * applying them sequentially is safe and their results simply compose.
 */
export function applyAssemblyDeterministicRepairs(
  project: GeneratedProject,
  issues: CodeReviewIssue[],
): DeterministicAssemblyRepairResult {
  const barrelFixes = planBarrelExportRepairs(issues, project);
  const barrelResult = applyBarrelExportRepairs(project, barrelFixes);

  const pathFixes = planWrongImportPathRepairs(issues);
  const pathResult = applyWrongImportPathRepairs(barrelResult.project, pathFixes);

  return {
    project: pathResult.project,
    repairedFiles: [...barrelResult.repairedFiles, ...pathResult.repairedFiles],
    summaries: [...barrelResult.summaries, ...pathResult.summaries],
  };
}
