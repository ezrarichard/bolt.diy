// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { RoadmapReview } from '~/lib/roadmap-review/roadmapReviewTypes';

const { approveRoadmapReviewMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  approveRoadmapReviewMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('~/lib/projects/roadmapReviewEngine', () => ({
  roadmapReviewEngine: { approveRoadmapReview: approveRoadmapReviewMock },
}));

vi.mock('~/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('react-toastify', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

const { RoadmapReviewCard } = await import('./RoadmapReviewCard');

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

function makeReview(overrides: Partial<RoadmapReview> = {}): RoadmapReview {
  return {
    id: 'roadmap-review-1',
    projectId: 'proj-1',
    productReviewId: 'product-review-1',
    targetMvpId: 'mvp-2',
    roadmapVersion: 1,
    status: 'ready_for_review',
    executiveSummary: 'Strong opportunity for a billing MVP2.',
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
  approveRoadmapReviewMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe('RoadmapReviewCard — source/target labeling', () => {
  it('shows both the source and target MVP labels when a source label is supplied', () => {
    render(
      <RoadmapReviewCard
        project={makeProject()}
        review={makeReview()}
        targetLabel="MVP2 — Billing"
        sourceLabel="MVP1 — Core booking"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText(/Source: MVP1 — Core booking/)).toBeTruthy();
    expect(screen.getByText(/Target: MVP2 — Billing/)).toBeTruthy();
  });

  it('shows only the target label, without crashing, when no source label can be resolved', () => {
    render(
      <RoadmapReviewCard
        project={makeProject()}
        review={makeReview()}
        targetLabel="MVP2 — Billing"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.getByText(/Target: MVP2 — Billing/)).toBeTruthy();
  });
});

describe('RoadmapReviewCard — approval flow', () => {
  it('has an accessible label naming the exact target MVP being approved', () => {
    render(<RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' })).toBeTruthy();
  });

  it('does not show an approval action once the review is already approved', () => {
    render(
      <RoadmapReviewCard
        project={makeProject()}
        review={makeReview({ status: 'approved' })}
        targetLabel="MVP2"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Approve Roadmap Review/ })).toBeNull();
  });

  it('shows a confirmation dialog explaining the roadmap_review approval, before approving', () => {
    render(<RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' }));

    expect(screen.getByRole('heading', { name: 'Approve Roadmap Review' })).toBeTruthy();
    expect(screen.getByText(/records the authoritative roadmap_review approval/)).toBeTruthy();
    expect(screen.getByText(/does NOT start engineering, promote Features, or deploy anything/)).toBeTruthy();
  });

  it('only calls the engine after confirmation, never on the initial click', () => {
    render(<RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' }));
    expect(approveRoadmapReviewMock).not.toHaveBeenCalled();
  });

  it('calls onChanged and shows success only after the engine call actually succeeds', async () => {
    approveRoadmapReviewMock.mockResolvedValue({ ok: true, error: null });

    const onChanged = vi.fn();

    render(
      <RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review' }));

    await waitFor(() => expect(approveRoadmapReviewMock).toHaveBeenCalledWith(makeReview(), { decidedBy: 'user-1' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('never calls onChanged or shows success when the engine call fails — no false approved state', async () => {
    approveRoadmapReviewMock.mockResolvedValue({ ok: false, error: 'Roadmap approval failed.' });

    const onChanged = vi.fn();

    render(
      <RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Roadmap approval failed.'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Approve Roadmap Review' })).toBeTruthy();
  });

  it('disables the confirm button while the approval is running, preventing double submission', async () => {
    let resolveApproval: (value: { ok: boolean; error: string | null }) => void = () => {};
    approveRoadmapReviewMock.mockReturnValue(
      new Promise((resolve) => {
        resolveApproval = resolve;
      }),
    );

    render(<RoadmapReviewCard project={makeProject()} review={makeReview()} targetLabel="MVP2" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Roadmap Review for MVP2' }));

    const confirmButton = screen.getByRole('button', { name: 'Approve Roadmap Review' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(approveRoadmapReviewMock).toHaveBeenCalledTimes(1));

    fireEvent.click(confirmButton);
    expect(approveRoadmapReviewMock).toHaveBeenCalledTimes(1);

    resolveApproval({ ok: true, error: null });
  });
});
