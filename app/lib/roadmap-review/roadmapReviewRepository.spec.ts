import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RoadmapReviewDraft } from './roadmapReviewTypes';

const { getBuildersDbClientMock } = vi.hoisted(() => ({
  getBuildersDbClientMock: vi.fn(),
}));

vi.mock('~/lib/builders-db/client', () => ({
  getBuildersDbClient: getBuildersDbClientMock,
  isBuildersDbConfigured: () => true,
}));

const {
  createRoadmapReview,
  updateRoadmapReview,
  getRoadmapReview,
  listRoadmapReviews,
  listRoadmapReviewsByProductReview,
} = await import('./roadmapReviewRepository');

function mockReviewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'roadmap-review-1',
    project_id: 'proj-1',
    product_review_id: 'product-review-1',
    target_mvp_id: 'mvp-2',
    roadmap_version: 1,
    status: 'draft',
    executive_summary: null,
    roadmap_changes: [],
    new_features: [],
    deferred_features: [],
    removed_features: [],
    priorities: [],
    dependencies: [],
    technical_risks: [],
    business_risks: [],
    assumptions: [],
    recommended_release_goal: null,
    approval_notes: null,
    analysis: null,
    artifact_id: null,
    created_by: null,
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<RoadmapReviewDraft> = {}): RoadmapReviewDraft {
  return {
    projectId: 'proj-1',
    productReviewId: 'product-review-1',
    targetMvpId: 'mvp-2',
    ...overrides,
  };
}

describe('createRoadmapReview', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('inserts a new draft row at roadmapVersion 1 when none exist yet for this project', async () => {
    let insertedPayload: Record<string, unknown> | undefined;
    let scopedTo: string | undefined;

    const from = vi.fn((table: string) => {
      if (table !== 'builders_roadmap_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: (_column: string, value: string) => {
            scopedTo = value;
            return { order: () => Promise.resolve({ data: [], error: null }) };
          },
        }),
        insert: (payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return { select: () => ({ single: () => Promise.resolve({ data: mockReviewRow(), error: null }) }) };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createRoadmapReview(makeDraft());

    expect(result.ok).toBe(true);
    expect(result.review?.roadmapVersion).toBe(1);
    expect(scopedTo).toBe('proj-1');
    expect(insertedPayload).toMatchObject({
      project_id: 'proj-1',
      product_review_id: 'product-review-1',
      target_mvp_id: 'mvp-2',
      roadmap_version: 1,
      status: 'draft',
    });
  });

  it('computes roadmapVersion as one past the highest existing version PROJECT-WIDE, not per Product Review', async () => {
    let insertedPayload: Record<string, unknown> | undefined;

    const from = vi.fn((table: string) => {
      if (table !== 'builders_roadmap_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                /*
                 * Two prior Roadmap Reviews for a DIFFERENT Product Review in the same project —
                 * the next version must still continue the project-wide sequence, not restart at 1.
                 */
                data: [
                  mockReviewRow({ roadmap_version: 1, product_review_id: 'product-review-older' }),
                  mockReviewRow({ roadmap_version: 2, product_review_id: 'product-review-older' }),
                ],
                error: null,
              }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: mockReviewRow({ roadmap_version: 3 }), error: null }),
            }),
          };
        },
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createRoadmapReview(makeDraft({ productReviewId: 'product-review-newer' }));

    expect(result.ok).toBe(true);
    expect(result.review?.roadmapVersion).toBe(3);
    expect(insertedPayload).toMatchObject({ roadmap_version: 3 });
  });

  it('surfaces a unique-constraint conflict on (project_id, roadmap_version) as a clear, distinguishable error', async () => {
    const from = vi.fn((table: string) => {
      if (table !== 'builders_roadmap_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }),
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint' },
              }),
          }),
        }),
      };
    });

    getBuildersDbClientMock.mockReturnValue({ from });

    const result = await createRoadmapReview(makeDraft());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('concurrent request');
  });

  it('returns ok:false when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await createRoadmapReview(makeDraft());

    expect(result.ok).toBe(false);
  });
});

describe('getRoadmapReview / listRoadmapReviews / listRoadmapReviewsByProductReview', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  it('getRoadmapReview maps a row back to a RoadmapReview', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockReviewRow(), error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const review = await getRoadmapReview('roadmap-review-1');

    expect(review?.id).toBe('roadmap-review-1');
    expect(review?.targetMvpId).toBe('mvp-2');
    expect(review?.roadmapVersion).toBe(1);
  });

  it('getRoadmapReview returns null when no row matches', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    expect(await getRoadmapReview('missing')).toBeNull();
  });

  it('listRoadmapReviews scopes the query to project_id', async () => {
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

    const reviews = await listRoadmapReviews('proj-1');

    expect(scopedTo).toBe('proj-1');
    expect(reviews).toHaveLength(1);
  });

  it('listRoadmapReviewsByProductReview returns every review recorded for that Product Review, newest first', async () => {
    let scopedTo: string | undefined;

    const from = vi.fn(() => ({
      select: () => ({
        eq: (_column: string, value: string) => {
          scopedTo = value;
          return {
            order: () =>
              Promise.resolve({
                data: [
                  mockReviewRow({ id: 'rr-2', roadmap_version: 2 }),
                  mockReviewRow({ id: 'rr-1', roadmap_version: 1 }),
                ],
                error: null,
              }),
          };
        },
      }),
    }));

    getBuildersDbClientMock.mockReturnValue({ from });

    const reviews = await listRoadmapReviewsByProductReview('product-review-1');

    expect(scopedTo).toBe('product-review-1');
    expect(reviews.map((review) => review.roadmapVersion)).toEqual([2, 1]);
  });

  it('list functions return [] when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    expect(await listRoadmapReviews('proj-1')).toEqual([]);
    expect(await listRoadmapReviewsByProductReview('product-review-1')).toEqual([]);
  });
});

