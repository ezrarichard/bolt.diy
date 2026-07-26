// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { Mvp, MvpApproval } from '~/lib/mvp/mvpTypes';
import type { Feature } from '~/lib/features/featureTypes';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';
import type { ProjectArtifact } from '~/lib/projects/artifacts';
import { ARTIFACT_TYPES } from '~/lib/projects/artifacts';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';

const {
  listMvpsForProjectMock,
  listMvpApprovalsMock,
  listFeaturesForProjectMock,
  listProductReviewsMock,
  listRoadmapReviewsMock,
  approveRoadmapReviewMock,
} = vi.hoisted(() => ({
  listMvpsForProjectMock: vi.fn(),
  listMvpApprovalsMock: vi.fn(),
  listFeaturesForProjectMock: vi.fn(),
  listProductReviewsMock: vi.fn(),
  listRoadmapReviewsMock: vi.fn(),
  approveRoadmapReviewMock: vi.fn(),
}));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: {
    listMvpsForProject: listMvpsForProjectMock,
    listMvpApprovals: listMvpApprovalsMock,
  },
}));

vi.mock('~/lib/features/featureRepository', () => ({
  featureRepository: { listFeaturesForProject: listFeaturesForProjectMock },
}));

vi.mock('~/lib/product-review/productReviewRepository', () => ({
  productReviewRepository: { listProductReviews: listProductReviewsMock },
}));

vi.mock('~/lib/roadmap-review/roadmapReviewRepository', () => ({
  roadmapReviewRepository: { listRoadmapReviews: listRoadmapReviewsMock },
}));

vi.mock('~/lib/projects/roadmapReviewEngine', () => ({
  roadmapReviewEngine: { approveRoadmapReview: approveRoadmapReviewMock },
}));

vi.mock('~/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

const { ProductWorkspacePanel } = await import('./ProductWorkspacePanel');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    ...overrides,
  } as Project;
}

function makeOwnerDraftArtifact(draft: ProductOwnerDraft): ProjectArtifact {
  return {
    id: 'artifact-owner-1',
    taskId: 'requirements',
    title: 'Product Owner Draft v1',
    type: ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'approved',
    content: JSON.stringify(draft),
    generatedBy: 'AI Product Owner',
    version: 1,
  };
}

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

beforeEach(() => {
  listMvpsForProjectMock.mockReset().mockResolvedValue([]);
  listMvpApprovalsMock.mockReset().mockResolvedValue([]);
  listFeaturesForProjectMock.mockReset().mockResolvedValue([]);
  listProductReviewsMock.mockReset().mockResolvedValue([]);
  listRoadmapReviewsMock.mockReset().mockResolvedValue([]);
  approveRoadmapReviewMock.mockReset();
});

describe('ProductWorkspacePanel — empty state', () => {
  it('shows the no-MVP empty state when the project has no committed MVP and no roadmap skeleton', async () => {
    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() =>
      expect(screen.getByText('The Product Roadmap will appear after MVP1 is approved.')).toBeTruthy(),
    );
  });
});

describe('ProductWorkspacePanel — loading and error', () => {
  it('shows a loading state before data resolves', () => {
    listMvpsForProjectMock.mockReturnValue(new Promise(() => {})); // never resolves

    render(<ProductWorkspacePanel project={makeProject()} />);

    expect(screen.getByText('Loading your Product Roadmap…')).toBeTruthy();
  });

  it('shows an inline error with a retry action when a repository call fails, with no destructive reset', async () => {
    listMvpsForProjectMock.mockRejectedValue(new Error('network down'));

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(screen.getByText("Couldn't load your Product Roadmap")).toBeTruthy());
    expect(screen.getByText('network down')).toBeTruthy();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    listMvpsForProjectMock.mockResolvedValue([makeMvp()]);
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText('MVP1')).toBeTruthy());
  });
});

describe('ProductWorkspacePanel — unreleased MVP1', () => {
  it('shows MVP1 in the timeline and explains Product Review is unavailable until release', async () => {
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'scoped' })]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(screen.getByText('MVP1')).toBeTruthy());
    expect(screen.getByText('Finish building and release your first MVP to start your Product Roadmap.')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Reviews/ }));
    expect(screen.getByText('No Product Review recorded for this release yet.')).toBeTruthy();
  });
});

describe('ProductWorkspacePanel — released MVP with no reviews (legacy-safe)', () => {
  it('treats a released MVP with no Product Review as a normal state, not an error', async () => {
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'released' })]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Reviews/ })).toBeTruthy());
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Reviews/ }));

    expect(screen.getByText('No Product Review recorded for this release yet.')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your Product Roadmap")).toBeNull();
  });
});

