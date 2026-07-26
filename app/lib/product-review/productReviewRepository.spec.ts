import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProductReviewDraft } from './productReviewTypes';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const { createProductReview, updateProductReview, getProductReview, listProductReviews, listProductReviewsByMvp } =
  await import('./productReviewRepository');

function mockReviewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'review-1',
    project_id: 'proj-1',
    mvp_id: 'mvp-1',
    review_date: '2026-07-26T00:00:00.000Z',
    review_type: 'post_release',
    status: 'draft',
    summary: null,
    recommendations: [],
    business_risks: [],
    opportunities: [],
    feature_requests: [],
    technical_concerns: [],
    analysis: null,
    attachments: [],
    artifact_id: null,
    created_by: null,
    created_at: '2026-07-26T00:00:00.000Z',
    updated_at: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ProductReviewDraft> = {}): ProductReviewDraft {
  return {
    projectId: 'proj-1',
    mvpId: 'mvp-1',
    ...overrides,
  };
}

describe('createProductReview', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts a new draft row scoped to the project and MVP', async () => {
    let insertedPayload: Record<string, unknown> | undefined;

    const from = vi.fn((table: string) => {
      if (table !== 'builders_product_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        insert: (payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return { select: () => ({ single: () => Promise.resolve({ data: mockReviewRow(), error: null }) }) };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createProductReview(makeDraft());

    expect(result.ok).toBe(true);
    expect(result.review?.projectId).toBe('proj-1');
    expect(result.review?.mvpId).toBe('mvp-1');
    expect(result.review?.status).toBe('draft');
    expect(insertedPayload).toMatchObject({
      project_id: 'proj-1',
      mvp_id: 'mvp-1',
      review_type: 'post_release',
      status: 'draft',
    });
  });

  it('returns ok:false when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await createProductReview(makeDraft());

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns ok:false when the insert fails', async () => {
    const from = vi.fn(() => ({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createProductReview(makeDraft());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });
});

describe('getProductReview / listProductReviews / listProductReviewsByMvp', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('getProductReview maps a row back to a ProductReview', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockReviewRow(), error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const review = await getProductReview('review-1');

    expect(review?.id).toBe('review-1');
    expect(review?.reviewType).toBe('post_release');
  });

  it('getProductReview returns null when no row matches', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await getProductReview('missing')).toBeNull();
  });

  it('listProductReviews scopes the query to project_id', async () => {
    let scopedTo: string | undefined;

    const from = vi.fn(() => ({
      select: () => ({
        eq: (_column: string, value: string) => {
          scopedTo = value;
          return {
            order: () => Promise.resolve({ data: [mockReviewRow(), mockReviewRow({ id: 'review-2' })], error: null }),
          };
        },
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const reviews = await listProductReviews('proj-1');

    expect(scopedTo).toBe('proj-1');
    expect(reviews).toHaveLength(2);
    expect(reviews.every((review) => review.projectId === 'proj-1')).toBe(true);
  });

  it('listProductReviewsByMvp scopes the query to mvp_id', async () => {
    let scopedTo: string | undefined;

    const from = vi.fn(() => ({
      select: () => ({
        eq: (_column: string, value: string) => {
          scopedTo = value;
          return { order: () => Promise.resolve({ data: [mockReviewRow()], error: null }) };
        },
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const reviews = await listProductReviewsByMvp('mvp-1');

    expect(scopedTo).toBe('mvp-1');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].mvpId).toBe('mvp-1');
  });

  it('list functions return [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await listProductReviews('proj-1')).toEqual([]);
    expect(await listProductReviewsByMvp('mvp-1')).toEqual([]);
  });
});

describe('multiple Product Reviews per MVP (Sprint 82 polish — verified, not a restriction)', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('createProductReview inserts a fresh row every call — no upsert-by-mvpId', async () => {
    const insertedPayloads: Record<string, unknown>[] = [];
    let nextId = 1;

    const from = vi.fn(() => ({
      insert: (payload: Record<string, unknown>) => {
        insertedPayloads.push(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: mockReviewRow({ id: `review-${nextId++}` }), error: null }),
          }),
        };
      },
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const first = await createProductReview(makeDraft({ reviewType: 'post_release' }));
    const second = await createProductReview(makeDraft({ reviewType: 'quarterly' }));
    const third = await createProductReview(makeDraft({ reviewType: 'security' }));

    expect(first.ok && second.ok && third.ok).toBe(true);
    expect(new Set([first.review?.id, second.review?.id, third.review?.id]).size).toBe(3);
    expect(insertedPayloads).toHaveLength(3);
    expect(insertedPayloads.every((payload) => payload.mvp_id === 'mvp-1')).toBe(true);
  });

  it('listProductReviewsByMvp returns every review recorded for that MVP, not just the latest', async () => {
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                mockReviewRow({ id: 'review-3', review_type: 'security' }),
                mockReviewRow({ id: 'review-2', review_type: 'quarterly' }),
                mockReviewRow({ id: 'review-1', review_type: 'post_release' }),
              ],
              error: null,
            }),
        }),
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const reviews = await listProductReviewsByMvp('mvp-1');

    expect(reviews).toHaveLength(3);
    expect(reviews.map((review) => review.reviewType)).toEqual(['security', 'quarterly', 'post_release']);
    expect(reviews.every((review) => review.mvpId === 'mvp-1')).toBe(true);
  });
});

