import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import type { Feature } from '~/lib/features/featureTypes';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';

const {
  resolveLatestReleasedMvpMock,
  listFeaturesForMvpMock,
  createProductReviewMock,
  updateProductReviewMock,
  logProjectActivityMock,
  addProjectArtifactMock,
  updateProjectArtifactMock,
} = vi.hoisted(() => ({
  resolveLatestReleasedMvpMock: vi.fn(),
  listFeaturesForMvpMock: vi.fn(),
  createProductReviewMock: vi.fn(),
  updateProductReviewMock: vi.fn(),
  logProjectActivityMock: vi.fn(),
  addProjectArtifactMock: vi.fn(),
  updateProjectArtifactMock: vi.fn(),
}));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: { resolveLatestReleasedMvp: resolveLatestReleasedMvpMock },
}));

vi.mock('~/lib/features/featureRepository', () => ({
  featureRepository: { listFeaturesForMvp: listFeaturesForMvpMock },
}));

vi.mock('~/lib/product-review/productReviewRepository', () => ({
  productReviewRepository: {
    createProductReview: createProductReviewMock,
    updateProductReview: updateProductReviewMock,
  },
}));

vi.mock('~/lib/stores/projects', () => ({
  logProjectActivity: logProjectActivityMock,
  addProjectArtifact: addProjectArtifactMock,
  updateProjectArtifact: updateProjectArtifactMock,
}));

const { productReviewEngine } = await import('./productReviewEngine');

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

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feature-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    code: 'FEAT-001',
    moduleSlug: 'FEAT-001',
    title: 'Book an appointment',
    dependsOn: [],
    status: 'deployed',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<ProductReview> = {}): ProductReview {
  return {
    id: 'review-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    reviewDate: '2026-07-26T00:00:00.000Z',
    reviewType: 'post_release',
    status: 'draft',
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

beforeEach(() => {
  resolveLatestReleasedMvpMock.mockReset();
  listFeaturesForMvpMock.mockReset();
  createProductReviewMock.mockReset();
  updateProductReviewMock.mockReset();
  logProjectActivityMock.mockReset();
  addProjectArtifactMock.mockReset();
  updateProjectArtifactMock.mockReset();
});

describe('canGenerateProductReview', () => {
  it('is true once an MVP has released', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    expect(await productReviewEngine.canGenerateProductReview('proj-1')).toBe(true);
  });

  it('is false when no MVP has ever released', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(undefined);
    expect(await productReviewEngine.canGenerateProductReview('proj-1')).toBe(false);
  });
});

describe('buildProductReviewContext', () => {
  it('resolves the released MVP and its shipped Features', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listFeaturesForMvpMock.mockResolvedValue([makeFeature()]);

    const context = await productReviewEngine.buildProductReviewContext(
      { id: 'proj-1', name: 'Dental Clinic' },
      { customerFeedback: ['Loved the booking flow'] },
    );

    expect(context?.mvp.id).toBe('mvp-1');
    expect(context?.features).toHaveLength(1);
    expect(context?.customerFeedback).toEqual(['Loved the booking flow']);
    expect(context?.businessGoals).toEqual([]);
  });

  it('returns undefined when no MVP has ever released', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(undefined);

    const context = await productReviewEngine.buildProductReviewContext({ id: 'proj-1', name: 'Dental Clinic' });

    expect(context).toBeUndefined();
    expect(listFeaturesForMvpMock).not.toHaveBeenCalled();
  });
});

describe('parseAnalysis', () => {
  it('parses a well-formed AI response into the structured output', () => {
    const raw = JSON.stringify({
      executiveSummary: 'The MVP shipped successfully and customers are booking appointments.',
      businessSuccesses: ['Booking conversion up 20%'],
      customerPainPoints: ['Reminder emails arrive too late'],
      requestedImprovements: ['SMS reminders'],
      missingFeatures: ['Waitlist'],
      businessRisks: ['Single clinic dependency'],
      technicalRisks: ['No load testing yet'],
      complianceObservations: ['HIPAA review pending'],
      uxObservations: ['Booking flow has too many steps'],
      performanceObservations: ['Slow on mobile during peak hours'],
      recommendedPriorities: ['Fix reminder timing'],
      potentialFutureMvpScope: ['Multi-location support'],
    });

    const result = productReviewEngine.parseAnalysis(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.executiveSummary).toContain('shipped successfully');
      expect(result.draft.businessRisks).toEqual(['Single clinic dependency']);
      expect(result.draft.potentialFutureMvpScope).toEqual(['Multi-location support']);
    }
  });

  it('fails on malformed JSON', () => {
    const result = productReviewEngine.parseAnalysis('not json at all');
    expect(result.ok).toBe(false);
  });
});

