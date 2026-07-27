import { describe, expect, it } from 'vitest';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import type { DeliveryPackage, DeliveryPackageRecord } from '~/lib/deployment/deliveryPackageTypes';
import type { DeploymentHistoryEvent, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ReleaseRecord } from '~/lib/deployment/releaseTypes';
import type { DeploymentVerification } from '~/lib/deployment/verificationTypes';
import type { Project } from '~/lib/stores/projects';
import { buildRelease, calculateReleaseIntegrity, type ReleaseInputs } from './releaseManagementService';

/** The builder is pure, so every test constructs its inputs directly — no BuildersDB, no mocks. */

const CLOCK = () => '2026-08-10T09:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Riverside Dental Clinic',
    icon: '🦷',
    color: 'blue',
    createdAt: '2026-06-01T00:00:00.000Z',
    projectType: 'guided_engineering',
    createdFrom: 'guided_engineering',
    blueprintId: 'business-website',
    artifacts: [],
    databaseActivation: {
      schema: { generatedAt: '', tableCount: 6, schemaSql: '', migrationSql: '', schemaVersion: 3 },
    },
    ...overrides,
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
      metadata: { schemaVersion: 3 },
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
      },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
    ...overrides,
  };
}

function makeHistory(): DeploymentHistoryEvent[] {
  return [
    {
      id: 'evt-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      eventType: 'push_successful',
      metadata: { commitSha: 'abc123def456789' },
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
    planChecksum: 'fnv1a:plan',
    sourceContentChecksum: 'fnv1a:content',
    ...overrides,
  } as ApplicationManifest;
}

function makeDeliverySummary(): DeliveryPackage {
  return {
    projectInformation: { projectId: 'proj-1', projectName: 'Riverside Dental Clinic' },
    verificationSummary: {
      verified: true,
      status: 'passed',
      checksPassed: 9,
      checksFailed: 0,
      warnings: 0,
      requiredPassed: 6,
      requiredTotal: 6,
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
          evidence: '',
        },
      ],
      implementedCount: 1,
      verifiedCount: 1,
      futureCount: 0,
      optionalCount: 0,
    },
    knownLimitations: [],
  } as unknown as DeliveryPackage;
}