describe('ProductWorkspacePanel — Product Review / Roadmap Review rendering', () => {
  it('renders a Product Review for the live MVP', async () => {
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'released' })]);
    listProductReviewsMock.mockResolvedValue([makeProductReview({ status: 'ready_for_review' })]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Reviews/ })).toBeTruthy());
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Reviews/ }));

    expect(await screen.findByText('Product Review')).toBeTruthy();
    expect(screen.getByText('Great launch.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Approve Product Review/i })).toBeTruthy();
  });

  it('renders a Roadmap Review for the target MVP', async () => {
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 2, code: 'MVP-002', status: 'planned' });
    listMvpsForProjectMock.mockResolvedValue([targetMvp]);
    listRoadmapReviewsMock.mockResolvedValue([
      makeRoadmapReview({ targetMvpId: 'mvp-2', executiveSummary: 'Billing MVP2 plan.' }),
    ]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Reviews/ })).toBeTruthy());
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Reviews/ }));

    expect(await screen.findByText('Roadmap Review')).toBeTruthy();
    expect(screen.getByText('Billing MVP2 plan.')).toBeTruthy();
  });
});

describe('ProductWorkspacePanel — timeline selection', () => {
  it('lets the user select a different committed MVP and updates the detail view', async () => {
    const mvp1 = makeMvp({ id: 'mvp-1', sequence: 1, code: 'MVP-001', theme: 'Core booking', status: 'released' });
    const mvp2 = makeMvp({ id: 'mvp-2', sequence: 2, code: 'MVP-002', theme: 'Billing', status: 'scoped' });
    listMvpsForProjectMock.mockResolvedValue([mvp1, mvp2]);
    listFeaturesForProjectMock.mockResolvedValue([
      makeFeature({ id: 'f1', mvpId: 'mvp-1', code: 'FEAT-001', title: 'Book appointment' }),
      makeFeature({ id: 'f2', mvpId: 'mvp-2', code: 'FEAT-002', title: 'Send invoice' }),
    ]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    // Defaults to the active MVP (MVP2, since it's not planned/superseded and is the highest sequence).
    await waitFor(() => expect(screen.getByText('MVP-002 — Billing')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /MVP-001/ }));

    await waitFor(() => expect(screen.getByText('MVP-001 — Core booking')).toBeTruthy());
  });

  it('selecting a skeleton-only future MVP shows its roadmap-skeleton info without Features/Reviews/Approvals', async () => {
    const draft: ProductOwnerDraft = {
      roadmapSkeleton: [{ id: 'MVP-002', sequence: 2, theme: 'Billing', estimatedEffort: 'medium' }],
    };
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'released' })]);

    render(<ProductWorkspacePanel project={makeProject({ artifacts: [makeOwnerDraftArtifact(draft)] })} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /MVP-002/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /MVP-002/ }));

    await waitFor(() => expect(screen.getByText(/This is a future MVP sketched in the roadmap/)).toBeTruthy());
    expect(screen.getByText('Estimated effort: medium')).toBeTruthy();
  });
});

describe('ProductWorkspacePanel — approvals for the selected MVP', () => {
  it('fetches and displays MvpApproval rows scoped to the selected MVP only', async () => {
    listMvpsForProjectMock.mockResolvedValue([makeMvp({ status: 'released' })]);

    const approval: MvpApproval = {
      id: 'approval-1',
      mvpId: 'mvp-1',
      projectId: 'proj-1',
      stage: 'scope',
      decision: 'approved',
      decidedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    listMvpApprovalsMock.mockResolvedValue([approval]);

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(listMvpApprovalsMock).toHaveBeenCalledWith('mvp-1'));

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Approvals/ }));
    expect(await screen.findByText('Gate A — Scope Approval')).toBeTruthy();
  });

  it('re-fetches MvpApproval rows after a Roadmap Review approval even though the selected MVP id never changes (no stale roadmap_review approval state)', async () => {
    // The only MVP is the Roadmap Review's own target — it stays selected before and after approval.
    const targetMvp = makeMvp({ id: 'mvp-2', sequence: 1, code: 'MVP-002', status: 'planned' });
    listMvpsForProjectMock.mockResolvedValue([targetMvp]);
    listRoadmapReviewsMock.mockResolvedValue([makeRoadmapReview({ targetMvpId: 'mvp-2', status: 'ready_for_review' })]);
    listMvpApprovalsMock.mockResolvedValue([]);
    approveRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    render(<ProductWorkspacePanel project={makeProject()} />);

    await waitFor(() => expect(listMvpApprovalsMock).toHaveBeenCalledWith('mvp-2'));
    expect(listMvpApprovalsMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Approvals/ }));
    expect(screen.getByText('No approvals recorded for this MVP yet.')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Reviews/ }));

    const roadmapApproval: MvpApproval = {
      id: 'approval-roadmap-review',
      mvpId: 'mvp-2',
      projectId: 'proj-1',
      stage: 'roadmap_review',
      decision: 'approved',
      decidedAt: '2026-07-28T00:00:00.000Z',
      createdAt: '2026-07-28T00:00:00.000Z',
    };
    listMvpApprovalsMock.mockResolvedValue([roadmapApproval]);

    fireEvent.click(await screen.findByRole('button', { name: /Approve Roadmap Review/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review' }));

    await waitFor(() => expect(approveRoadmapReviewMock).toHaveBeenCalled());

    // Same selectedMvpId ('mvp-2') both times — this must still re-fetch, not reuse the stale [] result.
    await waitFor(() => expect(listMvpApprovalsMock).toHaveBeenCalledTimes(2));

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Approvals/ }));
    expect(await screen.findByText('Roadmap Review Approval')).toBeTruthy();
  });
});
