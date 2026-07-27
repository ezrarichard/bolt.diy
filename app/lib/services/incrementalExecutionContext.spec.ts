import { describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES, type ProjectArtifact } from '~/lib/projects/artifacts';
import type { Project } from '~/lib/stores/projects';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import type { IncrementalEngineeringPlan, IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import type { ProductBaselineSnapshot } from '~/lib/evolution/evolutionBaseline';
import type { ImpactAnalysis } from '~/lib/evolution/impactTypes';
import { applyInvalidationPolicy } from '~/lib/evolution/invalidationPolicy';
import {
  baselineArtifactTypesFor,
  buildRoleExecutionContext,
  buildScopedProject,
  computeScopeFingerprint,
  detectSafetyFallbacks,
} from './incrementalExecutionContext';
import { buildIncrementalInstructionLayer, describeReduction } from './incrementalExecutionPrompt';

const AT = '2026-08-14T10:00:00.000Z';

function makeBaseline(overrides: Partial<ProductBaselineSnapshot> = {}): ProductBaselineSnapshot {
  return {
    releaseId: 'rel-1',
    semanticVersion: '1.2.0',
    capturedAt: AT,
    manifestVersion: 7,
    manifestPlanChecksum: 'abc123',
    features: [{ code: 'F-1', title: 'Booking', state: 'delivered' }],
    routes: [{ path: '/booking', name: 'Booking' }],
    files: [
      { path: 'pages/Booking.tsx', category: 'pages', featureIds: ['F-1'] },
      { path: 'components/Header.tsx', category: 'components', featureIds: [] },
      { path: 'api/bookings.ts', category: 'backend', featureIds: ['F-1'] },
    ],
    databaseTables: ['bookings'],
    environmentVariables: ['SUPABASE_URL'],
    requiredServices: [],
    apiSurfaces: ['api/bookings.ts'],
    documentationSections: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<IncrementalEngineeringPlan> = {}): IncrementalEngineeringPlan {
  return {
    modelVersion: '1.0.0',
    scope: {
      changeRequestId: 'req-1',
      releaseId: 'rel-1',
      releaseVersion: '1.2.0',
      baselineManifestVersion: 7,
      affectedFeatures: [{ identifier: 'F-1', label: 'Booking', evidence: 'named in the request' }],
      affectedPages: [{ identifier: 'pages/Booking.tsx', label: 'Booking page', evidence: 'named in the request' }],
      affectedComponents: [],
      affectedDatabaseObjects: [],
      affectedApis: [],
      affectedEnvironment: [],
      affectedDocuments: [],
      affectedRoles: ['frontend', 'qa'],
      unaffectedAreas: [{ area: 'database', detail: 'no schema term matched' }],
      metadata: {
        classification: 'small_enhancement',
        riskLevel: 'low',
        complexityLevel: 'small',
        requiresHumanReview: false,
        capturedAt: AT,
      },
    },
    roleDecisions: [],
    executionOrder: [
      { order: 1, role: 'frontend', label: 'Frontend Engineer', reasoning: 'the page changes' },
      { order: 2, role: 'qa', label: 'QA Engineer', reasoning: 're-verify' },
    ],
    changeSet: {
      summary: { modifyCount: 1, createCount: 0, unchangedCount: 2, totalReleasedFiles: 3, touchedPercentage: 33 },
    } as never,
    reducedContexts: [
      {
        role: 'frontend',
        label: 'Frontend Engineer',
        includedFeatures: ['F-1'],
        includedFiles: ['pages/Booking.tsx'],
        includedDatabaseObjects: [],
        includedApis: [],
        includedEnvironment: [],
        includedUpstreamArtifacts: [ARTIFACT_TYPES.REQUIREMENTS_DRAFT, ARTIFACT_TYPES.ARCHITECTURE_DRAFT],
        includedReviews: ['code_review'],
        excluded: ['database schema'],
        contextReductionRatio: 0.333,
      },
    ],
    reviewRequirements: [],
    summary: 'test plan',
    outOfScope: [],
    createdAt: AT,
    ...overrides,
  } as IncrementalEngineeringPlan;
}

function makeImpact(overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return {
    baselineCapturedAt: AT,
    analysedAt: AT,
    classification: {
      category: 'small_enhancement' as const,
      source: 'declared' as const,
      confidence: 'high' as const,
      reasoning: '',
      alternatives: [],
    },
    sections: [
      {
        id: 'ui',
        label: 'UI Impact',
        affected: true,
        items: [],
        confidence: 'high',
        detail: 'The booking page heading changes.',
      },
      {
        id: 'database',
        label: 'Database Impact',
        affected: false,
        items: [],
        confidence: 'high',
        detail: 'No table matched.',
      },
    ],
    unaffectedAreas: [],
    risk: { level: 'low', score: 1, factors: [], reasoning: '' },
    complexity: { level: 'very_small', score: 1, factors: [], reasoning: '' },
    roles: [],
    dependencies: [],
    recommendations: [],
    overallConfidence: 'high',
    requiresHumanReview: false,
    reasoning: [],
    summary: {
      affectedSections: 1,
      totalFindings: 1,
      highConfidenceFindings: 1,
      affectedFeatures: 1,
      affectedFiles: 1,
      affectedTables: 0,
    },
    ...overrides,
  };
}

const REQUEST = {
  id: 'req-1',
  requestNumber: 4,
  title: 'Rename the booking heading',
  description: 'The heading should read "Reserve a table".',
  deploymentId: 'dep-1',
  projectId: 'proj-1',
} as ChangeRequest;

function artifact(type: string, id: string): ProjectArtifact {
  return {
    id,
    taskId: 'task-1',
    title: type,
    type,
    createdAt: AT,
    updatedAt: AT,
    status: 'approved',
    content: '{}',
    version: 3,
  };
}

const ALL_ARTIFACTS = [
  artifact(ARTIFACT_TYPES.REQUIREMENTS_DRAFT, 'a-req'),
  artifact(ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT, 'a-po'),
  artifact(ARTIFACT_TYPES.ARCHITECTURE_DRAFT, 'a-arch'),
  artifact(ARTIFACT_TYPES.DATABASE_DRAFT, 'a-db'),
  artifact(ARTIFACT_TYPES.UIUX_DRAFT, 'a-uiux'),
  artifact(ARTIFACT_TYPES.BACKEND_DRAFT, 'a-be'),
  artifact(ARTIFACT_TYPES.FRONTEND_DRAFT, 'a-fe'),
  artifact(ARTIFACT_TYPES.QA_DRAFT, 'a-qa'),
  artifact(ARTIFACT_TYPES.DEVOPS_DRAFT, 'a-devops'),
];

const PROJECT = { id: 'proj-1', name: 'Riverside', artifacts: ALL_ARTIFACTS } as Project;

function contextFor(role: IncrementalRoleId, plan = makePlan(), baseline = makeBaseline()) {
  return buildRoleExecutionContext({ role, plan, request: REQUEST, impact: makeImpact(), baseline });
}

describe('computeScopeFingerprint', () => {
  it('is stable for the same scope regardless of role order', () => {
    const plan = makePlan();

    expect(computeScopeFingerprint(plan, ['frontend', 'qa'])).toBe(computeScopeFingerprint(plan, ['qa', 'frontend']));
  });

  it('changes when the approved roles change', () => {
    const plan = makePlan();

    expect(computeScopeFingerprint(plan, ['frontend'])).not.toBe(computeScopeFingerprint(plan, ['frontend', 'qa']));
  });

  it('changes when the scope changes', () => {
    const wider = makePlan();
    wider.scope.affectedPages = [
      ...wider.scope.affectedPages,
      { identifier: 'pages/Home.tsx', label: 'Home', evidence: 'x' },
    ];

    expect(computeScopeFingerprint(makePlan(), ['frontend'])).not.toBe(computeScopeFingerprint(wider, ['frontend']));
  });
});

describe('buildRoleExecutionContext', () => {
  it('uses the plan’s own reduced-context descriptor when there is one', () => {
    const context = contextFor('frontend');

    expect(context.affectedFiles).toEqual(['pages/Booking.tsx']);
    expect(context.upstreamArtifactTypes).toEqual([
      ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
      ARTIFACT_TYPES.ARCHITECTURE_DRAFT,
    ]);
    expect(context.contextReductionRatio).toBe(0.333);
    expect(context.usedFullContextFallback).toBe(false);
  });

  it('derives a context for an operator-added role that the plan never selected', () => {
    const context = contextFor('uiux');

    expect(context.affectedFiles).toEqual(['pages/Booking.tsx']);
    expect(context.upstreamArtifactTypes).toContain(ARTIFACT_TYPES.ARCHITECTURE_DRAFT);
    expect(context.upstreamArtifactTypes).not.toContain(ARTIFACT_TYPES.UIUX_DRAFT);
  });

  it('gives a role only the impact sections it owns', () => {
    const sections = contextFor('frontend').relevantImpactFindings.map((finding) => finding.section);

    expect(sections).toEqual(['ui']);
  });

  it('includes the role’s own released artifact so it revises rather than redesigns', () => {
    expect(contextFor('frontend').baselineArtifactTypes).toEqual([ARTIFACT_TYPES.FRONTEND_DRAFT]);
  });

  it('keeps the Database Engineer’s paired schema artifact together with its draft', () => {
    expect(baselineArtifactTypesFor('database')).toEqual([
      ARTIFACT_TYPES.DATABASE_DRAFT,
      ARTIFACT_TYPES.DATABASE_SCHEMA,
    ]);
  });

  it('states the excluded areas explicitly rather than leaving them implied', () => {
    const context = contextFor('frontend');

    expect(context.excludedAreas).toContain('database schema');
    expect(context.unaffectedAreas).toEqual([{ area: 'database', detail: 'no schema term matched' }]);
  });
});

describe('buildScopedProject', () => {
  it('hands the engine only the artifacts the role may read, plus its own released output', () => {
    const scoped = buildScopedProject(PROJECT, contextFor('frontend'));

    expect(scoped.artifacts?.map((entry) => entry.type).sort()).toEqual(
      [ARTIFACT_TYPES.REQUIREMENTS_DRAFT, ARTIFACT_TYPES.ARCHITECTURE_DRAFT, ARTIFACT_TYPES.FRONTEND_DRAFT].sort(),
    );
  });

  it('never mutates the project it was given', () => {
    buildScopedProject(PROJECT, contextFor('frontend'));

    expect(PROJECT.artifacts).toHaveLength(9);
  });

  it('returns the full project only under an approved full-context fallback', () => {
    const context = { ...contextFor('frontend'), usedFullContextFallback: true };

    expect(buildScopedProject(PROJECT, context).artifacts).toHaveLength(9);
  });
});

describe('detectSafetyFallbacks', () => {
  const invalidations = applyInvalidationPolicy({ approvedRoles: ['frontend', 'qa'] });

  function detect(overrides: Partial<Parameters<typeof detectSafetyFallbacks>[0]> = {}) {
    return detectSafetyFallbacks({
      plan: makePlan(),
      impact: makeImpact(),
      baseline: makeBaseline(),
      approvedRoles: ['frontend', 'qa'],
      invalidations,
      artifacts: ALL_ARTIFACTS,
      ...overrides,
    });
  }

  it('finds nothing wrong with a well-formed plan', () => {
    expect(detect()).toEqual([]);
  });

  it('fires on a manifest version mismatch', () => {
    const triggers = detect({ baseline: makeBaseline({ manifestVersion: 9 }) });

    expect(triggers[0].reason).toBe('baseline_integrity_mismatch');
  });

  it('fires on a release mismatch', () => {
    const triggers = detect({ baseline: makeBaseline({ releaseId: 'rel-9' }) });

    expect(triggers.some((trigger) => trigger.reason === 'baseline_integrity_mismatch')).toBe(true);
  });

  it('fires on a low-confidence impact analysis', () => {
    const triggers = detect({ impact: makeImpact({ overallConfidence: 'low' }) });

    expect(triggers.some((trigger) => trigger.reason === 'low_confidence_impact')).toBe(true);
  });

  it('fires when a required upstream artifact is missing', () => {
    const triggers = detect({
      artifacts: ALL_ARTIFACTS.filter((entry) => entry.type !== ARTIFACT_TYPES.BACKEND_DRAFT),
    });
    const missing = triggers.filter((trigger) => trigger.reason === 'missing_upstream_artifact');

    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].detail).toContain('backend-draft');
  });

  it('fires when the scope names a path the release baseline does not contain', () => {
    const plan = makePlan();
    plan.scope.affectedPages = [{ identifier: 'pages/Ghost.tsx', label: 'Ghost', evidence: 'guessed' }];

    const triggers = detect({ plan });

    expect(triggers.some((trigger) => trigger.reason === 'missing_file_mapping')).toBe(true);
  });

  it('fires when a running role would read an invalidated artifact nobody is regenerating', () => {
    /* Architecture re-runs, invalidating the Database and UI/UX designs — and QA reads both. */
    const triggers = detect({
      approvedRoles: ['architecture', 'qa'],
      invalidations: applyInvalidationPolicy({ approvedRoles: ['architecture', 'qa'] }),
    });

    const missing = triggers.filter((trigger) => trigger.reason === 'invalidated_dependency_missing');

    expect(missing.map((trigger) => trigger.role).sort()).toEqual(['database', 'uiux']);
  });

  it('does not block merely because a downstream artifact nothing reads went stale', () => {
    /* Running QA invalidates the DevOps artifact by the gate rule, but no running role reads it. */
    const triggers = detect({
      approvedRoles: ['frontend', 'qa'],
      invalidations: applyInvalidationPolicy({ approvedRoles: ['frontend', 'qa'] }),
    });

    expect(triggers.filter((trigger) => trigger.reason === 'invalidated_dependency_missing')).toEqual([]);
  });
});

