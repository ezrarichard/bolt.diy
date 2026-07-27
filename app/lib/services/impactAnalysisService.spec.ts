import { describe, expect, it } from 'vitest';
import type { DeploymentVerification, VerificationCheck } from '~/lib/deployment/verificationTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import { analyseChangeImpact } from './impactAnalysisService';

/** The analysis is pure, so every test constructs its inputs directly. No BuildersDB, no AI, no mocks. */

const ANALYSED_AT = '2026-08-12T10:00:00.000Z';

function baseline(overrides: Partial<ProductBaselineSnapshot> = {}): ProductBaselineSnapshot {
  return {
    releaseId: 'rel-1',
    semanticVersion: '1.0.0',
    capturedAt: '2026-08-12T09:00:00.000Z',
    manifestVersion: 4,
    manifestPlanChecksum: 'fnv1a:plan',
    features: [
      { code: 'FEAT-001', title: 'Book an appointment', state: 'verified' },
      { code: 'FEAT-002', title: 'View treatments', state: 'implemented' },
      { code: 'FEAT-003', title: 'Patient records', state: 'implemented' },
    ],
    routes: [
      { path: '/', name: 'Home' },
      { path: '/appointments', name: 'Appointments' },
      { path: '/login', name: 'Sign in' },
    ],
    files: [
      {
        path: 'src/pages/AppointmentsPage.tsx',
        category: 'pages',
        componentName: 'AppointmentsPage',
        displayName: 'Appointments',
        featureIds: ['FEAT-001'],
      },
      { path: 'src/components/Navbar.tsx', category: 'components', componentName: 'Navbar', featureIds: [] },
      { path: 'api/appointments/index.ts', category: 'backend', featureIds: ['FEAT-001'] },
      {
        path: 'src/pages/TreatmentsPage.tsx',
        category: 'pages',
        componentName: 'TreatmentsPage',
        featureIds: ['FEAT-002'],
      },
    ],
    databaseTables: ['appointments', 'patients', 'treatments'],
    environmentVariables: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    requiredServices: ['Supabase'],
    apiSurfaces: ['api/appointments/index.ts'],
    documentationSections: ['Requirements', 'Architecture'],
    repositoryFullName: 'acme/riverside-dental',
    deploymentUrl: 'https://riverside-dental.vercel.app',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    schemaVersion: 3,
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
    title: 'Change something',
    description: 'A description.',
    priority: 'medium',
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

function check(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    id: 'route:/appointments',
    category: 'route',
    name: 'Route /appointments',
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
    startedAt: '2026-08-11T00:00:00.000Z',
    checks: [check(), check({ id: 'database.supabase_reachable', category: 'database', name: 'Supabase reachable' })],
    summary: {
      total: 2,
      passed: 2,
      failed: 0,
      warnings: 0,
      skipped: 0,
      unavailable: 0,
      requiredTotal: 2,
      requiredPassed: 2,
      requiredFailed: 0,
    },
    message: 'ok',
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function analyse(overrides: Partial<ChangeRequest> = {}, snapshotOverrides: Partial<ProductBaselineSnapshot> = {}) {
  return analyseChangeImpact({
    request: request(overrides),
    baseline: baseline(snapshotOverrides),
    verification: verification(),
    analysedAt: ANALYSED_AT,
  });
}

function sectionById(analysis: ReturnType<typeof analyse>, id: string) {
  const section = analysis.sections.find((entry) => entry.id === id);

  if (!section) {
    throw new Error(`No section "${id}"`);
  }

  return section;
}

describe('analyseChangeImpact — matching', () => {
  it('matches a feature by its exact code with high confidence', () => {
    const analysis = analyse({ title: 'Fix FEAT-001', description: 'FEAT-001 is broken.' });
    const business = sectionById(analysis, 'business');

    expect(business.affected).toBe(true);
    expect(business.items[0]).toMatchObject({ identifier: 'FEAT-001', confidence: 'high' });
    expect(analysis.overallConfidence).toBe('high');
  });

  it('matches a feature by its full title with medium confidence', () => {
    const analysis = analyse({ title: 'Improve booking', description: 'Book an appointment should be faster.' });
    const items = sectionById(analysis, 'business').items;

    expect(items.map((item) => item.identifier)).toContain('FEAT-001');
    expect(items.find((item) => item.identifier === 'FEAT-001')?.confidence).toBe('medium');
  });

  it('matches a route by its exact path', () => {
    const analysis = analyse({ description: 'The /appointments page needs a cancel button.' });
    const ui = sectionById(analysis, 'ui');

    expect(ui.affected).toBe(true);
    expect(ui.items.some((item) => item.identifier === '/appointments' && item.confidence === 'high')).toBe(true);
  });

  it("links a file to a matched feature through the manifest's own ownership", () => {
    const analysis = analyse({ description: 'FEAT-001 needs rework.' });
    const technical = sectionById(analysis, 'technical');

    expect(technical.items.map((item) => item.identifier)).toEqual(
      expect.arrayContaining(['src/pages/AppointmentsPage.tsx', 'api/appointments/index.ts']),
    );
    expect(technical.items[0].evidence).toMatch(/generated for matched feature/);
  });

  it('matches a database table by name', () => {
    const analysis = analyse({ description: 'Add a status column to the appointments table.' });
    const database = sectionById(analysis, 'database');

    expect(database.affected).toBe(true);
    expect(database.items.map((item) => item.identifier)).toContain('appointments');
  });

  it('matches an environment variable by name', () => {
    const analysis = analyse({ description: 'Rotate VITE_SUPABASE_ANON_KEY.' });

    expect(sectionById(analysis, 'infrastructure').items.map((item) => item.identifier)).toContain(
      'VITE_SUPABASE_ANON_KEY',
    );
  });

  it('does not match on common words, so an ordinary sentence does not touch everything', () => {
    const analysis = analyse({
      title: 'Please update the page',
      description: 'The users want new data on the system.',
    });

    expect(analysis.summary.totalFindings).toBe(0);
  });

  it('does not match a partial word', () => {
    const analysis = analyse(
      { description: 'Improve bookkeeping records.' },
      { features: [{ code: 'FEAT-001', title: 'Book', state: 'verified' }] },
    );

    expect(analysis.summary.affectedFeatures).toBe(0);
  });

  it('returns an empty analysis with a stated reason rather than a guess', () => {
    const analysis = analyse({ title: 'Something entirely unrelated', description: 'Zzzz qqqq.' });

    expect(analysis.summary.totalFindings).toBe(0);
    expect(analysis.overallConfidence).toBe('low');
    expect(analysis.requiresHumanReview).toBe(true);
    expect(analysis.reasoning.join(' ')).toMatch(/empty by design rather than guessed/);
    expect(analysis.recommendations.join(' ')).toMatch(/Rewrite the request/);
  });
});

describe('analyseChangeImpact — declared areas and sections', () => {
  it('honours a declared area even when nothing textual matched', () => {
    const analysis = analyse({ description: 'Zzzz.', declaredAreas: ['database'] });
    const database = sectionById(analysis, 'database');

    expect(database.affected).toBe(true);
    expect(database.detail).toMatch(/operator declared/i);
  });

  it('reports deployment impact whenever code is implicated, and not otherwise', () => {
    expect(sectionById(analyse({ description: 'FEAT-001 is broken.' }), 'deployment').affected).toBe(true);
    expect(sectionById(analyse({ description: 'Zzzz.' }), 'deployment').affected).toBe(false);
  });

  it('links existing verification coverage to affected routes', () => {
    const analysis = analyse({ description: 'The /appointments page is wrong.' });
    const testing = sectionById(analysis, 'testing');

    expect(testing.affected).toBe(true);
    expect(testing.items.map((item) => item.identifier)).toContain('route:/appointments');
  });

  it('says when no verification covers the affected areas', () => {
    const analysis = analyseChangeImpact({
      request: request({ description: 'The /login page is wrong.' }),
      baseline: baseline(),
      verification: null,
      analysedAt: ANALYSED_AT,
    });

    expect(sectionById(analysis, 'testing').detail).toMatch(/new coverage will be needed/i);
  });

  it('flags the security section for an authentication route', () => {
    const analysis = analyse({ description: 'The /login page needs two-factor.' });

    expect(sectionById(analysis, 'security').affected).toBe(true);
  });

  it('states every section conclusion, including the unaffected ones', () => {
    const analysis = analyse({ description: 'FEAT-001 is broken.' });

    expect(analysis.sections.every((section) => section.detail.length > 0)).toBe(true);
  });

  it('answers "what can remain untouched"', () => {
    const analysis = analyse({ description: 'Change the appointments table.' });

    expect(analysis.unaffectedAreas.map((area) => area.area)).toContain('documentation');
    expect(analysis.unaffectedAreas.every((area) => area.detail.length > 0)).toBe(true);
  });
});

describe('analyseChangeImpact — classification, risk, complexity, roles', () => {
  it("uses the operator's declared category over any inference", () => {
    const analysis = analyse({ category: 'compliance', description: 'The /appointments page is broken and slow.' });

    expect(analysis.classification).toMatchObject({ category: 'compliance', source: 'declared', confidence: 'high' });
  });

  it('infers a category from the request text when none was declared', () => {
    const analysis = analyse({ title: 'Booking is broken', description: 'FEAT-001 fails with an error and crashes.' });

    expect(analysis.classification).toMatchObject({ category: 'bug_fix', source: 'inferred' });
    expect(analysis.classification.reasoning).toMatch(/heuristic/);
  });

  it('classifies breadth as a major expansion regardless of wording', () => {
    const analysis = analyse({
      description: 'FEAT-001 FEAT-002 FEAT-003 and the appointments table all need attention.',
      scope: 'cross_cutting',
    });

    expect(analysis.classification.category).toBe('major_expansion');
  });

  it('returns unknown rather than guessing when no signal exists', () => {
    const analysis = analyse({ title: 'Zzz', description: 'Qqq.' });

    expect(analysis.classification).toMatchObject({ category: 'unknown', confidence: 'low' });
  });

  it('raises risk for a database change and names the factor', () => {
    const analysis = analyse({ description: 'Drop the patients table.' });

    expect(analysis.risk.factors.map((factor) => factor.id)).toContain('database_change');
    expect(['medium', 'high', 'critical']).toContain(analysis.risk.level);
    expect(analysis.risk.reasoning).toContain('Database change');
  });

  it('raises risk for an authentication change', () => {
    const analysis = analyse({ description: 'Rework the /login page.' });

    expect(analysis.risk.factors.map((factor) => factor.id)).toContain('security_surface');
  });

  it('reports low risk with a stated reason when nothing risky is implicated', () => {
    const analysis = analyse({ description: 'Reword the Home page heading.' });

    expect(analysis.risk.level).toBe('low');
    expect(analysis.risk.reasoning).toMatch(/No elevated risk factor/);
  });

  /*
   * A documented consequence of term matching: a request naming the "/appointments" page also
   * matches the "appointments" TABLE, because the word genuinely appears. The analysis reports
   * both with their evidence rather than silently picking one — which is exactly why it raises
   * risk and flags human review instead of claiming to know which was meant.
   */
  it('reports both a route and a same-named table when the word matches both, and says why', () => {
    const analysis = analyse({ description: 'Change the wording on the /appointments page.' });

    expect(sectionById(analysis, 'ui').items.some((item) => item.identifier === '/appointments')).toBe(true);
    expect(sectionById(analysis, 'database').items.some((item) => item.identifier === 'appointments')).toBe(true);
    expect(analysis.risk.level).not.toBe('low');
    expect(analysis.requiresHumanReview).toBe(true);
  });

  it('sizes complexity from what was actually matched, and explains the arithmetic', () => {
    const small = analyse({ description: 'Reword the /appointments page.' });
    const large = analyse({
      description: 'FEAT-001 FEAT-002 FEAT-003 and the appointments, patients and treatments tables all change.',
    });

    expect(['very_small', 'small', 'medium']).toContain(small.complexity.level);
    expect(['large', 'very_large']).toContain(large.complexity.level);
    expect(large.complexity.reasoning).toMatch(/feature\(s\)/);
  });

  it('treats an unmatched request as unsized rather than small', () => {
    const analysis = analyse({ description: 'Zzzz.' });

    expect(analysis.complexity.reasoning).toMatch(/unsized rather than small/);
  });

  it('includes only the roles the impact actually pulled in', () => {
    const analysis = analyse({ description: 'Rotate VITE_SUPABASE_ANON_KEY.', declaredAreas: ['environment'] });
    const roles = analysis.roles.map((entry) => entry.role);

    expect(roles).toContain('devops');
    expect(roles).not.toContain('database_engineer');
    expect(roles).not.toContain('ui_ux');
    expect(roles).not.toContain('product_owner');
    expect(analysis.roles.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('pulls in database and architecture roles for a schema change', () => {
    const analysis = analyse({ description: 'Add a status column to the appointments table.' });
    const roles = analysis.roles.map((entry) => entry.role);

    expect(roles).toEqual(expect.arrayContaining(['database_engineer', 'solution_architect', 'qa']));
  });

  it('pulls in product roles for a feature addition', () => {
    const analysis = analyse({ category: 'feature_addition', description: 'Add a cancel option to FEAT-001.' });
    const roles = analysis.roles.map((entry) => entry.role);

    expect(roles).toContain('business_analyst');
    expect(roles).toContain('product_owner');
  });

  it('records grounded dependencies', () => {
    const analysis = analyse({ description: 'Change the appointments table and VITE_SUPABASE_URL.' });

    expect(analysis.dependencies.join(' ')).toMatch(/schema change must be applied/i);
    expect(analysis.dependencies.join(' ')).toMatch(/Environment variables must be updated/i);
  });
});

describe('analyseChangeImpact — honesty and determinism', () => {
  it('always analyses against the release, and says so', () => {
    const analysis = analyse({ description: 'FEAT-001.' });

    expect(analysis.releaseVersion).toBe('1.0.0');
    expect(analysis.reasoning[0]).toMatch(/frozen baseline, not the current deployment/);
  });

  it('flags human review whenever the classification was inferred', () => {
    const analysis = analyse({ description: 'FEAT-001 is broken.' });

    expect(analysis.classification.source).toBe('inferred');
    expect(analysis.requiresHumanReview).toBe(true);
    expect(analysis.reasoning.join(' ')).toMatch(/not an understanding of intent/);
  });

  it('does not require review for a declared category with an exact match', () => {
    const analysis = analyse({ category: 'bug_fix', description: 'FEAT-001 is broken.' });

    expect(analysis.overallConfidence).toBe('high');
    expect(analysis.requiresHumanReview).toBe(false);
  });

  it('is deterministic', () => {
    const run = () => analyse({ description: 'FEAT-001 and the appointments table.' });

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('keeps three projects isolated — each analysis sees only its own baseline', () => {
    const build = (suffix: string, featureCode: string) =>
      analyseChangeImpact({
        request: request({
          id: `cr-${suffix}`,
          projectId: `proj-${suffix}`,
          description: `${featureCode} needs work.`,
        }),
        baseline: baseline({
          releaseId: `rel-${suffix}`,
          semanticVersion: `1.${suffix === 'a' ? 0 : suffix === 'b' ? 1 : 2}.0`,
          features: [{ code: featureCode, title: `Feature ${suffix}`, state: 'verified' }],
          files: [{ path: `src/pages/Page${suffix}.tsx`, category: 'pages', featureIds: [featureCode] }],
          routes: [{ path: `/${suffix}-page`, name: `Page ${suffix}` }],
        }),
        verification: null,
        analysedAt: ANALYSED_AT,
      });

    const a = build('a', 'FEAT-A01');
    const b = build('b', 'FEAT-B01');
    const c = build('c', 'FEAT-C01');

    expect(a.releaseId).toBe('rel-a');
    expect(b.releaseId).toBe('rel-b');
    expect(c.releaseId).toBe('rel-c');

    expect(JSON.stringify(a)).not.toContain('FEAT-B01');
    expect(JSON.stringify(b)).not.toContain('Pagec');
    expect(JSON.stringify(c)).not.toContain('rel-a');
  });
});
