import { getProjectById, updateProject } from '~/lib/builders-db/repositories/buildersDbRepository';
import type { Project } from '~/lib/stores/projects';
import { packageEngine } from './packageProfileRegistry';
import type { PackageProfile } from './packageProfileTypes';
import type { PackageResolutionResult, PackageSelection } from './packageResolutionTypes';

/**
 * Package Resolution Service (Sprint 73, Package Intelligence Foundation).
 *
 * Answers "what is this project's effective Package Profile, and why?" — the Package
 * Intelligence sibling of `regionalResolutionService.ts`, deliberately built without an
 * append-only-history table for the same reason Regional Resolution has none: the only real
 * signal today is an explicit manual choice, so a single field on `Project`
 * (`packageSelection`, folded into `builders_projects.metadata` — see buildersDbTypes.ts's
 * `METADATA_FIELDS`) is sufficient and avoids an unjustified migration, per PART 6 of the
 * Sprint 73 brief.
 *
 * Never infers a package from company size, budget, Blueprint, Region, feature count, model
 * guesswork, or a package name found in free-text requirements (PART 4) — manual selection is
 * the only reachable source today (see `packageResolutionTypes.ts`'s `PackageSelectionSource`
 * for exactly which sources are reachable vs. reserved for a future sprint).
 */

function hasSubstantiveContent(profile: PackageProfile): boolean {
  return (
    (profile.architectureGuidance?.length ?? 0) > 0 ||
    (profile.securityGuidance?.length ?? 0) > 0 ||
    (profile.testingGuidance?.length ?? 0) > 0 ||
    profile.qualityFloor.length > 0
  );
}

function unresolvedResult(reason: string): PackageResolutionResult {
  return {
    packageProfileId: null,
    packageProfileCode: null,
    packageProfileVersion: null,
    selectionSource: 'none',
    sourceValue: null,
    unresolvedReason: reason,
    resolvedAt: new Date().toISOString(),
    contentAvailable: false,
  };
}

/**
 * Pure resolution given an already-loaded `Project` — no I/O. Exported separately from
 * `getEffectivePackageSelection` (which does the I/O) so callers that already have a `Project`
 * in hand (e.g. a client-side store) never need a redundant fetch, and so this logic is trivially
 * unit-testable without mocking BuildersDB.
 *
 * Manual selection always wins — it is, today, the ONLY source this function reads. If
 * `project.packageSelection` names a code with no matching profile (a deprecated/removed
 * package, or stale data), resolution safely falls back to unresolved rather than throwing or
 * guessing a substitute.
 */
export function resolveEffectivePackageSelection(project: Pick<Project, 'packageSelection'>): PackageResolutionResult {
  const selection = project.packageSelection;

  if (!selection) {
    return unresolvedResult('No manual package selection has been made for this project.');
  }

  const profile = packageEngine.getPackageProfile(selection.packageCode);

  if (!profile) {
    return unresolvedResult(
      `The project's selected package code "${selection.packageCode}" does not match any supported Package Profile.`,
    );
  }

  return {
    packageProfileId: profile.id,
    packageProfileCode: profile.code,
    packageProfileVersion: profile.version,
    selectionSource: 'manual_override',
    sourceValue: selection.packageCode,
    resolvedAt: new Date().toISOString(),
    contentAvailable: hasSubstantiveContent(profile),
  };
}

/**
 * The async, I/O-performing entry point — what `buildersDbContextProvider.ts` calls. Fetches the
 * project via the existing `getProjectById` repository function and delegates to the pure
 * function above. Never throws: a missing project or an unavailable BuildersDB connection both
 * resolve to the safe "unresolved" result.
 */
export async function getEffectivePackageSelection(projectId: string): Promise<PackageResolutionResult> {
  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return unresolvedResult('Project could not be loaded to resolve a Package Profile.');
    }

    return resolveEffectivePackageSelection(project);
  } catch (error) {
    console.error(
      '[Package Resolution] getEffectivePackageSelection failed, continuing without package context:',
      error,
    );
    return unresolvedResult('Package Profile resolution failed unexpectedly.');
  }
}

/**
 * Sets (or replaces) the project's manual Package Profile selection. Manual selection always
 * wins over any future automatic source. Returns `false` (never throws) if the project can't be
 * loaded/updated, or if `packageCode` doesn't match a known profile (never persists a selection
 * that can't resolve).
 */
export async function setManualPackageSelection(projectId: string, packageCode: string): Promise<boolean> {
  if (!packageEngine.getPackageProfile(packageCode)) {
    console.error(`[Package Resolution] setManualPackageSelection: unknown package code "${packageCode}"`);
    return false;
  }

  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return false;
    }

    const selection: PackageSelection = {
      packageCode: packageCode as PackageSelection['packageCode'],
      selectedAt: new Date().toISOString(),
    };

    return await updateProject({ ...project, packageSelection: selection });
  } catch (error) {
    console.error('[Package Resolution] setManualPackageSelection failed:', error);
    return false;
  }
}

/**
 * Clears a project's manual Package Profile selection, returning it to "no package resolved" —
 * today that means simply unresolved, since no automatic source is reachable yet. Never throws.
 */
export async function clearManualPackageSelection(projectId: string): Promise<boolean> {
  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return false;
    }

    const { packageSelection: _removed, ...rest } = project;

    return await updateProject(rest as Project);
  } catch (error) {
    console.error('[Package Resolution] clearManualPackageSelection failed:', error);
    return false;
  }
}

export const packageResolutionService = {
  resolveEffectivePackageSelection,
  getEffectivePackageSelection,
  setManualPackageSelection,
  clearManualPackageSelection,
};
