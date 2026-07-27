import { describe, expect, it } from 'vitest';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import type { DeploymentHistoryEvent, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeploymentVerification, VerificationCheck } from '~/lib/deployment/verificationTypes';
import type { Feature } from '~/lib/features/featureTypes';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import { assessEnvironmentReadiness } from '~/lib/services/environmentReadinessService';
import type { Project } from '~/lib/stores/projects';
import { buildDeliveryPackage, type DeliveryPackageInputs } from './deliveryPackageService';

/**
 * The builder is pure, so every test here constructs its inputs directly — no BuildersDB, no
 * network, no mocks beyond the fixtures below.
 */

const CLOCK = () => '2026-08-08T12:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    description: 'Appointment booking for a two-chair dental practice.',
    icon: '🦷',
    color: 'blue',
    createdAt: '2026-06-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    blueprintId: 'business-website',
    artifacts: [],
    ...overrides,
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
    updatedAt: '2026-08-07T00:00:00.000Z',
    github: {
      id: 'gh-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      repoOwner: 'acme',
      repoName: 'riverside-dental',
      repoFullName: 'acme/riverside-dental',
      repoUrl: 'https://github.com/acme/riverside-dental',
      defaultBranch: 'main',
      visibility: 'private',
      status: 'connected',
      metadata: {},
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    },
    supabase: {
      id: 'sb-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      supabaseProjectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      region: 'ap-south-1',
      status: 'connected',
      connectedAt: '2026-08-06T10:00:00.000Z',
      metadata: { projectName: 'riverside-dental', schemaVersion: 3 },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    },
    vercel: {
      id: 'vc-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      vercelProjectId: 'p1',
      vercelProjectName: 'riverside-dental',
      productionUrl: 'riverside-dental.vercel.app',
      status: 'connected',
      metadata: {
        latestDeploymentId: 'dpl_1',
        latestDeploymentUrl: 'riverside-dental-abc123.vercel.app',
        latestDeploymentState: 'READY',
        latestDeploymentAt: '2026-08-07T09:00:00.000Z',
        productionBranch: 'main',
      },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
    ...overrides,
  };
}

function makeHistory(): DeploymentHistoryEvent[] {
  // Most-recent first, matching `getDeploymentHistory`'s own ordering.
  return [
    {
      id: 'evt-4',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      eventType: 'verification_passed',
      metadata: {},
      createdAt: '2026-08-07T09:05:00.000Z',
    },
    {
      id: 'evt-3',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      eventType: 'deployment_succeeded',
      metadata: {},
      createdAt: '2026-08-07T09:00:00.000Z',
    },
    {
      id: 'evt-2',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      eventType: 'deployment_started',
      metadata: {},
      createdAt: '2026-08-07T08:58:30.000Z',
    },
    {
      id: 'evt-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      eventType: 'push_successful',
      metadata: { commitSha: 'abc123def456', filesPushed: 24, branch: 'main' },
      createdAt: '2026-08-06T12:00:00.000Z',
    },
  ];
}

