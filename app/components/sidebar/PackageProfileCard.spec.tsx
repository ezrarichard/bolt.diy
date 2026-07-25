// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';

const { setProjectPackageSelectionMock, clearProjectPackageSelectionMock } = vi.hoisted(() => ({
  setProjectPackageSelectionMock: vi.fn(),
  clearProjectPackageSelectionMock: vi.fn(),
}));

vi.mock('~/lib/stores/projects', () => ({
  setProjectPackageSelection: setProjectPackageSelectionMock,
  clearProjectPackageSelection: clearProjectPackageSelectionMock,
}));

const { PackageProfileCard } = await import('./PackageProfileCard');

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

describe('PackageProfileCard — Sprint 73', () => {
  beforeEach(() => {
    setProjectPackageSelectionMock.mockReset();
    clearProjectPackageSelectionMock.mockReset();
  });

  it('renders every supported package plus "No package selected"', () => {
    render(<PackageProfileCard project={makeProject()} />);

    expect(screen.getByText('No package selected')).toBeTruthy();
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Professional')).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
  });

  it('shows "Not specified" and source "Not set" when nothing has resolved', () => {
    render(<PackageProfileCard project={makeProject()} />);

    expect(screen.getByText('Not specified')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
  });

  it('displays the effective package and Project selection as the source', () => {
    render(
      <PackageProfileCard
        project={makeProject({
          packageSelection: { packageCode: 'PROFESSIONAL', selectedAt: '2026-07-25T00:00:00.000Z' },
        })}
      />,
    );

    expect(screen.getAllByText('Professional').length).toBeGreaterThan(0);
    expect(screen.getByText('Project selection')).toBeTruthy();
  });

  it('reflects the existing selection as the selected option', () => {
    render(
      <PackageProfileCard
        project={makeProject({ packageSelection: { packageCode: 'PREMIUM', selectedAt: '2026-07-25T00:00:00.000Z' } })}
      />,
    );

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    expect(select.value).toBe('PREMIUM');
  });

  it('selecting a package calls setProjectPackageSelection with that project id and code', () => {
    render(<PackageProfileCard project={makeProject()} />);

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'STARTER' } });

    expect(setProjectPackageSelectionMock).toHaveBeenCalledWith('proj-1', 'STARTER');
  });

  it('selecting "No package selected" calls clearProjectPackageSelection', () => {
    render(
      <PackageProfileCard
        project={makeProject({ packageSelection: { packageCode: 'STARTER', selectedAt: '2026-07-25T00:00:00.000Z' } })}
      />,
    );

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__none__' } });

    expect(clearProjectPackageSelectionMock).toHaveBeenCalledWith('proj-1');
  });

  it('the select is keyboard-focusable and has no disabled/loading state blocking interaction', () => {
    render(<PackageProfileCard project={makeProject()} />);

    const select = screen.getByRole('combobox') as unknown as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });

  it('communicates scope-control via explanatory copy', () => {
    render(<PackageProfileCard project={makeProject()} />);

    expect(screen.getByText(/does not add unrelated product features/i)).toBeTruthy();
  });

  it('renders safely for an existing project with no package data at all', () => {
    expect(() => render(<PackageProfileCard project={makeProject()} />)).not.toThrow();
  });
});