describe('updateRoadmapReview', () => {
  beforeEach(() => {
    getBuildersDbClientMock.mockReset();
  });

  function mockClientWithCurrent(
    currentStatus: string,
    onUpdate?: (payload: Record<string, unknown>) => void,
    rowOverrides: Partial<Record<string, unknown>> = {},
  ) {
    return vi.fn((table: string) => {
      if (table !== 'builders_roadmap_reviews') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: mockReviewRow({ status: currentStatus, ...rowOverrides }), error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          onUpdate?.(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    });
  }

  it('persists content fields while mutable', async () => {
    let updatedPayload: Record<string, unknown> | undefined;

    getBuildersDbClientMock.mockReturnValue({
      from: mockClientWithCurrent('planning', (payload) => {
        updatedPayload = payload;
      }),
    });

    const result = await updateRoadmapReview('roadmap-review-1', {
      executiveSummary: 'Great next step.',
      newFeatures: ['Billing'],
    });

    expect(result.ok).toBe(true);
    expect(updatedPayload).toEqual({ executive_summary: 'Great next step.', new_features: ['Billing'] });
  });

  it('rejects an illegal status transition and never writes', async () => {
    const from = vi.fn((table: string) => {
      if (table !== 'builders_roadmap_reviews') {
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

    const result = await updateRoadmapReview('roadmap-review-1', { status: 'approved' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid Roadmap Review status transition');
  });

  describe('immutability once approved or archived', () => {
    it('refuses a business-content change once status is approved, and never writes', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_roadmap_reviews') {
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

      const result = await updateRoadmapReview('roadmap-review-1', { executiveSummary: 'Edited after approval' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('immutable');
    });

    it('refuses a business-content change once status is archived', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_roadmap_reviews') {
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

      const result = await updateRoadmapReview('roadmap-review-1', { businessRisks: ['New risk'] });

      expect(result.ok).toBe(false);
    });

    it('still allows approvalNotes to be set in the SAME call that transitions to approved', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      getBuildersDbClientMock.mockReturnValue({
        from: mockClientWithCurrent('ready_for_review', (payload) => {
          updatedPayload = payload;
        }),
      });

      const result = await updateRoadmapReview('roadmap-review-1', {
        status: 'approved',
        approvalNotes: 'Looks good, proceed.',
      });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ status: 'approved', approval_notes: 'Looks good, proceed.' });
    });

    it('still allows an approved review to transition to archived (status-only, not content)', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      getBuildersDbClientMock.mockReturnValue({
        from: mockClientWithCurrent('approved', (payload) => {
          updatedPayload = payload;
        }),
      });

      const result = await updateRoadmapReview('roadmap-review-1', { status: 'archived' });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ status: 'archived' });
    });
  });

  describe('artifactId is system-managed linkage, not freely replaceable', () => {
    it('refuses to replace an already-linked artifactId with a different one, and never writes', async () => {
      const from = vi.fn((table: string) => {
        if (table !== 'builders_roadmap_reviews') {
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

      const result = await updateRoadmapReview('roadmap-review-1', { artifactId: 'artifact-different' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('cannot be replaced');
    });

    it('allows re-sending the SAME artifactId — an idempotent retry of the same link', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      getBuildersDbClientMock.mockReturnValue({
        from: mockClientWithCurrent(
          'planning',
          (payload) => {
            updatedPayload = payload;
          },
          { artifact_id: 'artifact-original' },
        ),
      });

      const result = await updateRoadmapReview('roadmap-review-1', { artifactId: 'artifact-original' });

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ artifact_id: 'artifact-original' });
    });
  });

  it('returns ok:false when BuildersDB is not configured', async () => {
    getBuildersDbClientMock.mockReturnValue(null);

    const result = await updateRoadmapReview('roadmap-review-1', { executiveSummary: 'x' });

    expect(result.ok).toBe(false);
  });

  describe('productReviewId / targetMvpId are immutable domain linkage (Sprint 83 correction)', () => {
    it('never forwards product_review_id or target_mvp_id to the DB even if a caller smuggles them in past the type system', async () => {
      let updatedPayload: Record<string, unknown> | undefined;

      const from = vi.fn((table: string) => {
        if (table !== 'builders_roadmap_reviews') {
          throw new Error(`unexpected table ${table}`);
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockReviewRow({ status: 'planning' }), error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updatedPayload = payload;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      });

      getBuildersDbClientMock.mockReturnValue({ from });

      /*
       * `RoadmapReviewUpdate` has no `productReviewId`/`targetMvpId` fields at all — this cast
       * simulates a caller that bypasses the type system, so the repository's own runtime
       * behavior (never reading these keys off `update`) is what's actually under test here.
       */
      const result = await updateRoadmapReview('roadmap-review-1', {
        executiveSummary: 'Legit change',
        productReviewId: 'product-review-different',
        targetMvpId: 'mvp-different',
      } as unknown as Parameters<typeof updateRoadmapReview>[1]);

      expect(result.ok).toBe(true);
      expect(updatedPayload).toEqual({ executive_summary: 'Legit change' });
      expect(updatedPayload).not.toHaveProperty('product_review_id');
      expect(updatedPayload).not.toHaveProperty('target_mvp_id');
    });
  });
});
