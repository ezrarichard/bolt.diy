// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ReleaseRecord } from '~/lib/deployment/releaseTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ChangeImpactRecord } from '~/lib/evolution/evolutionRepository';
import type { Project } from '~/lib/stores/projects';

const {
  getLatestReleaseMock,
  listChangeRequestsMock,
  listImpactAnalysesMock,
  createChangeRequestMock,
  runImpactAnalysisMock,
} = vi.hoisted(() => ({
  getLatestReleaseMock: vi.fn(),
  listChangeRequestsMock: vi.fn(),
  listImpactAnalysesMock: vi.fn(),
  createChangeRequestMock: vi.fn(),
  runImpactAnalysisMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { getLatestRelease: getLatestReleaseMock },
}));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: {
    listChangeRequests: listChangeRequestsMock,
    listImpactAnalyses: listImpactAnalysesMock,
    createChangeRequest: createChangeRequestMock,
  },
}));

vi.mock('~/lib/services/evolutionRunner', () => ({ runImpactAnalysis: runImpactAnalysisMock }));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { ProductEvolutionPanel } = await import('./ProductEvolutionPanel');

function makeProject(): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🦷',
    color: 'blue',
    createdAt: '2026-06-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    artifacts: [],
  } as Project;
}

function makeDeployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'released',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

function makeRelease(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    id: 'rel-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    releaseNumber: 1,
    semanticVersion: '1.0.0',
    releaseName: 'Launch',
    releaseType: 'major',
    releaseStatus: 'released',
    releaseDate: '2026-08-10T09:00:00.000Z',
    baseline: { capturedAt: '2026-08-10T09:00:00.000Z', deploymentId: 'dep-1', projectId: 'proj-1' },
    releaseNotes: { summary: '', categories: [], breakingChanges: [], knownIssues: [] },
    integrity: { complete: true, checks: [], checksum: 'x' },
    customerAcceptance: { state: 'accepted', conditions: [] },
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Allow patients to cancel an appointment',
    description: 'FEAT-001 should support cancellation.',
    priority: 'high',
    category: 'unknown',
    scope: 'unknown',
    declaredAreas: [],
    status: 'submitted',
    requestedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ChangeImpactRecord> = {}): ChangeImpactRecord {
  return {
    id: 'ia-1',
    changeRequestId: 'cr-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    analysisNumber: 1,
    classification: 'feature_addition',
    riskLevel: 'medium',
    complexityLevel: 'medium',
    overallConfidence: 'high',
    requiresHumanReview: true,
    analysedAt: '2026-08-12T10:00:00.000Z',
    createdAt: '2026-08-12T10:00:00.000Z',
    impact: {
      sections: [
        {
          id: 'business',
          label: 'Business Impact',
          affected: true,
          confidence: 'high',
          detail: '1 released feature is referenced.',
          items: [
            {
              kind: 'feature',
              identifier: 'FEAT-001',
              label: 'Book an appointment',
              confidence: 'high',
              evidence: 'exact match on "FEAT-001"',
            },
          ],
        },
        {
          id: 'database',
          label: 'Database Impact',
          affected: false,
          confidence: 'high',
          detail: 'No table referenced.',
          items: [],
        },
      ],
      unaffectedAreas: [
        { area: 'documentation', detail: 'No delivered documentation section appears to need revisiting.' },
      ],
      risk: {
        level: 'medium',
        score: 3,
        factors: [{ id: 'breadth', label: 'Breadth of change', detail: 'wide', weight: 2 }],
        reasoning: 'medium risk',
      },
      complexity: { level: 'medium', score: 4, factors: [], reasoning: 'medium complexity' },
      reasoning: ['Analysed against release 1.0.0.'],
      summary: {
        affectedSections: 1,
        totalFindings: 1,
        highConfidenceFindings: 1,
        affectedFeatures: 1,
        affectedFiles: 3,
        affectedTables: 0,
      },
    } as unknown as ChangeImpactRecord['impact'],
    evolutionPlan: {
      summary: 'A feature addition against release 1.0.0.',
      affectedArtifacts: [],
      requiredRoles: [{ role: 'frontend_engineer', label: 'Frontend Engineer', reason: 'Pages are implicated.' }],
      requiredReviews: [],
      estimatedPhases: [{ id: 'build', name: 'Implementation', roles: ['frontend_engineer'], detail: 'Implement.' }],
      estimatedRisks: [],
      suggestedMvp: {
        placement: 'next_mvp',
        label: 'Schedule into the next MVP',
        reasoning: 'Too broad for maintenance.',
      },
      suggestedSprint: 'Approximately 1 phase(s).',
      suggestedPriority: 'high',
      futureScope: ['No code is generated by this plan.'],
      createdAt: '2026-08-12T10:05:00.000Z',
    } as unknown as ChangeImpactRecord['evolutionPlan'],
    ...overrides,
  };
}