function makeDeliveryPackage(overrides: Partial<DeliveryPackageRecord> = {}): DeliveryPackageRecord {
  return {
    id: 'pkg-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    packageNumber: 2,
    packageVersion: '1.0.0',
    generatorVersion: '1.0.0',
    status: 'generated',
    manifestVersion: 4,
    verificationId: 'ver-1',
    completenessScore: 96,
    completenessLevel: 'complete',
    deliverySummary: makeDeliverySummary(),
    generatedAt: '2026-08-08T12:00:00.000Z',
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

function makeVerification(overrides: Partial<DeploymentVerification> = {}): DeploymentVerification {
  return {
    id: 'ver-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    verificationNumber: 2,
    status: 'passed',
    policyVersion: '2026-08-07.1',
    targetUrl: 'https://riverside-dental-abc123.vercel.app',
    startedAt: '2026-08-07T09:00:00.000Z',
    completedAt: '2026-08-07T09:00:05.000Z',
    checks: [],
    summary: {
      total: 9,
      passed: 9,
      failed: 0,
      warnings: 0,
      skipped: 0,
      unavailable: 0,
      requiredTotal: 6,
      requiredPassed: 6,
      requiredFailed: 0,
    },
    message: 'ok',
    createdAt: '2026-08-07T09:00:00.000Z',
    ...overrides,
  };
}

function makeInputs(overrides: Partial<ReleaseInputs> = {}): ReleaseInputs {
  return {
    project: makeProject(),
    deployment: makeDeployment(),
    history: makeHistory(),
    deliveryPackage: makeDeliveryPackage(),
    verification: makeVerification(),
    manifest: makeManifest(),
    existingReleases: [],
    ...overrides,
  };
}

function makeExistingRelease(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    id: 'rel-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    releaseNumber: 1,
    semanticVersion: '1.0.0',
    releaseName: 'v1.0.0',
    releaseType: 'major',
    releaseStatus: 'released',
    releaseDate: '2026-08-09T09:00:00.000Z',
    baseline: { capturedAt: '2026-08-09T09:00:00.000Z', deploymentId: 'dep-1', projectId: 'proj-1' },
    releaseNotes: { summary: '', categories: [], breakingChanges: [], knownIssues: [] },
    integrity: { complete: true, checks: [], checksum: 'x' },
    customerAcceptance: { state: 'pending', conditions: [] },
    metadata: { modelVersion: '1.0.0', intendedType: 'major', intentMatchesVersion: true },
    createdAt: '2026-08-09T09:00:00.000Z',
    updatedAt: '2026-08-09T09:00:00.000Z',
    ...overrides,
  };
}

describe('buildRelease — happy path', () => {
  it('creates release #1 at the explicit version the operator supplied', () => {
    const result = buildRelease({
      inputs: makeInputs(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      createdBy: 'ezra',
      clock: CLOCK,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.release).toMatchObject({
        releaseNumber: 1,
        semanticVersion: '1.0.0',
        releaseName: 'v1.0.0',
        releaseType: 'major',
        releaseStatus: 'released',
        releaseDate: '2026-08-10T09:00:00.000Z',
      });
      expect(result.release.customerAcceptance.state).toBe('pending');
      expect(result.release.metadata.createdBy).toBe('ezra');
    }
  });

  it('numbers a follow-up release from the existing ones', () => {
    const result = buildRelease({
      inputs: makeInputs({ existingReleases: [makeExistingRelease({ releaseNumber: 3, semanticVersion: '1.2.0' })] }),
      semanticVersion: '1.2.1',
      releaseType: 'patch',
      clock: CLOCK,
    });

    expect(result.ok && result.release.releaseNumber).toBe(4);
    expect(result.ok && result.release.metadata.previousVersion).toBe('1.2.0');
  });

  it('uses the supplied release name, falling back to the version rather than inventing a codename', () => {
    const named = buildRelease({
      inputs: makeInputs(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      releaseName: 'Launch',
      clock: CLOCK,
    });
    const unnamed = buildRelease({
      inputs: makeInputs(),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(named.ok && named.release.releaseName).toBe('Launch');
    expect(unnamed.ok && unnamed.release.releaseName).toBe('v1.0.0');
  });

  it('records the operator intent and whether the typed version matches it', () => {
    const result = buildRelease({
      inputs: makeInputs({ existingReleases: [makeExistingRelease()] }),
      semanticVersion: '2.0.0',
      releaseType: 'minor',
      clock: CLOCK,
    });

    expect(result.ok && result.release.metadata).toMatchObject({
      intendedType: 'minor',
      intentMatchesVersion: false,
    });
    expect(result.ok && result.release.releaseType).toBe('minor');
  });

  it('returns a deeply immutable release', () => {
    const result = buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });

    expect(result.ok && Object.isFrozen(result.release)).toBe(true);
    expect(result.ok && Object.isFrozen(result.release.baseline)).toBe(true);
    expect(() => {
      if (result.ok) {
        (result.release as { semanticVersion: string }).semanticVersion = '9.9.9';
      }
    }).toThrow();
  });

  it('is deterministic for the same inputs', () => {
    const build = () =>
      buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe('buildRelease — baseline (Parts 8/9)', () => {
  it('freezes every reference a future change will be compared against', () => {
    const result = buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });

    expect(result.ok && result.release.baseline).toMatchObject({
      capturedAt: '2026-08-10T09:00:00.000Z',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      manifestId: 'man-1',
      manifestVersion: 4,
      manifestPlanChecksum: 'fnv1a:plan',
      deliveryPackageId: 'pkg-1',
      deliveryPackageNumber: 2,
      verificationId: 'ver-1',
      verificationNumber: 2,
      verificationStatus: 'passed',
      blueprintId: 'business-website',
      mvpId: 'mvp-1',
      mvpCode: 'MVP-001',
      repositoryFullName: 'acme/riverside-dental',
      branch: 'main',
      gitCommit: 'abc123def456789',
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      schemaVersion: 3,
      vercelDeploymentId: 'dpl_1',
      deploymentUrl: 'https://riverside-dental-abc123.vercel.app',
    });
  });

  it('leaves the git tag undefined — tagging is out of scope', () => {
    const result = buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });

    expect(result.ok && result.release.baseline.gitTag).toBeUndefined();
  });

  it('normalises the deployment URL scheme', () => {
    const result = buildRelease({
      inputs: makeInputs({
        deployment: makeDeployment({
          vercel: { ...makeDeployment().vercel!, metadata: { latestDeploymentUrl: 'app.vercel.app' } },
        }),
      }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result.ok && result.release.baseline.deploymentUrl).toBe('https://app.vercel.app');
  });

  it('produces a checksum that changes when the baseline changes', () => {
    const first = buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });
    const second = buildRelease({
      inputs: makeInputs({ manifest: makeManifest({ version: 5, planChecksum: 'fnv1a:other' }) }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (first.ok && second.ok) {
      expect(first.release.integrity.checksum).not.toBe(second.release.integrity.checksum);
    }
  });
});

describe('buildRelease — integrity and refusal (Part 14)', () => {
  it('refuses when there is no delivery package', () => {
    const result = buildRelease({
      inputs: makeInputs({ deliveryPackage: null }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result).toMatchObject({ ok: false, code: 'integrity' });
    expect(result.ok === false && result.message).toMatch(/No delivery package/i);
  });

  it('refuses when the deployment was never verified', () => {
    const result = buildRelease({
      inputs: makeInputs({ verification: null }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result).toMatchObject({ ok: false, code: 'integrity' });
  });

  it('refuses when verification failed', () => {
    const result = buildRelease({
      inputs: makeInputs({ verification: makeVerification({ status: 'failed' }) }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result).toMatchObject({ ok: false, code: 'integrity' });
  });

  it('allows a warning verification to be released', () => {
    const result = buildRelease({
      inputs: makeInputs({ verification: makeVerification({ status: 'warning' }) }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses when there is no deployment URL or repository', () => {
    expect(
      buildRelease({
        inputs: makeInputs({
          deployment: makeDeployment({
            vercel: { ...makeDeployment().vercel!, metadata: {}, productionUrl: undefined },
          }),
        }),
        semanticVersion: '1.0.0',
        releaseType: 'major',
        clock: CLOCK,
      }),
    ).toMatchObject({ ok: false, code: 'integrity' });

    expect(
      buildRelease({
        inputs: makeInputs({ deployment: makeDeployment({ github: null }) }),
        semanticVersion: '1.0.0',
        releaseType: 'major',
        clock: CLOCK,
      }),
    ).toMatchObject({ ok: false, code: 'integrity' });
  });

  it('refuses when there is no manifest to baseline against', () => {
    expect(
      buildRelease({
        inputs: makeInputs({ manifest: null }),
        semanticVersion: '1.0.0',
        releaseType: 'major',
        clock: CLOCK,
      }),
    ).toMatchObject({ ok: false, code: 'integrity' });
  });

  it('does not block on advisory integrity checks', () => {
    const result = buildRelease({
      inputs: makeInputs({ history: [], deployment: makeDeployment({ supabase: null }) }),
      semanticVersion: '1.0.0',
      releaseType: 'major',
      clock: CLOCK,
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      const advisory = result.release.integrity.checks.filter((check) => !check.required);
      expect(advisory.some((check) => !check.satisfied)).toBe(true);
      expect(result.release.integrity.complete).toBe(true);
    }
  });

  it('refuses an invalid or duplicate version before building anything', () => {
    expect(
      buildRelease({ inputs: makeInputs(), semanticVersion: '1.0', releaseType: 'patch', clock: CLOCK }),
    ).toMatchObject({ ok: false, code: 'invalid_version' });

    expect(
      buildRelease({
        inputs: makeInputs({ existingReleases: [makeExistingRelease()] }),
        semanticVersion: '1.0.0',
        releaseType: 'patch',
        clock: CLOCK,
      }),
    ).toMatchObject({ ok: false, code: 'invalid_version' });
  });

  it('explains every integrity check it evaluated', () => {
    const inputs = makeInputs();
    const integrity = calculateReleaseIntegrity(inputs, {
      capturedAt: CLOCK(),
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      deploymentUrl: 'https://app.vercel.app',
      repositoryFullName: 'acme/app',
      manifestVersion: 4,
    });

    expect(integrity.checks.every((check) => check.detail.length > 0)).toBe(true);
    expect(integrity.checks.map((check) => check.id)).toEqual([
      'delivery_package',
      'verification',
      'deployment_url',
      'repository',
      'manifest',
      'git_commit',
      'database',
    ]);
  });
});

describe('buildRelease — release notes and isolation', () => {
  it('projects the delivery package into release notes rather than re-collecting', () => {
    const result = buildRelease({ inputs: makeInputs(), semanticVersion: '1.0.0', releaseType: 'major', clock: CLOCK });

    expect(result.ok && result.release.releaseNotes.summary).toContain('Riverside Dental Clinic 1.0.0');
    expect(
      result.ok &&
        result.release.releaseNotes.categories.find((group) => group.category === 'new_features')!.entries[0].title,
    ).toBe('Book an appointment');
  });

  it('keeps three projects entirely separate', () => {
    const build = (suffix: string) =>
      buildRelease({
        inputs: makeInputs({
          project: makeProject({ id: `proj-${suffix}`, name: `Project ${suffix}` }),
          deployment: makeDeployment({
            id: `dep-${suffix}`,
            projectId: `proj-${suffix}`,
            github: { ...makeDeployment().github!, repoFullName: `acme/app-${suffix}` },
            vercel: {
              ...makeDeployment().vercel!,
              metadata: { latestDeploymentUrl: `app-${suffix}.vercel.app`, latestDeploymentId: `dpl_${suffix}` },
            },
          }),
        }),
        semanticVersion: '1.0.0',
        releaseType: 'major',
        clock: CLOCK,
      });

    const a = build('a');
    const b = build('b');
    const c = build('c');

    expect(a.ok && a.release.baseline.deploymentUrl).toBe('https://app-a.vercel.app');
    expect(b.ok && b.release.baseline.deploymentUrl).toBe('https://app-b.vercel.app');
    expect(c.ok && c.release.baseline.deploymentUrl).toBe('https://app-c.vercel.app');

    expect(JSON.stringify(a)).not.toContain('app-b.vercel.app');
    expect(JSON.stringify(b)).not.toContain('acme/app-c');

    // Different baselines must fingerprint differently — no shared identity across projects.
    const checksums = [a, b, c].map((result) => (result.ok ? result.release.integrity.checksum : ''));
    expect(new Set(checksums).size).toBe(3);
  });
});
