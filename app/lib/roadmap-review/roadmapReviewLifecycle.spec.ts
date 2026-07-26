import { describe, expect, it } from 'vitest';
import { isValidRoadmapReviewStatusTransition, isRoadmapReviewImmutable } from './roadmapReviewLifecycle';
import type { RoadmapReviewStatus } from './roadmapReviewTypes';

describe('isValidRoadmapReviewStatusTransition', () => {
  it('allows the linear happy path', () => {
    expect(isValidRoadmapReviewStatusTransition('draft', 'planning')).toBe(true);
    expect(isValidRoadmapReviewStatusTransition('planning', 'ready_for_review')).toBe(true);
    expect(isValidRoadmapReviewStatusTransition('ready_for_review', 'approved')).toBe(true);
  });

  it('allows archiving from any non-terminal state', () => {
    const nonTerminal: RoadmapReviewStatus[] = ['draft', 'planning', 'ready_for_review', 'approved'];

    for (const status of nonTerminal) {
      expect(isValidRoadmapReviewStatusTransition(status, 'archived')).toBe(true);
    }
  });

  it('treats a no-op as always valid', () => {
    const statuses: RoadmapReviewStatus[] = ['draft', 'planning', 'ready_for_review', 'approved', 'archived'];

    for (const status of statuses) {
      expect(isValidRoadmapReviewStatusTransition(status, status)).toBe(true);
    }
  });

  it('rejects skipping a stage', () => {
    expect(isValidRoadmapReviewStatusTransition('draft', 'ready_for_review')).toBe(false);
    expect(isValidRoadmapReviewStatusTransition('draft', 'approved')).toBe(false);
  });

  it('rejects any transition out of archived', () => {
    expect(isValidRoadmapReviewStatusTransition('archived', 'draft')).toBe(false);
    expect(isValidRoadmapReviewStatusTransition('archived', 'planning')).toBe(false);
  });

  it('rejects moving backward', () => {
    expect(isValidRoadmapReviewStatusTransition('approved', 'ready_for_review')).toBe(false);
    expect(isValidRoadmapReviewStatusTransition('ready_for_review', 'draft')).toBe(false);
  });
});

describe('isRoadmapReviewImmutable', () => {
  it('is true for approved and archived', () => {
    expect(isRoadmapReviewImmutable('approved')).toBe(true);
    expect(isRoadmapReviewImmutable('archived')).toBe(true);
  });

  it('is false for draft, planning, and ready_for_review', () => {
    expect(isRoadmapReviewImmutable('draft')).toBe(false);
    expect(isRoadmapReviewImmutable('planning')).toBe(false);
    expect(isRoadmapReviewImmutable('ready_for_review')).toBe(false);
  });
});
