import { describe, expect, it } from 'vitest';
import { buildProductEvolutionView, type BuildProductEvolutionViewInput } from './productEvolutionView';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import type { Feature } from '~/lib/features/featureTypes';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';
import type { RoadmapSkeletonEntry } from './prompts/productOwner';

function makeMvp(overrides: Partial<Mvp> = {}): Mvp {
  return {
    id: 'mvp-1',
    projectId: 'proj-1',
    code: 'MVP-001',
    sequence: 1,
    theme: 'Core booking flow',
    status: 'released',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoadmapEntry(overrides: Partial<RoadmapSkeletonEntry> = {}): RoadmapSkeletonEntry {
  return {
    id: 'MVP-002',
    sequence: 2,
    theme: 'Billing',
    targetRelease: 'v0.2',
    estimatedEffort: 'medium',
    ...overrides,
  };
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feature-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    code: 'FEAT-001',
    moduleSlug: 'appointments',
    title: 'Book an appointment',
    dependsOn: [],
    status: 'deployed',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProductReview(overrides: Partial<ProductReview> = {}): ProductReview {
  return {
    id: 'product-review-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    reviewDate: '2026-07-26T00:00:00.000Z',
    reviewType: 'post_release',
    status: 'approved',
    recommendations: [],
    businessRisks: [],
    opportunities: [],
    featureRequests: [],
    technicalConcerns: [],
    attachments: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoadmapReview(overrides: Partial<RoadmapReview> = {}): RoadmapReview {
  return {
    id: 'roadmap-review-1',
    projectId: 'proj-1',
    productReviewId: 'product-review-1',
    targetMvpId: 'mvp-2',
    roadmapVersion: 1,
    status: 'approved',
    roadmapChanges: [],
    newFeatures: [],
    deferredFeatures: [],
    removedFeatures: [],
    priorities: [],
    dependencies: [],
    technicalRisks: [],
    businessRisks: [],
    assumptions: [],
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function baseInput(overrides: Partial<BuildProductEvolutionViewInput> = {}): BuildProductEvolutionViewInput {
  return {
    projectId: 'proj-1',
    mvps: [],
    roadmapSkeleton: [],
    features: [],
    productReviews: [],
    roadmapReviews: [],
    ...overrides,
  };
}

describe('buildProductEvolutionView — empty project', () => {
  it('reports isEmpty and the awaiting-mvp1 next action when there is no MVP data at all', () => {
    const view = buildProductEvolutionView(baseInput());

    expect(view.isEmpty).toBe(true);
    expect(view.timeline).toEqual([]);
    expect(view.liveEntry).toBeUndefined();
    expect(view.selected).toBeUndefined();
    expect(view.nextAction.id).toBe('awaiting-mvp1');
  });
});

describe('buildProductEvolutionView — timeline identity rules', () => {
  it('orders committed MVPs by sequence ascending, regardless of input order', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1 });
    const mvp3 = makeMvp({ id: 'mvp-3', sequence: 3, status: 'planned' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp3, mvp1, mvp2] }));

    expect(view.timeline.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it('produces a skeleton-only entry for a future roadmap sequence with no committed MVP', () => {
    const view = buildProductEvolutionView(baseInput({ mvps: [makeMvp()], roadmapSkeleton: [makeRoadmapEntry()] }));

    expect(view.timeline).toHaveLength(2);

    const skeletonEntry = view.timeline.find((entry) => entry.sequence === 2)!;
    expect(skeletonEntry.kind).toBe('skeleton');
    expect(skeletonEntry.mvp).toBeUndefined();
    expect(skeletonEntry.status).toBeUndefined();
    expect(skeletonEntry.code).toBe('MVP-002');
    expect(skeletonEntry.theme).toBe('Billing');
  });

  it('lets a persisted MVP override its matching skeleton entry rather than rendering both', () => {
    const mvp = makeMvp({ sequence: 2, theme: 'Committed theme', id: 'mvp-2' });
    const skeletonEntry = makeRoadmapEntry({ sequence: 2, theme: 'Skeleton theme (stale)' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], roadmapSkeleton: [skeletonEntry] }));

    expect(view.timeline).toHaveLength(1);

    const entry = view.timeline[0];
    expect(entry.kind).toBe('committed');
    expect(entry.theme).toBe('Committed theme');
    expect(entry.mvp?.id).toBe('mvp-2');
  });

  it('never produces two timeline rows for the same sequence', () => {
    const mvps = [makeMvp({ sequence: 1 }), makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' })];
    const roadmapSkeleton = [
      makeRoadmapEntry({ sequence: 1 }),
      makeRoadmapEntry({ sequence: 2 }),
      makeRoadmapEntry({ id: 'MVP-003', sequence: 3 }),
    ];

    const view = buildProductEvolutionView(baseInput({ mvps, roadmapSkeleton }));

    const sequencesSeen = view.timeline.map((entry) => entry.sequence);
    expect(sequencesSeen).toEqual([1, 2, 3]);
    expect(new Set(sequencesSeen).size).toBe(sequencesSeen.length);
  });

  it('falls back to the skeleton entry fields only for whichever committed MVP fields are unset', () => {
    const mvp = makeMvp({ theme: undefined, targetRelease: undefined, estimatedEffort: undefined });
    const skeletonEntry = makeRoadmapEntry({ sequence: 1, theme: 'From skeleton', targetRelease: 'v0.1' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], roadmapSkeleton: [skeletonEntry] }));

    expect(view.timeline[0].theme).toBe('From skeleton');
    expect(view.timeline[0].targetRelease).toBe('v0.1');
  });
});

describe('buildProductEvolutionView — live / active MVP resolution', () => {
  it('resolves the highest-sequence released MVP as isLive', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'superseded' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'released' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp1, mvp2] }));

    expect(view.liveEntry?.mvp?.id).toBe('mvp-2');
    expect(view.timeline.find((entry) => entry.sequence === 1)?.isLive).toBe(false);
  });

  it('resolves the highest-sequence non-planned/non-superseded MVP as isActive', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'released' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });
    const mvp3 = makeMvp({ id: 'mvp-3', sequence: 3, status: 'planned' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp1, mvp2, mvp3] }));

    expect(view.activeEntry?.mvp?.id).toBe('mvp-2');
    expect(view.liveEntry?.mvp?.id).toBe('mvp-1');
  });

  it('treats a released MVP with no successor as both live and active', () => {
    const mvp = makeMvp({ status: 'released' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp] }));

    expect(view.liveEntry?.mvp?.id).toBe('mvp-1');
    expect(view.activeEntry?.mvp?.id).toBe('mvp-1');
  });

  it('never treats a planned-only target row as live or active', () => {
    const mvp = makeMvp({ status: 'planned' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp] }));

    expect(view.liveEntry).toBeUndefined();
    expect(view.activeEntry).toBeUndefined();
  });
});

