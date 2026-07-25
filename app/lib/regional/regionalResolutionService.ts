import { getProjectById, updateProject } from '~/lib/builders-db/repositories/buildersDbRepository';
import type { Project } from '~/lib/stores/projects';
import { regionalEngine } from './regionalProfileRegistry';
import type { RegionalProfile } from './regionalProfileTypes';
import type { RegionalResolutionResult, RegionalSelection } from './regionalResolutionTypes';

/**
 * Regional Resolution Service (Sprint 71, Regional Intelligence Foundation; extended Sprint 72,
 * Regional Selection Activation).
 *
 * Answers "what is this project's effective Regional Profile, and why?" — the Regional
 * Intelligence sibling of `blueprintResolutionService.ts`, deliberately built without that
 * service's append-only-history table. Blueprint Resolution needs a table because it records a
 * *scoring engine's* output (candidates + confidence + explanation) that changes as Business
 * Understanding evolves — a genuinely per-run computation worth an audit trail. Regional
 * resolution has no scoring engine at all: the only two real signals are an explicit manual
 * choice and a structured Business Discovery market, both single fields on `Project`
 * (`regionalSelection`, and `projectKnowledge.primaryMarketCode`), folded into
 * `builders_projects.metadata` — see buildersDbTypes.ts's `METADATA_FIELDS`) — sufficient and
 * avoids an unjustified migration, per PART 6 of the Sprint 71 brief and PART 8 of the Sprint 72
 * brief.
 *
 * Never infers a region from IP, browser locale, device location, currency, timezone, Blueprint
 * industry, or model guesswork (see `regionalResolutionTypes.ts`'s `RegionalSelectionSource` for
 * exactly which sources are reachable). This module reads NOTHING about where a request came
 * from — only what a human explicitly chose or explicitly typed for this project.
 *
 * Resolution priority (Sprint 72 PART 4): manual project-level override always wins; if absent,
 * a supported Business Discovery market resolves; otherwise unresolved. Clearing the manual
 * override falls through to whatever Business Discovery currently holds (not whatever it held
 * when the override was set) — see `clearManualRegionalSelection`'s own comment.
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

function resultFor(
  profile: RegionalProfile,
  selectionSource: 'manual_override' | 'business_discovery',
  sourceValue: string,
): RegionalResolutionResult {
  return {
    regionalProfileId: profile.id,
    regionalProfileCode: profile.code,
    regionalProfileVersion: profile.version,
    selectionSource,
    sourceValue,
    matchedCountry: profile.name,
    resolvedAt: new Date().toISOString(),
    contentAvailable: hasSubstantiveContent(profile),
  };
}

/**
 * Pure resolution given an already-loaded `Project` — no I/O. Exported separately from
 * `getEffectiveRegionalSelection` (which does the I/O) so callers that already have a `Project`
 * in hand (e.g. a client-side store) never need a redundant fetch, and so this logic is
 * trivially unit-testable without mocking BuildersDB.
 *
 * Priority (Sprint 72 PART 4/PART 9):
 * 1. `project.regionalSelection` (manual override) — always wins when present, even if
 *    `projectKnowledge.primaryMarketCode` names a different market (a stale/different discovery
 *    value never overrides an explicit manual choice).
 * 2. `project.projectKnowledge.primaryMarketCode` — a structured Business Discovery market, only
 *    consulted when no manual override exists.
 * 3. Unresolved.
 *
 * If either source names a code with no matching profile (a deprecated/removed region, stale
 * data, `'OTHER'`, or simply "not specified"), resolution safely falls back to unresolved rather
 * than throwing or guessing a substitute.
 */
export function resolveEffectiveRegionalSelection(
  project: Pick<Project, 'regionalSelection' | 'projectKnowledge'>,
): RegionalResolutionResult {
  const selection = project.regionalSelection;

  if (selection) {
    const profile = regionalEngine.getRegionalProfile(selection.regionCode);

    if (!profile) {
      return unresolvedResult(
        `The project's selected region code "${selection.regionCode}" does not match any supported Regional Profile.`,
      );
    }

    return resultFor(profile, 'manual_override', selection.regionCode);
  }

  const marketCode = project.projectKnowledge?.primaryMarketCode;

  if (!marketCode) {
    return unresolvedResult(
      'No manual regional selection has been made, and no primary operating market has been captured in Business Discovery.',
    );
  }

  const profile = regionalEngine.getRegionalProfile(marketCode);

  if (!profile) {
    return unresolvedResult(
      `The project's Business Discovery primary operating market "${marketCode}" does not match any supported Regional Profile.`,
    );
  }

  return resultFor(profile, 'business_discovery', marketCode);
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
 * Clears a project's manual Regional Profile selection, restoring automatic resolution — Sprint
 * 72 PART 5's "ability to return to automatic resolution": whatever
 * `project.projectKnowledge.primaryMarketCode` currently resolves to (or unresolved, if that's
 * unset/unsupported too; see `RegionalSelectionSource`'s doc comment). Never throws.
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
