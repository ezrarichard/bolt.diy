// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeliveryPackage, DeliveryPackageRecord } from '~/lib/deployment/deliveryPackageTypes';
import type { Project } from '~/lib/stores/projects';

const { getLatestDeliveryPackageMock, generateDeliveryPackageMock } = vi.hoisted(() => ({
  getLatestDeliveryPackageMock: vi.fn(),
  generateDeliveryPackageMock: vi.fn(),
}));

vi.mock('~/lib/deployment/deploymentRepository', () => ({
  deploymentRepository: { getLatestDeliveryPackage: getLatestDeliveryPackageMock },
}));

vi.mock('~/lib/services/deliveryPackageRunner', () => ({
  generateDeliveryPackage: generateDeliveryPackageMock,
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { DeliveryPackagePanel } = await import('./DeliveryPackagePanel');

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
    status: 'verified',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: null,
    ...overrides,
  };
}

function makeSummary(): DeliveryPackage {
  return {
    projectInformation: { projectId: 'proj-1', projectName: 'Riverside Dental Clinic' },
    deploymentSummary: {
      lifecycleStatus: 'delivery_ready',
      environment: 'preview',
      provider: 'vercel',
      vercelProjectName: 'riverside-dental',
      previewUrl: 'https://riverside-dental-abc123.vercel.app',
    },
    repositoryInformation: { provider: 'github', repositoryFullName: 'acme/riverside-dental', branch: 'main' },
    databaseInformation: { provider: 'supabase', projectRef: 'abcdefghijklmnopqrst', region: 'ap-south-1' },
    verificationSummary: {
      verified: true,
      status: 'warning',
      checksPassed: 8,
      checksFailed: 0,
      warnings: 1,
      requiredPassed: 5,
      requiredTotal: 5,
      categories: [],
    },
    featureInventory: {
      features: [
        {
          code: 'FEAT-001',
          title: 'Book an appointment',
          state: 'verified',
          verificationState: 'verified',
          source: 'feature_registry',
          evidence: 'Feature status "deployed".',
        },
      ],
      implementedCount: 1,
      verifiedCount: 1,
      futureCount: 0,
      optionalCount: 0,
    },
    knownLimitations: [
      {
        id: 'environment:VITE_SUPABASE_ANON_KEY',
        title: 'Manual configuration required: VITE_SUPABASE_ANON_KEY',
        detail: 'Enter the publishable key manually before deploying.',
        severity: 'attention',
        source: 'environment',
      },
    ],
    acceptanceChecklist: {
      items: [
        {
          id: 'application_reachable',
          label: 'Application reachable',
          state: 'satisfied',
          evidence: 'From the availability check.',
          customerAction: false,
        },
        {
          id: 'customer_acceptance',
          label: 'Customer acceptance',
          state: 'pending',
          evidence: 'Awaiting the customer.',
          customerAction: true,
        },
      ],
      satisfiedCount: 1,
      outstandingCount: 1,
      customerActionCount: 1,
    },
    adminGuide: {
      previewUrl: 'https://riverside-dental-abc123.vercel.app',
      repositoryUrl: 'https://github.com/acme/riverside-dental',
      buildVersion: 'Manifest v4 (MVP-001)',
      environmentVariables: [{ name: 'VITE_SUPABASE_URL', status: 'resolved', requiresManualEntry: false }],
      procedures: [{ id: 'redeploy', title: 'How to redeploy', steps: ['Open the project in Builders.'] }],
    },
    completeness: {
      score: 92,
      level: 'almost_complete',
      dimensions: [
        { id: 'deployment', label: 'Deployment', weight: 20, score: 1, detail: 'Deployed with a live URL.' },
      ],
    },
    support: { contacts: [], note: 'Builders does not maintain a contact registry.', consoles: [] },
    packageMetadata: {
      packageVersion: '1.0.0',
      generatorVersion: '1.0.0',
      deliveredAt: '2026-08-08T12:00:00.000Z',
      sources: [],
    },
  } as unknown as DeliveryPackage;
}

function makeRecord(overrides: Partial<DeliveryPackageRecord> = {}): DeliveryPackageRecord {
  return {
    id: 'pkg-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    packageNumber: 1,
    packageVersion: '1.0.0',
    generatorVersion: '1.0.0',
    status: 'generated',
    manifestVersion: 4,
    verificationId: 'ver-1',
    completenessScore: 92,
    completenessLevel: 'almost_complete',
    deliverySummary: makeSummary(),
    generatedAt: '2026-08-08T12:00:00.000Z',
    generatedBy: 'ezra',
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

describe('DeliveryPackagePanel', () => {
  beforeEach(() => {
    getLatestDeliveryPackageMock.mockReset();
    generateDeliveryPackageMock.mockReset();
    getLatestDeliveryPackageMock.mockResolvedValue(null);
  });

  it('shows the empty state and offers to generate for a verified Deployment', async () => {
    render(<DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={vi.fn()} />);

    expect(await screen.findByText(/No delivery package has been generated yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate Package' })).toBeTruthy();
  });

  it('does not offer generation before the Deployment has been verified', async () => {
    render(
      <DeliveryPackagePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'deployed' })}
        onPackageGenerated={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/once this Deployment has been verified/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Generate Package' })).toBeNull();
  });

  it('renders the persisted package summary from the delivery domain', async () => {
    getLatestDeliveryPackageMock.mockResolvedValue(makeRecord());

    render(<DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={vi.fn()} />);

    expect(await screen.findByText('Delivery Package Ready')).toBeTruthy();
    expect(screen.getByText('#1 · v1.0.0')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('Almost complete')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Regenerate Package' })).toBeTruthy();
  });

  it('offers Export as a disabled placeholder, sourced from the export registry', async () => {
    getLatestDeliveryPackageMock.mockResolvedValue(makeRecord());

    render(<DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={vi.fn()} />);

    const exportButton = (await screen.findByRole('button', { name: 'Export' })) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.title.length).toBeGreaterThan(0);
  });

  it('renders the full package, including checklist evidence and limitations, without exposing secrets', async () => {
    getLatestDeliveryPackageMock.mockResolvedValue(makeRecord());

    render(<DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Package' }));

    expect(await screen.findByText(/Delivery Package #1 — Riverside Dental Clinic/)).toBeTruthy();
    expect(screen.getByText('Book an appointment')).toBeTruthy();
    expect(screen.getByText('Application reachable')).toBeTruthy();
    expect(screen.getByText(/Manual configuration required/)).toBeTruthy();
    expect(screen.getByText('How to redeploy')).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/eyJ|service_role|Bearer /);
  });

  it('generates through the runner and re-reads the domain afterwards', async () => {
    const onGenerated = vi.fn();
    generateDeliveryPackageMock.mockResolvedValue({
      ok: true,
      code: 'completed',
      transitioned: true,
      message: 'Delivery package #1 generated.',
    });

    render(
      <DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={onGenerated} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Package' }));

    await waitFor(() => expect(generateDeliveryPackageMock).toHaveBeenCalledTimes(1));
    expect(generateDeliveryPackageMock.mock.calls[0][0]).toMatchObject({
      project: expect.objectContaining({ id: 'proj-1' }),
    });
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
    expect(getLatestDeliveryPackageMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a generation failure without claiming a package exists', async () => {
    generateDeliveryPackageMock.mockResolvedValue({
      ok: false,
      code: 'persist_failed',
      transitioned: false,
      message: 'The delivery package could not be saved.',
    });

    render(<DeliveryPackagePanel project={makeProject()} deployment={makeDeployment()} onPackageGenerated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Package' }));

    await waitFor(() => expect(generateDeliveryPackageMock).toHaveBeenCalled());
    expect(screen.queryByText('Delivery Package Ready')).toBeNull();
  });

  it('restores the persisted package after a remount, with no session state to rebuild', async () => {
    getLatestDeliveryPackageMock.mockResolvedValue(makeRecord({ packageNumber: 3 }));

    const { unmount } = render(
      <DeliveryPackagePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'delivery_ready' })}
        onPackageGenerated={vi.fn()}
      />,
    );
    expect(await screen.findByText('#3 · v1.0.0')).toBeTruthy();
    unmount();

    render(
      <DeliveryPackagePanel
        project={makeProject()}
        deployment={makeDeployment({ status: 'delivery_ready' })}
        onPackageGenerated={vi.fn()}
      />,
    );

    expect(await screen.findByText('#3 · v1.0.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View Package' }));
    expect(await screen.findByText(/Delivery Package #3/)).toBeTruthy();
  });

  it("reads each deployment's own package — no shared cache across projects", async () => {
    getLatestDeliveryPackageMock.mockImplementation(async (deploymentId: string) =>
      makeRecord({ deploymentId, packageNumber: deploymentId === 'dep-a' ? 1 : 2 }),
    );

    render(
      <DeliveryPackagePanel
        project={makeProject()}
        deployment={makeDeployment({ id: 'dep-a' })}
        onPackageGenerated={vi.fn()}
      />,
    );
    expect(await screen.findByText('#1 · v1.0.0')).toBeTruthy();

    render(
      <DeliveryPackagePanel
        project={makeProject()}
        deployment={makeDeployment({ id: 'dep-b' })}
        onPackageGenerated={vi.fn()}
      />,
    );
    expect(await screen.findByText('#2 · v1.0.0')).toBeTruthy();

    expect(getLatestDeliveryPackageMock.mock.calls.map((call) => call[0])).toEqual(['dep-a', 'dep-b']);
  });
});
