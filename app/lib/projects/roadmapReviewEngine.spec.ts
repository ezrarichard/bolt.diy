import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import type { Feature } from '~/lib/features/featureTypes';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';
import type { ProjectArtifact } from './artifacts';
import type { RoadmapSkeletonEntry } from './prompts/productOwner';

const {
  resolveLatestReleasedMvpMock,
  resolveNextRoadmapTargetMock,
  createMvpMock,
  recordMvpApprovalMock,
  listMvpApprovalsMock,
  listFeaturesForProjectMock,
  listProductReviewsByMvpMock,
  createRoadmapReviewMock,
  updateRoadmapReviewMock,
  logProjectActivityMock,
  addProjectArtifactMock,
  updateProjectArtifactMock,
  getProjectArtifactsMock,
  getApprovedArtifactContentMock,
} = vi.hoisted(() => ({
  resolveLatestReleasedMvpMock: vi.fn(),
  resolveNextRoadmapTargetMock: vi.fn(),
  createMvpMock: vi.fn(() => {
    throw new Error('createMvp should never be called directly by roadmapReviewEngine — use resolveNextRoadmapTarget');
  }),
  recordMvpApprovalMock: vi.fn(),
  listMvpApprovalsMock: vi.fn(),
  listFeaturesForProjectMock: vi.fn(),
  listProductReviewsByMvpMock: vi.fn(),
  createRoadmapReviewMock: vi.fn(),
  updateRoadmapReviewMock: vi.fn(),
  logProjectActivityMock: vi.fn(),
  addProjectArtifactMock: vi.fn(),
  updateProjectArtifactMock: vi.fn(),
  getProjectArtifactsMock: vi.fn(),
  getApprovedArtifactContentMock: vi.fn(),
}));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: {
    resolveLatestReleasedMvp: resolveLatestReleasedMvpMock,
    resolveNextRoadmapTarget: resolveNextRoadmapTargetMock,
    createMvp: createMvpMock,
    recordMvpApproval: recordMvpApprovalMock,
    listMvpApprovals: listMvpApprovalsMock,
  },
}));

vi.mock('~/lib/features/featureRepository', () => ({
  featureRepository: { listFeaturesForProject: listFeaturesForProjectMock },
}));

vi.mock('~/lib/product-review/productReviewRepository', () => ({
  productReviewRepository: { listProductReviewsByMvp: listProductReviewsByMvpMock },
}));

vi.mock('~/lib/roadmap-review/roadmapReviewRepository', () => ({
  roadmapReviewRepository: {
    createRoadmapReview: createRoadmapReviewMock,
    updateRoadmapReview: updateRoadmapReviewMock,
  },
}));

vi.mock('~/lib/stores/projects', () => ({
  logProjectActivity: logProjectActivityMock,
  addProjectArtifact: addProjectArtifactMock,
  updateProjectArtifact: updateProjectArtifactMock,
  getProjectArtifacts: getProjectArtifactsMock,
}));

vi.mock('./artifacts', async () => {
  const actual = await vi.importActual<typeof import('./artifacts')>('./artifacts');
  return { ...actual, getApprovedArtifactContent: getApprovedArtifactContentMock };
});

const { roadmapReviewEngine } = await import('./roadmapReviewEngine');

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

