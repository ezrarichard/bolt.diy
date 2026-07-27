import { describe, expect, it } from 'vitest';
import type { ReviewRequirement } from '~/lib/evolution/engineeringScopeTypes';
import type { DiscoveredImpact, IncrementalRoleRun } from './incrementalExecutionTypes';
import { blockingReviews, evaluateIncrementalReviews, reviewsPassed } from './incrementalReview';

const AT = '2026-08-14T10:00:00.000Z';

function requirement(stage: ReviewRequirement['stage'], required = true): ReviewRequirement {
  return { stage, label: stage, required, reasoning: 'test' };
}

function run(role: IncrementalRoleRun['role'], status: IncrementalRoleRun['status']): IncrementalRoleRun {
  return {
    executionId: 'exec-1',
    role,
    label: role,
    attempt: 1,
    status,
    discoveredImpacts: [],
    startedAt: AT,
  };
}

const outOfScope: DiscoveredImpact = {
  description: 'The export job also reads this column.',
  category: 'backend',
  affectedArtifact: 'api/exports.ts',
  reasoning: 'selected by name',
  severity: 'high',
  recommendedAction: 'expand_scope',
  scopeChangeRequired: true,
  reportedByRole: 'backend',
};

describe('evaluateIncrementalReviews', () => {
  it('applies only the stages the plan marked required', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review'), requirement('product_review', false)],
      roleRuns: [run('frontend', 'completed')],
      discoveredImpacts: [],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0].stage).toBe('code_review');
    expect(reviews[0].decision).toBe('approved');
    expect(reviewsPassed(reviews)).toBe(true);
  });

  it('blocks by scope when a covered role reported material impact outside scope', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review')],
      roleRuns: [run('backend', 'completed')],
      discoveredImpacts: [outOfScope],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('blocked_by_scope');
    expect(reviews[0].reasoning).toContain('Backend Engineer');
    expect(blockingReviews(reviews)).toHaveLength(1);
  });

  it('stops blocking once an operator has recorded a scope decision', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review')],
      roleRuns: [run('backend', 'completed')],
      discoveredImpacts: [outOfScope],
      scopeExpansionDecisions: [
        { decision: 'reject_expansion', reason: 'handled separately', decidedAt: AT, discoveredImpactIds: [] },
      ],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('approved');
  });

  it('ignores an immaterial discovery', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review')],
      roleRuns: [run('backend', 'completed')],
      discoveredImpacts: [
        { ...outOfScope, severity: 'low', recommendedAction: 'monitor_only', scopeChangeRequired: false },
      ],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('approved');
  });

  it('rejects when a covered role failed', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review')],
      roleRuns: [run('frontend', 'failed')],
      discoveredImpacts: [],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('rejected');
  });

  it('requests changes when a covered role did not finish', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('code_review')],
      roleRuns: [run('frontend', 'running')],
      discoveredImpacts: [],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('changes_requested');
  });

  it('requests changes when a required stage had no role run at all', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('product_review')],
      roleRuns: [run('frontend', 'completed')],
      discoveredImpacts: [],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    expect(reviews[0].decision).toBe('changes_requested');
    expect(reviews[0].coveredRoles).toEqual([]);
  });

  it('does not let one role’s out-of-scope finding block an unrelated stage', () => {
    const reviews = evaluateIncrementalReviews({
      reviewRequirements: [requirement('product_review')],
      roleRuns: [run('requirements', 'completed'), run('backend', 'completed')],
      discoveredImpacts: [outOfScope],
      scopeExpansionDecisions: [],
      reviewedAt: AT,
    });

    // Product Review covers the Business Analyst; the Backend Engineer's finding belongs to Code Review.
    expect(reviews[0].decision).toBe('approved');
  });
});