describe('toProductReviewFields', () => {
  it('projects the 12-section AI output onto the curated top-level fields', () => {
    const fields = productReviewEngine.toProductReviewFields({
      executiveSummary: 'Solid launch.',
      businessSuccesses: ['Strong adoption'],
      requestedImprovements: ['Faster search'],
      missingFeatures: ['Export to CSV'],
      businessRisks: ['Customer concentration'],
      technicalRisks: ['No monitoring'],
      complianceObservations: ['GDPR gap'],
      performanceObservations: ['Slow reports page'],
      recommendedPriorities: ['Add monitoring'],
      potentialFutureMvpScope: ['Analytics dashboard'],
    });

    expect(fields.summary).toBe('Solid launch.');
    expect(fields.recommendations).toEqual(['Add monitoring']);
    expect(fields.businessRisks).toEqual(['Customer concentration']);
    expect(fields.opportunities).toEqual(['Strong adoption', 'Analytics dashboard']);
    expect(fields.featureRequests).toEqual(['Faster search', 'Export to CSV']);
    expect(fields.technicalConcerns).toEqual(['No monitoring', 'GDPR gap', 'Slow reports page']);
  });
});

describe('activity history', () => {
  it('startProductReview creates a draft row and logs product_review_started', async () => {
    createProductReviewMock.mockResolvedValue({ ok: true, error: null, review: makeReview() });

    const result = await productReviewEngine.startProductReview({ projectId: 'proj-1', mvpId: 'mvp-1' });

    expect(result.ok).toBe(true);
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'product_review_started', expect.any(String));
  });

  it('startProductReview does not log activity when the write fails', async () => {
    createProductReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await productReviewEngine.startProductReview({ projectId: 'proj-1', mvpId: 'mvp-1' });

    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('beginAnalysis transitions to analysing and logs business_analysis_running', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await productReviewEngine.beginAnalysis(makeReview());

    expect(result.ok).toBe(true);
    expect(updateProductReviewMock).toHaveBeenCalledWith('review-1', { status: 'analysing' });
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'business_analysis_running', expect.any(String));
  });

  it('completeAnalysis persists curated fields, moves to ready_for_review, and logs business_analysis_completed', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'Great launch.',
      recommendedPriorities: ['Ship SMS reminders'],
    });

    expect(result.ok).toBe(true);
    expect(updateProductReviewMock).toHaveBeenCalledWith(
      'review-1',
      expect.objectContaining({
        status: 'ready_for_review',
        summary: 'Great launch.',
        recommendations: ['Ship SMS reminders'],
        artifactId: expect.any(String),
      }),
    );
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'business_analysis_completed', expect.any(String));
  });

  it('approveProductReview transitions to approved and logs product_review_approved', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await productReviewEngine.approveProductReview(makeReview({ status: 'ready_for_review' }));

    expect(result.ok).toBe(true);
    expect(updateProductReviewMock).toHaveBeenCalledWith('review-1', { status: 'approved' });
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'product_review_approved', expect.any(String));
  });

  it('propagates the immutable-review domain error instead of logging activity', async () => {
    updateProductReviewMock.mockResolvedValue({
      ok: false,
      error: 'Product Review is approved (or archived) and immutable — business content can no longer be modified.',
    });

    const result = await productReviewEngine.completeAnalysis(makeReview({ status: 'approved' }), {
      executiveSummary: 'Attempted edit after approval.',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('immutable');
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });
});

