import { describe, expect, it } from 'vitest';
import type { ApplicationManifestFile } from '~/lib/application-manifest/manifestTypes';
import type { DeliveryPackage } from '~/lib/deployment/deliveryPackageTypes';
import type { ReleaseBaseline } from '~/lib/deployment/releaseTypes';
import {
  buildBaselineSnapshot,
  diffBaselineSnapshots,
  extractTableNames,
  type ProductBaselineSnapshot,
} from './evolutionBaseline';

function releaseBaseline(overrides: Partial<ReleaseBaseline> = {}): ReleaseBaseline {
  return {
    capturedAt: '2026-08-10T09:00:00.000Z',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    manifestId: 'man-1',
    manifestVersion: 4,
    manifestPlanChecksum: 'fnv1a:plan',
    deliveryPackageId: 'pkg-1',
    verificationId: 'ver-1',
    repositoryFullName: 'acme/riverside-dental',
    deploymentUrl: 'https://riverside-dental.vercel.app',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    schemaVersion: 3,
    blueprintId: 'business-website',
    mvpCode: 'MVP-001',
    ...overrides,
  };
}

function deliveryPackage(): DeliveryPackage {
  return {
    applicationSummary: {
      routes: [
        { path: '/', name: 'Home' },
        { path: '/appointments', name: 'Appointments' },
      ],
      requiredServices: ['Supabase'],
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
        {
          code: 'FEAT-002',
          title: 'View treatments',
          state: 'implemented',
          verificationState: 'not_verified',
          source: 'feature_registry',
          evidence: '',
        },
        {
          code: 'FUTURE:payments',
          title: 'Online payments',
          state: 'future',
          verificationState: 'unavailable',
          source: 'manifest_scope',
          evidence: '',
        },
      ],
    },
    environmentSummary: {
      variables: [
        { name: 'VITE_SUPABASE_URL', status: 'resolved', source: 'provider', sensitive: false, detail: '' },
        { name: 'VITE_SUPABASE_ANON_KEY', status: 'missing', source: 'manual', sensitive: true, detail: '' },
      ],
    },
    documentation: {
      available: true,
      sections: [{ id: 'requirements', label: 'Requirements', fileCount: 1 }],
      missingSections: [],
    },
  } as unknown as DeliveryPackage;
}

function manifestFiles(): ApplicationManifestFile[] {
  return [
    {
      path: 'src/pages/AppointmentsPage.tsx',
      category: 'pages',
      componentName: 'AppointmentsPage',
      displayName: 'Appointments',
      featureIds: ['FEAT-001'],
    },
    { path: 'src/components/Navbar.tsx', category: 'components', componentName: 'Navbar', featureIds: [] },
    { path: 'api/appointments/index.ts', category: 'backend', featureIds: ['FEAT-001'] },
  ] as unknown as ApplicationManifestFile[];
}

const SCHEMA_SQL = `
create table if not exists appointments (id uuid primary key);
CREATE TABLE Patients (id uuid primary key);
create table "treatments" (id uuid primary key);
`;

describe('extractTableNames', () => {
  it('reads table names from generated schema SQL, case-insensitively', () => {
    expect(extractTableNames(SCHEMA_SQL)).toEqual(['appointments', 'patients', 'treatments']);
  });

  it('returns nothing for absent or unparseable SQL rather than guessing', () => {
    expect(extractTableNames(undefined)).toEqual([]);
    expect(extractTableNames('-- no tables here')).toEqual([]);
  });
});