function makeManifest(overrides: Partial<ApplicationManifest> = {}): ApplicationManifest {
  return {
    id: 'man-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    mvpCode: 'MVP-001',
    version: 4,
    status: 'active',
    framework: 'react-vite-ts',
    packageManager: 'npm',
    entryFile: 'src/main.tsx',
    planChecksum: 'fnv1a:plan',
    sourceContentChecksum: 'fnv1a:content',
    fingerprints: { types: 't', services: 's', pages: 'p', components: 'c' },
    totalFiles: 20,
    completedFiles: 20,
    failedFiles: 0,
    persistedAt: '2026-08-05T00:00:00.000Z',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    completedAt: '2026-08-05T02:00:00.000Z',
    dependencies: { react: '^18.3.1', 'react-router-dom': '^6.26.2' },
    environmentRequirements: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    runtimeRequirements: ['Node.js'],
    requiredServices: ['Supabase'],
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    routes: [
      { path: '/', name: 'Home', componentName: 'HomePage', filePath: 'src/pages/HomePage.tsx' },
      {
        path: '/appointments',
        name: 'Appointments',
        componentName: 'AppointmentsPage',
        filePath: 'src/pages/AppointmentsPage.tsx',
      },
    ],
    featureScope: {
      inScopeFeatureIds: ['FEAT-001', 'FEAT-002'],
      outOfScopeFeatureDescriptions: ['Online payments for treatments', 'Patient SMS reminders'],
    },
    ...overrides,
  } as ApplicationManifest;
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'f-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    code: 'FEAT-001',
    moduleSlug: 'appointments',
    title: 'Book an appointment',
    description: 'Patients can request an appointment slot.',
    priority: 'Must Have',
    dependsOn: [],
    status: 'deployed',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

function makeMvp(): Mvp {
  return {
    id: 'mvp-1',
    projectId: 'proj-1',
    code: 'MVP-001',
    sequence: 1,
    theme: 'Let patients book appointments online',
    status: 'approved',
    targetRelease: 'v1.0',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function check(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    id: 'availability.http_response',
    category: 'availability',
    name: 'HTTP response',
    description: '',
    required: true,
    status: 'passed',
    evidence: {},
    retryable: false,
    attempts: 1,
    ...overrides,
  };
}

function makeVerification(overrides: Partial<DeploymentVerification> = {}): DeploymentVerification {
  const checks = overrides.checks ?? [
    check(),
    check({ id: 'application.shell', category: 'application', name: 'Application shell' }),
    check({ id: 'route:/appointments', category: 'route', name: 'Route /appointments' }),
    check({ id: 'asset:script:https://app/assets/index.js', category: 'asset', name: 'Script index.js' }),
    check({ id: 'database.supabase_reachable', category: 'database', name: 'Supabase endpoint reachable' }),
    check({
      id: 'security.headers',
      category: 'security',
      name: 'Security headers',
      required: false,
      status: 'warning',
      errorMessage: 'The deployment does not send some common security headers.',
    }),
  ];

  return {
    id: 'ver-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    verificationNumber: 2,
    status: 'warning',
    policyVersion: '2026-08-07.1',
    targetUrl: 'https://riverside-dental-abc123.vercel.app',
    startedAt: '2026-08-07T09:04:00.000Z',
    completedAt: '2026-08-07T09:05:00.000Z',
    durationMs: 4200,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.status === 'passed').length,
      failed: checks.filter((c) => c.status === 'failed').length,
      warnings: checks.filter((c) => c.status === 'warning').length,
      skipped: 0,
      unavailable: 0,
      requiredTotal: checks.filter((c) => c.required).length,
      requiredPassed: checks.filter((c) => c.required && c.status === 'passed').length,
      requiredFailed: checks.filter((c) => c.required && c.status === 'failed').length,
    },
    message: 'Verification passed with 1 advisory item.',
    createdAt: '2026-08-07T09:04:00.000Z',
    ...overrides,
  };
}

function makeProductPackage(): ProductPackage {
  return {
    projectId: 'proj-1',
    projectName: 'Riverside Dental Clinic',
    assembledAt: '2026-08-05T00:00:00.000Z',
    sections: [
      { id: 'requirements', label: 'Requirements', files: [] as never[] },
      { id: 'architecture', label: 'Architecture', files: [] as never[] },
    ],
    missingSections: [{ section: 'qa', label: 'QA', reason: 'The QA role has not produced an artifact yet.' }],
  } as unknown as ProductPackage;
}

function makeInputs(overrides: Partial<DeliveryPackageInputs> = {}): DeliveryPackageInputs {
  const project = overrides.project ?? makeProject();
  const deployment = overrides.deployment ?? makeDeployment();
  const manifest = overrides.manifest !== undefined ? overrides.manifest : makeManifest();

  return {
    project,
    deployment,
    history: makeHistory(),
    verification: makeVerification(),
    manifest,
    features: [makeFeature()],
    mvp: makeMvp(),
    productPackage: makeProductPackage(),
    environmentReport: assessEnvironmentReadiness({
      environmentRequirements: manifest?.environmentRequirements ?? [],
      github: deployment.github,
      supabase: deployment.supabase,
    }),
    packageNumber: 1,
    generatedBy: 'ezra',
    clock: CLOCK,
    ...overrides,
  };
}

