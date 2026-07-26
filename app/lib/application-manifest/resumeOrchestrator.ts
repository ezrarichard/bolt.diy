import type { GenerationPlan } from '~/lib/code-generation/codeGenerationTypes';
import { REACT_VITE_TS_TEMPLATE_ID, resolveTemplate } from '~/lib/code-generation/templateResolver';
import { carryForwardFile, isReusableGeneratedStatus } from '~/lib/generated-files/generatedFilesRepository';
import { mvpRepository } from '~/lib/mvp/mvpRepository';
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
 *
 * Sprint 78 Phase 0 — `resolveFileCarryForwardPlan` layers a per-file refinement on top of that
 * category-level check, using each file's existing `featureIds` (Sprint 49) as its module/Feature
 * ownership signal: a file whose owning Feature set is unchanged carries forward even when its
 * category's aggregate fingerprint changed elsewhere (e.g. a sibling module's pages were added),
 * so an unrelated module is never invalidated just because it shares a `ManifestFileCategory`
 * with a module that actually changed. See that function's own comment for the exact rule.
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
    case 'backend':
      /*
       * Sprint 79 Phase 1 — no aggregate `GenerationPlanFingerprints` field tracks backend
       * content (see `ManifestFileCategory`'s own comment on `'backend'`), so there is no
       * category-level signal to check here at all. Conservative default: NOT reusable at this
       * level. In practice every backend file always carries `featureIds`, so
       * `resolveFileCarryForwardPlan` below intercepts first and makes the real (correct,
       * per-file) decision — this branch only matters as the fallback for a hypothetical
       * backend file with no Feature ownership, where "regenerate rather than silently trust
       * stale content with nothing to invalidate it" is the safe default.
       */
      return { reusable: false, downgradeToGenerated: false };
    default:
      // Scaffold (entry/config/styles/documentation) — deterministic template code, never content-invalidated.
      return { reusable: true, downgradeToGenerated: false };
  }
}

/**
 * Sprint 78 Phase 0 — module/feature-granular carry-forward, addressing the corrective review's
 * requirement that carry-forward be evaluated at "module/file ownership granularity rather than
 * invalidating every file in an aggregate category."
 *
 * `resolveCarryForwardPlan` above answers "did THIS CATEGORY change" from one fingerprint shared
 * by every file in it — correct for scaffold/legacy files, but too coarse once a category (e.g.
 * `pages`) contains files owned by more than one Feature/Module: today's single `pages`
 * fingerprint (`GenerationPlanFingerprints`, deliberately one hash over ALL pages content, see
 * `manifestTypes.ts`) changing because a NEW module's pages were added would otherwise invalidate
 * an UNRELATED, unchanged module's pages too.
 *
 * This function adds a finer-grained check that takes precedence when it can: `featureIds`
 * already exists on every `ApplicationManifestFile`/`Draft` (Sprint 49) — the exact "which
 * Feature(s) does this file belong to" ownership data the review asked to reuse rather than
 * inventing a parallel model. If a file's owning Feature set is IDENTICAL between the previous
 * and the newly-built manifest, that file's own ownership is unaffected by whatever else changed
 * in its category, so it is carried forward regardless of the category-level fingerprint —
 * exactly "Appointments carried forward, Billing marked for generation" when both share the
 * `pages` category. If the set changed (a Feature was added to — or removed from — this exact
 * file's ownership, e.g. an existing module gaining a new Feature), the file is NOT reusable —
 * conservative, since content for the new ownership doesn't exist yet.
 *
 * Falls back to the existing category-level `resolveCarryForwardPlan` for any file with no
 * Feature ownership at all (every scaffold file, and every file in a legacy/no-MVP project) —
 * there is no finer-grained ownership signal to prefer for those, so behavior for them is
 * completely unchanged.
 */