describe('buildProductEvolutionView — selected MVP', () => {
  it('maps Features onto the selected committed MVP only', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1 });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });
    const featureForMvp1 = makeFeature({ id: 'f1', mvpId: 'mvp-1' });
    const featureForMvp2 = makeFeature({ id: 'f2', mvpId: 'mvp-2', code: 'FEAT-002' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [mvp1, mvp2], features: [featureForMvp1, featureForMvp2], selectedSequence: 1 }),
    );

    expect(view.selected?.features).toEqual([featureForMvp1]);
    expect(view.selected?.featureSummary.total).toBe(1);
  });

  it('summarizes Features by status and distinct module count', () => {
    const mvp = makeMvp();
    const features = [
      makeFeature({ id: 'f1', code: 'FEAT-001', moduleSlug: 'appointments', status: 'deployed' }),
      makeFeature({ id: 'f2', code: 'FEAT-002', moduleSlug: 'appointments', status: 'deployed' }),
      makeFeature({ id: 'f3', code: 'FEAT-003', moduleSlug: 'billing', status: 'in_progress' }),
    ];

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], features, selectedSequence: 1 }));

    expect(view.selected?.featureSummary).toEqual({
      total: 3,
      byStatus: { deployed: 2, in_progress: 1 },
      moduleCount: 2,
    });
  });

  it('returns no Features for a skeleton-only selection, never manufacturing data', () => {
    const view = buildProductEvolutionView(baseInput({ roadmapSkeleton: [makeRoadmapEntry()], selectedSequence: 2 }));

    expect(view.selected?.entry.kind).toBe('skeleton');
    expect(view.selected?.features).toEqual([]);
    expect(view.selected?.productReviews).toEqual([]);
    expect(view.selected?.roadmapReviews).toEqual([]);
  });

  it('defaults selection to the active MVP when the caller does not specify one', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'released' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp1, mvp2] }));

    expect(view.selected?.entry.sequence).toBe(2);
  });

  it('falls back to the live MVP when there is no distinct active MVP', () => {
    const mvp = makeMvp({ status: 'released' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp] }));

    expect(view.selected?.entry.sequence).toBe(1);
  });

  it('carries caller-supplied approvals through for the selected MVP only', () => {
    const mvp = makeMvp();
    const approvals = [
      {
        id: 'approval-1',
        mvpId: 'mvp-1',
        projectId: 'proj-1',
        stage: 'scope' as const,
        decision: 'approved' as const,
        decidedAt: '2026-07-01T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ];

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], selectedApprovals: approvals }));

    expect(view.selected?.approvals).toEqual(approvals);
  });

  it('defaults approvals to an empty array when the caller omits them', () => {
    const view = buildProductEvolutionView(baseInput({ mvps: [makeMvp()] }));

    expect(view.selected?.approvals).toEqual([]);
  });
});

