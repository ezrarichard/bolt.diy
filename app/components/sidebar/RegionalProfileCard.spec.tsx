// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';

const { setProjectRegionalSelectionMock, clearProjectRegionalSelectionMock } = vi.hoisted(() => ({
  setProjectRegionalSelectionMock: vi.fn(),
  clearProjectRegionalSelectionMock: vi.fn(),
}));

vi.mock('~/lib/stores/projects', () => ({
  setProjectRegionalSelection: setProjectRegionalSelectionMock,
  clearProjectRegionalSelection: clearProjectRegionalSelectionMock,
}));

const { RegionalProfileCard } = await import('./RegionalProfileCard');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    icon: '🚀',
    color: 'purple',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    ...overrides,
  } as Project;
}

describe('RegionalProfileCard — Sprint 72', () => {
  beforeEach(() => {
    setProjectRegionalSelectionMock.mockReset();
    clearProjectRegionalSelectionMock.mockReset();
  });

  it('renders every supported market plus "Use automatic selection"', () => {
    render(<RegionalProfileCard project={makeProject()} />);

    expect(screen.getByText('Use automatic selection')).toBeTruthy();
    expect(screen.getByText('India')).toBeTruthy();
    expect(screen.getByText('United Arab Emirates')).toBeTruthy();
    expect(screen.getByText('United Kingdom')).toBeTruthy();
    expect(screen.getByText('United States')).toBeTruthy();
  });

  it('shows "Not specified" and source "Not set" when nothing has resolved', () => {
    render(<RegionalProfileCard project={makeProject()} />);

    expect(screen.getByText('Not specified')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
  });

  it('displays the effective region and Business Discovery as the source', () => {
    render(<RegionalProfileCard project={makeProject({ projectKnowledge: { primaryMarketCode: 'AE' } })} />);

    expect(screen.getAllByText('United Arab Emirates').length).toBeGreaterThan(0);
    expect(screen.getByText('Business Discovery')).toBeTruthy();
  });

  it('displays Manual override as the source and reflects it as the selected option', () => {
    render(
      <RegionalProfileCard
        project={makeProject({ regionalSelection: { regionCode: 'GB', selectedAt: '2026-07-25T00:00:00.000Z' } })}
      />,
    );

    expect(screen.getByText('Manual override')).toBeTruthy();

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    expect(select.value).toBe('GB');
  });

  it('selecting a market calls setProjectRegionalSelection with that project id and code', () => {
    render(<RegionalProfileCard project={makeProject()} />);

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'IN' } });

    expect(setProjectRegionalSelectionMock).toHaveBeenCalledWith('proj-1', 'IN');
  });

  it('selecting "Use automatic selection" calls clearProjectRegionalSelection', () => {
    render(
      <RegionalProfileCard
        project={makeProject({ regionalSelection: { regionCode: 'US', selectedAt: '2026-07-25T00:00:00.000Z' } })}
      />,
    );

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__auto__' } });

    expect(clearProjectRegionalSelectionMock).toHaveBeenCalledWith('proj-1');
  });

  it('the select is keyboard-focusable and has no disabled/loading state blocking interaction', () => {
    render(<RegionalProfileCard project={makeProject()} />);

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });

  it('communicates scope-control via explanatory copy', () => {
    render(<RegionalProfileCard project={makeProject()} />);

    expect(screen.getByText(/does not add product features or guarantee legal compliance/i)).toBeTruthy();
  });

  it('renders safely for an existing project with no regional data at all', () => {
    expect(() => render(<RegionalProfileCard project={makeProject()} />)).not.toThrow();
  });
});