describe('buildDeliveryPackage — project, application and business sections', () => {
  it('sources project identity from the project store', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.projectInformation).toMatchObject({
      projectId: 'proj-1',
      projectName: 'Riverside Dental Clinic',
      projectType: 'guided_engineering',
    });
  });

  it('sources the application summary from the Application Manifest, never from a name', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.applicationSummary).toMatchObject({
      framework: 'react-vite-ts',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      requiredServices: ['Supabase'],
      totalFiles: 20,
    });
    expect(pkg.applicationSummary.routes).toEqual([
      { path: '/', name: 'Home' },
      { path: '/appointments', name: 'Appointments' },
    ]);
    expect(pkg.applicationSummary.dependencies).toEqual(['react', 'react-router-dom']);
  });

  it('sources the blueprint summary from the blueprint registry', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.blueprintSummary.blueprintId).toBe('business-website');
    expect(pkg.blueprintSummary.name).toBeTruthy();
    expect(pkg.blueprintSummary.recommendedStack.length).toBeGreaterThan(0);
  });

  it('uses the MVP theme as the business summary rather than inventing one', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.businessSummary.theme).toBe('Let patients book appointments online');
    expect(pkg.versionSummary).toMatchObject({ manifestVersion: 4, mvpCode: 'MVP-001', targetRelease: 'v1.0' });
  });

  it('degrades honestly when no manifest exists', () => {
    const pkg = buildDeliveryPackage(makeInputs({ manifest: null, features: [], mvp: null }));

    expect(pkg.applicationSummary.framework).toBe('unknown');
    expect(pkg.applicationSummary.routes).toEqual([]);
    expect(pkg.versionSummary.manifestVersion).toBeUndefined();
    expect(pkg.packageMetadata.sources.find((s) => s.source === 'application_manifest')).toMatchObject({
      available: false,
    });
  });
});

describe('buildDeliveryPackage — deployment summary (Part 4)', () => {
  it('summarises every provider from the Deployment domain', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.deploymentSummary).toMatchObject({
      lifecycleStatus: 'verified',
      provider: 'vercel',
      vercelProjectName: 'riverside-dental',
      previewUrl: 'https://riverside-dental-abc123.vercel.app',
      latestDeploymentState: 'READY',
      productionBranch: 'main',
    });
    expect(pkg.repositoryInformation).toMatchObject({
      provider: 'github',
      repositoryFullName: 'acme/riverside-dental',
      branch: 'main',
      lastCommit: 'abc123def456',
    });
    expect(pkg.databaseInformation).toMatchObject({
      provider: 'supabase',
      projectRef: 'abcdefghijklmnopqrst',
      region: 'ap-south-1',
      schemaVersion: 3,
    });
  });

  it('computes deployment duration from the started/succeeded history events', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.deploymentSummary.deploymentDurationMs).toBe(90_000);
  });

  it('prefers the latest deployment URL over the long-lived production alias', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.deploymentSummary.previewUrl).toContain('abc123');
  });

  it('reports missing providers as "none" rather than guessing', () => {
    const pkg = buildDeliveryPackage(
      makeInputs({ deployment: makeDeployment({ github: null, supabase: null, vercel: null }) }),
    );

    expect(pkg.deploymentSummary.provider).toBe('none');
    expect(pkg.repositoryInformation.provider).toBe('none');
    expect(pkg.databaseInformation.provider).toBe('none');
  });
});

describe('buildDeliveryPackage — verification summary', () => {
  it('summarises the latest verification report and groups checks by category', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.verificationSummary).toMatchObject({
      verified: true,
      status: 'warning',
      verificationNumber: 2,
      policyVersion: '2026-08-07.1',
      requiredPassed: 5,
      requiredTotal: 5,
    });
    expect(pkg.verificationSummary.categories.map((entry) => entry.category)).toContain('route');
  });

  it('states plainly when a deployment has never been verified', () => {
    const pkg = buildDeliveryPackage(makeInputs({ verification: null }));

    expect(pkg.verificationSummary.verified).toBe(false);
    expect(pkg.verificationSummary.checksPassed).toBe(0);
  });

  it('carries the blocking failure line but never the whole evidence dump', () => {
    const failing = makeVerification({
      status: 'failed',
      checks: [check({ status: 'failed', errorMessage: 'HTTP 500' })],
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        warnings: 0,
        skipped: 0,
        unavailable: 0,
        requiredTotal: 1,
        requiredPassed: 0,
        requiredFailed: 1,
        blockingFailure: { checkId: 'availability.http_response', name: 'HTTP response', errorMessage: 'HTTP 500' },
      },
    });

    const pkg = buildDeliveryPackage(makeInputs({ verification: failing }));

    expect(pkg.verificationSummary.blockingFailure).toBe('HTTP response: HTTP 500');
  });
});