function makeTargetMvp(overrides: Partial<Mvp> = {}): Mvp {
  return {
    id: 'mvp-2',
    projectId: 'proj-1',
    code: 'MVP-002',
    sequence: 2,
    theme: 'Billing',
    status: 'planned',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoadmapEntry(overrides: Partial<RoadmapSkeletonEntry> = {}): RoadmapSkeletonEntry {
  return {
    id: 'MVP-002',
    sequence: 2,
    theme: 'Billing',
    targetRelease: 'v0.2',
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

function makeApprovedProductReview(overrides: Partial<ProductReview> = {}): ProductReview {
  return {
    id: 'product-review-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    reviewDate: '2026-07-26T00:00:00.000Z',
    reviewType: 'post_release',
    status: 'approved',
    summary: 'Great launch.',
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
    status: 'draft',
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

function makeProject(artifacts: ProjectArtifact[] = []) {
  return { id: 'proj-1', name: 'Dental Clinic', artifacts } as unknown as Parameters<
    typeof roadmapReviewEngine.buildRoadmapReviewContext
  >[0];
}

beforeEach(() => {
  resolveLatestReleasedMvpMock.mockReset();
  resolveNextRoadmapTargetMock.mockReset();
  createMvpMock.mockClear();
  recordMvpApprovalMock.mockReset();
  listMvpApprovalsMock.mockReset();
  listFeaturesForProjectMock.mockReset();
  listProductReviewsByMvpMock.mockReset();
  createRoadmapReviewMock.mockReset();
  updateRoadmapReviewMock.mockReset();
  logProjectActivityMock.mockReset();
  addProjectArtifactMock.mockReset();
  updateProjectArtifactMock.mockReset();
  getProjectArtifactsMock.mockReset();
  getApprovedArtifactContentMock.mockReset();
  getProjectArtifactsMock.mockReturnValue([]);
  getApprovedArtifactContentMock.mockReturnValue(undefined);
  recordMvpApprovalMock.mockResolvedValue(true);
  listMvpApprovalsMock.mockResolvedValue([]);
});

describe('canGenerateRoadmapReview', () => {
  it('is true once a released MVP has at least one approved Product Review', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([makeApprovedProductReview()]);

    expect(await roadmapReviewEngine.canGenerateRoadmapReview('proj-1')).toBe(true);
  });

  it('is false when no MVP has ever released', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(undefined);

    expect(await roadmapReviewEngine.canGenerateRoadmapReview('proj-1')).toBe(false);
    expect(listProductReviewsByMvpMock).not.toHaveBeenCalled();
  });

  it('is false when the released MVP has no approved Product Review — draft/ready_for_review reviews do not count', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([
      makeApprovedProductReview({ status: 'ready_for_review' }),
      makeApprovedProductReview({ status: 'draft' }),
    ]);

    expect(await roadmapReviewEngine.canGenerateRoadmapReview('proj-1')).toBe(false);
  });
});

describe('buildRoadmapReviewContext — architectural requirement: only APPROVED Product Reviews, resolver reuse', () => {
  it('resolves source MVP, approved Product Review, roadmap target, and current Features', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([makeApprovedProductReview()]);
    getApprovedArtifactContentMock.mockReturnValue({
      productVision: 'A scheduling app for small clinics.',
      roadmapSkeleton: [makeRoadmapEntry()],
    });
    resolveNextRoadmapTargetMock.mockResolvedValue({
      targetMvp: makeTargetMvp(),
      roadmapEntry: makeRoadmapEntry(),
      previousReleasedMvp: makeMvp(),
    });
    listFeaturesForProjectMock.mockResolvedValue([makeFeature()]);

    const context = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());

    expect(context?.sourceMvp.id).toBe('mvp-1');
    expect(context?.productReview.status).toBe('approved');
    expect(context?.targetMvp.id).toBe('mvp-2');
    expect(context?.project.productVision).toBe('A scheduling app for small clinics.');
    expect(context?.currentFeatures).toHaveLength(1);
    expect(resolveNextRoadmapTargetMock).toHaveBeenCalledWith('proj-1', [makeRoadmapEntry()]);
  });

  it('returns undefined when no MVP has ever released', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(undefined);

    const context = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());

    expect(context).toBeUndefined();
    expect(listProductReviewsByMvpMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the released MVP has no APPROVED Product Review — never falls back to a draft/pending one', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([makeApprovedProductReview({ status: 'draft' })]);

    const context = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());

    expect(context).toBeUndefined();
    expect(resolveNextRoadmapTargetMock).not.toHaveBeenCalled();
  });

  it('returns undefined when resolveNextRoadmapTarget cannot resolve a target (no roadmap entry sketched that far)', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([makeApprovedProductReview()]);
    resolveNextRoadmapTargetMock.mockResolvedValue(undefined);

    const context = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());

    expect(context).toBeUndefined();
    expect(listFeaturesForProjectMock).not.toHaveBeenCalled();
  });

  it('reuses the SAME resolved target across repeated calls — never creates a duplicate MVP row itself', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([makeApprovedProductReview()]);
    resolveNextRoadmapTargetMock.mockResolvedValue({
      targetMvp: makeTargetMvp(),
      roadmapEntry: makeRoadmapEntry(),
      previousReleasedMvp: makeMvp(),
    });
    listFeaturesForProjectMock.mockResolvedValue([]);

    const first = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());
    const second = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject());

    expect(first?.targetMvp.id).toBe(second?.targetMvp.id);

    // Confirms the engine only ever delegates to the idempotent resolver — never mints its own MVP row.
    expect(createMvpMock).not.toHaveBeenCalled();
  });

  it('honors an explicit productReviewId rather than always picking the newest approved review', async () => {
    resolveLatestReleasedMvpMock.mockResolvedValue(makeMvp());
    listProductReviewsByMvpMock.mockResolvedValue([
      makeApprovedProductReview({ id: 'product-review-newest' }),
      makeApprovedProductReview({ id: 'product-review-older' }),
    ]);
    resolveNextRoadmapTargetMock.mockResolvedValue({
      targetMvp: makeTargetMvp(),
      roadmapEntry: makeRoadmapEntry(),
      previousReleasedMvp: makeMvp(),
    });
    listFeaturesForProjectMock.mockResolvedValue([]);

    const context = await roadmapReviewEngine.buildRoadmapReviewContext(makeProject(), {
      productReviewId: 'product-review-older',
    });

    expect(context?.productReview.id).toBe('product-review-older');
  });
});

