import { describe, expect, it } from 'vitest';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeploymentVerification, VerificationCheck } from '~/lib/deployment/verificationTypes';
import type { Feature } from '~/lib/features/featureTypes';
import { buildFeatureInventory } from './deliveryFeatureInventory';

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'f-1',
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    code: 'FEAT-001',
    moduleSlug: 'appointments',
    title: 'Book an appointment',
    priority: 'Must Have',
    dependsOn: [],
    status: 'deployed',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function deployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
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

function manifest(overrides: Partial<ApplicationManifest> = {}): ApplicationManifest {
  return { routes: [], environmentRequirements: [], ...overrides } as unknown as ApplicationManifest;
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

function verification(overrides: Partial<DeploymentVerification> = {}): DeploymentVerification {
  return {
    id: 'ver-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    verificationNumber: 1,
    status: 'passed',
    policyVersion: 'v',
    targetUrl: 'https://app.vercel.app',
    startedAt: '2026-08-07T00:00:00.000Z',
    checks: [check()],
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      warnings: 0,
      skipped: 0,
      unavailable: 0,
      requiredTotal: 1,
      requiredPassed: 1,
      requiredFailed: 0,
    },
    message: 'ok',
    createdAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFeatureInventory — Feature registry (primary source)', () => {
  it('marks a deployed feature verified when the live application was verified', () => {
    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features[0]).toMatchObject({
      code: 'FEAT-001',
      state: 'verified',
      verificationState: 'verified',
      source: 'feature_registry',
    });
    expect(inventory.verifiedCount).toBe(1);
  });

  it('marks a deployed feature only implemented when nothing verified the live application', () => {
    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: manifest(),
      deployment: deployment(),
      verification: null,
    });

    expect(inventory.features[0]).toMatchObject({ state: 'implemented', verificationState: 'unavailable' });
    expect(inventory.verifiedCount).toBe(0);
  });

  it('does not treat a failed verification as evidence of a verified feature', () => {
    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification({ status: 'failed' }),
    });

    expect(inventory.features[0].state).toBe('implemented');
    expect(inventory.features[0].verificationState).toBe('not_verified');
  });

  it('classifies generated and qa_passed features as implemented', () => {
    const inventory = buildFeatureInventory({
      features: [
        feature({ code: 'FEAT-002', status: 'generated' }),
        feature({ code: 'FEAT-003', status: 'qa_passed' }),
      ],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features.map((entry) => entry.state)).toEqual(['implemented', 'implemented']);
  });

  it('classifies planned and in-progress features as future', () => {
    const inventory = buildFeatureInventory({
      features: [
        feature({ code: 'FEAT-004', status: 'planned' }),
        feature({ code: 'FEAT-005', status: 'in_progress' }),
      ],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features.map((entry) => entry.state)).toEqual(['future', 'future']);
    expect(inventory.futureCount).toBe(2);
  });

  it("classifies Could Have / Won't Have features as optional", () => {
    const inventory = buildFeatureInventory({
      features: [
        feature({ code: 'FEAT-006', priority: 'Could Have' }),
        feature({ code: 'FEAT-007', priority: "Won't Have" }),
      ],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features.map((entry) => entry.state)).toEqual(['optional', 'optional']);
    expect(inventory.optionalCount).toBe(2);
  });

  it('states the evidence behind every classification', () => {
    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: manifest(),
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features.every((entry) => entry.evidence.length > 0)).toBe(true);
  });
});

describe('buildFeatureInventory — fallback and capability sources', () => {
  it('falls back to declared manifest routes only when the Feature registry is empty', () => {
    const routed = manifest({
      routes: [
        { path: '/', name: 'Home', componentName: 'HomePage', filePath: 'src/pages/HomePage.tsx' },
        { path: '/about', name: 'About', componentName: 'AboutPage', filePath: 'src/pages/AboutPage.tsx' },
      ],
    } as Partial<ApplicationManifest>);

    const inventory = buildFeatureInventory({
      features: [],
      manifest: routed,
      deployment: deployment(),
      verification: verification({ checks: [check(), check({ id: 'route:/about', category: 'route' })] }),
    });

    expect(inventory.features.map((entry) => entry.source)).toEqual(['manifest_routes', 'manifest_routes']);
    expect(inventory.features.every((entry) => entry.state === 'verified')).toBe(true);
  });

  it('never double-counts routes alongside a populated Feature registry', () => {
    const routed = manifest({
      routes: [{ path: '/', name: 'Home', componentName: 'HomePage', filePath: 'src/pages/HomePage.tsx' }],
    } as Partial<ApplicationManifest>);

    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: routed,
      deployment: deployment(),
      verification: verification(),
    });

    expect(inventory.features.filter((entry) => entry.source === 'manifest_routes')).toHaveLength(0);
  });

  it('records a connected database as a delivered capability', () => {
    const inventory = buildFeatureInventory({
      features: [],
      manifest: manifest(),
      deployment: deployment({
        supabase: {
          id: 'sb-1',
          deploymentId: 'dep-1',
          projectId: 'proj-1',
          supabaseProjectRef: 'abcdefghijklmnopqrst',
          status: 'connected',
          metadata: {},
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
      }),
      verification: verification({
        checks: [check({ id: 'database.supabase_reachable', category: 'database', status: 'passed' })],
      }),
    });

    expect(inventory.features.find((entry) => entry.code === 'CAP:database')).toMatchObject({
      state: 'connected',
      verificationState: 'verified',
      source: 'provider',
    });
  });

  it("records runtime configuration as configured, from the manifest's declared variables", () => {
    const inventory = buildFeatureInventory({
      features: [],
      manifest: manifest({ environmentRequirements: ['VITE_SUPABASE_URL'] } as Partial<ApplicationManifest>),
      deployment: deployment(),
      verification: null,
    });

    expect(inventory.features.find((entry) => entry.code === 'CAP:runtime_configuration')).toMatchObject({
      state: 'configured',
      source: 'manifest_scope',
    });
  });

  it('lists deferred scope as future, never as delivered', () => {
    const inventory = buildFeatureInventory({
      features: [feature()],
      manifest: manifest({
        featureScope: { inScopeFeatureIds: ['FEAT-001'], outOfScopeFeatureDescriptions: ['Online payments'] },
      } as Partial<ApplicationManifest>),
      deployment: deployment(),
      verification: verification(),
    });

    const deferred = inventory.features.find((entry) => entry.title === 'Online payments');
    expect(deferred).toMatchObject({ state: 'future', source: 'manifest_scope' });
    expect(inventory.implementedCount).toBe(1);
  });

  it('produces an empty inventory rather than inventing entries when nothing is known', () => {
    const inventory = buildFeatureInventory({
      features: [],
      manifest: null,
      deployment: deployment(),
      verification: null,
    });

    expect(inventory.features).toEqual([]);
    expect(inventory.implementedCount).toBe(0);
  });
});
