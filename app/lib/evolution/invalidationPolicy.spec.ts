import { describe, expect, it } from 'vitest';
import type { IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import { PIPELINE_ORDER } from './roleSelection';
import { CONSUMED_ARTIFACTS, GATE_DEPENDENCY, independentGroups, transitiveConsumersOf } from './roleDependencyGraph';
import { applyInvalidationPolicy, missingMandatoryReruns, reviewOnlyRoles } from './invalidationPolicy';

/** Sprint 97, Part 5. The spec's own worked example is the first test, verbatim. */

function stateOf(decisions: ReturnType<typeof applyInvalidationPolicy>, role: IncrementalRoleId) {
  return decisions.find((decision) => decision.role === role)!;
}

describe('roleDependencyGraph', () => {
  it('keeps the gate map consistent with the consumption map', () => {
    for (const [role, gate] of Object.entries(GATE_DEPENDENCY)) {
      expect(CONSUMED_ARTIFACTS[role as IncrementalRoleId]).toContain(gate);
    }
  });

  it('covers every pipeline role', () => {
    for (const role of PIPELINE_ORDER) {
      expect(CONSUMED_ARTIFACTS[role]).toBeDefined();
    }
  });

  it('never reports a role as its own consumer', () => {
    for (const role of PIPELINE_ORDER) {
      expect(transitiveConsumersOf(role)).not.toContain(role);
    }
  });

  it('finds database and uiux independent of each other', () => {
    // Both gate on architecture; neither reads the other. This is the one genuinely parallel pair.
    expect(independentGroups(['database', 'uiux'])).toEqual([['database', 'uiux']]);
  });

  it('never groups a producer with something that consumes it', () => {
    expect(independentGroups(['backend', 'frontend'])).toEqual([['backend'], ['frontend']]);
  });
});

describe('applyInvalidationPolicy', () => {
  it("resolves the sprint's Architecture example", () => {
    const decisions = applyInvalidationPolicy({ approvedRoles: ['architecture'] });

    expect(stateOf(decisions, 'architecture').state).toBe('invalidated');

    // Gate consumers of architecture must re-run.
    expect(stateOf(decisions, 'database')).toMatchObject({ state: 'invalidated', mustRerun: true });
    expect(stateOf(decisions, 'uiux')).toMatchObject({ state: 'invalidated', mustRerun: true });

    // Direct readers of architecture may only need review.
    for (const role of ['backend', 'frontend', 'qa', 'devops'] as IncrementalRoleId[]) {
      expect(stateOf(decisions, role)).toMatchObject({
        state: 'potentially_stale',
        mustRerun: false,
        requiresReview: true,
      });
    }

    // Nothing upstream of architecture is affected.
    expect(stateOf(decisions, 'requirements').state).toBe('valid');
    expect(stateOf(decisions, 'productowner').state).toBe('valid');
  });

  it('marks everything valid when nothing runs', () => {
    const decisions = applyInvalidationPolicy({ approvedRoles: [] });

    expect(decisions.every((decision) => decision.state === 'valid')).toBe(true);
    expect(decisions).toHaveLength(PIPELINE_ORDER.length);
  });

  it('marks an executing role as invalidated by the execution itself', () => {
    const decisions = applyInvalidationPolicy({ approvedRoles: ['frontend', 'qa'] });

    expect(stateOf(decisions, 'frontend')).toMatchObject({ state: 'invalidated', causedBy: ['frontend'] });
  });

  it('invalidates QA when frontend re-runs, because frontend is QA’s gate', () => {
    const decisions = applyInvalidationPolicy({ approvedRoles: ['frontend'] });

    expect(stateOf(decisions, 'qa')).toMatchObject({ state: 'invalidated', mustRerun: true });
    expect(stateOf(decisions, 'devops')).toMatchObject({ state: 'potentially_stale' });
  });

  it('carries the dependency edge as evidence, never a bare label', () => {
    const decisions = applyInvalidationPolicy({ approvedRoles: ['database'] });
    const backend = stateOf(decisions, 'backend');

    expect(backend.state).toBe('invalidated');
    expect(backend.evidence[0]).toContain('gate');
    expect(backend.reasoning).toContain('Database Engineer');
  });

  it('carries the artifact type through when the plan supplies one', () => {
    const decisions = applyInvalidationPolicy({
      approvedRoles: ['frontend'],
      artifactTypeByRole: { qa: 'qa-draft' },
    });

    expect(stateOf(decisions, 'qa').artifactType).toBe('qa-draft');
  });

  it('reports a mandatory re-run that the approved selection omits, and never adds it', () => {
    const approved: IncrementalRoleId[] = ['frontend'];
    const decisions = applyInvalidationPolicy({ approvedRoles: approved });
    const missing = missingMandatoryReruns(decisions, approved);

    expect(missing.map((decision) => decision.role)).toEqual(['qa']);

    // The policy reports; it does not expand the selection.
    expect(approved).toEqual(['frontend']);
  });

  it('reports nothing missing when the mandatory re-run is already approved', () => {
    const approved: IncrementalRoleId[] = ['frontend', 'qa', 'devops'];

    expect(missingMandatoryReruns(applyInvalidationPolicy({ approvedRoles: approved }), approved)).toEqual([]);
  });

  it('lists review-only roles separately from mandatory re-runs', () => {
    const approved: IncrementalRoleId[] = ['database', 'backend'];
    const decisions = applyInvalidationPolicy({ approvedRoles: approved });

    /*
     * Frontend gates on Backend, so it must re-run. QA and DevOps read Database and Backend
     * directly but gate on something that is not executing — review, not a mandatory re-run.
     */
    expect(missingMandatoryReruns(decisions, approved).map((decision) => decision.role)).toEqual(['frontend']);
    expect(reviewOnlyRoles(decisions, approved)).toEqual(['qa', 'devops']);
  });
});
