import { describe, expect, it } from 'vitest';
import type { IncrementalEngineeringPlan, IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import { approvedExecutionOrder, resolveRoleSelection, restoreRecommendedSelection } from './roleOverrides';

/**
 * Sprint 97, Part 4. Every test here asserts a REFUSAL or an ACCEPTANCE of a concrete operator
 * edit — the point of the module is that an invalid execution graph cannot be produced, so the
 * interesting cases are the ones that must not be allowed through.
 */

function makePlan(selected: IncrementalRoleId[], scopeOverrides: Partial<IncrementalEngineeringPlan['scope']> = {}) {
  return {
    modelVersion: '1.0.0',
    scope: {
      changeRequestId: 'req-1',
      affectedFeatures: [{ identifier: 'F-1', label: 'Booking', evidence: 'matched' }],
      affectedPages: [{ identifier: 'pages/Booking.tsx', label: 'Booking', evidence: 'matched' }],
      affectedComponents: [],
      affectedDatabaseObjects: [{ identifier: 'bookings', label: 'bookings', evidence: 'matched' }],
      affectedApis: [{ identifier: 'api/bookings.ts', label: 'bookings API', evidence: 'matched' }],
      affectedEnvironment: [],
      affectedDocuments: [],
      affectedRoles: selected,
      unaffectedAreas: [],
      metadata: {
        classification: 'enhancement',
        riskLevel: 'low',
        complexityLevel: 'small',
        requiresHumanReview: false,
        capturedAt: '2026-08-14T10:00:00.000Z',
      },
      ...scopeOverrides,
    },
    roleDecisions: [],
    executionOrder: selected.map((role, index) => ({ order: index + 1, role, label: role, reasoning: 'selected' })),
    changeSet: {} as never,
    reducedContexts: [],
    reviewRequirements: [],
    summary: '',
    outOfScope: [],
    createdAt: '2026-08-14T10:00:00.000Z',
  } as unknown as IncrementalEngineeringPlan;
}

describe('resolveRoleSelection', () => {
  it('returns the recommendation unchanged when there are no overrides', () => {
    const result = resolveRoleSelection({ plan: makePlan(['frontend', 'qa']) });

    expect(result.ok).toBe(true);
    expect(result.approvedRoles).toEqual(['frontend', 'qa']);
    expect(result.appliedOverrides).toEqual([]);
  });

  it('rejects an override with no reason', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'devops', action: 'include', reason: '   ' }],
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0].code).toBe('missing_reason');

    // The approved selection falls back to the recommendation — never a half-applied set.
    expect(result.approvedRoles).toEqual(['frontend', 'qa']);
  });

  it('rejects an override that changes nothing', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'frontend', action: 'include', reason: 'already there' }],
    });

    expect(result.violations[0].code).toBe('not_applicable');
  });

  it('rejects two overrides for the same role', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [
        { role: 'devops', action: 'include', reason: 'env change' },
        { role: 'devops', action: 'exclude', reason: 'changed my mind' },
      ],
    });

    expect(result.violations.some((violation) => violation.code === 'duplicate_override')).toBe(true);
  });

  it('refuses to remove QA while a code-producing role runs', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'qa', action: 'exclude', reason: 'in a hurry' }],
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0].code).toBe('qa_required');
    expect(result.violations[0].message).toContain('Frontend Engineer');
  });

  it('allows QA to be removed when no code-producing role runs', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['requirements', 'qa']),
      overrides: [{ role: 'qa', action: 'exclude', reason: 'requirements wording only' }],
    });

    expect(result.ok).toBe(true);
    expect(result.approvedRoles).toEqual(['requirements']);
  });

  it('refuses to exclude a role whose output an approved role consumes', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['backend', 'frontend', 'qa']),
      overrides: [{ role: 'backend', action: 'exclude', reason: 'no API change after all' }],
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((violation) => violation.code === 'dependency_broken')).toBe(true);
  });

  it('allows excluding the last role in the chain', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa', 'devops']),
      overrides: [{ role: 'devops', action: 'exclude', reason: 'no infrastructure change' }],
    });

    expect(result.ok).toBe(true);
    expect(result.approvedRoles).toEqual(['frontend', 'qa']);
  });

  it('includes an operator-added role that the scope can brief', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'database', action: 'include', reason: 'the bookings table needs a column' }],
    });

    expect(result.ok).toBe(true);
    expect(result.approvedRoles).toEqual(['database', 'frontend', 'qa']);
  });

  it('refuses to add a role the scope cannot brief', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'devops', action: 'include', reason: 'just in case' }],
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0].code).toBe('no_reduced_context');
  });

  it('rejects an unknown role', () => {
    const result = resolveRoleSelection({
      plan: makePlan(['frontend', 'qa']),
      overrides: [{ role: 'marketing' as IncrementalRoleId, action: 'include', reason: 'why not' }],
    });

    expect(result.violations[0].code).toBe('unknown_role');
  });

  it('restores the recommended selection', () => {
    const plan = makePlan(['backend', 'frontend', 'qa']);

    expect(restoreRecommendedSelection(plan).approvedRoles).toEqual(['backend', 'frontend', 'qa']);
  });

  it('always returns roles in the pipeline order, whatever order they were added in', () => {
    expect(approvedExecutionOrder(['qa', 'requirements', 'frontend'])).toEqual(['requirements', 'frontend', 'qa']);
  });
});