export function resolveFileCarryForwardPlan(
  previous: Pick<ApplicationManifestFile, 'featureIds'>,
  next: Pick<ApplicationManifestFile, 'category' | 'featureIds'>,
  invalidation: CategoryInvalidation,
): { reusable: boolean; downgradeToGenerated: boolean } {
  const previousFeatureIds = previous.featureIds ?? [];
  const nextFeatureIds = next.featureIds ?? [];

  if (nextFeatureIds.length === 0 && previousFeatureIds.length === 0) {
    return resolveCarryForwardPlan(next.category, invalidation);
  }

  const previousOwners = new Set(previousFeatureIds);
  const nextOwners = new Set(nextFeatureIds);
  const ownershipUnchanged =
    previousOwners.size === nextOwners.size && [...previousOwners].every((id) => nextOwners.has(id));

  if (ownershipUnchanged) {
    return { reusable: true, downgradeToGenerated: false };
  }

  return { reusable: false, downgradeToGenerated: false };
}

export interface PrepareManifestResult {
  ok: boolean;
  manifest?: ApplicationManifest;
  files?: ApplicationManifestFile[];
  resumed: boolean;
  versionCreated: boolean;
  carriedForwardCount: number;
  error?: string;

  /** Sprint 48 — true when the manifest this run diffed against (whatever was previously "active" for the project) belonged to a DIFFERENT MVP than this run's own `mvpId` — i.e. this is genuinely MVP N+1 extending MVP N's manifest, not a same-MVP resume/replan. False for a same-MVP replan, a first-ever manifest, or a legacy project with no MVP at all. */
  crossMvpTransition: boolean;

  /** Sprint 48 — the previous manifest's `mvpId`, when one existed and differed from this run's — see `crossMvpTransition`. Undefined whenever that flag is false. */
  previousMvpId?: string;

  /** Sprint 49, Part 4/11 — any Feature ID `manifestBuilder.ts`'s `validateFeatureIds` stripped from a file draft before persistence (an out-of-scope or unrecognized ID), deduplicated. Empty when nothing was rejected — including every legacy/no-MVP run, which never has candidate Feature IDs to reject in the first place. */
  rejectedFeatureIds: string[];
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
 *
 * Sprint 48 additions (see docs/05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md):
 *
 *  - Step 0 (Part 7, out-of-scope protection): when `input.mvpId` is supplied, it is
 *    RE-RESOLVED against `mvpRepository.resolveActiveMvpId` at the moment of persistence,
 *    not merely trusted from whenever planning started. Planning and persistence are
 *    separated by an AI generation run that can take tens of seconds to minutes — if the
 *    active MVP changed underneath this run (superseded, a different MVP advanced past
 *    Gate A), persisting a manifest under the now-stale `mvpId` would silently generate
 *    files "for" an MVP that is no longer the one actually in play. This is a genuine
 *    code-level block (`{ ok: false, error }`), not a prompt instruction — it cannot by
 *    itself detect an out-of-scope FEATURE within an otherwise-valid MVP (see
 *    `GenerationPlanScope`'s own comment on why that remains prompt-level, same
 *    limitation Sprint 47 documented for the engineering roles).
 *  - Step 4 continued (Parts 5/8, cross-MVP diff + traceability): `previousManifest` was
 *    already being fetched as "whatever manifest is currently active for this project" —
 *    which, once MVP 2 starts generating, IS MVP 1's manifest (manifests are project-
 *    scoped with an `mvp_id` tag, not re-parented — see docs/02-Architecture/
 *    06-mvp-as-core-object.md). The carry-forward mechanism itself is unchanged; what's
 *    new is `crossMvpTransition`/`previousMvpId` on the result, so the caller can log
 *    "extending MVP N's manifest" distinctly from "replanning within the same MVP."
 */
