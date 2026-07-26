import type { GeneratedFile } from './codeGenerationTypes';

/**
 * Dependency Validation — Sprint 86 (Generation Reliability & Deployment Foundation).
 *
 * Sprint 85's assessment found the single biggest blocker to a deployable generated app:
 * `templateResolver.ts`'s hardcoded `package.json` dependency list only ever covers the
 * scaffold's own imports (react/react-dom/react-router-dom) — a generated Backend Module
 * imports `@supabase/supabase-js` (see `BACKEND_GENERATION_SYSTEM_PROMPT` in prompts.ts),
 * but nothing ever added that package to `package.json`, so `npm run build` (`tsc && vite
 * build`) fails on an unresolved import for every project with a Backend Module.
 *
 * This module closes that gap deterministically: `detectImportedPackages` is a pure regex
 * scan (no AST/TypeScript compiler dependency — same "no need for a full compiler"
 * philosophy `generationPipeline.ts`'s `validateGeneratedFiles` already established) over
 * every generated file's `import ... from '<specifier>'` statements, and
 * `resolveRequiredDependencies` cross-references the result against a small, explicit
 * registry of packages this pipeline's own prompts are known to ask for. A package the
 * registry doesn't recognize is never silently given a guessed version — it's reported as
 * `unresolvedImports` instead (see `validateDependencies`), since fabricating a version
 * number would be exactly the kind of invented precision this codebase's other engines
 * (see `backendModuleTypes.ts`'s own comment on `featureIds`) already refuse to do.
 */

/**
 * Every package name this pipeline's own prompts (prompts.ts) instruct the AI to import,
 * pinned to a version already compatible with the React + Vite + TypeScript template
 * (templateResolver.ts). Extend this list only when a prompt change actually starts
 * allowing a new import — this registry exists so a real, resolvable dependency is never
 * missing from a generated `package.json`, not to pre-approve arbitrary packages.
 */
export const KNOWN_DEPENDENCY_VERSIONS: Record<string, string> = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  'react-router-dom': '^6.26.2',
  '@supabase/supabase-js': '^2.45.4',
  zod: '^3.23.8',
  'date-fns': '^3.6.0',
};

const RELATIVE_IMPORT_PREFIX = /^\.{1,2}\//;

/** Every `from '...'`/`from "..."` (and bare `import '...'`) specifier in one file's content, in source order — deliberately regex-based, not a full parser, matching this pipeline's existing "basic validation" convention. */
function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const match of content.matchAll(pattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

/** The npm package name a non-relative import specifier resolves to — the specifier itself for a bare import ("zod"), the scope+name for a scoped package ("@supabase/supabase-js" from "@supabase/supabase-js/dist/..."), or the first path segment for a deep import ("date-fns" from "date-fns/format"). */
function packageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split('/');

  if (specifier.startsWith('@')) {
    return segments.slice(0, 2).join('/');
  }

  return segments[0];
}

/** Every non-relative package name imported anywhere across `files`, deduped, first-seen order. Relative imports (own project files) are never included — those are `generationValidator.ts`'s concern, not a dependency question. */
export function detectImportedPackages(files: GeneratedFile[]): string[] {
  const seen = new Set<string>();
  const packages: string[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) {
      continue;
    }

    for (const specifier of extractImportSpecifiers(file.content)) {
      if (RELATIVE_IMPORT_PREFIX.test(specifier) || specifier.startsWith('/')) {
        continue;
      }

      const packageName = packageNameFromSpecifier(specifier);

      if (!seen.has(packageName)) {
        seen.add(packageName);
        packages.push(packageName);
      }
    }
  }

  return packages;
}

export interface DependencyValidationResult {
  /** True when every imported package is either already present in `existingDependencies` or a known package this function was able to resolve a version for. False only when at least one imported package has no known version (see `unresolvedImports`) — never false merely because a KNOWN package was missing, since that case is auto-fixed via `resolvedDependencies` instead. */
  ok: boolean;

  /** `existingDependencies` merged with every detected, known-registry package not already present — this is what `package.json`'s "dependencies" SHOULD contain. */
  resolvedDependencies: Record<string, string>;

  /** Known packages that were imported but missing from `existingDependencies` before this validation ran — informational (they're already included in `resolvedDependencies`). */
  addedDependencies: string[];

  /** Imported packages with no entry in `KNOWN_DEPENDENCY_VERSIONS` — cannot be auto-added since a version can't be guessed; these are genuine build risks that must be surfaced, never silently dropped or invented. */
  unresolvedImports: string[];
}

/**
 * Cross-references every package `files` actually imports against `existingDependencies`
 * (typically `template.dependencies` merged with anything already scaffolded) and the
 * known-version registry above. Pure, synchronous, never throws.
 */
export function validateDependencies(
  files: GeneratedFile[],
  existingDependencies: Record<string, string>,
): DependencyValidationResult {
  const imported = detectImportedPackages(files);
  const resolvedDependencies = { ...existingDependencies };
  const addedDependencies: string[] = [];
  const unresolvedImports: string[] = [];

  for (const packageName of imported) {
    if (packageName in resolvedDependencies) {
      continue;
    }

    const knownVersion = KNOWN_DEPENDENCY_VERSIONS[packageName];

    if (knownVersion) {
      resolvedDependencies[packageName] = knownVersion;
      addedDependencies.push(packageName);
    } else {
      unresolvedImports.push(packageName);
    }
  }

  return {
    ok: unresolvedImports.length === 0,
    resolvedDependencies,
    addedDependencies,
    unresolvedImports,
  };
}

/** Convenience wrapper for callers (projectScaffolder.ts) that only need the corrected dependency map, not the full validation detail. */
export function resolveRequiredDependencies(
  files: GeneratedFile[],
  existingDependencies: Record<string, string>,
): Record<string, string> {
  return validateDependencies(files, existingDependencies).resolvedDependencies;
}
