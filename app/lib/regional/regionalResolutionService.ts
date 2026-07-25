import { getProjectById, updateProject } from '~/lib/builders-db/repositories/buildersDbRepository';
import type { Project } from '~/lib/stores/projects';
import { regionalEngine } from './regionalProfileRegistry';
import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult, RegionalSelection } from './regionalResolutionTypes';

/**
 * Regional Resolution Service (Sprint 71, Regional Intelligence Foundation).
 *
 * Answers "what is this project's effective Regional Profile, and why?" — the Regional
 * Intelligence sibling of `blueprintResolutionService.ts`, deliberately built without that
 * service's append-only-history table. Blueprint Resolution needs a table because it records a
 * *scoring engine's* output (candidates + confidence + explanation) that changes as Business
 * Understanding evolves — a genuinely per-run computation worth an audit trail. Regional
 * resolution in this foundation sprint has no scoring engine at all: the only real signal is an
 * explicit manual choice, so a single field on `Project` (`regionalSelection`, folded into
 * `builders_projects.metadata` — see buildersDbTypes.ts's `METADATA_FIELDS`) is sufficient and
 * avoids an unjustified migration, per PART 6 of the Sprint 71 brief.
 *
 * Never infers a region from IP, browser locale, device location, currency, timezone, Blueprint
 * industry, or model guesswork — manual selection is the only reachable source today (see
 * `regionalResolutionTypes.ts`'s `RegionalSelectionSource` for exactly which sources are
 * reachable vs. reserved for a future sprint). This function reads NOTHING about where a
 * request came from — only what a human explicitly chose for this project.
 */

function hasSubstantiveContent(profile: RegionalProfile): boolean {
  return (
    profile.taxGuidance.length > 0 ||
    profile.privacyGuidance.length > 0 ||
    profile.accessibilityGuidance.length > 0 ||
    profile.complianceNotes.length > 0
  );
}

function unresolvedResult(reason: string): RegionalResolutionResult {
  return {
    regionalProfileId: null,
    regionalProfileCode: null,
    regionalProfileVersion: null,
    selectionSource: 'none',
    sourceValue: null,
    matchedCountry: null,
    unresolvedReason: reason,
    resolvedAt: new Date().toISOString(),
    contentAvailable: false,
  };
}

/**
 * Pure resolution given an already-loaded `Project` — no I/O. Exported separately from
 * `getEffectiveRegionalSelection` (which does the I/O) so callers that already have a `Project`
 * in hand (e.g. a client-side store) never need a redundant fetch, and so this logic is
 * trivially unit-testable without mocking BuildersDB.
 *
 * Manual selection always wins — it is, today, the ONLY source this function reads. If
 * `project.regionalSelection` names a code with no matching profile (a deprecated/removed
 * region, or stale data), resolution safely falls back to unresolved rather than throwing or
 * guessing a substitute.
 */
export function resolveEffectiveRegionalSelection(
  project: Pick<Project, 'regionalSelection'>,
): RegionalResolutionResult {
  const selection = project.regionalSelection;

  if (!selection) {
    return unresolvedResult('No manual regional selection has been made for this project.');
  }

  const profile = regionalEngine.getRegionalProfile(selection.regionCode);

  if (!profile) {
    return unresolvedResult(
      `The project's selected region code "${selection.regionCode}" does not match any supported Regional Profile.`,
    );
  }

  return {
    regionalProfileId: profile.id,
    regionalProfileCode: profile.code,
    regionalProfileVersion: profile.version,
    selectionSource: 'manual_override',
    sourceValue: selection.regionCode,
    matchedCountry: profile.name,
    resolvedAt: new Date().toISOString(),
    contentAvailable: hasSubstantiveContent(profile),
  };
}

/**
 * The async, I/O-performing entry point — what `buildersDbContextProvider.ts` calls. Fetches
 * the project via the existing `getProjectById` repository function (same one every other
 * BuildersDB-backed read in this codebase uses) and delegates to the pure function above.
 * Never throws: a missing project or an unavailable BuildersDB connection both resolve to the
 * safe "unresolved" result, exactly like `getLatestBlueprintResolution` returning `null` rather
 * than throwing when BuildersDB is unavailable.
 */
export async function getEffectiveRegionalSelection(projectId: string): Promise<RegionalResolutionResult> {
  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return unresolvedResult('Project could not be loaded to resolve a Regional Profile.');
    }

    return resolveEffectiveRegionalSelection(project);
  } catch (error) {
    console.error(
      '[Regional Resolution] getEffectiveRegionalSelection failed, continuing without regional context:',
      error,
    );
    return unresolvedResult('Regional Profile resolution failed unexpectedly.');
  }
}

/**
 * Sets (or replaces) the project's manual Regional Profile selection. Manual selection always
 * wins over any future automatic source — PART 11 of the Sprint 71 brief. Returns `false`
 * (never throws) if the project can't be loaded/updated, or if `regionCode` doesn't match a
 * known profile (never persists a selection that can't resolve).
 */
export async function setManualRegionalSelection(projectId: string, regionCode: string): Promise<boolean> {
  if (!regionalEngine.getRegionalProfile(regionCode)) {
    console.error(`[Regional Resolution] setManualRegionalSelection: unknown region code "${regionCode}"`);
    return false;
  }

  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return false;
    }

    const selection: RegionalSelection = {
      regionCode: regionCode as RegionalSelection['regionCode'],
      selectedAt: new Date().toISOString(),
    };

    return await updateProject({ ...project, regionalSelection: selection });
  } catch (error) {
    console.error('[Regional Resolution] setManualRegionalSelection failed:', error);
    return false;
  }
}

/**
 * Clears a project's manual Regional Profile selection, returning it to "no region resolved"
 * (PART 11's "ability to return to automatic resolution" — today that means simply
 * unresolved, since no automatic source is reachable yet; see `RegionalSelectionSource`'s doc
 * comment). Never throws.
 */
export async function clearManualRegionalSelection(projectId: string): Promise<boolean> {
  try {
    const project = await getProjectById(projectId);

    if (!project) {
      return false;
    }

    const { regionalSelection: _removed, ...rest } = project;

    return await updateProject(rest as Project);
  } catch (error) {
    console.error('[Regional Resolution] clearManualRegionalSelection failed:', error);
    return false;
  }
}

export const regionalResolutionService = {
  resolveEffectiveRegionalSelection,
  getEffectiveRegionalSelection,
  setManualRegionalSelection,
  clearManualRegionalSelection,
};
