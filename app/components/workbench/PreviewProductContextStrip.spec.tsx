// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProductEvolutionMvpEntry, ProductEvolutionNextAction } from '~/lib/projects/productEvolutionView';

const { useProductEvolutionSummaryMock } = vi.hoisted(() => ({
  useProductEvolutionSummaryMock: vi.fn(),
}));

vi.mock('~/lib/projects/useProductEvolutionSummary', () => ({
  useProductEvolutionSummary: useProductEvolutionSummaryMock,
}));

const { PreviewProductContextStrip } = await import('./PreviewProductContextStrip');
const { projectsStore, currentProjectIdStore, isProjectDashboardOpenStore } = await import('~/lib/stores/projects');

const PROJECT = {
  id: 'proj-1',
  name: 'Riverside Dental Clinic',
  icon: '🚀',
  color: 'purple',
  createdAt: '2026-01-01T00:00:00.000Z',
  projectType: 'guided_engineering',
  createdFrom: 'guided_engineering',
  artifacts: [],
} as never;

function makeLiveEntry(overrides: Partial<ProductEvolutionMvpEntry> = {}): ProductEvolutionMvpEntry {
  return {
    kind: 'committed',
    sequence: 1,
    code: 'MVP-001',
    theme: 'Core booking flow',
    status: 'released',
    isLive: true,
    isActive: true,
    ...overrides,
  };
}

function makeNextAction(overrides: Partial<ProductEvolutionNextAction> = {}): ProductEvolutionNextAction {
  return { id: 'start-product-review', label: 'Start a Product Review for MVP-001.', ...overrides };
}

beforeEach(() => {
  projectsStore.set([PROJECT]);
  currentProjectIdStore.set('proj-1');
  isProjectDashboardOpenStore.set(false);
  useProductEvolutionSummaryMock.mockReset();
  sessionStorage.clear();
});

describe('PreviewProductContextStrip', () => {
  it('renders nothing while the summary is still loading', () => {
    useProductEvolutionSummaryMock.mockReturnValue({ status: 'loading', isEmpty: true });

    const { container } = render(<PreviewProductContextStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a project with no live MVP yet (Sprint 84A Section 9 constraint)', () => {
    useProductEvolutionSummaryMock.mockReturnValue({ status: 'ready', isEmpty: true, liveEntry: undefined });

    const { container } = render(<PreviewProductContextStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the live MVP and next action, with an Open Product link, once a live MVP exists', () => {
    useProductEvolutionSummaryMock.mockReturnValue({
      status: 'ready',
      isEmpty: false,
      liveEntry: makeLiveEntry(),
      nextAction: makeNextAction(),
    });

    render(<PreviewProductContextStrip />);

    expect(screen.getByText(/MVP-001 — Released/)).toBeTruthy();
    expect(screen.getByText(/Start a Product Review for MVP-001/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Product' })).toBeTruthy();
  });

  it('opens the Product tab of the dashboard when "Open Product" is clicked, without duplicating the workspace UI', () => {
    useProductEvolutionSummaryMock.mockReturnValue({
      status: 'ready',
      isEmpty: false,
      liveEntry: makeLiveEntry(),
      nextAction: makeNextAction(),
    });

    render(<PreviewProductContextStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Product' }));

    expect(isProjectDashboardOpenStore.get()).toBe(true);
    expect(projectsStore.get()[0].workspaceState?.lastSelectedTab).toBe('product');

    // The strip itself never renders timeline/reviews/approvals content.
    expect(screen.queryByText(/Reviews/)).toBeNull();
  });

  it('hides the strip when dismissed, and remembers the dismissal for the session', () => {
    useProductEvolutionSummaryMock.mockReturnValue({
      status: 'ready',
      isEmpty: false,
      liveEntry: makeLiveEntry(),
      nextAction: makeNextAction(),
    });

    const { unmount } = render(<PreviewProductContextStrip />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide product status banner' }));
    expect(screen.queryByRole('button', { name: 'Open Product' })).toBeNull();

    unmount();

    // Re-mounting (simulating navigating back to Preview later in the same session) stays hidden.
    render(<PreviewProductContextStrip />);
    expect(screen.queryByRole('button', { name: 'Open Product' })).toBeNull();
  });

  it('does not show a "Next" fact once the product is fully up to date', () => {
    useProductEvolutionSummaryMock.mockReturnValue({
      status: 'ready',
      isEmpty: false,
      liveEntry: makeLiveEntry(),
      nextAction: makeNextAction({ id: 'up-to-date', label: 'No product action needed right now.' }),
    });

    render(<PreviewProductContextStrip />);
    expect(screen.queryByText(/No product action needed/)).toBeNull();
  });
});