describe('Transactional Consistency Review — completeAnalysis (Sprint 82)', () => {
  it('never touches the ProductReview when persisting the artifact itself throws', async () => {
    addProjectArtifactMock.mockImplementation(() => {
      throw new Error('local store write failed');
    });

    const result = await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'Great launch.',
    });

    expect(result.ok).toBe(false);
    expect(updateProductReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('discards the newly created artifact when linking it to the ProductReview fails (first-time completion)', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: false, error: 'Invalid Product Review status transition' });

    const result = await productReviewEngine.completeAnalysis(makeReview({ status: 'draft', artifactId: undefined }), {
      executiveSummary: 'Great launch.',
    });

    expect(result.ok).toBe(false);
    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);

    const createdArtifactId = addProjectArtifactMock.mock.calls[0][1].id;

    expect(updateProjectArtifactMock).toHaveBeenCalledWith('proj-1', createdArtifactId, { status: 'discarded' });
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('does not discard anything when a RETRY completion fails to link — the canonical artifact/link is unchanged', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await productReviewEngine.completeAnalysis(
      makeReview({ status: 'ready_for_review', artifactId: 'artifact-existing' }),
      {
        executiveSummary: 'Revised analysis.',
      },
    );

    expect(updateProjectArtifactMock).not.toHaveBeenCalledWith('proj-1', 'artifact-existing', { status: 'discarded' });
  });

  it('logs business_analysis_completed only once the ProductReview link write actually succeeds', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'Great launch.',
    });

    expect(logProjectActivityMock).not.toHaveBeenCalled();

    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'Great launch, take two.',
    });

    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'business_analysis_completed', expect.any(String));
  });

  it('retrying completion reuses the same canonical artifact id instead of creating a duplicate', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const firstResult = await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'First pass.',
    });

    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);

    const canonicalArtifactId = addProjectArtifactMock.mock.calls[0][1].id;
    expect((firstResult as { ok: boolean }).ok).toBe(true);

    // Retry: the review now carries the artifactId the first call linked.
    await productReviewEngine.completeAnalysis(
      makeReview({ status: 'ready_for_review', artifactId: canonicalArtifactId }),
      { executiveSummary: 'Revised after more feedback came in.' },
    );

    // Still only ONE addProjectArtifact call ever — the retry updated the existing artifact in place.
    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);
    expect(updateProjectArtifactMock).toHaveBeenCalledWith(
      'proj-1',
      canonicalArtifactId,
      expect.objectContaining({ content: expect.stringContaining('Revised after more feedback') }),
    );

    const secondLinkPayload = updateProductReviewMock.mock.calls[1][1];
    expect(secondLinkPayload.artifactId).toBe(canonicalArtifactId);
  });
});

describe('Transactional Consistency Review — approveProductReview (Sprint 82)', () => {
  it('never commits the approval when flipping the linked artifact throws', async () => {
    updateProjectArtifactMock.mockImplementation(() => {
      throw new Error('local store write failed');
    });

    const result = await productReviewEngine.approveProductReview(
      makeReview({ status: 'ready_for_review', artifactId: 'artifact-abc' }),
    );

    expect(result.ok).toBe(false);
    expect(updateProductReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('logs product_review_approved only once the ProductReview approval write actually succeeds', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await productReviewEngine.approveProductReview(
      makeReview({ status: 'ready_for_review', artifactId: 'artifact-abc' }),
    );

    expect(logProjectActivityMock).not.toHaveBeenCalled();

    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await productReviewEngine.approveProductReview(
      makeReview({ status: 'ready_for_review', artifactId: 'artifact-abc' }),
    );

    expect(result.ok).toBe(true);
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'product_review_approved', expect.any(String));
  });
});

describe('Business Analyst artifact persistence (Sprint 82 polish)', () => {
  it('buildProductReviewArtifact builds a PRODUCT_REVIEW_ANALYSIS artifact holding the full analysis verbatim', () => {
    const analysis = {
      executiveSummary: 'Great launch.',
      businessRisks: ['Customer concentration'],
      recommendedPriorities: ['Add monitoring'],
    };

    const artifact = productReviewEngine.buildProductReviewArtifact(makeReview(), analysis);

    expect(artifact.type).toBe('product-review-analysis');
    expect(artifact.generatedBy).toBe('AI Business Analyst');
    expect(artifact.status).toBe('draft');
    expect(artifact.mvpId).toBe('mvp-1');
    expect(JSON.parse(artifact.content)).toEqual(analysis);
  });

  it('completeAnalysis persists the artifact locally and links it to the review via artifactId', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    await productReviewEngine.completeAnalysis(makeReview({ status: 'analysing' }), {
      executiveSummary: 'Great launch.',
    });

    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);

    const [projectId, artifact] = addProjectArtifactMock.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(artifact.type).toBe('product-review-analysis');
    expect(artifact.mvpId).toBe('mvp-1');

    const [, updatePayload] = updateProductReviewMock.mock.calls[0];
    expect(updatePayload.artifactId).toBe(artifact.id);
  });

  it('approveProductReview flips the linked artifact to approved status', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    await productReviewEngine.approveProductReview(
      makeReview({ status: 'ready_for_review', artifactId: 'artifact-abc' }),
    );

    expect(updateProjectArtifactMock).toHaveBeenCalledWith('proj-1', 'artifact-abc', { status: 'approved' });
  });

  it('approveProductReview does not touch an artifact when the review never completed analysis', async () => {
    updateProductReviewMock.mockResolvedValue({ ok: true, error: null });

    await productReviewEngine.approveProductReview(makeReview({ status: 'ready_for_review', artifactId: undefined }));

    expect(updateProjectArtifactMock).not.toHaveBeenCalled();
  });
});