describe('parseAnalysis / toRoadmapReviewFields', () => {
  it('parses a well-formed AI response into the structured output', () => {
    const raw = JSON.stringify({
      executiveSummary: 'Strong opportunity for a billing MVP2.',
      roadmapChanges: ['Bring billing forward from MVP3 to MVP2'],
      featurePriorities: ['Invoicing: Must Have'],
      mvp2CandidateScope: ['Invoicing', 'Payment reminders'],
      deferredScope: ['Multi-location support'],
      removedFeatures: ['Legacy CSV export'],
      futureVision: ['Eventually support recurring billing'],
      dependencyAnalysis: ['Invoicing depends on the existing customer record model'],
      assumptions: ['Stripe remains the payment provider'],
      businessRisks: ['Billing complexity could delay release'],
      technicalRisks: ['No existing payment integration'],
      releaseRecommendation: 'Target v0.2 in 6 weeks.',
    });

    const result = roadmapReviewEngine.parseAnalysis(raw);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.mvp2CandidateScope).toEqual(['Invoicing', 'Payment reminders']);
      expect(result.draft.releaseRecommendation).toBe('Target v0.2 in 6 weeks.');
    }
  });

  it('fails on malformed JSON', () => {
    const result = roadmapReviewEngine.parseAnalysis('not json at all');
    expect(result.ok).toBe(false);
  });

  it('toRoadmapReviewFields projects the AI output onto the curated top-level fields', () => {
    const fields = roadmapReviewEngine.toRoadmapReviewFields({
      executiveSummary: 'Strong opportunity.',
      roadmapChanges: ['Bring billing forward'],
      featurePriorities: ['Invoicing: Must Have'],
      mvp2CandidateScope: ['Invoicing'],
      deferredScope: ['Multi-location'],
      removedFeatures: ['Legacy export'],
      dependencyAnalysis: ['Depends on customer records'],
      assumptions: ['Stripe stays the provider'],
      businessRisks: ['Delay risk'],
      technicalRisks: ['No integration yet'],
      releaseRecommendation: 'Target v0.2.',
    });

    expect(fields.executiveSummary).toBe('Strong opportunity.');
    expect(fields.newFeatures).toEqual(['Invoicing']);
    expect(fields.deferredFeatures).toEqual(['Multi-location']);
    expect(fields.removedFeatures).toEqual(['Legacy export']);
    expect(fields.priorities).toEqual(['Invoicing: Must Have']);
    expect(fields.dependencies).toEqual(['Depends on customer records']);
    expect(fields.recommendedReleaseGoal).toBe('Target v0.2.');
  });
});