describe('updateProductReview', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  /** Every business-content update now reads the current row first (to check immutability) — this mock supplies both `select`/`maybeSingle` and `update`. */
  function mockClientWithCurrent(currentStatus: string, onUpdate?: (payload: Record<string, unknown>) => void) {
    return vi.fn((table: string) => {
      if (table !== 'builders_product_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockReviewRow({ status: currentStatus }), error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          onUpdate?.(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    });
  }

  it('persists analysis fields without touching status', async () => {
    let updatedPayload: Record<string, unknown> | undefined;

    getBuildersDbClientMock.mockReturnValue({
      from: mockClientWithCurrent('draft', (payload) => {
        updatedPayload = payload;
      }),
    });

    const result = await updateProductReview('review-1', { summary: 'Great launch', businessRisks: ['Churn risk'] });

    expect(result.ok).toBe(true);
    expect(updatedPayload).toEqual({ summary: 'Great launch', business_risks: ['Churn risk'] });
  });

  it('rejects an illegal status transition and never writes', async () => {
    const from = vi.fn((table: string) => {
      if (table !== 'builders_product_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockReviewRow({ status: 'draft' }), error: null }) }),
        }),
        update: () => {
          throw new Error('update should never be called for an illegal transition');
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await updateProductReview('review-1', { status: 'approved' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid Product Review status transition');
  });

  it('allows a legal status transition', async () => {
    let updatedPayload: Record<string, unknown> | undefined;

    getBuildersDbClientMock.mockReturnValue({
      from: mockClientWithCurrent('draft', (payload) => {
        updatedPayload = payload;
      }),
    });

    const result = await updateProductReview('review-1', { status: 'analysing' });

    expect(result.ok).toBe(true);
    expect(updatedPayload).toEqual({ status: 'analysing' });
  });

  it('returns ok:false when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await updateProductReview('review-1', { summary: 'x' });

    expect(result.ok).toBe(false);
  });

  describe('immutability once approved or archived (Sprint 82 polish)', () => {
    it('refuses a business-content change once status is approved, and never writes', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_product_reviews') {
          throw new Error(`unexpected table ${table}`);
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockReviewRow({ status: 'approved' }), error: null }),
            }),
          }),
          update: () => {
            throw new Error('update should never be called against an immutable review');
          },
        };
      });

      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await updateProductReview('review-1', { summary: 'Revised after the fact' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('immutable');
    });

    it('refuses a business-content change once status is archived', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_product_reviews') {
          throw new Error(`unexpected table ${table}`);
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockReviewRow({ status: 'archived' }), error: null }),
            }),
          }),
          update: () => {
            throw new Error('update should never be called against an immutable review');
          },
        };
      });

      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await updateProductReview('review-1', { businessRisks: ['New risk'] });

      expect(result.ok).toBe(false);
    });

    it('still allows an approved review to transition to archived (status-only, not content)', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      getBuildersDbClientMock.mockReturnValue({
        from: mockClientWithCurrent('approved', (payload) => {
          updatedPayload = payload;
        }),
      });

      const result = await updateProductReview('review-1', { status: 'archived' });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ status: 'archived' });
    });

    it('still allows setting artifactId once approved — linkage metadata, not business content', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      getBuildersDbClientMock.mockReturnValue({
        from: mockClientWithCurrent('approved', (payload) => {
          updatedPayload = payload;
        }),
      });

      const result = await updateProductReview('review-1', { artifactId: 'artifact-123' });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ artifact_id: 'artifact-123' });
    });
  });

  describe('artifactId is system-managed linkage, not freely replaceable (Sprint 82 — Transactional Consistency Review)', () => {
    it('refuses to replace an already-linked artifactId with a different one, and never writes', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_product_reviews') {
          throw new Error(`unexpected table ${table}`);
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: mockReviewRow({ artifact_id: 'artifact-original' }), error: null }),
            }),
          }),
          update: () => {
            throw new Error('update should never be called when replacing an existing artifact link');
          },
        };
      });

      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await updateProductReview('review-1', { artifactId: 'artifact-different' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('cannot be replaced');
    });

    it('allows re-sending the SAME artifactId — an idempotent retry of the same link', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      const from = vi.fn((table: string) => {
        if (table !== 'builders_product_reviews') {
          throw new Error(`unexpected table ${table}`);
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: mockReviewRow({ artifact_id: 'artifact-original' }), error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updatedPayload = payload;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      });

      getBuildersDbClientMock.mockReturnValue({ from });

      const result = await updateProductReview('review-1', {
        artifactId: 'artifact-original',
        summary: 'Refined summary',
      });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ artifact_id: 'artifact-original', summary: 'Refined summary' });
    });
  });
});
