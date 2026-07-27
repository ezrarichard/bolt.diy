import { describe, expect, it } from 'vitest';
import type { ChangeRequest } from './changeRequestTypes';
import { buildEvolutionPlan } from './evolutionPlan';
import type { ComplexityLevel, ImpactAnalysis, RiskLevel } from './impactTypes';

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr-1',
    projectId: 'proj-1',
    deploymentId: 'dep-1',
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    requestNumber: 1,
    title: 'Allow patients to cancel an appointment',
    description: 'FEAT-001 should support cancellation.',
    priority: 'medium',
    category: 'unknown',
    scope: 'unknown',
    declaredAreas: [],
    status: 'analyzed',
    requestedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function analysis(overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return {
    releaseId: 'rel-1',
    releaseVersion: '1.0.0',
    baselineCapturedAt: '2026-08-12T09:00:00.000Z',
    analysedAt: '2026-08-12T10:00:00.000Z',
    classification: {
      category: 'feature_addition',
      source: 'inferred',
      confidence: 'medium',
      reasoning: 'x',
      alternatives: [],
    },
    sections: [
      {
        id: 'business',
        label: 'Business Impact',
        affected: true,
        confidence: 'high',
        detail: '1 feature',
        items: [
          {
            kind: 'feature',
            identifier: 'FEAT-001',
            label: 'Book an appointment',
            confidence: 'high',
            evidence: 'exact',
          },
        ],
      },
      { id: 'ui', label: 'UI Impact', affected: true, confidence: 'medium', detail: '1 page', items: [] },
    ],
    unaffectedAreas: [],
    risk: {
      level: 'medium',
      score: 3,
      factors: [{ id: 'database_change', label: 'Database change', detail: 'tables', weight: 3 }],
      reasoning: 'medium',
    },
    complexity: { level: 'medium', score: 4, factors: [], reasoning: 'medium' },
    roles: [
      { role: 'business_analyst', reason: 'scope change' },
      { role: 'product_owner', reason: 'roadmap' },
      { role: 'frontend_engineer', reason: 'pages' },
      { role: 'ui_ux', reason: 'design' },
      { role: 'qa', reason: 'reverify' },
    ],
    dependencies: [],
    recommendations: [],
    overallConfidence: 'high',
    requiresHumanReview: true,
    reasoning: [],
    summary: {
      affectedSections: 2,
      totalFindings: 1,
      highConfidenceFindings: 1,
      affectedFeatures: 1,
      affectedFiles: 3,
      affectedTables: 0,
    },
    ...overrides,
  };
}

function plan(analysisOverrides: Partial<ImpactAnalysis> = {}, requestOverrides: Partial<ChangeRequest> = {}) {
  return buildEvolutionPlan({
    request: request(requestOverrides),
    analysis: analysis(analysisOverrides),
    createdAt: '2026-08-12T10:05:00.000Z',
  });
}

describe('buildEvolutionPlan', () => {
  it('summarises from the analysis counts, never from adjectives', () => {
    const result = plan();

    expect(result.summary).toContain('release 1.0.0');
    expect(result.summary).toContain('1 feature(s)');
    expect(result.summary).toContain('3 generated file(s)');
    expect(result.summary).toContain('medium risk');
  });

  it('lists affected artifacts grouped by impact section', () => {
    const result = plan();

    expect(result.affectedArtifacts).toEqual([{ group: 'Business Impact', items: ['Book an appointment (FEAT-001)'] }]);
  });

  it('carries only the roles the analysis found, with their reasons', () => {
    const result = plan();

    expect(result.requiredRoles.map((role) => role.role)).toEqual([
      'business_analyst',
      'product_owner',
      'frontend_engineer',
      'ui_ux',
      'qa',
    ]);
    expect(result.requiredRoles.every((role) => role.reason.length > 0)).toBe(true);
  });

  it('builds phases from those roles rather than a fixed template', () => {
    const result = plan();

    expect(result.estimatedPhases.map((phase) => phase.id)).toEqual(['scope', 'ux', 'build', 'verify']);
  });

  it('produces no build phase when no engineering role is involved', () => {
    const result = plan({ roles: [{ role: 'business_analyst', reason: 'scope' }] });

    expect(result.estimatedPhases.map((phase) => phase.id)).toEqual(['scope']);
  });

  it('names only review gates this platform really has', () => {
    const result = plan();

    expect(result.requiredReviews.join(' ')).toMatch(/Roadmap Review/);
    expect(result.requiredReviews.join(' ')).toMatch(/Product Review/);
    expect(result.requiredReviews.join(' ')).toMatch(/Code Review/);
  });

  it('adds a customer sign-off gate for high risk', () => {
    const result = plan({ risk: { level: 'critical' as RiskLevel, score: 9, factors: [], reasoning: 'x' } });

    expect(result.requiredReviews.join(' ')).toMatch(/Customer sign-off/);
  });

  it('suggests maintenance of the current MVP for a small confined change', () => {
    const result = plan({
      complexity: { level: 'small' as ComplexityLevel, score: 2, factors: [], reasoning: 'x' },
      summary: { ...analysis().summary, affectedFeatures: 1 },
    });

    expect(result.suggestedMvp.placement).toBe('current_mvp_maintenance');
    expect(result.suggestedMvp.reasoning).toContain('small');
  });

  it('suggests a dedicated MVP for a major expansion', () => {
    const result = plan({
      classification: {
        category: 'major_expansion',
        source: 'inferred',
        confidence: 'low',
        reasoning: 'x',
        alternatives: [],
      },
    });

    expect(result.suggestedMvp.placement).toBe('dedicated_mvp');
  });

  it('suggests the next MVP when several features are implicated', () => {
    const result = plan({ summary: { ...analysis().summary, affectedFeatures: 3 } });

    expect(result.suggestedMvp.placement).toBe('next_mvp');
  });

  it('refuses to place work it could not ground', () => {
    const result = plan({
      summary: {
        affectedSections: 0,
        totalFindings: 0,
        highConfidenceFindings: 0,
        affectedFeatures: 0,
        affectedFiles: 0,
        affectedTables: 0,
      },
      roles: [],
    });

    expect(result.suggestedMvp.placement).toBe('needs_scoping');
    expect(result.summary).toMatch(/could not be linked/);
    expect(result.suggestedSprint).toMatch(/Not schedulable/);
  });

  it("raises priority for high risk but never lowers the customer's own", () => {
    expect(
      plan({ risk: { level: 'critical' as RiskLevel, score: 9, factors: [], reasoning: '' } }).suggestedPriority,
    ).toBe('urgent');
    expect(
      plan({ risk: { level: 'high' as RiskLevel, score: 5, factors: [], reasoning: '' } }, { priority: 'low' })
        .suggestedPriority,
    ).toBe('high');
    expect(
      plan({ risk: { level: 'low' as RiskLevel, score: 0, factors: [], reasoning: '' } }, { priority: 'urgent' })
        .suggestedPriority,
    ).toBe('urgent');
  });

  it('states its own boundary — nothing is created, generated or scheduled', () => {
    const result = plan();

    expect(result.futureScope.join(' ')).toMatch(/No code is generated/);
    expect(result.futureScope.join(' ')).toMatch(/No MVP, sprint or roadmap entry is created/);
    expect(result.futureScope.join(' ')).toMatch(/left completely untouched/);
  });

  it('carries the analysis risk factors verbatim rather than restating them', () => {
    expect(plan().estimatedRisks).toEqual([{ label: 'Database change', detail: 'tables' }]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });
});