describe('ProductEvolutionPanel', () => {
  beforeEach(() => {
    getLatestReleaseMock.mockReset();
    listChangeRequestsMock.mockReset();
    listImpactAnalysesMock.mockReset();
    createChangeRequestMock.mockReset();
    runImpactAnalysisMock.mockReset();

    getLatestReleaseMock.mockResolvedValue(makeRelease());
    listChangeRequestsMock.mockResolvedValue([]);
    listImpactAnalysesMock.mockResolvedValue([]);
  });

  it('shows the active release baseline and an empty request list', async () => {
    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText('Baseline 1.0.0')).toBeTruthy();
    expect(screen.getByText('1.0.0 · Launch')).toBeTruthy();
    expect(screen.getByText(/No change requests have been raised/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raise Change Request' })).toBeTruthy();
  });

  it('refuses to offer evolution before the product is released', async () => {
    getLatestReleaseMock.mockResolvedValue(null);

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment({ status: 'delivery_ready' })} />);

    await waitFor(() => expect(screen.getByText(/Create a release before raising change requests/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Raise Change Request' })).toBeNull();
  });

  it('does not treat a superseded release as an active baseline', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease({ releaseStatus: 'superseded' }));

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    await waitFor(() => expect(screen.getByText(/Create a release before raising change requests/i)).toBeTruthy());
  });

  it('lists change requests with their latest analysis headline', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    listImpactAnalysesMock.mockResolvedValue([makeAnalysis()]);

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText('#1 Allow patients to cancel an appointment')).toBeTruthy();
    expect(screen.getByText(/Feature Addition/)).toBeTruthy();
    expect(screen.getByText(/1 impact area\(s\) · 1 feature\(s\) · 3 file\(s\)/)).toBeTruthy();
    expect(screen.getByText(/needs engineer review/)).toBeTruthy();
  });

  it('raises a change request against the active release', async () => {
    createChangeRequestMock.mockResolvedValue({ ok: true, request: makeRequest() });

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Raise Change Request' }));
    fireEvent.change(await screen.findByPlaceholderText(/Allow patients to cancel/), {
      target: { value: 'Add cancellation' },
    });
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'FEAT-001 needs a cancel action.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Database' }));
    fireEvent.click(screen.getByRole('button', { name: 'Raise Request' }));

    await waitFor(() => expect(createChangeRequestMock).toHaveBeenCalledTimes(1));
    expect(createChangeRequestMock.mock.calls[0][0]).toMatchObject({
      projectId: 'proj-1',
      deploymentId: 'dep-1',
      releaseId: 'rel-1',
      releaseVersion: '1.0.0',
      title: 'Add cancellation',
      declaredAreas: ['database'],
      category: 'unknown',
    });
    expect(getLatestReleaseMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rejected request without adding it to the list', async () => {
    createChangeRequestMock.mockResolvedValue({ ok: false, code: 'duplicate', message: 'Already open.' });

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Raise Change Request' }));
    fireEvent.change(await screen.findByPlaceholderText(/Allow patients to cancel/), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise Request' }));

    await waitFor(() => expect(createChangeRequestMock).toHaveBeenCalled());
    expect(screen.queryByText('#1 Dup')).toBeNull();
  });

  it('runs impact analysis through the runner and re-reads the domain', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    runImpactAnalysisMock.mockResolvedValue({ ok: true, code: 'completed', message: 'Impact analysis created.' });

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyse Impact' }));

    await waitFor(() => expect(runImpactAnalysisMock).toHaveBeenCalledTimes(1));
    expect(runImpactAnalysisMock.mock.calls[0][0]).toMatchObject({
      project: expect.objectContaining({ id: 'proj-1' }),
      request: expect.objectContaining({ id: 'cr-1' }),
    });
    await waitFor(() => expect(listChangeRequestsMock).toHaveBeenCalledTimes(2));
  });

  it('offers re-analysis once an analysis exists', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    listImpactAnalysesMock.mockResolvedValue([makeAnalysis()]);

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByRole('button', { name: 'Re-analyse' })).toBeTruthy();
  });

  it('renders the full analysis, its reasoning and the evolution plan', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    listImpactAnalysesMock.mockResolvedValue([makeAnalysis()]);

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Analysis' }));

    expect(await screen.findByText(/Analysis #1 against release 1.0.0/)).toBeTruthy();
    expect(screen.getByText(/deterministic matching against the released baseline/)).toBeTruthy();
    expect(screen.getByText('FEAT-001')).toBeTruthy();
    expect(screen.getByText(/exact match on "FEAT-001"/)).toBeTruthy();
    expect(screen.getByText('Can remain untouched')).toBeTruthy();
    expect(screen.getByText('Schedule into the next MVP')).toBeTruthy();
    expect(screen.getByText(/No code is generated by this plan/)).toBeTruthy();
    expect(screen.getByText('Analysed against release 1.0.0.')).toBeTruthy();

    // An unaffected section is not rendered as an affected area.
    expect(screen.queryByText('Database Impact')).toBeNull();
  });

  it('restores everything after a remount, with no session state to rebuild', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    listImpactAnalysesMock.mockResolvedValue([makeAnalysis()]);

    const { unmount } = render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);
    expect(await screen.findByText('#1 Allow patients to cancel an appointment')).toBeTruthy();
    unmount();

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText('#1 Allow patients to cancel an appointment')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View Analysis' }));
    expect(await screen.findByText(/Analysis #1 against release 1.0.0/)).toBeTruthy();
  });

  it("reads each deployment's own requests — no shared cache across projects", async () => {
    listChangeRequestsMock.mockImplementation(async (deploymentId: string) => [
      makeRequest({ deploymentId, title: `Request for ${deploymentId}` }),
    ]);

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment({ id: 'dep-a' })} />);
    expect(await screen.findByText('#1 Request for dep-a')).toBeTruthy();

    render(<ProductEvolutionPanel project={makeProject()} deployment={makeDeployment({ id: 'dep-b' })} />);
    expect(await screen.findByText('#1 Request for dep-b')).toBeTruthy();

    expect(listChangeRequestsMock.mock.calls.map((call) => call[0])).toEqual(['dep-a', 'dep-b']);
  });
});
