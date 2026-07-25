import { describe, expect, it } from 'vitest';
import { isValidFeatureStatusTransition, isValidMvpStatusTransition } from './lifecycleTransitions';

describe('isValidMvpStatusTransition — Sprint 78 Phase 0', () => {
  it('allows the full forward chain, one step at a time', () => {
    expect(isValidMvpStatusTransition('planned', 'scoped')).toBe(true);
    expect(isValidMvpStatusTransition('scoped', 'generating')).toBe(true);
    expect(isValidMvpStatusTransition('generating', 'ready_for_review')).toBe(true);
    expect(isValidMvpStatusTransition('ready_for_review', 'approved')).toBe(true);
    expect(isValidMvpStatusTransition('approved', 'released')).toBe(true);
    expect(isValidMvpStatusTransition('released', 'superseded')).toBe(true);
  });

  it('rejects skipping a step', () => {
    expect(isValidMvpStatusTransition('planned', 'generating')).toBe(false);
    expect(isValidMvpStatusTransition('scoped', 'approved')).toBe(false);
    expect(isValidMvpStatusTransition('planned', 'released')).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(isValidMvpStatusTransition('approved', 'ready_for_review')).toBe(false);
    expect(isValidMvpStatusTransition('released', 'approved')).toBe(false);
    expect(isValidMvpStatusTransition('superseded', 'released')).toBe(false);
  });

  it('never stores "provisioned"/"generated"/"qa_passed"/"ready_for_deployment" as MvpStatus values — approved transitions directly to released', () => {
    expect(isValidMvpStatusTransition('approved', 'released')).toBe(true);
  });

  it('allows blocked from any pre-released state, and resuming from blocked back into any pre-released state', () => {
    for (const state of ['planned', 'scoped', 'generating', 'ready_for_review', 'approved'] as const) {
      expect(isValidMvpStatusTransition(state, 'blocked')).toBe(true);
      expect(isValidMvpStatusTransition('blocked', state)).toBe(true);
    }
  });

  it('never allows blocked from released or superseded', () => {
    expect(isValidMvpStatusTransition('released', 'blocked')).toBe(false);
    expect(isValidMvpStatusTransition('superseded', 'blocked')).toBe(false);
  });

  it('treats a no-op (from === to) as always valid, for every status', () => {
    for (const state of [
      'planned',
      'scoped',
      'generating',
      'ready_for_review',
      'approved',
      'blocked',
      'released',
      'superseded',
    ] as const) {
      expect(isValidMvpStatusTransition(state, state)).toBe(true);
    }
  });

  it('superseded is terminal — nothing transitions out of it', () => {
    for (const state of [
      'planned',
      'scoped',
      'generating',
      'ready_for_review',
      'approved',
      'blocked',
      'released',
    ] as const) {
      expect(isValidMvpStatusTransition('superseded', state)).toBe(false);
    }
  });
});

describe('isValidFeatureStatusTransition — Sprint 78 Phase 0', () => {
  it('allows the full forward chain, one step at a time', () => {
    expect(isValidFeatureStatusTransition('planned', 'in_progress')).toBe(true);
    expect(isValidFeatureStatusTransition('in_progress', 'generated')).toBe(true);
    expect(isValidFeatureStatusTransition('generated', 'qa_passed')).toBe(true);
    expect(isValidFeatureStatusTransition('qa_passed', 'deployed')).toBe(true);
  });

  it('rejects skipping a step', () => {
    expect(isValidFeatureStatusTransition('planned', 'generated')).toBe(false);
    expect(isValidFeatureStatusTransition('planned', 'deployed')).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(isValidFeatureStatusTransition('deployed', 'qa_passed')).toBe(false);
    expect(isValidFeatureStatusTransition('generated', 'planned')).toBe(false);
  });

  it('treats a no-op (from === to) as always valid, for every status', () => {
    for (const state of ['planned', 'in_progress', 'generated', 'qa_passed', 'deployed'] as const) {
      expect(isValidFeatureStatusTransition(state, state)).toBe(true);
    }
  });

  it('deployed is terminal — nothing transitions out of it', () => {
    for (const state of ['planned', 'in_progress', 'generated', 'qa_passed'] as const) {
      expect(isValidFeatureStatusTransition('deployed', state)).toBe(false);
    }
  });
});
