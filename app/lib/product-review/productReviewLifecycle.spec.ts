import { describe, expect, it } from 'vitest';
import { isValidProductReviewStatusTransition } from './productReviewLifecycle';
import type { ProductReviewStatus } from './productReviewTypes';

describe('isValidProductReviewStatusTransition', () => {
  it('allows the linear happy path', () => {
    expect(isValidProductReviewStatusTransition('draft', 'analysing')).toBe(true);
    expect(isValidProductReviewStatusTransition('analysing', 'ready_for_review')).toBe(true);
    expect(isValidProductReviewStatusTransition('ready_for_review', 'approved')).toBe(true);
  });

  it('allows archiving from any non-terminal state', () => {
    const nonTerminal: ProductReviewStatus[] = ['draft', 'analysing', 'ready_for_review', 'approved'];

    for (const status of nonTerminal) {
      expect(isValidProductReviewStatusTransition(status, 'archived')).toBe(true);
    }
  });

  it('treats a no-op as always valid', () => {
    const statuses: ProductReviewStatus[] = ['draft', 'analysing', 'ready_for_review', 'approved', 'archived'];

    for (const status of statuses) {
      expect(isValidProductReviewStatusTransition(status, status)).toBe(true);
    }
  });

  it('rejects skipping a stage', () => {
    expect(isValidProductReviewStatusTransition('draft', 'ready_for_review')).toBe(false);
    expect(isValidProductReviewStatusTransition('draft', 'approved')).toBe(false);
  });

  it('rejects any transition out of archived', () => {
    expect(isValidProductReviewStatusTransition('archived', 'draft')).toBe(false);
    expect(isValidProductReviewStatusTransition('archived', 'analysing')).toBe(false);
  });

  it('rejects moving backward', () => {
    expect(isValidProductReviewStatusTransition('approved', 'ready_for_review')).toBe(false);
    expect(isValidProductReviewStatusTransition('ready_for_review', 'draft')).toBe(false);
  });
});
