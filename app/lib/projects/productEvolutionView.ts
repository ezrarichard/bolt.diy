import type { Mvp, MvpApproval, MvpEstimatedEffort, MvpStatus } from '~/lib/mvp/mvpTypes';
import type { Feature, FeatureStatus } from '~/lib/features/featureTypes';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';
import type { RoadmapSkeletonEntry } from './prompts/productOwner';

/**
 * Product Evolution Read Model — Sprint 84B (Product Evolution Workspace).
 *
 * A pure, deterministic selector that joins ALREADY-FETCHED data (committed `Mvp` rows, the
 * approved roadmap skeleton, `Feature` rows, `ProductReview`/`RoadmapReview` rows, and — for the
 * selected MVP only — `MvpApproval` rows) into the single shape `ProductWorkspacePanel` and its
 * children need. **Never persists anything, never calls a repository, never awaits.** Every
 * async fetch happens in the caller (`ProductWorkspacePanel.tsx`); this module only combines
 * results already in hand — the same "pure join over already-fetched data" discipline
 * `docs/product-management/Product-Management-Architecture.md` Part 7's own Roadmap UI section
 * specifies ("one read... left-outer-joined in memory... no new query primitive").
 *
 * **Timeline identity rule.** A committed `Mvp` row and a `RoadmapSkeletonEntry` describe the
 * SAME roadmap position when their `sequence` matches — this is the exact identity rule
 * `docs/product-management/Product-Management-Architecture.md` Part 1 already established
 * ("one RoadmapSkeletonEntry ⋈ (0 or 1) Mvp row, joined by `sequence`"), reused here rather than
 * invented. A persisted `Mvp` row is always authoritative for that sequence — its own
 * `theme`/`targetRelease`/`estimatedEffort` are used, with the skeleton entry's fields only as a
 * fallback for any that are unset; the skeleton entry is never rendered as a second, duplicate
 * timeline row alongside it.
 *
 * **No mutation.** This module — and every caller of it — must never invoke
 * `mvpRepository.resolveNextRoadmapTarget` (Sprint 81; mutation-capable: it creates a `planned`
 * `Mvp` row the first time it's called for a not-yet-reached sequence) merely to render a
 * timeline. "Live"/"active" MVP identity below is computed with the exact same PURE predicate
 * `mvpRepository.resolveLatestReleasedMvp`/`resolveActiveMvpId` already use internally
 * (highest-sequence reduce over a status filter) — reimplemented here, not imported, because
 * those are `async` repository functions and this selector must stay synchronous; duplicating a
 * two-line pure predicate is the same tradeoff `mvpRepository.ts`'s own
 * `formatFallbackMvpCode` comment already accepts ("allowed to compute the same value
 * independently without one depending on the other").
 */

export type ProductEvolutionMvpKind = 'committed' | 'skeleton';

/** One row in the Product Roadmap timeline — either a committed `Mvp` or a skeleton-only future entry. */
export interface ProductEvolutionMvpEntry {
  kind: ProductEvolutionMvpKind;
  sequence: number;
  code: string;
  theme?: string;
  targetRelease?: string;
  estimatedEffort?: MvpEstimatedEffort;

  /** Undefined for a skeleton-only entry — there is no committed status yet. */
  status?: MvpStatus;

  /** Present only when `kind === 'committed'`. */
  mvp?: Mvp;

  /** True for the highest-sequence `Mvp` with `status === 'released'` — mirrors `resolveLatestReleasedMvp`. */
  isLive: boolean;

  /** True for the highest-sequence `Mvp` with `status` not `'planned'`/`'superseded'` — mirrors `resolveActiveMvpId`. Not mutually exclusive with `isLive` (a released MVP with no successor yet is both). */
  isActive: boolean;
}

export interface ProductEvolutionFeatureSummary {
  total: number;
  byStatus: Partial<Record<FeatureStatus, number>>;
  moduleCount: number;
}

export interface ProductEvolutionSelectedMvp {
  entry: ProductEvolutionMvpEntry;
  features: Feature[];
  featureSummary: ProductEvolutionFeatureSummary;

  /** Only populated for a committed MVP — see `BuildProductEvolutionViewInput.selectedApprovals`'s own comment for why this is caller-supplied rather than fetched in here. */
  approvals: MvpApproval[];

  /** Every `ProductReview` whose `mvpId` (the SOURCE MVP being reviewed) is this entry's MVP — newest first. Never assumed to be at most one (Sprint 82's own "One MVP, many Product Reviews"). */
  productReviews: ProductReview[];