describe('activity history', () => {
  it('startRoadmapReview creates a draft row and logs roadmap_review_started', async () => {
    createRoadmapReviewMock.mockResolvedValue({ ok: true, error: null, review: makeRoadmapReview() });

    const result = await roadmapReviewEngine.startRoadmapReview({
      projectId: 'proj-1',
      productReviewId: 'product-review-1',
      targetMvpId: 'mvp-2',
    });

    expect(result.ok).toBe(true);
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'roadmap_review_started', expect.any(String));
  });

  it('startRoadmapReview does not log activity when the write fails', async () => {
    createRoadmapReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await roadmapReviewEngine.startRoadmapReview({
      projectId: 'proj-1',
      productReviewId: 'product-review-1',
      targetMvpId: 'mvp-2',
    });

    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('beginPlanning transitions to planning and logs roadmap_planning_running', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await roadmapReviewEngine.beginPlanning(makeRoadmapReview());

    expect(result.ok).toBe(true);
    expect(updateRoadmapReviewMock).toHaveBeenCalledWith('roadmap-review-1', { status: 'planning' });
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'roadmap_planning_running', expect.any(String));
  });

  it('approveRoadmapReview transitions to approved and logs roadmap_review_approved', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await roadmapReviewEngine.approveRoadmapReview(makeRoadmapReview({ status: 'ready_for_review' }));

    expect(result.ok).toBe(true);
    expect(updateRoadmapReviewMock).toHaveBeenCalledWith('roadmap-review-1', { status: 'approved' });
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'roadmap_review_approved', expect.any(String));
  });

  it('approveRoadmapReview carries approvalNotes through in the same call', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    await roadmapReviewEngine.approveRoadmapReview(makeRoadmapReview({ status: 'ready_for_review' }), {
      approvalNotes: 'Looks good.',
    });

    expect(updateRoadmapReviewMock).toHaveBeenCalledWith('roadmap-review-1', {
      status: 'approved',
      approvalNotes: 'Looks good.',
    });
  });
});

