import { useCallback, useEffect, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { ARTIFACT_TYPES, getApprovedArtifactContent } from '~/lib/projects/artifacts';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';
import { mvpRepository } from '~/lib/mvp/mvpRepository';
import type { Mvp, MvpApproval } from '~/lib/mvp/mvpTypes';
import { featureRepository } from '~/lib/features/featureRepository';
import type { Feature } from '~/lib/features/featureTypes';
import { productReviewRepository } from '~/lib/product-review/productReviewRepository';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import { roadmapReviewRepository } from '~/lib/roadmap-review/roadmapReviewRepository';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';
import { buildProductEvolutionView } from '~/lib/projects/productEvolutionView';
import { BuildersAlert, BuildersButton, BuildersStatusBadge } from '~/components/ui/builders';
import { MvpTimeline } from './MvpTimeline';
import { MvpSummaryCard } from './MvpSummaryCard';

/**
 * Product Workspace Panel — Sprint 84B (Product Evolution Workspace).
 *
 * The root of the Product tab: loads Product Evolution data (committed MVPs, the approved
 * roadmap skeleton, Features, Product Reviews, Roadmap Reviews — all Sprints 78–83), manages
 * which MVP is selected, and composes the smaller presentation components
 * (`MvpTimeline`/`MvpSummaryCard`, which itself composes `ProductReviewCard`/`RoadmapReviewCard`)
 * around the pure `buildProductEvolutionView` read-model. This component never derives lifecycle
 * status itself and never stores it as independent UI-only truth — every status shown anywhere
 * under this panel traces back to a field on a persisted `Mvp`/`Feature`/`ProductReview`/
 * `RoadmapReview`/`MvpApproval` row.
 */

export interface ProductWorkspacePanelProps {
  project: Project;
}

interface LoadedData {
  mvps: Mvp[];
  features: Feature[];
  productReviews: ProductReview[];
  roadmapReviews: RoadmapReview[];
}

function LoadingState() {
  return (
    <div className="space-y-4 animate-pulse" role="status" aria-live="polite">
      <span className="sr-only">Loading your Product Roadmap…</span>
      <div className="h-24 rounded-xl bg-bolt-elements-background-depth-2/60" />
      <div className="flex gap-2">
        <div className="h-20 w-44 rounded-xl bg-bolt-elements-background-depth-2/60" />
        <div className="h-20 w-44 rounded-xl bg-bolt-elements-background-depth-2/60" />
        <div className="h-20 w-44 rounded-xl bg-bolt-elements-background-depth-2/60" />
      </div>
      <div className="h-56 rounded-xl bg-bolt-elements-background-depth-2/60" />
    </div>
  );
}

export function ProductWorkspacePanel({ project }: ProductWorkspacePanelProps) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedSequence, setSelectedSequence] = useState<number | undefined>(undefined);
  const [approvals, setApprovals] = useState<MvpApproval[]>([]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const ownerDraft = useMemo(
    () =>
      getApprovedArtifactContent<ProductOwnerDraft>(getProjectArtifacts(project), ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT),
    [project],
  );
  const roadmapSkeleton = useMemo(() => ownerDraft?.roadmapSkeleton ?? [], [ownerDraft]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      try {
        const [mvps, features, productReviews, roadmapReviews] = await Promise.all([
          mvpRepository.listMvpsForProject(project.id),
          featureRepository.listFeaturesForProject(project.id),
          productReviewRepository.listProductReviews(project.id),
          roadmapReviewRepository.listRoadmapReviews(project.id),
        ]);

        if (cancelled) {
          return;
        }

        setData({ mvps, features, productReviews, roadmapReviews });
        setStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Failed to load your Product Roadmap.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project.id, reloadToken]);

  /*
   * First pass without approvals — needed only to discover WHICH MVP is selected, since
   * `listMvpApprovals` is scoped to one `mvpId` and this panel only ever needs it for the
   * currently-selected row (see productEvolutionView.ts's own comment on `selectedApprovals`).
   */
  const preliminaryView = useMemo(() => {
    if (!data) {
      return undefined;
    }

    return buildProductEvolutionView({
      projectId: project.id,
      productVision: ownerDraft?.productVision,
      mvps: data.mvps,
      roadmapSkeleton,
      features: data.features,
      productReviews: data.productReviews,
      roadmapReviews: data.roadmapReviews,
      selectedSequence,
    });
  }, [data, ownerDraft, roadmapSkeleton, project.id, selectedSequence]);

  const selectedMvpId = preliminaryView?.selected?.entry.mvp?.id;

  /*
   * Re-fetches on `reloadToken` too, not just `selectedMvpId` — a `reload()` after approving a
   * Roadmap Review persists its `MvpApproval { stage: 'roadmap_review' }` against the CURRENTLY
   * selected (target) MVP without that MVP's id ever changing, so keying this effect on
   * `selectedMvpId` alone would leave the Approvals tab showing the stale, pre-approval list.
   */
  useEffect(() => {
    let cancelled = false;

    if (!selectedMvpId) {
      setApprovals([]);
      return undefined;
    }

    (async () => {
      const result = await mvpRepository.listMvpApprovals(selectedMvpId);

      if (!cancelled) {
        setApprovals(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMvpId, reloadToken]);

  const view = useMemo(() => {
    if (!preliminaryView || !data) {
      return preliminaryView;
    }

    if (!selectedMvpId) {
      return preliminaryView;
    }

    return buildProductEvolutionView({
      projectId: project.id,
      productVision: ownerDraft?.productVision,
      mvps: data.mvps,
      roadmapSkeleton,
      features: data.features,
      productReviews: data.productReviews,
      roadmapReviews: data.roadmapReviews,
      selectedSequence,
      selectedApprovals: approvals,
    });
  }, [preliminaryView, data, selectedMvpId, approvals, ownerDraft, roadmapSkeleton, project.id, selectedSequence]);

  if (status === 'loading') {
    return <LoadingState />;
  }

  if (status === 'error') {
    return (
      <BuildersAlert variant="error" title="Couldn't load your Product Roadmap">
        <p>{errorMessage}</p>
        <BuildersButton size="sm" variant="outline" className="mt-2" onClick={reload}>
          Retry
        </BuildersButton>
      </BuildersAlert>
    );
  }

  if (!view || view.isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-bolt-elements-borderColor/60">
        <span className="i-ph:map-trifold-duotone h-9 w-9 text-bolt-elements-textTertiary mb-3" />
        <div className="text-sm font-medium text-bolt-elements-textSecondary">
          The Product Roadmap will appear after MVP1 is approved.
        </div>
        <div className="text-xs text-bolt-elements-textTertiary mt-1 max-w-[360px]">
          Approve your MVP Roadmap &amp; Scope in the Plan tab to start MVP1 — its release, review, and roadmap history
          will show up here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Product header — Phase 5. */}
      <div
        className={classNames(
          'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
          'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        )}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">{project.name}</h2>
            {view.productVision && (
              <p className="text-sm text-bolt-elements-textSecondary mt-1 max-w-[560px]">{view.productVision}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
              Live
            </span>
            {view.liveEntry ? (
              <BuildersStatusBadge status="success" label={`${view.liveEntry.code} — Released`} />
            ) : (
              <span className="text-bolt-elements-textTertiary text-xs">Not released yet</span>
            )}
          </div>

          {view.activeEntry && view.activeEntry.sequence !== view.liveEntry?.sequence && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
                Planned
              </span>
              <BuildersStatusBadge status="working" label={`${view.activeEntry.code} — In Progress`} />
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-purple-500/30 bg-purple-50/70 dark:bg-purple-500/[0.08] px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-1">
            Next Product Action
          </div>
          <div className="text-sm text-bolt-elements-textPrimary">{view.nextAction.label}</div>
        </div>
      </div>

      {/* MVP timeline — Phase 6. */}
      <MvpTimeline
        entries={view.timeline}
        selectedSequence={view.selected?.entry.sequence}
        onSelect={setSelectedSequence}
      />

      {/* Selected-MVP detail — Phase 7. */}
      {view.selected && <MvpSummaryCard project={project} selected={view.selected} onChanged={reload} />}
    </div>
  );
}