  /** Every `RoadmapReview` whose `targetMvpId` is this entry's MVP — newest first. Never assumed to be at most one (Sprint 83's own "One Product Review, many Roadmap Reviews", which implies the same for a given target MVP). */
  roadmapReviews: RoadmapReview[];

  /**
   * For each entry in `roadmapReviews`, the human-readable timeline `code` of its SOURCE MVP —
   * the MVP whose approved Product Review (`RoadmapReview.productReviewId`) this Roadmap Review
   * evaluated — resolved from already-fetched `productReviews`/`timeline` data, never a new fetch.
   * Keyed by `RoadmapReview.id`. A review's id is absent from this map (never `undefined` present)
   * only if its source Product Review or that Product Review's MVP can't be resolved from the data
   * already in hand — callers must treat a missing key as "source unknown", not an error.
   */
  roadmapReviewSourceLabels: Record<string, string>;
}

export type ProductEvolutionActionId =
  | 'awaiting-mvp1'
  | 'awaiting-release'
  | 'start-product-review'
  | 'product-review-in-progress'
  | 'approve-product-review'
  | 'start-roadmap-review'
  | 'roadmap-review-in-progress'
  | 'approve-roadmap-review'
  | 'roadmap-review-approved'
  | 'up-to-date';

export interface ProductEvolutionNextAction {
  id: ProductEvolutionActionId;
  label: string;
}

export interface ProductEvolutionView {
  projectId: string;
  productVision?: string;

  /** Ordered by `sequence` ascending — deterministic, never re-sorted by the caller. */
  timeline: ProductEvolutionMvpEntry[];

  /** True when `timeline` is empty (no committed MVP and no roadmap skeleton at all) — Phase 12 state A. */
  isEmpty: boolean;

  liveEntry?: ProductEvolutionMvpEntry;
  activeEntry?: ProductEvolutionMvpEntry;
  selected?: ProductEvolutionSelectedMvp;
  nextAction: ProductEvolutionNextAction;
}

export interface BuildProductEvolutionViewInput {
  projectId: string;
  productVision?: string;
  mvps: Mvp[];
  roadmapSkeleton: RoadmapSkeletonEntry[];
  features: Feature[];
  productReviews: ProductReview[];
  roadmapReviews: RoadmapReview[];

  /** Which timeline `sequence` is selected. Defaults to the active MVP, then the live MVP, then the last timeline entry — see `resolveDefaultSelectedSequence`. */
  selectedSequence?: number;

  /**
   * `MvpApproval` rows for the selected MVP only — fetched by the caller (`listMvpApprovals`
   * is scoped to one `mvpId`, not project-wide, so this selector never has to fetch N times per
   * timeline row; it only ever needs approvals for whichever ONE row is currently selected).
   * Omitted or `undefined` for a skeleton-only selection, which has no `Mvp` row to have
   * approvals against — never defaulted to `[]` silently so a caller that forgot to fetch is
   * distinguishable in tests from a genuinely empty, already-fetched result.
   */
  selectedApprovals?: MvpApproval[];
}

function higherSequence<T extends { sequence: number }>(a: T, b: T): T {
  return b.sequence > a.sequence ? b : a;
}

/** Newest-first, tie-broken by `id` for full determinism (two rows created in the same millisecond must still sort identically across runs). */
function byNewestFirst<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
}

/** The timeline entry's `code` for the MVP that produced `productReviewId`, or `undefined` if that Product Review (or its MVP's timeline entry) isn't present in already-fetched data. Pure lookup — never fetches. */
function resolveRoadmapReviewSourceLabel(
  review: RoadmapReview,
  productReviews: ProductReview[],
  timeline: ProductEvolutionMvpEntry[],
): string | undefined {
  const sourceReview = productReviews.find((candidate) => candidate.id === review.productReviewId);

  if (!sourceReview) {
    return undefined;
  }

  const sourceEntry = timeline.find((entry) => entry.mvp?.id === sourceReview.mvpId);

  return sourceEntry?.code;
}

function summarizeFeatures(features: Feature[]): ProductEvolutionFeatureSummary {
  const byStatus: Partial<Record<FeatureStatus, number>> = {};

  for (const feature of features) {
    byStatus[feature.status] = (byStatus[feature.status] ?? 0) + 1;
  }

  return {
    total: features.length,
    byStatus,
    moduleCount: new Set(features.map((feature) => feature.moduleSlug)).size,
  };
}

