import { describe, expect, it } from 'vitest';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import type { EvolutionPlan } from '~/lib/evolution/evolutionPlan';
import type { ImpactAnalysis, ImpactItem, ImpactSection } from '~/lib/evolution/impactTypes';
import { buildChangeSet, buildEngineeringScope, buildIncrementalPlan } from './incrementalEngineeringService';

/** The planner is pure, so every test constructs its inputs directly. No BuildersDB, no AI, no mocks. */

const CAPTURED_AT = '2026-08-14T10:00:00.000Z';

function item(overrides: Partial<ImpactItem> = {}): ImpactItem {
  return {
    kind: 'feature',
    identifier: 'FEAT-001',
    label: 'Book an appointment',
    confidence: 'high',
    evidence: 'exact match on "FEAT-001"',
    ...overrides,
  };
}

function section(id: ImpactSection['id'], items: ImpactItem[], affected = items.length > 0): ImpactSection {
  return { id, label: `${id} Impact`, affected, items, confidence: 'high', detail: `${items.length} item(s)` };
}

function baseline(overrides: Partial<ProductBaselineSnapshot> = {}): ProductBaselineSnapshot {
  return {
    releaseId: 'rel-1',
    semanticVersion: '1.0.0',
    capturedAt: '2026-08-14T09:00:00.000Z',
    manifestVersion: 4,
    manifestPlanChecksum: 'fnv1a:plan',
    features: [
      { code: 'FEAT-001', title: 'Book an appointment', state: 'verified' },
      { code: 'FEAT-002', title: 'View treatments', state: 'implemented' },
    ],
    routes: [
      { path: '/', name: 'Home' },
      { path: '/appointments', name: 'Appointments' },
    ],
    files: [
      {
        path: 'src/pages/AppointmentsPage.tsx',
        category: 'pages',
        componentName: 'AppointmentsPage',
        featureIds: ['FEAT-001'],
      },
      { path: 'src/components/Navbar.tsx', category: 'components', componentName: 'Navbar', featureIds: [] },
      { path: 'src/index.css', category: 'styles', featureIds: [] },
      { path: 'api/appointments/index.ts', category: 'backend', featureIds: ['FEAT-001'] },
      { path: 'src/pages/HomePage.tsx', category: 'pages', componentName: 'HomePage', featureIds: [] },
      { path: 'package.json', category: 'config', featureIds: [] },
    ],
    databaseTables: ['appointments', 'patients'],
    environmentVariables: ['VITE_SUPABASE_URL'],
    requiredServices: ['Supabase'],
    apiSurfaces: ['api/appointments/index.ts'],
    documentationSections: ['Requirements'],
    ...overrides,
  };
}

function impact(overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return {
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    baselineCapturedAt: '2026-08-14T09:00:00.000Z',
    analysedAt: '2026-08-14T09:30:00.000Z',
    classification: {
      category: 'feature_addition',
      source: 'declared',
      confidence: 'high',
      reasoning: 'x',
      alternatives: [],
    },
    sections: [
      section('business', [item()]),
      section('technical', [
        item({
          kind: 'component',
          identifier: 'src/pages/AppointmentsPage.tsx',
          label: 'Appointments',
          evidence: 'owns FEAT-001',
        }),
        item({ kind: 'file', identifier: 'api/appointments/index.ts', label: 'api', evidence: 'owns FEAT-001' }),
      ]),
      section('ui', [item({ kind: 'route', identifier: '/appointments', label: 'Appointments', evidence: 'exact' })]),
      section('backend', [
        item({ kind: 'api_surface', identifier: 'api/appointments/index.ts', label: 'api', evidence: 'exact' }),
      ]),
      section('database', []),
      section('security', []),
      section('infrastructure', []),
      section('testing', [
        item({
          kind: 'verification_check',
          identifier: 'route:/appointments',
          label: 'Route check',
          evidence: 'covers',
        }),
      ]),
      section('deployment', [], true),
      section('documentation', []),
    ],
    unaffectedAreas: [
      { area: 'database', detail: '2 released table(s) appear untouched.' },
      { area: 'infrastructure', detail: 'Environment configuration appears untouched.' },
      { area: 'authentication', detail: 'The authentication surface appears untouched.' },
      { area: 'documentation', detail: 'No delivered documentation section appears to need revisiting.' },
    ],
    risk: { level: 'medium', score: 3, factors: [], reasoning: 'medium' },
    complexity: { level: 'medium', score: 4, factors: [], reasoning: 'medium' },
    roles: [
      { role: 'frontend_engineer', reason: 'Pages, components or routes are implicated.' },
      { role: 'ui_ux', reason: 'A user-facing change needs a design decision.' },
      { role: 'backend_engineer', reason: 'Backend modules or API surfaces are implicated.' },
      { role: 'qa', reason: 'Any change to released code needs re-verification.' },
    ],
    dependencies: [],
    recommendations: [],
    overallConfidence: 'high',
    requiresHumanReview: false,
    reasoning: [],
    summary: {
      affectedSections: 6,
      totalFindings: 6,
      highConfidenceFindings: 6,
      affectedFeatures: 1,
      affectedFiles: 2,
      affectedTables: 0,
    },
    ...overrides,
  };
}

