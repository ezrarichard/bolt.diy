// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';

const {
  handleApproveMock,
  isAvailableMock,
  listMvpsForProjectMock,
  createMvpMock,
  recordMvpApprovalMock,
  promoteFeaturesForMvpMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  handleApproveMock: vi.fn(),
  isAvailableMock: vi.fn(),
  listMvpsForProjectMock: vi.fn(),
  createMvpMock: vi.fn(),
  recordMvpApprovalMock: vi.fn(),
  promoteFeaturesForMvpMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const DRAFT: ProductOwnerDraft = {
  productVision: 'A dental clinic scheduling app',
  currentMvp: {
    id: 'MVP-001',
    sequence: 1,
    features: [
      {
        id: 'FEAT-001',
        name: 'Book an appointment',
        description: 'Customer can book an appointment',
        priority: 'Must Have',
        dependsOn: [],
        customerValue: 'Core booking flow',
      },
      {
        id: 'FEAT-002',
        name: 'Cancel an appointment',
        description: 'Customer can cancel a booking',
        priority: 'Should Have',
        dependsOn: ['FEAT-001'],
        customerValue: 'Reduces no-shows',
      },
    ],
    acceptanceCriteria: ['Booking succeeds end to end'],
    risks: [],
    assumptions: [],
    openQuestions: [],
    technicalConstraints: [],
    businessConstraints: [],
    successMetrics: [],
    exitCriteria: [],
    engineeringHandoff: {
      scope: ['Appointments'],
      constraints: [],
      architectureGoals: [],
      successCriteria: [],
      acceptanceCriteria: [],
      features: [],
      outOfScopeFeatures: [],
      dependencies: [],
    },
  },
};

vi.mock('~/lib/hooks/useDraftPanel', () => ({
  useDraftPanel: () => ({
    phase: 'idle',
    setPhase: vi.fn(),
    errorMessage: '',
    isGenerating: false,
    canGenerate: true,
    latest: { id: 'artifact-1', status: 'draft', version: 1 },
    latestDraft: DRAFT,
    isPreviewing: true,
    isPendingApproval: true,
    statusMeta: undefined,
    runGeneration: vi.fn(),
    handleApprove: handleApproveMock,
    handleDiscard: vi.fn(),
  }),
}));

vi.mock('~/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('~/lib/mvp/mvpRepository', () => ({
  mvpRepository: {
    isAvailable: isAvailableMock,
    listMvpsForProject: listMvpsForProjectMock,
    createMvp: createMvpMock,
    recordMvpApproval: recordMvpApprovalMock,
  },
}));

vi.mock('~/lib/features/featureRepository', () => ({
  featureRepository: {
    promoteFeaturesForMvp: promoteFeaturesForMvpMock,
  },
}));

vi.mock('react-toastify', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: toastErrorMock } }));

const { ProductOwnerDraftPanel } = await import('./ProductOwnerDraftPanel');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'BrightSmile Dental',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
    ...overrides,
  } as Project;
}

describe('ProductOwnerDraftPanel — Sprint 78 Phase 0 corrective: transactional Gate A', () => {
  beforeEach(() => {
    handleApproveMock.mockReset();
    isAvailableMock.mockReset().mockReturnValue(true);
    listMvpsForProjectMock.mockReset().mockResolvedValue([]);
    createMvpMock.mockReset().mockResolvedValue({ ok: true, mvp: { id: 'mvp-1' } });
    recordMvpApprovalMock.mockReset().mockResolvedValue(true);
    promoteFeaturesForMvpMock.mockReset().mockResolvedValue({ ok: true, features: [] });
    toastErrorMock.mockReset();
  });

  it('promotes currentMvp.features into Feature rows for the newly-created MVP, then approves the artifact', async () => {
    const project = makeProject();
    render(<ProductOwnerDraftPanel project={project} />);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));

    await waitFor(() =>
      expect(promoteFeaturesForMvpMock).toHaveBeenCalledWith('proj-1', 'mvp-1', DRAFT.currentMvp!.features),
    );

    expect(handleApproveMock).toHaveBeenCalled();
    expect(recordMvpApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({ mvpId: 'mvp-1', projectId: 'proj-1', stage: 'scope', decision: 'approved' }),
    );

    // Promotion happens after the approval is recorded, not before.
    const approvalOrder = recordMvpApprovalMock.mock.invocationCallOrder[0];
    const promotionOrder = promoteFeaturesForMvpMock.mock.invocationCallOrder[0];
    expect(promotionOrder).toBeGreaterThan(approvalOrder);

    // The artifact is only marked approved AFTER persistence succeeded.
    const handleApproveOrder = handleApproveMock.mock.invocationCallOrder[0];
    expect(handleApproveOrder).toBeGreaterThan(promotionOrder);
  });

  it('reuses an existing MVP row (by sequence) instead of creating a new one, then still promotes features against it', async () => {
    listMvpsForProjectMock.mockResolvedValue([{ id: 'mvp-existing', sequence: 1 }]);

    const project = makeProject();
    render(<ProductOwnerDraftPanel project={project} />);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));

    await waitFor(() =>
      expect(promoteFeaturesForMvpMock).toHaveBeenCalledWith('proj-1', 'mvp-existing', DRAFT.currentMvp!.features),
    );

    expect(createMvpMock).not.toHaveBeenCalled();
    expect(handleApproveMock).toHaveBeenCalled();
  });

  it('MVP persistence failure prevents successful Gate A completion — the artifact is never marked approved', async () => {
    createMvpMock.mockResolvedValue({ ok: false, error: 'boom' });

    const project = makeProject();
    render(<ProductOwnerDraftPanel project={project} />);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('boom'));

    expect(recordMvpApprovalMock).not.toHaveBeenCalled();
    expect(promoteFeaturesForMvpMock).not.toHaveBeenCalled();
    expect(handleApproveMock).not.toHaveBeenCalled();
  });

  it('Feature promotion failure prevents successful Gate A completion — the artifact is never marked approved', async () => {
    promoteFeaturesForMvpMock.mockResolvedValue({ ok: false, features: [], error: 'promotion failed' });

    const project = makeProject();
    render(<ProductOwnerDraftPanel project={project} />);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('promotion failed'));

    expect(recordMvpApprovalMock).toHaveBeenCalled();
    expect(handleApproveMock).not.toHaveBeenCalled();
  });

  it('retry after a partial failure succeeds idempotently — the second click reuses the already-created MVP and does not duplicate it', async () => {
    createMvpMock.mockResolvedValueOnce({ ok: false, error: 'boom' });

    const project = makeProject();
    render(<ProductOwnerDraftPanel project={project} />);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('boom'));
    expect(handleApproveMock).not.toHaveBeenCalled();

    // Simulate the MVP now existing from some prior partial success (or a fixed transient error) on retry.
    listMvpsForProjectMock.mockResolvedValue([{ id: 'mvp-1', sequence: 1 }]);

    fireEvent.click(screen.getByText('Approve Roadmap (Gate A)'));

    await waitFor(() => expect(handleApproveMock).toHaveBeenCalled());
    expect(createMvpMock).toHaveBeenCalledTimes(1);
    expect(promoteFeaturesForMvpMock).toHaveBeenCalledWith('proj-1', 'mvp-1', DRAFT.currentMvp!.features);
  });
});