describe('buildBaselineSnapshot', () => {
  const snapshot = () =>
    buildBaselineSnapshot({
      releaseBaseline: releaseBaseline(),
      releaseId: 'rel-1',
      semanticVersion: '1.0.0',
      deliveryPackage: deliveryPackage(),
      manifestFiles: manifestFiles(),
      schemaSql: SCHEMA_SQL,
      capturedAt: '2026-08-12T09:00:00.000Z',
    });

  it('assembles the released product from the release baseline, not current state', () => {
    const result = snapshot();

    expect(result).toMatchObject({
      releaseId: 'rel-1',
      semanticVersion: '1.0.0',
      manifestVersion: 4,
      manifestPlanChecksum: 'fnv1a:plan',
      repositoryFullName: 'acme/riverside-dental',
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      schemaVersion: 3,
      mvpCode: 'MVP-001',
    });
  });

  it('excludes deferred features — a baseline describes what was delivered', () => {
    expect(snapshot().features.map((feature) => feature.code)).toEqual(['FEAT-001', 'FEAT-002']);
  });

  it('carries routes, files, tables, environment variables and services', () => {
    const result = snapshot();

    expect(result.routes.map((route) => route.path)).toEqual(['/', '/appointments']);
    expect(result.files).toHaveLength(3);
    expect(result.databaseTables).toEqual(['appointments', 'patients', 'treatments']);
    expect(result.environmentVariables).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(result.requiredServices).toEqual(['Supabase']);
  });

  it('identifies API surfaces from the manifest file plan, never from a route name', () => {
    expect(snapshot().apiSurfaces).toEqual(['api/appointments/index.ts']);
  });

  it('degrades to an empty but well-formed snapshot when artifacts are missing', () => {
    const result = buildBaselineSnapshot({
      releaseBaseline: releaseBaseline({ manifestVersion: undefined }),
      deliveryPackage: null,
      manifestFiles: [],
      capturedAt: '2026-08-12T09:00:00.000Z',
    });

    expect(result.features).toEqual([]);
    expect(result.routes).toEqual([]);
    expect(result.databaseTables).toEqual([]);
    expect(result.capturedAt).toBe('2026-08-12T09:00:00.000Z');
  });
});

describe('diffBaselineSnapshots (prepared for Sprint 96)', () => {
  const base = (overrides: Partial<ProductBaselineSnapshot> = {}): ProductBaselineSnapshot => ({
    capturedAt: '2026-08-12T09:00:00.000Z',
    manifestPlanChecksum: 'fnv1a:plan',
    features: [{ code: 'FEAT-001', title: 'Book', state: 'verified' }],
    routes: [{ path: '/', name: 'Home' }],
    files: [{ path: 'src/pages/HomePage.tsx', category: 'pages', featureIds: [] }],
    databaseTables: ['appointments'],
    environmentVariables: ['VITE_SUPABASE_URL'],
    requiredServices: ['Supabase'],
    apiSurfaces: [],
    documentationSections: [],
    ...overrides,
  });

  it('reports no changes between identical snapshots', () => {
    const diff = diffBaselineSnapshots(base(), base());

    expect(diff.hasChanges).toBe(false);
    expect(diff.manifestChanged).toBe(false);
    expect(diff.features.unchanged).toHaveLength(1);
  });

  it('detects added, removed and changed entries', () => {
    const next = base({
      features: [
        { code: 'FEAT-001', title: 'Book an appointment', state: 'verified' },
        { code: 'FEAT-003', title: 'Cancel', state: 'implemented' },
      ],
      routes: [],
      databaseTables: ['appointments', 'cancellations'],
    });

    const diff = diffBaselineSnapshots(base(), next);

    expect(diff.features.added.map((feature) => feature.code)).toEqual(['FEAT-003']);
    expect(diff.features.changed).toHaveLength(1);
    expect(diff.routes.removed.map((route) => route.path)).toEqual(['/']);
    expect(diff.databaseTables.added).toEqual(['cancellations']);
    expect(diff.hasChanges).toBe(true);
  });

  it('flags a moved manifest plan checksum as a change on its own', () => {
    const diff = diffBaselineSnapshots(base(), base({ manifestPlanChecksum: 'fnv1a:other' }));

    expect(diff.manifestChanged).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });

  it('does not claim a manifest change when a checksum is unknown', () => {
    expect(diffBaselineSnapshots(base({ manifestPlanChecksum: undefined }), base()).manifestChanged).toBe(false);
  });
});