function evolutionPlan(overrides: Partial<EvolutionPlan> = {}): EvolutionPlan {
  return {
    summary: 'x',
    affectedArtifacts: [],
    requiredRoles: [
      { role: 'frontend_engineer', label: 'Frontend Engineer', reason: 'Pages implicated.' },
      { role: 'ui_ux', label: 'UI/UX', reason: 'Design decision.' },
      { role: 'backend_engineer', label: 'Backend Engineer', reason: 'API implicated.' },
      { role: 'qa', label: 'QA', reason: 'Re-verify.' },
    ],
    requiredReviews: [],
    estimatedPhases: [],
    estimatedRisks: [],
    suggestedMvp: { placement: 'current_mvp_maintenance', label: 'Maintenance', reasoning: 'x' },
    suggestedSprint: 'x',
    suggestedPriority: 'medium',
    futureScope: [],
    createdAt: CAPTURED_AT,
    ...overrides,
  };
}

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Allow cancellation',
    description: 'FEAT-001 needs a cancel action on /appointments.',
    priority: 'medium',
    category: 'feature_addition',
    scope: 'single_feature',
    declaredAreas: [],
    status: 'analyzed',
    requestedAt: CAPTURED_AT,
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
    metadata: {},
    ...overrides,
  };
}

function plan(
  overrides: { impact?: ImpactAnalysis; baseline?: ProductBaselineSnapshot; evolutionPlan?: EvolutionPlan } = {},
) {
  return buildIncrementalPlan({
    request: request(),
    impact: overrides.impact ?? impact(),
    evolutionPlan: overrides.evolutionPlan ?? evolutionPlan(),
    baseline: overrides.baseline ?? baseline(),
    impactAnalysisId: 'ia-1',
    capturedAt: CAPTURED_AT,
  });
}

describe('buildEngineeringScope (Part 2)', () => {
  it('builds scope only from the impact analysis, evolution plan and release baseline', () => {
    const scope = buildEngineeringScope({
      request: request(),
      impact: impact(),
      evolutionPlan: evolutionPlan(),
      baseline: baseline(),
      impactAnalysisId: 'ia-1',
      capturedAt: CAPTURED_AT,
    });

    expect(scope).toMatchObject({
      changeRequestId: 'cr-1',
      releaseId: 'rel-1',
      releaseVersion: '1.0.0',
      baselineManifestVersion: 4,
    });
    expect(scope.metadata).toMatchObject({
      classification: 'feature_addition',
      riskLevel: 'medium',
      impactAnalysisId: 'ia-1',
    });
  });

  it('separates pages from components using the manifest category, not the path', () => {
    const scope = plan().scope;

    expect(scope.affectedPages.map((entry) => entry.identifier)).toContain('src/pages/AppointmentsPage.tsx');
    expect(scope.affectedComponents.map((entry) => entry.identifier)).not.toContain('src/pages/AppointmentsPage.tsx');
  });

  it('includes a matched route as an affected page surface', () => {
    expect(plan().scope.affectedPages.map((entry) => entry.identifier)).toContain('/appointments');
  });

  it('keeps the evidence that put each artifact in scope', () => {
    const scope = plan().scope;

    expect([...scope.affectedFeatures, ...scope.affectedPages].every((entry) => entry.evidence.length > 0)).toBe(true);
  });

  it('translates the evolution plan roles into real pipeline role ids', () => {
    expect(plan().scope.affectedRoles).toEqual(['frontend', 'uiux', 'backend', 'qa']);
  });

  it('carries the unaffected areas through as the basis for skipping', () => {
    expect(plan().scope.unaffectedAreas.map((entry) => entry.area)).toContain('database');
  });
});

