import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import { carryForwardFile, isReusableGeneratedStatus } from '~/lib/generated-files/generatedFilesRepository';
import { buildApplicationManifest } from './manifestBuilder';
import {
  getActiveApplicationManifest,
  listApplicationManifestFiles,
  saveApplicationManifest,
} from './applicationManifestRepository';
import type {
  ApplicationManifest,
  ApplicationManifestFile,
  ManifestFingerprints,
  ManifestFileStatus,
} from './manifestTypes';

/**
 * Resumable Application Generation — Sprint 44.2, Phase 3.
 *
 * Reuses every table/repository from Phase 1 (builders_application_manifests/_files)
 * and Phase 2 (builders_generated_application_files/_versions) unchanged — this module
 * is pure orchestration logic on top of them, no new persistence primitives beyond the
 * two `manifestBuilder.ts`/`generatedFilesRepository.ts` additions this phase makes.
 *
 * Deliberately does NOT implement a full dependency graph engine (the plan's own
 * instruction) — invalidation is four coarse, deterministic category fingerprints
 * (types/services/pages/components, see codeGenerationTypes.ts's
 * `GenerationPlanFingerprints`), not a per-file/per-import graph. See this file's
 * `determineCategoryInvalidation` and its own comment for exactly what "conservative"
 * means here and why.
 */

/**
 * Resume Rules (spec's own table) mapped onto this codebase's actual capabilities:
 *  - complete/validated → 'skip' (content is trusted, no AI call).
 *  - generated → 'skip' too — Phase 2 already marks a freshly-generated file
 *    'generated' before it's been through a validation pass; treating it as reusable
 *    (not re-calling the AI) is what makes an interrupted-after-generation-but-before-
 *    validation run resumable at all.
 *  - failed/pending → 'generate' (retry / first attempt).
 *  - generating → 'generate' ("treat as interrupted, retry safely" — a run that died
 *    mid-call left no completed content behind for this file, so there's nothing to
 *    reuse regardless of how far the AI call had gotten).
 *  - repairing → 'generate' as well: the spec's own "resume repair" implies a per-file
 *    repair loop that does not exist in this codebase — repair (repairEngine.ts) runs
 *    once over the WHOLE assembled project, not per manifest file. Treating an
 *    interrupted 'repairing' file as needing regeneration is the conservative, honest
 *    choice until Phase 5 makes repair itself file-granular (see this sprint's Known
 *    Limitations) — never silently trusting content that was mid-repair when the run
 *    died.
 *  - superseded → 'ignore' (belongs to a manifest version that's no longer active).
 */
export type ResumeAction = 'skip' | 'generate' | 'ignore';

export function classifyResumeAction(status: ManifestFileStatus): ResumeAction {
  switch (status) {
    case 'complete':
    case 'validated':
    case 'generated':
      return 'skip';
    case 'superseded':
      return 'ignore';
    case 'pending':
    case 'failed':
    case 'generating':
    case 'repairing':
    case 'skipped':
    default:
      return 'generate';
  }
}

export interface CategoryInvalidation {
  types: boolean;
  services: boolean;
  pages: boolean;
  components: boolean;
}

/** True per category whose OWN fingerprint changed between the previous and current plan. */
export function determineCategoryInvalidation(
  previous: ManifestFingerprints,
  current: GenerationPlan['fingerprints'],
): CategoryInvalidation {
  return {
    types: previous.types !== current.types,
    services: previous.services !== current.services,
    pages: previous.pages !== current.pages,
    components: previous.components !== current.components,
  };
}

/**
 * Whether a file of this category, given which categories were invalidated, is (a) not
 * reusable at all — must regenerate — or (b) reusable but should be downgraded to
 * `'generated'` so it's revalidated rather than trusted outright (the spec's own "types
 * changes → dependent pages become validated → pending validation, NOT regenerated
 * immediately" example). Mirrors the dependency edges manifestBuilder.ts's
 * `buildFileDrafts` already declares: pages/services depend on types, pages also depend
 * on services; components and scaffold (entry/config/styles/documentation) files have no
 * cross-category dependency in this deterministic model.
 */
export function resolveCarryForwardPlan(
  category: ApplicationManifestFile['category'],
  invalidation: CategoryInvalidation,
): { reusable: boolean; downgradeToGenerated: boolean } {
  switch (category) {
    case 'types':
      return invalidation.types
        ? { reusable: false, downgradeToGenerated: false }
        : { reusable: true, downgradeToGenerated: false };
    case 'services':
      if (invalidation.services) {
        return { reusable: false, downgradeToGenerated: false };
      }

      return { reusable: true, downgradeToGenerated: invalidation.types };
    case 'pages':
      if (invalidation.pages) {
        return { reusable: false, downgradeToGenerated: false };
      }

      return { reusable: true, downgradeToGenerated: invalidation.types || invalidation.services };
    case 'components':
      return invalidation.components
        ? { reusable: false, downgradeToGenerated: false }
        : { reusable: true, downgradeToGenerated: false };
    default:
      // Scaffold (entry/config/styles/documentation) — deterministic template code, never content-invalidated.
      return { reusable: true, downgradeToGenerated: false };
  }
}

