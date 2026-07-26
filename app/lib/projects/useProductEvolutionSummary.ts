import { useEffect, useState } from 'react';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { ARTIFACT_TYPES, getApprovedArtifactContent } from '~/lib/projects/artifacts';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';
import { mvpRepository } from '~/lib/mvp/mvpRepository';
import { productReviewRepository } from '~/lib/product-review/productReviewRepository';
import { roadmapReviewRepository } from '~/lib/roadmap-review/roadmapReviewRepository';
import {
  buildProductEvolutionView,
  type ProductEvolutionMvpEntry,
  type ProductEvolutionNextAction,
} from './productEvolutionView';

/**
 * Product Evolution summary — Sprint 84C (Preview Context Strip).
 *
 * A lightweight sibling to `ProductWorkspacePanel`'s own data loading: reads the SAME persisted
 * data (`Mvp`/`ProductReview`/`RoadmapReview` rows) through the SAME pure `buildProductEvolutionView`
 * selector Sprint 84B already built, but exposes only the two facts a compact context strip needs
 * (the live MVP, the next action) rather than the full workspace shape. This never renders
 * anything itself and never duplicates `ProductWorkspacePanel` — it exists so `Preview.tsx` can
 * show a one-line summary without mounting the full Product tab. `features` is always passed as
 * `[]` since nothing this hook exposes depends on per-MVP feature detail.
 */

export interface ProductEvolutionSummary {
  status: 'loading' | 'ready' | 'error';
  isEmpty: boolean;
  liveEntry?: ProductEvolutionMvpEntry;
  activeEntry?: ProductEvolutionMvpEntry;
  nextAction?: ProductEvolutionNextAction;
}

const LOADING_STATE: ProductEvolutionSummary = { status: 'loading', isEmpty: true };

export function useProductEvolutionSummary(project: Project | undefined): ProductEvolutionSummary {
  const [state, setState] = useState<ProductEvolutionSummary>(LOADING_STATE);

  useEffect(() => {
    if (!project) {
      setState(LOADING_STATE);
      return undefined;
    }

    let cancelled = false;
    setState(LOADING_STATE);

    (async () => {
      try {
        const [mvps, productReviews, roadmapReviews] = await Promise.all([
          mvpRepository.listMvpsForProject(project.id),
          productReviewRepository.listProductReviews(project.id),
          roadmapReviewRepository.listRoadmapReviews(project.id),
        ]);

        if (cancelled) {
          return;
        }

        const ownerDraft = getApprovedArtifactContent<ProductOwnerDraft>(
          getProjectArtifacts(project),
          ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
        );

        const view = buildProductEvolutionView({
          projectId: project.id,
          productVision: ownerDraft?.productVision,
          mvps,
          roadmapSkeleton: ownerDraft?.roadmapSkeleton ?? [],
          features: [],
          productReviews,
          roadmapReviews,
        });

        if (!cancelled) {
          setState({
            status: 'ready',
            isEmpty: view.isEmpty,
            liveEntry: view.liveEntry,
            activeEntry: view.activeEntry,
            nextAction: view.nextAction,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ status: 'error', isEmpty: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  return state;
}