describe('buildIncrementalInstructionLayer', () => {
  const block = buildIncrementalInstructionLayer(contextFor('frontend'));

  it('tells the role it is changing a released product', () => {
    expect(block).toContain('ALREADY BUILT, ALREADY RELEASED');
    expect(block).toContain('release 1.2.0');
  });

  it('carries every Part 8 instruction', () => {
    expect(block).toContain('Change ONLY what the approved scope below names');
    expect(block).toContain('Do NOT redesign');
    expect(block).toContain('Preserve backward compatibility');
    expect(block).toContain('Do NOT invent file paths');
    expect(block).toContain('overwrite');
    expect(block).toContain('State your assumptions');
  });

  it('lists the approved scope and the exclusions', () => {
    expect(block).toContain('pages/Booking.tsx');
    expect(block).toContain('EXPLICITLY OUT OF SCOPE');
    expect(block).toContain('database schema');
  });

  it('gives the role a machine-readable way to report impact outside scope', () => {
    expect(block).toContain('"discoveredImpact"');
    expect(block).toContain('scopeChangeRequired');
    expect(block).toContain('An operator decides');
  });

  it('does not leak an unrelated page into the scope list', () => {
    expect(block).not.toContain('components/Header.tsx');
  });

  it('labels a full-context fallback in the prompt itself', () => {
    const fallback = buildIncrementalInstructionLayer({ ...contextFor('frontend'), usedFullContextFallback: true });

    expect(fallback).toContain('FULL CONTEXT FALLBACK IS IN FORCE');
    expect(fallback).toContain('wider context is not wider permission');
  });

  it('is deterministic', () => {
    expect(buildIncrementalInstructionLayer(contextFor('frontend'))).toBe(block);
  });

  it('summarises the reduction without quoting prompt text', () => {
    const summary = describeReduction(contextFor('frontend'));

    expect(summary).toContain('1/3 file(s)');
    expect(summary).not.toContain('ALREADY BUILT');
  });
});
