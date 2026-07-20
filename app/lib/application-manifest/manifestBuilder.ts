import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import { REACT_VITE_TS_TEMPLATE_ID } from '~/lib/code-generation/templateResolver';
import { fnv1aHash } from '~/lib/checksum/fnv1a';
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
  featureIds?: string[];
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
    featureIds: input.featureIds ?? [],
  };
}

/**
 * Sprint 49, Part 4 — the one real structural guard this sprint adds: given a candidate
 * list of Feature IDs a file/entity claims to implement, returns only the ones that are
 * actually members of the active MVP's `inScopeFeatureIds` (see
 * `GenerationPlanScope`, codeGenerationTypes.ts). Anything else — a typo'd ID, an ID the
 * AI invented, or a real Feature ID that belongs to a DIFFERENT MVP (past or future) —
 * is rejected, never persisted. `validFeatureIds` is always the CURRENT active MVP's own
 * `inScopeFeatureIds`; there is no cross-MVP feature registry to check "future MVP" IDs
 * against directly, but rejecting everything not in the current MVP's own list has the
 * identical effect, since a future MVP's features are never members of the current MVP's
 * `inScopeFeatureIds` by construction (see docs/05-AI-Product-Owner/
 * 12-sprint-49-traceability-and-ownership.md for why a separate "is this a real Feature ID
 * from ANY MVP" check would need a cross-MVP registry this codebase doesn't have and
 * Sprint 49 does not add).
 *
 * Legacy/no-scope callers (an empty `validFeatureIds`, meaning no active MVP at all) reject
 * every candidate — Part 13's "legacy projects... remain supported" is satisfied by never
 * calling this with a non-empty candidate list for a legacy project in the first place
 * (see `buildFileDrafts` below), not by this function special-casing emptiness.
 */
export function validateFeatureIds(
  candidateIds: string[],
  validFeatureIds: string[],
): { valid: string[]; rejected: string[] } {
  const validSet = new Set(validFeatureIds);
  const valid: string[] = [];
  const rejected: string[] = [];

  for (const id of candidateIds) {
    if (validSet.has(id)) {
      valid.push(id);
    } else {
      rejected.push(id);
    }
  }

  return { valid, rejected };
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

  /*
   * Sprint 49, Part 2 — every AI-generated file gets the WHOLE active MVP's in-scope
   * Feature IDs (coarse, MVP-wide — see `ApplicationManifestFileDraft.featureIds`'s own
   * comment on why per-page precision isn't fabricated here). Already trusted, real IDs
   * (sourced from `EngineeringHandoff.features[].id` via `resolveMvpScope` in
   * useCodeGeneration.ts) — `validateFeatureIds` is the defensive check applied once, at
   * the whole-manifest level, in `buildApplicationManifest` below, not re-run per file
   * here. Empty for a legacy/no-MVP plan (`plan.scope.inScopeFeatureIds` is `[]` in that
   * case — see `GenerationPlanScope`'s own comment), so a legacy project's files simply
   * never carry Feature IDs, satisfying Part 13.
   */
  const scopedFeatureIds = plan.scope.inScopeFeatureIds;

  const typesPath = 'src/types/index.ts';
  files.push(
    draft({
      path: typesPath,
      category: 'types',
      sourceKind: 'ai_generated',
      generationOrder: order++,
      featureIds: scopedFeatureIds,
    }),
  );

  const servicesPath = 'src/services/api.ts';
  files.push(
    draft({
      path: servicesPath,
      category: 'services',
      sourceKind: 'ai_generated',
      generationOrder: order++,
      dependencies: [typesPath],
      featureIds: scopedFeatureIds,
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
        featureIds: scopedFeatureIds,
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
        featureIds: scopedFeatureIds,
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

/**
 * Exported for direct testing of the rejection rules (duplicate/invalid/oversized paths,
 * dangling dependency references, missing mandatory entry files) independent of plan
 * construction — see manifestBuilder.spec.ts.
 *
 * Sprint 49, Part 4 — `validFeatureIds` (the active MVP's own `inScopeFeatureIds`, or
 * `undefined`/empty for a legacy project) is the structural enforcement point: every
 * file's `featureIds` is filtered through `validateFeatureIds` here, BEFORE persistence,
 * not merely at tagging time in `buildFileDrafts` — so this catches an out-of-scope ID
 * regardless of how it got onto a file draft (today, only `buildFileDrafts` itself; in
 * the future, potentially a reconciled unplanned file or a hand-edited state). Rejected
 * IDs are stripped (never persisted) and reported as a warning, never a blocking error —
 * matching this function's own established "never block on validation, report it"
 * convention for every other check it already performs.
 */
export function validateManifestFileDrafts(
  files: ApplicationManifestFileDraft[],
  validFeatureIds: string[] = [],
): {
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

    const { valid: validatedFeatureIds, rejected: rejectedFeatureIds } = validateFeatureIds(
      file.featureIds,
      validFeatureIds,
    );

    if (rejectedFeatureIds.length > 0) {
      issues.push({
        severity: 'warning',
        message: `${path}: out-of-scope Feature ID(s) rejected before persistence: ${rejectedFeatureIds.join(', ')}`,
        path,
      });
    }

    seenPaths.add(path);
    kept.push({ ...file, path, featureIds: validatedFeatureIds });
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

  return fnv1aHash(JSON.stringify(canonical));
}

export interface BuildManifestInput {
  projectId: string;
  plan: GenerationPlan;
  sourcePackageAssembledAt?: string;

  /** Sprint 47 — see ApplicationManifestDraft.mvpId's comment (manifestTypes.ts). Threaded straight through to the built manifest, nothing here resolves or validates it. */
  mvpId?: string;

  /** Sprint 48 — see ApplicationManifestDraft.mvpCode/featureScope's comments (manifestTypes.ts). Threaded straight through, unvalidated — this module stays pure/deterministic. */
  mvpCode?: string;
  featureScope?: { inScopeFeatureIds: string[]; outOfScopeFeatureDescriptions: string[] };
}

/** Pure, synchronous, never throws — persistence is a separate step (applicationManifestRepository.ts). */
export function buildApplicationManifest(input: BuildManifestInput): BuildManifestResult {
  const rawFiles = buildFileDrafts(input.plan);
  const { files, issues } = validateManifestFileDrafts(rawFiles, input.plan.scope.inScopeFeatureIds);
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
      mvpId: input.mvpId,
      mvpCode: input.mvpCode,
      featureScope: input.featureScope,
      framework: REACT_VITE_TS_TEMPLATE_ID,
      packageManager: 'npm',
      entryFile: ENTRY_FILE,
      sourcePackageAssembledAt: input.sourcePackageAssembledAt,
      planChecksum: computeManifestChecksum(files),
      fingerprints: input.plan.fingerprints,
      sourceContentChecksum: fnv1aHash(JSON.stringify(input.plan.fingerprints)),
    },
  };
}
