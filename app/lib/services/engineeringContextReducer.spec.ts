import { describe, expect, it } from 'vitest';
import { ROLE_ARTIFACT_CHAIN } from '~/lib/projects/collaborationContext';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import type { EngineeringScope, ReviewRequirement } from '~/lib/evolution/engineeringScopeTypes';
import { reduceEngineeringContext, upstreamArtifactsFor } from './engineeringContextReducer';

function baseline(overrides: Partial<ProductBaselineSnapshot> = {}): ProductBaselineSnapshot {
  return {
    capturedAt: '2026-08-14T09:00:00.000Z',
    features: [],
    routes: [],
    files: [
      { path: 'src/pages/AppointmentsPage.tsx', category: 'pages', featureIds: ['FEAT-001'] },
      { path: 'src/components/Navbar.tsx', category: 'components', featureIds: [] },
      { path: 'api/appointments/index.ts', category: 'backend', featureIds: ['FEAT-001'] },
      { path: 'src/pages/HomePage.tsx', category: 'pages', featureIds: [] },
      { path: 'package.json', category: 'config', featureIds: [] },
    ],
    databaseTables: [],
    environmentVariables: [],
    requiredServices: [],
    apiSurfaces: [],
    documentationSections: [],
    ...overrides,
  };
}

function scope(overrides: Partial<EngineeringScope> = {}): EngineeringScope {
  return {
    changeRequestId: 'cr-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    baselineManifestVersion: 4,
    affectedFeatures: [{ identifier: 'FEAT-001', label: 'Book', evidence: 'exact' }],
    affectedPages: [{ identifier: 'src/pages/AppointmentsPage.tsx', label: 'Appointments', evidence: 'owns FEAT-001' }],
    affectedComponents: [{ identifier: 'api/appointments/index.ts', label: 'api', evidence: 'owns FEAT-001' }],
    affectedDatabaseObjects: [{ identifier: 'appointments', label: 'appointments', evidence: 'exact' }],
    affectedApis: [{ identifier: 'api/appointments/index.ts', label: 'api', evidence: 'exact' }],
    affectedEnvironment: [{ identifier: 'VITE_SUPABASE_URL', label: 'VITE_SUPABASE_URL', evidence: 'exact' }],
    affectedDocuments: [],
    affectedRoles: ['frontend', 'backend', 'database', 'devops', 'qa'],
    unaffectedAreas: [{ area: 'authentication', detail: 'untouched' }],
    metadata: {
      classification: 'feature_addition',
      riskLevel: 'medium',
      complexityLevel: 'medium',
      requiresHumanReview: false,
      capturedAt: '2026-08-14T10:00:00.000Z',
    },
    ...overrides,
  };
}

const reviews: ReviewRequirement[] = [
  { stage: 'product_review', label: 'Product Review', required: false, reasoning: 'x' },
  { stage: 'roadmap_review', label: 'Roadmap Review', required: false, reasoning: 'x' },
  { stage: 'code_review', label: 'Code Review', required: true, reasoning: 'x' },
  { stage: 'customer_signoff', label: 'Customer sign-off', required: false, reasoning: 'x' },
];

function reduce(roles: EngineeringScope['affectedRoles'], overrides: Partial<EngineeringScope> = {}) {
  return reduceEngineeringContext({
    scope: scope({ ...overrides, affectedRoles: roles }),
    baseline: baseline(),
    selectedRoles: roles,
    reviews,
  });
}

describe('upstreamArtifactsFor', () => {
  it('mirrors the existing ROLE_ARTIFACT_CHAIN traversal rather than a second list', () => {
    expect(upstreamArtifactsFor('database')).toEqual([
      'requirements-draft',
      'product-owner-draft',
      'architecture-draft',
    ]);
  });

  it('gives the first role no upstream artifacts', () => {
    expect(upstreamArtifactsFor('requirements')).toEqual([]);
  });

  it('gives the last role every upstream artifact in the chain', () => {
    expect(upstreamArtifactsFor('devops')).toHaveLength(ROLE_ARTIFACT_CHAIN.length - 1);
  });
});

describe('reduceEngineeringContext (Part 4)', () => {
  it('produces one descriptor per selected role, in pipeline order', () => {
    const contexts = reduce(['qa', 'frontend', 'database']);

    expect(contexts.map((context) => context.role)).toEqual(['database', 'frontend', 'qa']);
  });

  it('gives each role only the scope slices it can legitimately use', () => {
    const [database] = reduce(['database']);

    expect(database.includedDatabaseObjects).toEqual(['appointments']);
    expect(database.includedFiles).toEqual([]);
    expect(database.includedApis).toEqual([]);
    expect(database.includedEnvironment).toEqual([]);
  });

  it('filters files by the categories a role works on', () => {
    const [frontend] = reduce(['frontend']);
    const [backend] = reduce(['backend']);

    expect(frontend.includedFiles).toEqual(['src/pages/AppointmentsPage.tsx']);
    expect(backend.includedFiles).toEqual(['api/appointments/index.ts']);
  });

  it('gives DevOps only environment configuration', () => {
    const [devops] = reduce(['devops']);

    expect(devops.includedEnvironment).toEqual(['VITE_SUPABASE_URL']);
    expect(devops.includedFeatures).toEqual([]);
    expect(devops.includedFiles).toEqual([]);
  });

  it('names what is excluded, so the reduction is inspectable rather than implied', () => {
    const [devops] = reduce(['devops']);

    expect(devops.excluded).toEqual(
      expect.arrayContaining(['released feature list', 'generated file set', 'database schema', 'API surfaces']),
    );
    expect(devops.excluded.join(' ')).toMatch(/the impact analysis found unaffected/);
  });

  it('reports how much of the released file set each role would see', () => {
    const [frontend] = reduce(['frontend']);
    const [devops] = reduce(['devops']);

    expect(frontend.contextReductionRatio).toBe(0.2);
    expect(devops.contextReductionRatio).toBe(0);
  });

  it('never sends a role unrelated project context', () => {
    const contexts = reduce(['frontend', 'database', 'devops']);
    const everything = JSON.stringify(contexts.map((context) => context.includedFiles));

    expect(everything).not.toContain('src/pages/HomePage.tsx');
    expect(everything).not.toContain('package.json');
    expect(everything).not.toContain('src/components/Navbar.tsx');
  });

  it('includes the upstream artifacts the existing chain says a role reads', () => {
    const [frontend] = reduce(['frontend']);

    expect(frontend.includedUpstreamArtifacts).toContain('architecture-draft');
    expect(frontend.includedUpstreamArtifacts).not.toContain('frontend-draft');
  });

  it('attaches only the reviews relevant to each role', () => {
    const [database] = reduce(['database']);
    const [devops] = reduce(['devops']);

    expect(database.includedReviews).toEqual(['code_review']);
    expect(devops.includedReviews).toEqual([]);
  });

  it('returns nothing for an empty selection — unselected roles get no context because they do not run', () => {
    expect(reduce([])).toEqual([]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(reduce(['frontend', 'qa']))).toBe(JSON.stringify(reduce(['frontend', 'qa'])));
  });
});
