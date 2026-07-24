import type { BlueprintCandidate } from '~/lib/blueprints';
import type { BlueprintResolution } from '~/lib/builders-db/repositories/blueprintResolutionRepository';

/**
 * Sprint 62 — Blueprint Recommendation & Selection.
 *
 * Pure display-mapping logic for `BlueprintRecommendationCard.tsx`, kept in its own `.ts` module
 * for the exact reason `businessDiscoveryDisplay.ts` gives for doing the same thing: this
 * codebase has no convention/tooling for rendering JSX in tests, so every branch of "what do we
 * show" lives here as a plain, directly-testable function.
 */

export interface BadgeMeta {
  label: string;
  badgeClass: string;
}

/** Confidence is the Sprint 61 engine's own 0-100 score — these bands are display-only, never fed back into any calculation. */
export function confidenceMeta(confidence: number): BadgeMeta {
  if (confidence >= 70) {
    return {
      label: `${confidence}% confidence`,
      badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
    };
  }

  if (confidence >= 40) {
    return {
      label: `${confidence}% confidence`,
      badgeClass: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
    };
  }

  return {
    label: `${confidence}% confidence`,
    badgeClass: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  };
}

/** Whether the user has manually diverged from what the engine recommended — never mutates, purely a read of the two stored ids. */
export function isCustomSelection(
  resolution: Pick<BlueprintResolution, 'recommendedBlueprintId' | 'selectedBlueprintId'>,
): boolean {
  return resolution.selectedBlueprintId !== resolution.recommendedBlueprintId;
}

export function selectionStatusMeta(
  resolution: Pick<BlueprintResolution, 'recommendedBlueprintId' | 'selectedBlueprintId'>,
): BadgeMeta {
  return isCustomSelection(resolution)
    ? {
        label: 'Custom Selection',
        badgeClass: 'text-purple-600 dark:text-purple-300 border-purple-500/30 bg-purple-500/10',
      }
    : {
        label: 'Following Recommendation',
        badgeClass: 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10',
      };
}

const MAX_ALTERNATES = 3;

/** The next-best candidates after the recommended one, most confident first — never includes the recommended blueprint itself. */
export function topAlternates(
  resolution: Pick<BlueprintResolution, 'candidates' | 'recommendedBlueprintId'>,
): BlueprintCandidate[] {
  return resolution.candidates
    .filter((candidate) => candidate.blueprintId !== resolution.recommendedBlueprintId)
    .slice(0, MAX_ALTERNATES);
}
