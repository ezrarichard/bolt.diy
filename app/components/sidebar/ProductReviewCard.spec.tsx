// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { ProductReview } from '~/lib/product-review/productReviewTypes';

const { approveProductReviewMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  approveProductReviewMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('~/lib/projects/productReviewEngine', () => ({
  productReviewEngine: { approveProductReview: approveProductReviewMock },
}));

vi.mock('react-toastify', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

const { ProductReviewCard } = await import('./ProductReviewCard');

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

function makeReview(overrides: Partial<ProductReview> = {}): ProductReview {
  return {
    id: 'product-review-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    reviewDate: '2026-07-26T00:00:00.000Z',
    reviewType: 'post_release',
    status: 'ready_for_review',
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

beforeEach(() => {
  approveProductReviewMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe('ProductReviewCard — approval flow', () => {
  it('has an accessible label naming the exact review being approved', () => {
    render(<ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Approve Product Review for MVP1' })).toBeTruthy();
  });

  it('does not show an approval action once the review is already approved', () => {
    render(
      <ProductReviewCard
        project={makeProject()}
        review={makeReview({ status: 'approved' })}
        sourceLabel="MVP1"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Approve Product Review/ })).toBeNull();
  });

  it('shows a confirmation dialog before approving, explaining the content freeze', () => {
    render(<ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review for MVP1' }));

    expect(screen.getByRole('heading', { name: 'Approve Product Review' })).toBeTruthy();
    expect(screen.getByText(/freezes its business content/)).toBeTruthy();
  });

  it('only calls the engine after the confirmation is confirmed, never on the initial click', () => {
    render(<ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review for MVP1' }));
    expect(approveProductReviewMock).not.toHaveBeenCalled();
  });

  it('calls onChanged and shows success only after the engine call actually succeeds', async () => {
    approveProductReviewMock.mockResolvedValue({ ok: true, error: null });

    const onChanged = vi.fn();

    render(
      <ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review for MVP1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review' }));

    await waitFor(() => expect(approveProductReviewMock).toHaveBeenCalledWith(makeReview()));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('never calls onChanged or shows success when the engine call fails — no false approved state', async () => {
    approveProductReviewMock.mockResolvedValue({ ok: false, error: 'Approval failed.' });

    const onChanged = vi.fn();

    render(
      <ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review for MVP1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Approval failed.'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();

    // The confirmation dialog stays open on failure — never silently closes as if it succeeded.
    expect(screen.getByRole('heading', { name: 'Approve Product Review' })).toBeTruthy();
  });

  it('disables the confirm button while the approval is running, preventing double submission', async () => {
    let resolveApproval: (value: { ok: boolean; error: string | null }) => void = () => {};
    approveProductReviewMock.mockReturnValue(
      new Promise((resolve) => {
        resolveApproval = resolve;
      }),
    );

    render(<ProductReviewCard project={makeProject()} review={makeReview()} sourceLabel="MVP1" onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve Product Review for MVP1' }));

    const confirmButton = screen.getByRole('button', { name: 'Approve Product Review' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(approveProductReviewMock).toHaveBeenCalledTimes(1));

    // A second click while the first call is still in flight must not trigger a second engine call.
    fireEvent.click(confirmButton);
    expect(approveProductReviewMock).toHaveBeenCalledTimes(1);

    resolveApproval({ ok: true, error: null });
  });
});