export async function prepareManifestForGeneration(input: {
  projectId: string;
  plan: GenerationPlan;
  sourcePackageAssembledAt?: string;
  createdBy?: string;
  forceRestart?: boolean;

  /** Sprint 47 — see ApplicationManifestDraft.mvpId's comment (manifestTypes.ts). */
  mvpId?: string;

  /** Sprint 48 — see ApplicationManifestDraft.mvpCode/featureScope's comments (manifestTypes.ts). */
  mvpCode?: string;
  featureScope?: { inScopeFeatureIds: string[]; outOfScopeFeatureDescriptions: string[] };
}): Promise<PrepareManifestResult> {
  if (input.mvpId) {
    const currentlyActiveMvpId = await mvpRepository.resolveActiveMvpId(input.projectId);

    if (currentlyActiveMvpId !== input.mvpId) {
      return {
        ok: false,
        resumed: false,
        versionCreated: false,
        carriedForwardCount: 0,
        crossMvpTransition: false,
        rejectedFeatureIds: [],
        error:
          'The MVP this generation was planned for is no longer the active MVP for this project ' +
          '(it may have been superseded, or a different MVP has since passed Gate A) — refusing to ' +
          'persist a manifest for a stale MVP scope. Re-open the project to replan against the current MVP.',
      };
    }
  }

  /*
   * Sprint 86, Part 5 — seeded with the template's own baseline dependencies at this
   * plan-ready point (before any AI call has run, so the FINAL resolved dependency set —
   * see `dependencyValidation.ts` — isn't known yet). This is the manifest's best
   * available answer at persistence time, not a promise that no additional package will be
   * added once generation actually completes; a future sprint building GitHub/Vercel
   * automation on top of this should treat it as "at least these," not "exactly these."
   * `needsSupabaseEnv` uses the same `plan.backendModules` signal
   * `generationPipeline.ts`'s own `needsSupabaseEnv` computation checks first — the
   * Database Activation half of that computation isn't available here (this function only
   * receives `plan`, not the full `Project`), a known, documented gap rather than an
   * oversight.
   */
  const needsSupabaseEnv = Boolean(input.plan.backendModules && input.plan.backendModules.length > 0);

  const built = buildApplicationManifest({
    projectId: input.projectId,
    plan: input.plan,
    sourcePackageAssembledAt: input.sourcePackageAssembledAt,
    mvpId: input.mvpId,
    mvpCode: input.mvpCode,
    featureScope: input.featureScope,
    dependencies: resolveTemplate(REACT_VITE_TS_TEMPLATE_ID).dependencies,
    needsSupabaseEnv,
  });

  /*
   * Sprint 49, Part 4/11 — `validateFeatureIds` (inside `validateManifestFileDrafts`,
   * called by `buildApplicationManifest`) stripped these before persistence; parsed back
   * out of the warning issues' own message text rather than a dedicated result field on
   * `BuildManifestResult`, since this is the only caller that needs them structured and
   * `manifestBuilder.ts` otherwise has no reason to grow a second return shape for one
   * consumer (see manifestBuilder.ts's `validateManifestFileDrafts` for the exact message
   * format this parses).
   */
  const rejectedFeatureIds = Array.from(
    new Set(
      built.issues
        .map((issue) => /out-of-scope Feature ID\(s\) rejected before persistence: (.+)$/.exec(issue.message)?.[1])
        .filter((match): match is string => Boolean(match))
        .flatMap((match) => match.split(',').map((id) => id.trim())),
    ),
  );

  if (!built.ok || !built.manifest) {
    const message = built.issues.find((issue) => issue.severity === 'error')?.message ?? 'Manifest build failed.';
    return {
      ok: false,
      resumed: false,
      versionCreated: false,
      carriedForwardCount: 0,
      crossMvpTransition: false,
      rejectedFeatureIds,
      error: message,
    };
  }

  const previousManifest = await getActiveApplicationManifest(input.projectId);
  const previousFiles = previousManifest ? await listApplicationManifestFiles(previousManifest.id) : [];
  const crossMvpTransition = Boolean(previousManifest?.mvpId && input.mvpId && previousManifest.mvpId !== input.mvpId);
  const previousMvpId = crossMvpTransition ? previousManifest?.mvpId : undefined;

  const result = await saveApplicationManifest(built.manifest, built.files, {
    createdBy: input.createdBy,
    forceNewVersion: input.forceRestart,
  });

  if (!result.ok || !result.manifest || !result.files) {
    return {
      ok: false,
      resumed: false,
      versionCreated: false,
      carriedForwardCount: 0,
      crossMvpTransition: false,
      rejectedFeatureIds,
      error: result.error,
    };
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
      crossMvpTransition: false,
      rejectedFeatureIds,
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
      crossMvpTransition,
      rejectedFeatureIds,
      previousMvpId,
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

    const { reusable, downgradeToGenerated } = resolveFileCarryForwardPlan(previous, newFile, invalidation);

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
    crossMvpTransition,
    previousMvpId,
    rejectedFeatureIds,
  };
}

export { isReusableGeneratedStatus };
