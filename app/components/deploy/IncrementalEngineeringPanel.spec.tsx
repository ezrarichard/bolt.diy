// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { IncrementalPlanRecord } from '~/lib/evolution/engineeringScopeTypes';
import type { Project } from '~/lib/stores/projects';

const { listChangeRequestsMock, listIncrementalPlansMock, planIncrementalEngineeringMock } = vi.hoisted(() => ({
  listChangeRequestsMock: vi.fn(),
  listIncrementalPlansMock: vi.fn(),
  planIncrementalEngineeringMock: vi.fn(),
}));

vi.mock('~/lib/evolution/evolutionRepository', () => ({
  evolutionRepository: {
    listChangeRequests: listChangeRequestsMock,
    listIncrementalPlans: listIncrementalPlansMock,
  },
}));

vi.mock('~/lib/services/incrementalEngineeringRunner', () => ({
  planIncrementalEngineering: planIncrementalEngineeringMock,
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { IncrementalEngineeringPanel } = await import('./IncrementalEngineeringPanel');

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

function makeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Allow patients to cancel an appointment',
    description: 'x',
    priority: 'medium',
    category: 'feature_addition',
    scope: 'single_feature',
    declaredAreas: [],
    status: 'analyzed',
    requestedAt: '2026-08-14T09:00:00.000Z',
    createdAt: '2026-08-14T09:00:00.000Z',
    updatedAt: '2026-08-14T09:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function makePlan(overrides: Partial<IncrementalPlanRecord> = {}): IncrementalPlanRecord {
  return {
    id: 'ip-1',
    changeRequestId: 'cr-1',
    impactAnalysisId: 'ia-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    planNumber: 1,
    modelVersion: '1.0.0',
    selectedRoles: ['uiux', 'frontend', 'qa'],
    filesToModifyCount: 2,
    touchedPercentage: 33,
    createdAt: '2026-08-14T10:00:00.000Z',
    plan: {
      modelVersion: '1.0.0',
      summary: '3 of 9 engineering roles are required, skipping 6.',
      scope: {
        changeRequestId: 'cr-1',
        affectedFeatures: [{ identifier: 'FEAT-001', label: 'Book', evidence: 'exact' }],
        affectedPages: [{ identifier: 'src/pages/AppointmentsPage.tsx', label: 'Appointments', evidence: 'owns' }],
        affectedComponents: [],
        affectedDatabaseObjects: [],
        affectedApis: [],
        affectedEnvironment: [],
        affectedDocuments: [],
        affectedRoles: ['uiux', 'frontend', 'qa'],
        unaffectedAreas: [],
        metadata: {
          classification: 'feature_addition',
          riskLevel: 'medium',
          complexityLevel: 'medium',
          requiresHumanReview: false,
          capturedAt: '2026-08-14T10:00:00.000Z',
        },
      },
      roleDecisions: [
        {
          role: 'database',
          label: 'Database Engineer',
          selected: false,
          reasoning: 'Skipped — tables untouched.',
          dependsOn: [],
        },
        {
          role: 'frontend',
          label: 'Frontend Engineer',
          selected: true,
          reasoning: 'Selected — pages implicated.',
          dependsOn: [],
        },
      ],
      executionOrder: [
        { order: 1, role: 'uiux', label: 'UI/UX Engineer', artifactType: 'uiux-draft', reasoning: 'Design decision.' },
        { order: 2, role: 'frontend', label: 'Frontend Engineer', artifactType: 'frontend-draft', reasoning: 'Pages.' },
        { order: 3, role: 'qa', label: 'QA Engineer', artifactType: 'qa-draft', reasoning: 'Re-verify.' },
      ],
      changeSet: {
        filesToModify: [{ path: 'src/pages/AppointmentsPage.tsx', category: 'pages', reason: 'owns FEAT-001' }],
        filesToCreate: [],
        filesUnchanged: [],
        databaseChanges: [],
        apiChanges: [],
        uiChanges: [],
        testingTargets: [],
        documentationUpdates: [],
        reviewRequirements: [],
        summary: { modifyCount: 2, createCount: 0, unchangedCount: 4, totalReleasedFiles: 6, touchedPercentage: 33 },
      },
      reducedContexts: [
        {
          role: 'frontend',
          label: 'Frontend Engineer',
          includedFeatures: ['FEAT-001'],
          includedFiles: ['src/pages/AppointmentsPage.tsx'],
          includedDatabaseObjects: [],
          includedApis: [],
          includedEnvironment: [],
          includedUpstreamArtifacts: ['architecture-draft'],
          includedReviews: ['code_review'],
          excluded: ['database schema'],
          contextReductionRatio: 0.167,
        },
      ],
      reviewRequirements: [
        { stage: 'code_review', label: 'Code Review', required: true, reasoning: 'Generated code changes.' },
        { stage: 'product_review', label: 'Product Review', required: false, reasoning: 'Requirements unchanged.' },
      ],
      outOfScope: ['No code is generated and no AI role is executed by this plan.'],
      createdAt: '2026-08-14T10:00:00.000Z',
    } as unknown as IncrementalPlanRecord['plan'],
    ...overrides,
  };
}

describe('IncrementalEngineeringPanel', () => {
  beforeEach(() => {
    listChangeRequestsMock.mockReset();
    listIncrementalPlansMock.mockReset();
    planIncrementalEngineeringMock.mockReset();

    listChangeRequestsMock.mockResolvedValue([]);
    listIncrementalPlansMock.mockResolvedValue([]);
  });

  it('tells the operator to analyse first when nothing is plannable', async () => {
    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText(/Analyse a change request first/i)).toBeTruthy();
  });

  it('does not offer planning for a request that has not been analysed', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest({ status: 'submitted' })]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    await waitFor(() => expect(screen.getByText(/Analyse a change request first/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Plan Engineering' })).toBeNull();
  });

  it('offers planning for an analysed request', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText('#1 Allow patients to cancel an appointment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan Engineering' })).toBeTruthy();
  });

  it('shows the role count, touched percentage and execution order for an existing plan', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest({ status: 'planned' })]);
    listIncrementalPlansMock.mockResolvedValue([makePlan()]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText('3/9 roles')).toBeTruthy();
    expect(screen.getByText('33% of files')).toBeTruthy();
    expect(screen.getByText('UI/UX Engineer → Frontend Engineer → QA Engineer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-plan' })).toBeTruthy();
  });

  it('runs planning through the runner and re-reads the domain', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    planIncrementalEngineeringMock.mockResolvedValue({ ok: true, code: 'completed', message: 'Plan #1 created.' });

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Plan Engineering' }));

    await waitFor(() => expect(planIncrementalEngineeringMock).toHaveBeenCalledTimes(1));
    expect(planIncrementalEngineeringMock.mock.calls[0][0]).toMatchObject({
      project: expect.objectContaining({ id: 'proj-1' }),
      request: expect.objectContaining({ id: 'cr-1' }),
    });
    await waitFor(() => expect(listIncrementalPlansMock).toHaveBeenCalledTimes(2));
  });

  it('surfaces a refusal without showing a plan', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest()]);
    planIncrementalEngineeringMock.mockResolvedValue({
      ok: false,
      code: 'invalid_scope',
      message: 'Nothing to engineer.',
    });

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Plan Engineering' }));

    await waitFor(() => expect(planIncrementalEngineeringMock).toHaveBeenCalled());
    expect(screen.queryByText('3/9 roles')).toBeNull();
  });

  it('renders the full plan — order, YES/NO decisions, scope, change set, reduced context and reviews', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest({ status: 'planned' })]);
    listIncrementalPlansMock.mockResolvedValue([makePlan()]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Plan' }));

    expect(await screen.findByText('Incremental Engineering Plan #1')).toBeTruthy();
    expect(screen.getByText('Execution order')).toBeTruthy();
    expect(screen.getByText('uiux-draft')).toBeTruthy();
    expect(screen.getByText('Skipped — tables untouched.')).toBeTruthy();
    expect(screen.getByText('FEAT-001')).toBeTruthy();
    expect(screen.getByText(/Change set — 2 of 6 files/)).toBeTruthy();
    expect(screen.getByText(/17% of the released file set/)).toBeTruthy();
    expect(screen.getByText(/Excludes: database schema/)).toBeTruthy();
    expect(screen.getByText(/No code is generated and no AI role is executed/)).toBeTruthy();
  });

  it('offers no control that executes anything', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest({ status: 'planned' })]);
    listIncrementalPlansMock.mockResolvedValue([makePlan()]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    await screen.findByText('3/9 roles');

    for (const label of [/^Run/i, /^Execute/i, /^Generate/i, /^Deploy/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('restores plans after a remount, with no session state to rebuild', async () => {
    listChangeRequestsMock.mockResolvedValue([makeRequest({ status: 'planned' })]);
    listIncrementalPlansMock.mockResolvedValue([makePlan({ planNumber: 3 })]);

    const { unmount } = render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);
    expect(await screen.findByText(/Plan #3/)).toBeTruthy();
    unmount();

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment()} />);

    expect(await screen.findByText(/Plan #3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View Plan' }));
    expect(await screen.findByText('Incremental Engineering Plan #3')).toBeTruthy();
  });

  it("reads each deployment's own plans — no shared cache across projects", async () => {
    listChangeRequestsMock.mockImplementation(async (deploymentId: string) => [
      makeRequest({ deploymentId, title: `Request for ${deploymentId}` }),
    ]);

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment({ id: 'dep-a' })} />);
    expect(await screen.findByText('#1 Request for dep-a')).toBeTruthy();

    render(<IncrementalEngineeringPanel project={makeProject()} deployment={makeDeployment({ id: 'dep-b' })} />);
    expect(await screen.findByText('#1 Request for dep-b')).toBeTruthy();

    expect(listIncrementalPlansMock.mock.calls.map((call) => call[0])).toEqual(['dep-a', 'dep-b']);
  });
});