describe('selective role execution (Part 3)', () => {
  it('answers YES/NO for every pipeline role, with reasoning on both', () => {
    const decisions = plan().roleDecisions;

    expect(decisions).toHaveLength(9);
    expect(decisions.every((decision) => decision.reasoning.length > 0)).toBe(true);
    expect(decisions.filter((decision) => decision.selected).map((decision) => decision.role)).toEqual([
      'uiux',
      'backend',
      'frontend',
      'qa',
    ]);
  });

  it('explains a skip using the impact analysis rather than a bare "not needed"', () => {
    const database = plan().roleDecisions.find((decision) => decision.role === 'database')!;

    expect(database.selected).toBe(false);
    expect(database.reasoning).toContain('released table(s) appear untouched');
  });

  it('names the artifact each selected role would produce, from the existing registry', () => {
    const frontend = plan().roleDecisions.find((decision) => decision.role === 'frontend')!;

    expect(frontend.artifactType).toBe('frontend-draft');
  });

  it('records pipeline dependencies without requiring them to re-run', () => {
    const backend = plan().roleDecisions.find((decision) => decision.role === 'backend')!;

    expect(backend.dependsOn).toEqual(['requirements', 'productowner', 'architecture', 'database', 'uiux']);
  });

  it('selects the Business Analyst and Product Owner only when the change alters scope', () => {
    const withScopeChange = plan({
      evolutionPlan: evolutionPlan({
        requiredRoles: [
          { role: 'business_analyst', label: 'BA', reason: 'Requirements change.' },
          { role: 'product_owner', label: 'PO', reason: 'Roadmap.' },
          { role: 'frontend_engineer', label: 'FE', reason: 'Pages.' },
        ],
      }),
    });

    expect(withScopeChange.scope.affectedRoles).toContain('requirements');
    expect(withScopeChange.roleDecisions.find((decision) => decision.role === 'requirements')!.selected).toBe(true);
    expect(plan().roleDecisions.find((decision) => decision.role === 'requirements')!.selected).toBe(false);
  });
});

describe('execution order and dependencies (Part 7)', () => {
  it("orders selected roles by the pipeline's own fixed order, skipping the rest", () => {
    expect(plan().executionOrder.map((phase) => phase.role)).toEqual(['uiux', 'backend', 'frontend', 'qa']);
    expect(plan().executionOrder.map((phase) => phase.order)).toEqual([1, 2, 3, 4]);
  });

  it('produces no execution order when no role is required', () => {
    const empty = plan({ evolutionPlan: evolutionPlan({ requiredRoles: [] }) });

    expect(empty.executionOrder).toEqual([]);
    expect(empty.summary).toMatch(/No engineering role is required/);
  });

  it('reports downstream artifacts that may be left stale rather than resolving it', () => {
    const result = plan();

    expect(result.outOfScope.join(' ')).toMatch(/Downstream artifact invalidation is reported but not resolved/);
  });
});

describe('change set (Part 5)', () => {
  it('lists files to modify with their category and reason', () => {
    const changeSet = plan().changeSet;

    expect(changeSet.filesToModify.map((file) => file.path)).toEqual([
      'src/pages/AppointmentsPage.tsx',
      'api/appointments/index.ts',
    ]);
    expect(changeSet.filesToModify[0]).toMatchObject({ category: 'pages' });
    expect(changeSet.filesToModify.every((file) => file.reason.length > 0)).toBe(true);
  });

  it('lists everything else as unchanged — the "can remain untouched" answer in file terms', () => {
    const changeSet = plan().changeSet;

    expect(changeSet.filesUnchanged.map((file) => file.path)).toEqual([
      'src/components/Navbar.tsx',
      'src/index.css',
      'src/pages/HomePage.tsx',
      'package.json',
    ]);
  });

  it('never invents new files', () => {
    expect(plan().changeSet.filesToCreate).toEqual([]);
    expect(plan().changeSet.summary.createCount).toBe(0);
  });

  it('computes how much of the application is touched', () => {
    expect(plan().changeSet.summary).toMatchObject({
      modifyCount: 2,
      unchangedCount: 4,
      totalReleasedFiles: 6,
      touchedPercentage: 33,
    });
  });

  it('carries database, API, UI, testing and documentation targets from the scope', () => {
    const changeSet = plan().changeSet;

    expect(changeSet.apiChanges.map((entry) => entry.identifier)).toEqual(['api/appointments/index.ts']);
    expect(changeSet.testingTargets.map((entry) => entry.identifier)).toEqual(['route:/appointments']);
    expect(changeSet.databaseChanges).toEqual([]);
  });

  it('handles an empty baseline without dividing by zero', () => {
    const changeSet = buildChangeSet(plan().scope, impact(), baseline({ files: [] }), []);

    expect(changeSet.summary.touchedPercentage).toBe(0);
  });
});