describe('buildProductEvolutionView — Product Review / Roadmap Review linkage', () => {
  it('links every Product Review whose mvpId matches the selected (source) MVP', () => {
    const mvp = makeMvp();
    const review = makeProductReview();

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], productReviews: [review] }));

    expect(view.selected?.productReviews).toEqual([review]);
  });

  it('supports multiple Product Reviews for one MVP, ordered newest first', () => {
    const mvp = makeMvp();
    const older = makeProductReview({ id: 'review-older', createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = makeProductReview({ id: 'review-newer', createdAt: '2026-07-10T00:00:00.000Z' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], productReviews: [older, newer] }));

    expect(view.selected?.productReviews.map((review) => review.id)).toEqual(['review-newer', 'review-older']);
  });

  it('links every Roadmap Review whose targetMvpId matches the selected MVP', () => {
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, status: 'planned' });
    const roadmapReview = makeRoadmapReview({ targetMvpId: 'mvp-2' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [targetMvp], roadmapReviews: [roadmapReview], selectedSequence: 2 }),
    );

    expect(view.selected?.roadmapReviews).toEqual([roadmapReview]);
  });

  it('supports multiple Roadmap Reviews for one target MVP, ordered newest first', () => {
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, status: 'planned' });
    const older = makeRoadmapReview({ id: 'rr-older', targetMvpId: 'mvp-2', createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = makeRoadmapReview({ id: 'rr-newer', targetMvpId: 'mvp-2', createdAt: '2026-07-10T00:00:00.000Z' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [targetMvp], roadmapReviews: [older, newer], selectedSequence: 2 }),
    );

    expect(view.selected?.roadmapReviews.map((review) => review.id)).toEqual(['rr-newer', 'rr-older']);
  });

  it('never links a Product Review belonging to a different MVP', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1 });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });
    const reviewForMvp2 = makeProductReview({ mvpId: 'mvp-2' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [mvp1, mvp2], productReviews: [reviewForMvp2], selectedSequence: 1 }),
    );

    expect(view.selected?.productReviews).toEqual([]);
  });
});

describe('buildProductEvolutionView — selection fallback', () => {
  it('falls back to the default resolution when the requested selectedSequence no longer matches any timeline entry', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'released' });

    // selectedSequence 99 does not exist in the timeline — must not silently produce `selected: undefined`.
    const view = buildProductEvolutionView(baseInput({ mvps: [mvp1], selectedSequence: 99 }));

    expect(view.selected).toBeDefined();
    expect(view.selected?.entry.sequence).toBe(1);
  });

  it('preserves an explicitly selected MVP that still exists rather than reverting to the default', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'released' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, status: 'scoped' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp1, mvp2], selectedSequence: 1 }));

    // Default resolution would pick MVP2 (active) — an explicit, still-valid selection must win.
    expect(view.selected?.entry.sequence).toBe(1);
  });

  it('preserves an explicitly selected skeleton entry that still exists', () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, status: 'released' });
    const skeletonEntry = makeRoadmapEntry({ sequence: 2 });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [mvp1], roadmapSkeleton: [skeletonEntry], selectedSequence: 2 }),
    );

    expect(view.selected?.entry.kind).toBe('skeleton');
    expect(view.selected?.entry.sequence).toBe(2);
  });
});

describe('buildProductEvolutionView — Roadmap Review source labeling', () => {
  it('resolves the source MVP label for a Roadmap Review from its productReviewId', () => {
    const sourceMvp = makeMvp({ id: 'mvp-1', sequence: 1, code: 'MVP-001', status: 'released' });
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, code: 'MVP-002', status: 'planned' });
    const productReview = makeProductReview({ id: 'product-review-1', mvpId: 'mvp-1' });
    const roadmapReview = makeRoadmapReview({
      id: 'rr-1',
      productReviewId: 'product-review-1',
      targetMvpId: 'mvp-2',
    });

    const view = buildProductEvolutionView(
      baseInput({
        mvps: [sourceMvp, targetMvp],
        productReviews: [productReview],
        roadmapReviews: [roadmapReview],
        selectedSequence: 2,
      }),
    );

    expect(view.selected?.roadmapReviewSourceLabels['rr-1']).toBe('MVP-001');
  });

  it('omits the source label rather than guessing when the source Product Review is not in already-fetched data', () => {
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, code: 'MVP-002', status: 'planned' });
    const roadmapReview = makeRoadmapReview({ id: 'rr-1', productReviewId: 'missing-review', targetMvpId: 'mvp-2' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [targetMvp], roadmapReviews: [roadmapReview], selectedSequence: 2 }),
    );

    expect(view.selected?.roadmapReviewSourceLabels['rr-1']).toBeUndefined();
  });
});

