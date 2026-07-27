// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ReleaseRecord } from '~/lib/deployment/releaseTypes';
import type { Project } from '~/lib/stores/projects';

const { getLatestReleaseMock, createProjectReleaseMock, recordReleaseAcceptanceMock } = vi.hoisted(() => ({
  getLatestReleaseMock: vi.fn(),
  createProjectReleaseMock: vi.fn(),
  recordReleaseAcceptanceMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { getLatestRelease: getLatestReleaseMock },
}));

vi.mock('~/lib/services/releaseManagementRunner', async () => {
  const actual = await vi.importActual<typeof import('~/lib/services/releaseManagementRunner')>(
    '~/lib/services/releaseManagementRunner',
  );

  return {
    ...actual,
    createProjectRelease: createProjectReleaseMock,
    recordReleaseAcceptance: recordReleaseAcceptanceMock,
  };
});

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { ReleasePanel } = await import('./ReleasePanel');

/** The panel's own button and the dialog's submit button share a label — pick the submitting one. */
function submitButton(name: string): HTMLElement {
  const match = screen
    .getAllByRole('button', { name })
    .find((button) => (button as HTMLButtonElement).type === 'submit');

  if (!match) {
    throw new Error(`No submit button named "${name}"`);
  }

  return match;
}

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
    status: 'delivery_ready',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
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
    baseline: {
      capturedAt: '2026-08-10T09:00:00.000Z',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      deploymentUrl: 'https://riverside-dental-abc123.vercel.app',
      repositoryFullName: 'acme/riverside-dental',
      branch: 'main',
      gitCommit: 'abc123def456',
      manifestVersion: 4,
      deliveryPackageNumber: 2,
      verificationNumber: 2,
      verificationStatus: 'passed',
      mvpCode: 'MVP-001',
    },
    releaseNotes: {
      summary: 'Riverside Dental Clinic 1.0.0 delivers 1 feature(s).',
      categories: [
        {
          category: 'new_features',
          entries: [{ id: 'feature:FEAT-001', title: 'Book an appointment', source: 'Feature registry' }],
        },
        { category: 'improvements', entries: [] },
      ],
      breakingChanges: [],
      knownIssues: [{ id: 'issue:1', title: 'Security headers missing', source: 'Verification report' }],
    },
    integrity: { complete: true, checks: [], checksum: 'fnv1a:abc123' },
    customerAcceptance: { state: 'pending', conditions: [] },
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('ReleasePanel', () => {
  beforeEach(() => {
    getLatestReleaseMock.mockReset();
    createProjectReleaseMock.mockReset();
    recordReleaseAcceptanceMock.mockReset();
    getLatestReleaseMock.mockResolvedValue(null);
  });

  it('shows the empty state and offers to create a release for a delivery_ready Deployment', async () => {
    render(<ReleasePanel project={makeProject()} deployment={makeDeployment()} onReleaseChanged={vi.fn()} />);

    expect(await screen.findByText(/No release has been created yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Release' })).toBeTruthy();
  });

  it('does not offer a release before a delivery package exists', async () => {
    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'verified' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/once a delivery package has been generated/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Create Release' })).toBeNull();
  });

  it('renders the persisted release from the release domain', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease());

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText('Released')).toBeTruthy();
    expect(screen.getByText('1.0.0 · Major')).toBeTruthy();
    expect(screen.getByText('Awaiting customer')).toBeTruthy();
    expect(screen.getByText(/delivers 1 feature/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Next Release' })).toBeTruthy();
  });

  it('marks a superseded release distinctly', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease({ releaseStatus: 'superseded' }));

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText('Superseded')).toBeTruthy();
  });

  it('prefills a suggested version but never submits it on its own', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease({ semanticVersion: '1.4.0' }));

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Create Next Release' }));

    const versionInput = (await screen.findByPlaceholderText('1.0.0')) as HTMLInputElement;
    expect(versionInput.value).toBe('1.5.0');
    expect(createProjectReleaseMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Major' }));
    expect((screen.getByPlaceholderText('1.0.0') as HTMLInputElement).value).toBe('2.0.0');
  });

  it('creates a release with the version the operator actually submitted', async () => {
    const onChanged = vi.fn();
    createProjectReleaseMock.mockResolvedValue({
      ok: true,
      code: 'completed',
      transitioned: true,
      message: 'Released.',
    });

    render(<ReleasePanel project={makeProject()} deployment={makeDeployment()} onReleaseChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create Release' }));

    const versionInput = await screen.findByPlaceholderText('1.0.0');
    fireEvent.change(versionInput, { target: { value: '2.1.0' } });
    fireEvent.click(submitButton('Create Release'));

    await waitFor(() => expect(createProjectReleaseMock).toHaveBeenCalledTimes(1));
    expect(createProjectReleaseMock.mock.calls[0][0]).toMatchObject({ semanticVersion: '2.1.0', releaseType: 'minor' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(getLatestReleaseMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rejected release attempt without claiming a release exists', async () => {
    createProjectReleaseMock.mockResolvedValue({
      ok: false,
      code: 'integrity',
      transitioned: false,
      message: 'No delivery package has been generated.',
    });

    render(<ReleasePanel project={makeProject()} deployment={makeDeployment()} onReleaseChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create Release' }));
    await screen.findByPlaceholderText('1.0.0');
    fireEvent.click(submitButton('Create Release'));

    await waitFor(() => expect(createProjectReleaseMock).toHaveBeenCalled());
    expect(screen.queryByText('1.0.0 · Major')).toBeNull();
  });

  it('records a customer acceptance decision and re-reads the domain', async () => {
    const onChanged = vi.fn();
    getLatestReleaseMock.mockResolvedValue(makeRelease());
    recordReleaseAcceptanceMock.mockResolvedValue({ ok: true, state: 'accepted', eventRecorded: true, message: 'ok' });

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={onChanged}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Customer Acceptance' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accepted with conditions' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fix the logo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Response' }));

    await waitFor(() => expect(recordReleaseAcceptanceMock).toHaveBeenCalledTimes(1));
    expect(recordReleaseAcceptanceMock.mock.calls[0][0]).toMatchObject({
      releaseId: 'rel-1',
      state: 'accepted_with_conditions',
      conditions: ['Fix the logo'],
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('renders a recorded acceptance state', async () => {
    getLatestReleaseMock.mockResolvedValue(
      makeRelease({
        customerAcceptance: {
          state: 'accepted',
          conditions: [],
          recordedBy: 'ezra',
          recordedAt: '2026-08-11T10:00:00.000Z',
          notes: 'Signed off',
        },
      }),
    );

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText('Accepted')).toBeTruthy();
  });

  it('renders the full release, including notes and the frozen baseline', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease());

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'View Release' }));

    expect(await screen.findByText('Launch — 1.0.0')).toBeTruthy();
    expect(screen.getByText('New Features (1)')).toBeTruthy();
    expect(screen.getByText('Book an appointment')).toBeTruthy();
    expect(screen.getByText('Known Issues (1)')).toBeTruthy();
    expect(screen.getByText('acme/riverside-dental')).toBeTruthy();
    expect(screen.getByText('abc123def456')).toBeTruthy();
    expect(screen.getByText('fnv1a:abc123')).toBeTruthy();

    // Empty categories are not rendered as empty sections.
    expect(screen.queryByText(/^Improvements/)).toBeNull();
  });

  it('restores the persisted release after a remount, with no session state to rebuild', async () => {
    getLatestReleaseMock.mockResolvedValue(makeRelease({ semanticVersion: '2.3.0', releaseType: 'minor' }));

    const { unmount } = render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText('2.3.0 · Minor')).toBeTruthy();
    unmount();

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText('2.3.0 · Minor')).toBeTruthy();
    expect(screen.getByText('Awaiting customer')).toBeTruthy();
  });

  it("reads each deployment's own release — no shared cache across projects", async () => {
    getLatestReleaseMock.mockImplementation(async (deploymentId: string) =>
      makeRelease({ deploymentId, semanticVersion: deploymentId === 'dep-a' ? '1.0.0' : '2.0.0' }),
    );

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ id: 'dep-a', status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText('1.0.0 · Major')).toBeTruthy();

    render(
      <ReleasePanel
        project={makeProject()}
        deployment={makeDeployment({ id: 'dep-b', status: 'released' })}
        onReleaseChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText('2.0.0 · Major')).toBeTruthy();

    expect(getLatestReleaseMock.mock.calls.map((call) => call[0])).toEqual(['dep-a', 'dep-b']);
  });
});