/** Default selection when the caller hasn't picked one: prefer the MVP currently active in engineering, then the live release, then whichever timeline entry sorts last (the newest roadmap position). */
function resolveDefaultSelectedSequence(
  timeline: ProductEvolutionMvpEntry[],
  activeEntry: ProductEvolutionMvpEntry | undefined,
  liveEntry: ProductEvolutionMvpEntry | undefined,
): number | undefined {
  if (activeEntry) {
    return activeEntry.sequence;
  }

  if (liveEntry) {
    return liveEntry.sequence;
  }

  return timeline.length > 0 ? timeline[timeline.length - 1].sequence : undefined;
}

interface NextActionContext {
  timeline: ProductEvolutionMvpEntry[];
  liveEntry: ProductEvolutionMvpEntry | undefined;
  productReviews: ProductReview[];
  roadmapReviews: RoadmapReview[];
}

/**
 * The approved product flow, walked step by step: released MVP -> Product Review -> approved ->
 * Roadmap Review -> approved -> ready for a future Engineering Gate. Deliberately does not
 * distinguish "Complete MVP1" vs. "Release MVP1" (both collapse into `awaiting-release`) — this
 * selector only has `Mvp.status`, and Sprint 80's own architecture keeps "provisioned"/
 * "generated"/etc. as DERIVED facts never stored on `Mvp` itself; a finer action here would
 * require deriving from systems this read model deliberately doesn't reach into (per the
 * sprint's own "expose only actions the engine workflow currently supports" instruction).
 */
function computeNextAction(context: NextActionContext): ProductEvolutionNextAction {
  const { timeline, liveEntry, productReviews, roadmapReviews } = context;

  if (timeline.length === 0) {
    return { id: 'awaiting-mvp1', label: 'Approve your MVP1 roadmap in the Plan tab to start your Product Roadmap.' };
  }

  if (!liveEntry || !liveEntry.mvp) {
    return {
      id: 'awaiting-release',
      label: 'Finish building and release your first MVP to start your Product Roadmap.',
    };
  }

  const liveMvpId = liveEntry.mvp.id;
  const reviewsForLive = productReviews.filter((review) => review.mvpId === liveMvpId).sort(byNewestFirst);
  const latestReview = reviewsForLive[0];

  if (!latestReview) {
    return { id: 'start-product-review', label: `Start a Product Review for ${liveEntry.code}.` };
  }

  if (latestReview.status === 'draft' || latestReview.status === 'analysing') {
    return { id: 'product-review-in-progress', label: `Product Review for ${liveEntry.code} is in progress.` };
  }

  if (latestReview.status === 'ready_for_review') {
    return { id: 'approve-product-review', label: `Approve the Product Review for ${liveEntry.code}.` };
  }

  // 'approved' or 'archived' — either way, the Product Review's own job is done; look for what it produced.
  const roadmapReviewsForReview = roadmapReviews
    .filter((review) => review.productReviewId === latestReview.id)
    .sort(byNewestFirst);
  const latestRoadmap = roadmapReviewsForReview[0];

  if (!latestRoadmap) {
    return { id: 'start-roadmap-review', label: 'Start a Roadmap Review to plan the next MVP.' };
  }

  if (latestRoadmap.status === 'draft' || latestRoadmap.status === 'planning') {
    return { id: 'roadmap-review-in-progress', label: 'Roadmap Review is in progress.' };
  }

  if (latestRoadmap.status === 'ready_for_review') {
    return { id: 'approve-roadmap-review', label: 'Approve the Roadmap Review to plan the next MVP.' };
  }

  if (latestRoadmap.status === 'approved') {
    const targetEntry = timeline.find((entry) => entry.mvp?.id === latestRoadmap.targetMvpId);
    const targetLabel = targetEntry ? targetEntry.code : `MVP sequence ${latestRoadmap.roadmapVersion}`;

    return {
      id: 'roadmap-review-approved',
      label: `Roadmap Review approved — ${targetLabel} is ready for a future Engineering Gate.`,
    };
  }

  return { id: 'up-to-date', label: 'No product action needed right now.' };
}

/**
 * Builds the Product Evolution view model. Pure — no I/O, no persistence, no repository calls.
 * See this file's own header comment for the timeline-identity and no-mutation rules this
 * implements.
 */