describe('buildProductEvolutionView — legacy and incomplete data', () => {
  it('treats a released MVP with no recorded Product Review as legacy, not an error, and recommends starting one', () => {
    const mvp = makeMvp({ status: 'released' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp] }));

    expect(view.selected?.productReviews).toEqual([]);
    expect(view.nextAction.id).toBe('start-product-review');
  });

  it('does not crash on an MVP with every optional field unset', () => {
    const minimalMvp: Mvp = {
      id: 'mvp-1',
      projectId: 'proj-1',
      sequence: 1,
      status: 'released',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };

    const view = buildProductEvolutionView(baseInput({ mvps: [minimalMvp] }));

    expect(view.timeline[0].code).toBe('MVP-001');
    expect(view.timeline[0].theme).toBeUndefined();
  });

  it('does not crash on a roadmap skeleton entry with only its required fields', () => {
    const minimalEntry: RoadmapSkeletonEntry = { id: 'MVP-002', sequence: 2, theme: 'Billing' };

    const view = buildProductEvolutionView(baseInput({ roadmapSkeleton: [minimalEntry] }));

    expect(view.timeline[0].targetRelease).toBeUndefined();
    expect(view.timeline[0].estimatedEffort).toBeUndefined();
  });
});

describe('buildProductEvolutionView — next action across the approved product flow', () => {
  it('recommends approving the Product Review once it is ready_for_review', () => {
    const mvp = makeMvp({ status: 'released' });
    const review = makeProductReview({ status: 'ready_for_review' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], productReviews: [review] }));

    expect(view.nextAction.id).toBe('approve-product-review');
  });

  it('recommends starting a Roadmap Review once the Product Review is approved', () => {
    const mvp = makeMvp({ status: 'released' });
    const review = makeProductReview({ status: 'approved' });

    const view = buildProductEvolutionView(baseInput({ mvps: [mvp], productReviews: [review] }));

    expect(view.nextAction.id).toBe('start-roadmap-review');
  });

  it('recommends approving the Roadmap Review once it is ready_for_review', () => {
    const mvp = makeMvp({ status: 'released' });
    const review = makeProductReview({ status: 'approved' });
    const roadmapReview = makeRoadmapReview({ productReviewId: 'product-review-1', status: 'ready_for_review' });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [mvp], productReviews: [review], roadmapReviews: [roadmapReview] }),
    );

    expect(view.nextAction.id).toBe('approve-roadmap-review');
  });

  it('reports the roadmap as approved and ready for a future Engineering Gate once the Roadmap Review is approved', () => {
    const sourceMvp = makeMvp({ status: 'released' });
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, code: 'MVP-002', status: 'planned' });
    const review = makeProductReview({ status: 'approved' });
    const roadmapReview = makeRoadmapReview({
      productReviewId: 'product-review-1',
      targetMvpId: 'mvp-2',
      status: 'approved',
    });

    const view = buildProductEvolutionView(
      baseInput({
        mvps: [sourceMvp, targetMvp],
        productReviews: [review],
        roadmapReviews: [roadmapReview],
      }),
    );

    expect(view.nextAction.id).toBe('roadmap-review-approved');
    expect(view.nextAction.label).toContain('MVP-002');
  });

  it('never surfaces Gate A / engineering-transition language in the next action', () => {
    const sourceMvp = makeMvp({ status: 'released' });
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, status: 'planned' });
    const review = makeProductReview({ status: 'approved' });
    const roadmapReview = makeRoadmapReview({
      productReviewId: 'product-review-1',
      targetMvpId: 'mvp-2',
      status: 'approved',
    });

    const view = buildProductEvolutionView(
      baseInput({ mvps: [sourceMvp, targetMvp], productReviews: [review], roadmapReviews: [roadmapReview] }),
    );

    expect(view.nextAction.label.toLowerCase()).not.toContain('gate a');
    expect(view.nextAction.label.toLowerCase()).not.toContain('deploy');
  });
});