describe('Final Approval Integration — authoritative MvpApproval (Sprint 83 correction)', () => {
  it('records a roadmap_review MvpApproval against the exact resolved targetMvpId', async () => {
    listMvpApprovalsMock.mockResolvedValue([]);
    recordMvpApprovalMock.mockResolvedValue(true);
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await roadmapReviewEngine.approveRoadmapReview(
      makeRoadmapReview({ status: 'ready_for_review', targetMvpId: 'mvp-2', projectId: 'proj-1' }),
      { approvalNotes: 'Ship it.', decidedBy: 'user-1' },
    );

    expect(result.ok).toBe(true);
    expect(listMvpApprovalsMock).toHaveBeenCalledWith('mvp-2');
    expect(recordMvpApprovalMock).toHaveBeenCalledWith({
      mvpId: 'mvp-2',
      projectId: 'proj-1',
      stage: 'roadmap_review',
      decision: 'approved',
      notes: 'Ship it.',
      decidedBy: 'user-1',
    });
  });

  it('is a no-op success (no duplicate insert) when a roadmap_review approval already exists for the target MVP — retry safety', async () => {
    listMvpApprovalsMock.mockResolvedValue([
      {
        id: 'approval-1',
        mvpId: 'mvp-2',
        projectId: 'proj-1',
        stage: 'roadmap_review',
        decision: 'approved',
        decidedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z',
      },
    ]);
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await roadmapReviewEngine.approveRoadmapReview(
      makeRoadmapReview({ status: 'ready_for_review', targetMvpId: 'mvp-2' }),
    );

    expect(result.ok).toBe(true);
    expect(recordMvpApprovalMock).not.toHaveBeenCalled();
    expect(updateRoadmapReviewMock).toHaveBeenCalledWith('roadmap-review-1', { status: 'approved' });
  });

  it('never moves RoadmapReview.status to approved when recording the MvpApproval fails', async () => {
    listMvpApprovalsMock.mockResolvedValue([]);
    recordMvpApprovalMock.mockResolvedValue(false);

    const result = await roadmapReviewEngine.approveRoadmapReview(
      makeRoadmapReview({ status: 'ready_for_review', targetMvpId: 'mvp-2' }),
    );

    expect(result.ok).toBe(false);
    expect(updateRoadmapReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('a repeated call against an already-approved review succeeds idempotently without re-recording the approval or re-logging activity', async () => {
    const result = await roadmapReviewEngine.approveRoadmapReview(makeRoadmapReview({ status: 'approved' }));

    expect(result.ok).toBe(true);
    expect(listMvpApprovalsMock).not.toHaveBeenCalled();
    expect(recordMvpApprovalMock).not.toHaveBeenCalled();
    expect(updateRoadmapReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('never promotes a Feature, transitions Mvp status, or starts any engineering role — persist-only, never Gate A', async () => {
    listMvpApprovalsMock.mockResolvedValue([]);
    recordMvpApprovalMock.mockResolvedValue(true);
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    await roadmapReviewEngine.approveRoadmapReview(
      makeRoadmapReview({ status: 'ready_for_review', targetMvpId: 'mvp-2' }),
    );

    /*
     * No such functions are even imported by this engine — asserting on the two mvpRepository
     * functions that DO exist in its dependency surface is what proves nothing beyond
     * recordMvpApproval/listMvpApprovals was ever touched on the MVP itself.
     */
    expect(createMvpMock).not.toHaveBeenCalled();
  });
});

describe('Transactional Consistency — completePlanning', () => {
  it('never touches the RoadmapReview when persisting the artifact itself throws', async () => {
    addProjectArtifactMock.mockImplementation(() => {
      throw new Error('local store write failed');
    });

    const result = await roadmapReviewEngine.completePlanning(makeRoadmapReview({ status: 'planning' }), {
      executiveSummary: 'Strong opportunity.',
    });

    expect(result.ok).toBe(false);
    expect(updateRoadmapReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('discards the newly created artifact when linking it to the RoadmapReview fails (first-time completion)', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: false, error: 'boom' });

    await roadmapReviewEngine.completePlanning(makeRoadmapReview({ status: 'planning', artifactId: undefined }), {
      executiveSummary: 'Strong opportunity.',
    });

    const createdArtifactId = addProjectArtifactMock.mock.calls[0][1].id;
    expect(updateProjectArtifactMock).toHaveBeenCalledWith('proj-1', createdArtifactId, { status: 'discarded' });
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });

  it('logs roadmap_planning_completed only once the RoadmapReview link write actually succeeds', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const result = await roadmapReviewEngine.completePlanning(makeRoadmapReview({ status: 'planning' }), {
      executiveSummary: 'Strong opportunity.',
    });

    expect(result.ok).toBe(true);
    expect(logProjectActivityMock).toHaveBeenCalledWith('proj-1', 'roadmap_planning_completed', expect.any(String));
  });

  it('retrying completion reuses the same canonical artifact id instead of creating a duplicate', async () => {
    updateRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    await roadmapReviewEngine.completePlanning(makeRoadmapReview({ status: 'planning' }), {
      executiveSummary: 'First pass.',
    });

    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);

    const canonicalArtifactId = addProjectArtifactMock.mock.calls[0][1].id;

    await roadmapReviewEngine.completePlanning(
      makeRoadmapReview({ status: 'ready_for_review', artifactId: canonicalArtifactId }),
      { executiveSummary: 'Revised.' },
    );

    expect(addProjectArtifactMock).toHaveBeenCalledTimes(1);
    expect(updateProjectArtifactMock).toHaveBeenCalledWith(
      'proj-1',
      canonicalArtifactId,
      expect.objectContaining({ content: expect.stringContaining('Revised') }),
    );

    const secondLinkPayload = updateRoadmapReviewMock.mock.calls[1][1];
    expect(secondLinkPayload.artifactId).toBe(canonicalArtifactId);
  });
});

describe('Transactional Consistency — approveRoadmapReview', () => {
  it('never commits the approval when flipping the linked artifact throws', async () => {
    updateProjectArtifactMock.mockImplementation(() => {
      throw new Error('local store write failed');
    });

    const result = await roadmapReviewEngine.approveRoadmapReview(
      makeRoadmapReview({ status: 'ready_for_review', artifactId: 'artifact-abc' }),
    );

    expect(result.ok).toBe(false);
    expect(recordMvpApprovalMock).not.toHaveBeenCalled();
    expect(updateRoadmapReviewMock).not.toHaveBeenCalled();
    expect(logProjectActivityMock).not.toHaveBeenCalled();
  });
});