describe('buildDeliveryPackage — known limitations (Part 5)', () => {
  it('lists deferred scope from the manifest, never invented caveats', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const scoped = pkg.knownLimitations.filter((entry) => entry.source === 'manifest_scope');

    expect(scoped.map((entry) => entry.detail)).toEqual(['Online payments for treatments', 'Patient SMS reminders']);
  });

  it('lists environment variables that still need a human', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const environment = pkg.knownLimitations.filter((entry) => entry.source === 'environment');

    expect(environment.some((entry) => entry.title.includes('VITE_SUPABASE_ANON_KEY'))).toBe(true);
  });

  it('lists verification warnings as informational and failures as blocking', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const warning = pkg.knownLimitations.find((entry) => entry.id === 'verification:security.headers');

    expect(warning?.severity).toBe('informational');
  });

  it('flags an unverified deployment as a blocking limitation', () => {
    const pkg = buildDeliveryPackage(makeInputs({ verification: null }));

    expect(pkg.knownLimitations.find((entry) => entry.id === 'verification:none')?.severity).toBe('blocking');
  });

  it('flags a required-but-missing database', () => {
    const pkg = buildDeliveryPackage(makeInputs({ deployment: makeDeployment({ supabase: null }) }));

    expect(pkg.knownLimitations.some((entry) => entry.id === 'deployment:missing_supabase')).toBe(true);
  });

  it('produces no limitations from thin air when every artifact is clean', () => {
    const cleanManifest = makeManifest({
      environmentRequirements: [],
      requiredServices: [],
      featureScope: { inScopeFeatureIds: [], outOfScopeFeatureDescriptions: [] },
    });
    const pkg = buildDeliveryPackage(
      makeInputs({
        manifest: cleanManifest,
        productPackage: null,
        verification: makeVerification({ status: 'passed', checks: [check()] }),
        environmentReport: assessEnvironmentReadiness({
          environmentRequirements: [],
          github: null,
          supabase: null,
        }),
      }),
    );

    expect(pkg.knownLimitations).toEqual([]);
  });
});

describe('buildDeliveryPackage — acceptance checklist (Part 6)', () => {
  it('grounds every item in a real fact', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const byId = Object.fromEntries(pkg.acceptanceChecklist.items.map((item) => [item.id, item]));

    expect(byId.application_reachable.state).toBe('satisfied');
    expect(byId.deployment_verified.state).toBe('satisfied');
    expect(byId.repository_linked.state).toBe('satisfied');
    expect(byId.database_connected.state).toBe('satisfied');
    expect(byId.primary_routes_verified.state).toBe('satisfied');
    expect(byId.assets_verified.state).toBe('satisfied');
    expect(pkg.acceptanceChecklist.items.every((item) => item.evidence.length > 0)).toBe(true);
  });

  it('marks database items not applicable when no database is required', () => {
    const pkg = buildDeliveryPackage(makeInputs({ manifest: makeManifest({ requiredServices: [] }) }));
    const byId = Object.fromEntries(pkg.acceptanceChecklist.items.map((item) => [item.id, item]));

    expect(byId.database_connected.state).toBe('not_applicable');
    expect(byId.database_schema_applied.state).toBe('not_applicable');
  });

  it('leaves customer review and acceptance pending, as only the customer can complete them', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const customerItems = pkg.acceptanceChecklist.items.filter((item) => item.customerAction);

    expect(customerItems.map((item) => item.id)).toEqual(['customer_review', 'customer_acceptance']);
    expect(customerItems.every((item) => item.state === 'pending')).toBe(true);
    expect(pkg.acceptanceChecklist.customerActionCount).toBe(2);
  });

  it('does not claim reachability when nothing has been verified', () => {
    const pkg = buildDeliveryPackage(makeInputs({ verification: null }));
    const byId = Object.fromEntries(pkg.acceptanceChecklist.items.map((item) => [item.id, item]));

    expect(byId.application_reachable.state).toBe('pending');
    expect(byId.deployment_verified.state).toBe('pending');
  });
});

