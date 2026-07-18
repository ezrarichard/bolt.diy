import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import { REACT_VITE_TS_TEMPLATE_ID } from '~/lib/code-generation/templateResolver';
import type {
  ApplicationManifestFileDraft,
  BuildManifestResult,
  ManifestFileCategory,
  ManifestValidationIssue,
} from './manifestTypes';

/**
 * Application Manifest Builder — Sprint 44.2, Phase 1.
 *
 * Deterministically derives the COMPLETE planned application file set from the exact
 * same `GenerationPlan` the code generation pipeline already builds
 * (app/lib/code-generation/generationPipeline.ts's `buildGenerationPlan`) plus the
 * deterministic scaffold file list (projectScaffolder.ts) — no AI call, no filesystem
 * access, never throws. Every path this module produces is exactly the path the
 * pipeline's own prompts (see prompts.ts) instruct the AI to use, or that
 * projectScaffolder.ts deterministically writes — so a Phase 1 manifest, while built
 * ahead of generation, should already match what generation actually produces (subject
 * to the AI occasionally returning EXTRA files beyond what a prompt asked for, which
 * this manifest doesn't attempt to predict — that reconciliation is Phase 2/3's job,
 * not this one's).
 */

const ENTRY_FILE = 'src/main.tsx';
const MAX_PATH_LENGTH = 240;
const MAX_SEGMENT_LENGTH = 100;

function fileTypeOf(path: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(path);
  return match ? match[1] : 'unknown';
}

/** Same word-by-word, whole-word-boundary PascalCase strategy as generationPipeline.ts's toComponentName() — kept as an independent, smaller implementation here (no dependency between the two — see this file's header) since a shared component's name has no "Page" suffix requirement. */
function toPascalComponentName(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  const pascal = words.join('').slice(0, MAX_SEGMENT_LENGTH);

  return pascal.length > 0 ? pascal : 'SharedComponent';
}

function draft(input: {
  path: string;
  category: ManifestFileCategory;
  sourceKind: ApplicationManifestFileDraft['sourceKind'];
  generationOrder: number;
  componentName?: string;
  displayName?: string;
  dependencies?: string[];
  required?: boolean;
}): ApplicationManifestFileDraft {
  return {
    path: input.path,
    fileType: fileTypeOf(input.path),
    category: input.category,
    componentName: input.componentName,
    displayName: input.displayName ?? input.path,
    generationOrder: input.generationOrder,
    dependencies: input.dependencies ?? [],
    required: input.required ?? true,
    sourceKind: input.sourceKind,
  };
}

/**
 * Builds every planned file for the React + Vite + TypeScript template (the only
 * template this codebase generates today — see templateResolver.ts). Order mirrors the
 * pipeline's actual call order (types -> services -> pages -> shared components ->
 * deterministic scaffold, assembled last) purely so `generationOrder` reads naturally;
 * scaffold files needing no AI call doesn't make them optional — they're still part of
 * "the complete planned runnable application file set" the manifest exists to describe.
 */
function buildFileDrafts(plan: GenerationPlan): ApplicationManifestFileDraft[] {
  let order = 0;
  const files: ApplicationManifestFileDraft[] = [];

  const typesPath = 'src/types/index.ts';
  files.push(draft({ path: typesPath, category: 'types', sourceKind: 'ai_generated', generationOrder: order++ }));

  const servicesPath = 'src/services/api.ts';
  files.push(
    draft({
      path: servicesPath,
      category: 'services',
      sourceKind: 'ai_generated',
      generationOrder: order++,
      dependencies: [typesPath],
    }),
  );

  const pagePaths: string[] = [];

  for (const page of plan.pages) {
    const path = `src/pages/${page.fileName}`;
    pagePaths.push(path);
    files.push(
      draft({
        path,
        category: 'pages',
        sourceKind: 'ai_generated',
        generationOrder: order++,
        componentName: page.componentName,
        displayName: page.name,
        dependencies: [typesPath, servicesPath],
      }),
    );
  }

  const usedComponentNames = new Set<string>();

  for (const name of plan.sharedComponents) {
    let componentName = toPascalComponentName(name);
    let suffix = 2;

    while (usedComponentNames.has(componentName)) {
      componentName = `${toPascalComponentName(name)}${suffix}`;
      suffix += 1;
    }

    usedComponentNames.add(componentName);

    files.push(
      draft({
        path: `src/components/${componentName}.tsx`,
        category: 'components',
        sourceKind: 'ai_generated',
        generationOrder: order++,
        componentName,
        displayName: name,
      }),
    );
  }

  // Deterministic scaffold files — same set/order as projectScaffolder.ts's scaffoldReactViteProject().
  files.push(draft({ path: 'package.json', category: 'config', sourceKind: 'scaffold', generationOrder: order++ }));
  files.push(draft({ path: 'vite.config.ts', category: 'config', sourceKind: 'scaffold', generationOrder: order++ }));
  files.push(draft({ path: 'tsconfig.json', category: 'config', sourceKind: 'scaffold', generationOrder: order++ }));
  files.push(
    draft({ path: 'tsconfig.node.json', category: 'config', sourceKind: 'scaffold', generationOrder: order++ }),
  );
  files.push(draft({ path: 'index.html', category: 'config', sourceKind: 'scaffold', generationOrder: order++ }));
  files.push(
    draft({
      path: ENTRY_FILE,
      category: 'entry',
      sourceKind: 'scaffold',
      generationOrder: order++,
      componentName: 'main',
      dependencies: ['src/App.tsx'],
    }),
  );
  files.push(draft({ path: 'src/index.css', category: 'styles', sourceKind: 'scaffold', generationOrder: order++ }));
  files.push(
    draft({
      path: 'src/App.tsx',
      category: 'entry',
      sourceKind: 'scaffold',
      generationOrder: order++,
      componentName: 'App',
      dependencies: pagePaths,
    }),
  );
  files.push(draft({ path: 'README.md', category: 'documentation', sourceKind: 'scaffold', generationOrder: order++ }));

  return files;
}

