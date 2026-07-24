import { useEffect, useState } from 'react';
import {
  resolveAndRecordBlueprint,
  getLatestBlueprintResolution,
  selectBlueprint as selectBlueprintService,
} from '~/lib/projects/blueprintResolutionService';
import type { BlueprintResolution } from '~/lib/builders-db/repositories/blueprintResolutionRepository';
import type { DiscoveryIntelligenceState } from './useDiscoveryIntelligence';

/**
 * Sprint 62 — Blueprint Recommendation & Selection.
 *
 * Client-side trigger + read/write surface for the Sprint 61 Blueprint Resolution Engine, which
 * nothing called from any UI until now. Mirrors `useDiscoveryIntelligence.ts`'s exact
 * conventions (same status-union shape, same "reset synchronously on key change" pattern, same
 * never-throw discipline) so this reads as the same family of hook, not a new one.
 *
 * Auto-resolution rule (Sprint 62 objective 1): resolve **once**, only when Discovery has
 * genuinely reached `READY` and no resolution has ever been recorded for this project yet. A
 * project that already has a resolution never re-triggers automatically here, no matter how
 * many times this hook re-mounts — re-resolution is deliberately not wired to anything
 * automatic this sprint (see blueprintResolutionEngine.ts's own append-only history design);
 * only a manual `selectBlueprint`/`resetToRecommendation` call ever writes after that first run.
 *
 * Never touches `project.blueprintId` or any AI role's context — see
 * `BlueprintRecommendationCard.tsx`'s header comment for why that matters.
 */
export type BlueprintRecommendationState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'resolving' }
  | { status: 'error'; message: string }
  | { status: 'ready'; resolution: BlueprintResolution };

export interface UseBlueprintRecommendationResult {
  state: BlueprintRecommendationState;

  /** Records a manual override — never reruns the resolution engine, never touches project.blueprintId. */
  selectBlueprint: (blueprintId: string) => Promise<void>;

  /** Convenience for "put it back the way the engine recommended" — just `selectBlueprint(recommendedBlueprintId)`. */
  resetToRecommendation: () => Promise<void>;
}

export function useBlueprintRecommendation(
  projectId: string | undefined,
  discovery: DiscoveryIntelligenceState,
): UseBlueprintRecommendationResult {
  const [state, setState] = useState<BlueprintRecommendationState>({ status: 'loading' });

  const discoveryKey =
    discovery.status === 'ready' ? `${discovery.session.id}:${discovery.model.updatedAt}` : discovery.status;
  const currentKey = `${projectId ?? ''}:${discoveryKey}`;
  const [loadedForKey, setLoadedForKey] = useState<string>('');

  if (currentKey !== loadedForKey) {
    setLoadedForKey(currentKey);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    if (!projectId || discovery.status !== 'ready') {
      setState({ status: 'hidden' });
      return undefined;
    }

    let cancelled = false;
    const { session, model } = discovery;

    (async () => {
      try {
        const existing = await getLatestBlueprintResolution(projectId);

        if (cancelled) {
          return;
        }

        if (existing) {
          setState({ status: 'ready', resolution: existing });
          return;
        }

        if (model.decision.state !== 'READY') {
          setState({ status: 'hidden' });
          return;
        }

        setState({ status: 'resolving' });

        const { persisted } = await resolveAndRecordBlueprint({ projectId, sessionId: session.id, model });

        if (cancelled) {
          return;
        }

        if (!persisted) {
          setState({ status: 'error', message: 'Blueprint recommendation could not be saved.' });
          return;
        }

        setState({ status: 'ready', resolution: persisted });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentKey]);

  async function selectBlueprint(blueprintId: string): Promise<void> {
    if (state.status !== 'ready') {
      return;
    }

    const ok = await selectBlueprintService(state.resolution.id, blueprintId);

    if (!ok) {
      return;
    }

    setState({ status: 'ready', resolution: { ...state.resolution, selectedBlueprintId: blueprintId } });
  }

  async function resetToRecommendation(): Promise<void> {
    if (state.status !== 'ready') {
      return;
    }

    await selectBlueprint(state.resolution.recommendedBlueprintId);
  }

  return { state, selectBlueprint, resetToRecommendation };
}