describe('buildDeliveryPackage — admin guide and support (Part 7)', () => {
  it('assembles the operational facts a customer admin needs', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.adminGuide).toMatchObject({
      previewUrl: 'https://riverside-dental-abc123.vercel.app',
      repositoryUrl: 'https://github.com/acme/riverside-dental',
      branch: 'main',
      supabaseProjectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      buildVersion: 'Manifest v4 (MVP-001)',
    });
    expect(pkg.adminGuide.procedures.map((entry) => entry.id)).toEqual(['redeploy', 'reconnect_providers', 'support']);
  });

  it('lists environment variable names and manual-entry status, never values', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.adminGuide.environmentVariables).toEqual([
      { name: 'VITE_SUPABASE_URL', status: 'resolved', requiresManualEntry: false },
      { name: 'VITE_SUPABASE_ANON_KEY', status: 'missing', requiresManualEntry: true },
    ]);
    expect(Object.keys(pkg.adminGuide.environmentVariables[0])).not.toContain('value');
  });

  it('never carries a secret anywhere in the package', () => {
    const pkg = buildDeliveryPackage(makeInputs());
    const serialised = JSON.stringify(pkg);

    for (const forbidden of ['apikey', 'service_role', 'password', 'Bearer ', 'ghp_', 'eyJ']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('asserts no technical contact, because Builders has no contact registry', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.support.contacts).toEqual([]);
    expect(pkg.support.note).toMatch(/does not maintain a contact registry/i);
    expect(pkg.support.consoles.some((entry) => entry.label === 'Supabase dashboard')).toBe(true);
  });
});

describe('buildDeliveryPackage — documentation, metadata and immutability', () => {
  it('indexes the Product Package without copying its content', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.documentation.available).toBe(true);
    expect(pkg.documentation.sections.map((section) => section.id)).toEqual(['requirements', 'architecture']);
    expect(pkg.documentation.missingSections[0]).toMatchObject({ id: 'qa' });
    expect(JSON.stringify(pkg.documentation)).not.toContain('content');
  });

  it('records package and generator versions plus which sources contributed', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(pkg.packageMetadata).toMatchObject({
      packageVersion: '1.0.0',
      generatorVersion: '1.0.0',
      deliveredAt: '2026-08-08T12:00:00.000Z',
      generatedBy: 'ezra',
    });
    expect(pkg.packageMetadata.sources.every((entry) => typeof entry.available === 'boolean')).toBe(true);
  });

  it('returns a deeply immutable package', () => {
    const pkg = buildDeliveryPackage(makeInputs());

    expect(Object.isFrozen(pkg)).toBe(true);
    expect(Object.isFrozen(pkg.acceptanceChecklist.items)).toBe(true);
    expect(() => {
      (pkg as { completeness: { score: number } }).completeness.score = 0;
    }).toThrow();
  });

  it('is deterministic — the same inputs always produce the same package', () => {
    expect(JSON.stringify(buildDeliveryPackage(makeInputs()))).toBe(JSON.stringify(buildDeliveryPackage(makeInputs())));
  });
});

describe('buildDeliveryPackage — multi-project isolation (Part 14)', () => {
  it('keeps three projects entirely separate', () => {
    const build = (suffix: string) =>
      buildDeliveryPackage(
        makeInputs({
          project: makeProject({ id: `proj-${suffix}`, name: `Project ${suffix.toUpperCase()}` }),
          deployment: makeDeployment({
            id: `dep-${suffix}`,
            projectId: `proj-${suffix}`,
            github: {
              ...makeDeployment().github!,
              repoFullName: `acme/app-${suffix}`,
              repoUrl: `https://github.com/acme/app-${suffix}`,
            },
            vercel: {
              ...makeDeployment().vercel!,
              metadata: { latestDeploymentUrl: `app-${suffix}.vercel.app`, latestDeploymentId: `dpl_${suffix}` },
            },
          }),
        }),
      );

    const a = build('a');
    const b = build('b');
    const c = build('c');

    expect(a.deploymentSummary.previewUrl).toBe('https://app-a.vercel.app');
    expect(b.deploymentSummary.previewUrl).toBe('https://app-b.vercel.app');
    expect(c.deploymentSummary.previewUrl).toBe('https://app-c.vercel.app');

    expect(JSON.stringify(a)).not.toContain('app-b.vercel.app');
    expect(JSON.stringify(b)).not.toContain('acme/app-c');
    expect(JSON.stringify(c)).not.toContain('proj-a');
  });
});