/**
 * Rejects duplicate paths, unsafe/invalid paths, excessively long paths, and dependency
 * references to a path that isn't itself in the manifest. Never throws — collects every
 * issue and returns them alongside whichever files survived (duplicates: first occurrence
 * wins, the rest dropped; invalid paths: dropped outright), matching the codebase's
 * established "never block on validation, report it" convention (see
 * generationPipeline.ts's validateGeneratedFiles()).
 */
/**
 * Single-path safety check — empty/traversal/absolute/oversized — shared with
 * app/lib/generated-files/generatedFilesRepository.ts's unplanned-file reconciliation
 * (Phase 2, requirement G: "validate the path before persistence" for a file the AI
 * returned that wasn't itself in the manifest). Returns the trimmed path plus a reason
 * string when the path is rejected, `undefined` when it's safe.
 */
export function checkPathSafety(rawPath: string): { safe: true; path: string } | { safe: false; reason: string } {
  const path = rawPath.trim();

  if (path.length === 0) {
    return { safe: false, reason: 'Empty file path.' };
  }

  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    return { safe: false, reason: `Unsafe/traversal path: ${path}` };
  }

  if (path.length > MAX_PATH_LENGTH || path.split('/').some((segment) => segment.length > MAX_SEGMENT_LENGTH)) {
    return { safe: false, reason: `Excessively long path: ${path}` };
  }

  return { safe: true, path };
}

/** Exported for direct testing of the rejection rules (duplicate/invalid/oversized paths, dangling dependency references, missing mandatory entry files) independent of plan construction — see manifestBuilder.spec.ts. */
export function validateManifestFileDrafts(files: ApplicationManifestFileDraft[]): {
  files: ApplicationManifestFileDraft[];
  issues: ManifestValidationIssue[];
} {
  const issues: ManifestValidationIssue[] = [];
  const seenPaths = new Set<string>();
  const kept: ApplicationManifestFileDraft[] = [];

  for (const file of files) {
    const safety = checkPathSafety(file.path);

    if (!safety.safe) {
      issues.push({ severity: 'error', message: `${safety.reason} was dropped.`, path: file.path.trim() || undefined });
      continue;
    }

    const path = safety.path;

    if (seenPaths.has(path)) {
      issues.push({ severity: 'error', message: `Duplicate path was dropped: ${path}`, path });
      continue;
    }

    seenPaths.add(path);
    kept.push({ ...file, path });
  }

  for (const file of kept) {
    for (const dependency of file.dependencies) {
      if (!seenPaths.has(dependency)) {
        issues.push({
          severity: 'warning',
          message: `${file.path} depends on "${dependency}", which is not itself a planned file.`,
          path: file.path,
        });
      }
    }
  }

  const requiredEntryPaths = [ENTRY_FILE, 'src/App.tsx', 'package.json', 'index.html'];

  for (const requiredPath of requiredEntryPaths) {
    if (!seenPaths.has(requiredPath)) {
      issues.push({ severity: 'error', message: `Missing mandatory entry file: ${requiredPath}` });
    }
  }

  return { files: kept, issues };
}

/**
 * FNV-1a (32-bit) over a stable, sorted-by-path JSON representation of the manifest's
 * structural shape — path/category/sourceKind/required/generationOrder/dependencies,
 * deliberately NOT file content (nothing has been generated yet at manifest-build time).
 * Two builds of the same plan always produce the same checksum, which is exactly what
 * applicationManifestRepository.ts uses to skip creating a duplicate version for an
 * unchanged plan. A plain hash (not a cryptographic one) is enough here — this is a
 * change-detection fingerprint, not a security boundary — and avoids pulling in Node's
 * `crypto` module, which isn't available the same way in every runtime this code runs in
 * (browser + Cloudflare Worker + Node test runner).
 */
export function computeManifestChecksum(files: ApplicationManifestFileDraft[]): string {
  const canonical = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      path: file.path,
      category: file.category,
      sourceKind: file.sourceKind,
      required: file.required,
      generationOrder: file.generationOrder,
      dependencies: [...file.dependencies].sort(),
    }));

  const text = JSON.stringify(canonical);

  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface BuildManifestInput {
  projectId: string;
  plan: GenerationPlan;
  sourcePackageAssembledAt?: string;
}

/** Pure, synchronous, never throws — persistence is a separate step (applicationManifestRepository.ts). */
export function buildApplicationManifest(input: BuildManifestInput): BuildManifestResult {
  const rawFiles = buildFileDrafts(input.plan);
  const { files, issues } = validateManifestFileDrafts(rawFiles);
  const hasBlockingIssue = issues.some((issue) => issue.severity === 'error');

  if (hasBlockingIssue || files.length === 0) {
    return { ok: false, files, issues };
  }

  return {
    ok: true,
    files,
    issues,
    manifest: {
      projectId: input.projectId,
      framework: REACT_VITE_TS_TEMPLATE_ID,
      packageManager: 'npm',
      entryFile: ENTRY_FILE,
      sourcePackageAssembledAt: input.sourcePackageAssembledAt,
      planChecksum: computeManifestChecksum(files),
    },
  };
}