export interface PrepareManifestResult {
  ok: boolean;
  manifest?: ApplicationManifest;
  files?: ApplicationManifestFile[];
  resumed: boolean;
  versionCreated: boolean;
  carriedForwardCount: number;
  error?: string;
}

/**
 * The Phase 3 entry point — replaces Phase 1/2's plain `buildApplicationManifest` +
 * `saveApplicationManifest` call with a resume-aware version:
 *
 *  1. Builds the current plan's manifest (same as Phase 1 — deterministic, no AI call).
 *  2. Reads whatever manifest is CURRENTLY active for this project (if any), before
 *     saving anything, so its fingerprints/files are available for comparison.
 *  3. Persists via `saveApplicationManifest` (Phase 1/2, now checksum-aware — see that
 *     function's own comment) — `forceRestart` skips the checksum comparison entirely
 *     ("Restart Generation" always creates a new version).
 *  4. If a NEW version was created (checksum changed, or forced) and a previous version
 *     existed, carries forward every unaffected file's content (see
 *     `resolveCarryForwardPlan`) — `forceRestart` explicitly skips carry-forward too
 *     (a deliberate full redo starts every file at `pending`, matching "Restart" being a
 *     distinct user action from the automatic content-change version bump).
 */
export async function prepareManifestForGeneration(input: {
  projectId: string;
  plan: GenerationPlan;
  sourcePackageAssembledAt?: string;
  createdBy?: string;
  forceRestart?: boolean;
}): Promise<PrepareManifestResult> {
  const built = buildApplicationManifest({
    projectId: input.projectId,
    plan: input.plan,
    sourcePackageAssembledAt: input.sourcePackageAssembledAt,
  });

  if (!built.ok || !built.manifest) {
    const message = built.issues.find((issue) => issue.severity === 'error')?.message ?? 'Manifest build failed.';
    return { ok: false, resumed: false, versionCreated: false, carriedForwardCount: 0, error: message };
  }

  const previousManifest = await getActiveApplicationManifest(input.projectId);
  const previousFiles = previousManifest ? await listApplicationManifestFiles(previousManifest.id) : [];

  const result = await saveApplicationManifest(built.manifest, built.files, {
    createdBy: input.createdBy,
    forceNewVersion: input.forceRestart,
  });

  if (!result.ok || !result.manifest || !result.files) {
    return { ok: false, resumed: false, versionCreated: false, carriedForwardCount: 0, error: result.error };
  }

  if (!result.created) {
    // Unchanged plan/content — plain resume against the SAME manifest, nothing to carry forward.
    return {
      ok: true,
      manifest: result.manifest,
      files: result.files,
      resumed: true,
      versionCreated: false,
      carriedForwardCount: 0,
    };
  }

  if (!previousManifest || previousFiles.length === 0 || input.forceRestart) {
    return {
      ok: true,
      manifest: result.manifest,
      files: result.files,
      resumed: false,
      versionCreated: true,
      carriedForwardCount: 0,
    };
  }

  const invalidation = determineCategoryInvalidation(previousManifest.fingerprints, input.plan.fingerprints);
  const previousByPath = new Map(previousFiles.map((file) => [file.path, file]));
  let carriedForwardCount = 0;

  for (const newFile of result.files) {
    const previous = previousByPath.get(newFile.path);

    if (!previous) {
      continue; // A genuinely new path — nothing to carry forward, stays 'pending'.
    }

    const { reusable, downgradeToGenerated } = resolveCarryForwardPlan(newFile.category, invalidation);

    if (!reusable) {
      continue;
    }

    const carried = await carryForwardFile({
      projectId: input.projectId,
      newManifestId: result.manifest.id,
      newManifestFileId: newFile.id,
      path: newFile.path,
      sourceManifestFileId: previous.id,
      downgradeToGenerated,
    });

    if (carried.ok && carried.carried) {
      carriedForwardCount += 1;
    }
  }

  const refreshedFiles = await listApplicationManifestFiles(result.manifest.id);

  return {
    ok: true,
    manifest: result.manifest,
    files: refreshedFiles,
    resumed: false,
    versionCreated: true,
    carriedForwardCount,
  };
}

export { isReusableGeneratedStatus };