export function buildProductEvolutionView(input: BuildProductEvolutionViewInput): ProductEvolutionView {
  const { projectId, productVision, mvps, roadmapSkeleton, features, productReviews, roadmapReviews } = input;

  const released = mvps.filter((mvp) => mvp.status === 'released');
  const liveMvp = released.length > 0 ? released.reduce(higherSequence) : undefined;

  const eligibleActive = mvps.filter((mvp) => mvp.status !== 'planned' && mvp.status !== 'superseded');
  const activeMvp = eligibleActive.length > 0 ? eligibleActive.reduce(higherSequence) : undefined;

  const sequences = Array.from(
    new Set<number>([...mvps.map((mvp) => mvp.sequence), ...roadmapSkeleton.map((entry) => entry.sequence)]),
  ).sort((a, b) => a - b);

  const timeline: ProductEvolutionMvpEntry[] = sequences.map((sequence) => {
    const mvp = mvps.find((candidate) => candidate.sequence === sequence);
    const roadmapEntry = roadmapSkeleton.find((candidate) => candidate.sequence === sequence);

    if (mvp) {
      return {
        kind: 'committed',
        sequence,
        code: mvp.code ?? roadmapEntry?.id ?? `MVP-${String(sequence).padStart(3, '0')}`,
        theme: mvp.theme ?? roadmapEntry?.theme,
        targetRelease: mvp.targetRelease ?? roadmapEntry?.targetRelease,
        estimatedEffort: mvp.estimatedEffort ?? roadmapEntry?.estimatedEffort,
        status: mvp.status,
        mvp,
        isLive: liveMvp?.id === mvp.id,
        isActive: activeMvp?.id === mvp.id,
      };
    }

    /*
     * Skeleton-only — no committed row exists at this sequence yet. `roadmapEntry` is guaranteed
     * here: `sequences` only ever contains a sequence with no `mvp` when it came from
     * `roadmapSkeleton` in the first place.
     */
    return {
      kind: 'skeleton',
      sequence,
      code: roadmapEntry!.id,
      theme: roadmapEntry!.theme,
      targetRelease: roadmapEntry!.targetRelease,
      estimatedEffort: roadmapEntry!.estimatedEffort,
      status: undefined,
      mvp: undefined,
      isLive: false,
      isActive: false,
    };
  });

  const isEmpty = timeline.length === 0;
  const liveEntry = timeline.find((entry) => entry.isLive);
  const activeEntry = timeline.find((entry) => entry.isActive);

  /*
   * A caller-supplied `selectedSequence` that no longer matches any timeline row (its committed
   * MVP or skeleton entry disappeared from the data between renders — never expected in normal
   * operation, but must degrade deterministically rather than silently rendering no selection at
   * all) falls back to the same default-resolution rule as no selection being supplied.
   */
  const requestedSequence = input.selectedSequence;
  const requestedSequenceStillExists =
    requestedSequence !== undefined && timeline.some((entry) => entry.sequence === requestedSequence);
  const selectedSequence = requestedSequenceStillExists
    ? requestedSequence
    : resolveDefaultSelectedSequence(timeline, activeEntry, liveEntry);
  const selectedEntry = timeline.find((entry) => entry.sequence === selectedSequence);

  let selected: ProductEvolutionSelectedMvp | undefined;

  if (selectedEntry) {
    const selectedMvpId = selectedEntry.mvp?.id;
    const selectedFeatures = selectedMvpId ? features.filter((feature) => feature.mvpId === selectedMvpId) : [];
    const selectedProductReviews = selectedMvpId
      ? productReviews.filter((review) => review.mvpId === selectedMvpId).sort(byNewestFirst)
      : [];
    const selectedRoadmapReviews = selectedMvpId
      ? roadmapReviews.filter((review) => review.targetMvpId === selectedMvpId).sort(byNewestFirst)
      : [];

    const roadmapReviewSourceLabels: Record<string, string> = {};

    for (const review of selectedRoadmapReviews) {
      const sourceLabel = resolveRoadmapReviewSourceLabel(review, productReviews, timeline);

      if (sourceLabel !== undefined) {
        roadmapReviewSourceLabels[review.id] = sourceLabel;
      }
    }

    selected = {
      entry: selectedEntry,
      features: selectedFeatures,
      featureSummary: summarizeFeatures(selectedFeatures),
      approvals: input.selectedApprovals ?? [],
      productReviews: selectedProductReviews,
      roadmapReviews: selectedRoadmapReviews,
      roadmapReviewSourceLabels,
    };
  }

  const nextAction = computeNextAction({ timeline, liveEntry, productReviews, roadmapReviews });

  return {
    projectId,
    productVision,
    timeline,
    isEmpty,
    liveEntry,
    activeEntry,
    selected,
    nextAction,
  };
}
