// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';

const { getProjectKnowledgeMock, updateProjectKnowledgeMock, recordRequirementsFormSubmissionMock } = vi.hoisted(
  () => ({
    getProjectKnowledgeMock: vi.fn(),
    updateProjectKnowledgeMock: vi.fn(),
    recordRequirementsFormSubmissionMock: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('~/lib/stores/projects', () => ({
  getProjectKnowledge: getProjectKnowledgeMock,
  updateProjectKnowledge: updateProjectKnowledgeMock,
}));

vi.mock('~/lib/projects/requirementsSessionOrchestrator', () => ({
  recordRequirementsFormSubmission: recordRequirementsFormSubmissionMock,
}));

vi.mock('~/lib/blueprints', () => ({
  blueprintEngine: {
    getBlueprint: () => undefined,
    getDefaultBlueprint: () => ({ id: 'blank-project', name: 'Blank Project' }),
  },
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ProjectRequirementsDialog } = await import('./ProjectRequirementsDialog');

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

describe('ProjectRequirementsDialog — Sprint 72 "Primary operating market" field', () => {
  beforeEach(() => {
    getProjectKnowledgeMock.mockReset().mockReturnValue(undefined);
    updateProjectKnowledgeMock.mockReset();
    recordRequirementsFormSubmissionMock.mockReset().mockResolvedValue(undefined);
  });

  it('renders the market select with an accessible label and every supported option', () => {
    render(<ProjectRequirementsDialog project={makeProject()} open onClose={() => {}} />);

    const label = screen.getByText('Primary operating market');
    expect(label).toBeTruthy();

    expect(screen.getByText('Not specified')).toBeTruthy();
    expect(screen.getByText('India')).toBeTruthy();
    expect(screen.getByText('United Arab Emirates')).toBeTruthy();
    expect(screen.getByText('United Kingdom')).toBeTruthy();
    expect(screen.getByText('United States')).toBeTruthy();
    expect(screen.getByText('Other / unsupported market')).toBeTruthy();
  });

  it('shows the scope-control helper text under the label', () => {
    render(<ProjectRequirementsDialog project={makeProject()} open onClose={() => {}} />);

    expect(screen.getByText(/helps Builders apply appropriate currency/i)).toBeTruthy();
  });

  it('selects the existing saved value when the project already has one', () => {
    getProjectKnowledgeMock.mockReturnValue({ primaryMarketCode: 'AE' });

    render(<ProjectRequirementsDialog project={makeProject()} open onClose={() => {}} />);

    const selects = screen.getAllByRole('combobox') as unknown as HTMLSelectElement[];
    const marketSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === 'AE'));

    expect(marketSelect?.value).toBe('AE');
  });

  it('renders safely for an existing project with no primaryMarketCode at all', () => {
    getProjectKnowledgeMock.mockReturnValue({ projectVision: 'A local services app' });

    expect(() => render(<ProjectRequirementsDialog project={makeProject()} open onClose={() => {}} />)).not.toThrow();

    const selects = screen.getAllByRole('combobox') as unknown as HTMLSelectElement[];
    const marketSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === 'AE'));
    expect(marketSelect?.value).toBe('');
  });

  it('changing the market and saving persists primaryMarketCode via updateProjectKnowledge', () => {
    render(<ProjectRequirementsDialog project={makeProject()} open onClose={() => {}} />);

    const selects = screen.getAllByRole('combobox') as unknown as HTMLSelectElement[];
    const marketSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === 'US'))!;

    fireEvent.change(marketSelect, { target: { value: 'US' } });
    fireEvent.click(screen.getByText('Save Requirements'));

    expect(updateProjectKnowledgeMock).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ primaryMarketCode: 'US' }),
    );
  });
});