describe('review impact (Part 8)', () => {
  it('requires code review when generated code changes, and skips product/roadmap review when scope does not', () => {
    const reviews = plan().reviewRequirements;
    const byStage = Object.fromEntries(reviews.map((review) => [review.stage, review]));

    expect(byStage.code_review.required).toBe(true);
    expect(byStage.product_review.required).toBe(false);
    expect(byStage.roadmap_review.required).toBe(false);
    expect(byStage.product_review.reasoning).toMatch(/still applies/);
  });

  it('requires product and roadmap review when the BA and PO re-run', () => {
    const result = plan({
      evolutionPlan: evolutionPlan({
        requiredRoles: [
          { role: 'business_analyst', label: 'BA', reason: 'x' },
          { role: 'product_owner', label: 'PO', reason: 'x' },
        ],
      }),
    });
    const byStage = Object.fromEntries(result.reviewRequirements.map((review) => [review.stage, review]));

    expect(byStage.product_review.required).toBe(true);
    expect(byStage.roadmap_review.required).toBe(true);
  });

  it('adds a customer sign-off gate for high risk', () => {
    const result = plan({ impact: impact({ risk: { level: 'critical', score: 9, factors: [], reasoning: 'x' } }) });
    const signoff = result.reviewRequirements.find((review) => review.stage === 'customer_signoff')!;

    expect(signoff.required).toBe(true);
  });

  it('explains every review decision, required or not', () => {
    expect(plan().reviewRequirements.every((review) => review.reasoning.length > 0)).toBe(true);
  });
});

describe('plan boundary and determinism (Part 6)', () => {
  it('states plainly that it engineers nothing', () => {
    const outOfScope = plan().outOfScope.join(' ');

    expect(outOfScope).toMatch(/No code is generated and no AI role is executed/);
    expect(outOfScope).toMatch(/No release, manifest, deployment or generated file is modified/);
    expect(outOfScope).toMatch(/Nothing is deployed and nothing is verified/);
  });

  it('flags that role selection needs confirmation when the analysis did', () => {
    const result = plan({ impact: impact({ requiresHumanReview: true }) });

    expect(result.outOfScope.join(' ')).toMatch(/requires human review/);
  });

  it('summarises the reduction in one sentence', () => {
    expect(plan().summary).toMatch(/4 of 9 engineering roles are required/);
    expect(plan().summary).toMatch(/2 of 6 released file\(s\) would be modified — 33%/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('keeps three projects isolated', () => {
    const build = (suffix: string) =>
      buildIncrementalPlan({
        request: request({ id: `cr-${suffix}`, projectId: `proj-${suffix}`, deploymentId: `dep-${suffix}` }),
        impact: impact({ releaseId: `rel-${suffix}`, releaseVersion: `1.${suffix === 'a' ? 0 : 1}.0` }),
        evolutionPlan: evolutionPlan(),
        baseline: baseline({
          releaseId: `rel-${suffix}`,
          files: [{ path: `src/pages/Page${suffix}.tsx`, category: 'pages', featureIds: [] }],
        }),
        capturedAt: CAPTURED_AT,
      });

    const a = build('a');
    const b = build('b');
    const c = build('c');

    expect(a.scope.changeRequestId).toBe('cr-a');
    expect(b.scope.releaseId).toBe('rel-b');
    expect(JSON.stringify(a)).not.toContain('cr-b');
    expect(JSON.stringify(c)).not.toContain('Pagea.tsx');
  });
});
