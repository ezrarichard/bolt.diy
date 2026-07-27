import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import {
  isProductReviewImmutable,
  isValidProductReviewStatusTransition,
  PRODUCT_REVIEW_ARTIFACT_LINK_ERROR,
  PRODUCT_REVIEW_IMMUTABLE_ERROR,
} from './productReviewLifecycle';
import {
  PRODUCT_REVIEW_CONTENT_FIELDS,
  type ProductReview,
  type ProductReviewAttachment,
  type ProductReviewDraft,
  type ProductReviewStatus,
  type ProductReviewType,
  type ProductReviewUpdate,
  type ProductReviewUpdateResult,
  type ProductReviewWriteResult,
} from './productReviewTypes';
import type { BusinessAnalystProductReviewOutput } from '~/lib/projects/prompts/productReview';
import { formatError, toStructuredError } from '~/lib/builders-db/repositories/structuredError';

/**
 * Product Review Repository — Sprint 82 (Business Analyst Product Review workflow).
 *
 * Same defensive contract as every other BuildersDB repository in this codebase
 * (`mvpRepository.ts`, `featureRepository.ts`): guarded on BuildersDB being configured, every
 * Supabase call wrapped in try/catch, every failure path logs and returns a safe fallback
 * (`false`/`[]`/`null`, or an explicit `{ ok: false, error }`) rather than throwing. Ownership/RLS
 * is enforced entirely at the database layer (`builders_user_can_access_project`/
 * `builders_user_can_edit_project`, same helpers `builders_mvps`/`builders_features` already use
 * — see the migration) — this module never re-checks ownership itself.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[ProductReview] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[ProductReview] ${method}() failed: ${formatError(error)}`, toStructuredError(error));
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown error';
}

interface ProductReviewRow {
  id: string;
  project_id: string;
  mvp_id: string;
  review_date: string;
  review_type: ProductReviewType;
  status: ProductReviewStatus;
  summary: string | null;
  recommendations: string[] | null;
  business_risks: string[] | null;
  opportunities: string[] | null;
  feature_requests: string[] | null;
  technical_concerns: string[] | null;
  analysis: BusinessAnalystProductReviewOutput | null;
  attachments: ProductReviewAttachment[] | null;
  artifact_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: ProductReviewRow): ProductReview {
  return {
    id: row.id,
    projectId: row.project_id,
    mvpId: row.mvp_id,
    reviewDate: row.review_date,
    reviewType: row.review_type,
    status: row.status,
    summary: row.summary ?? undefined,
    recommendations: row.recommendations ?? [],
    businessRisks: row.business_risks ?? [],
    opportunities: row.opportunities ?? [],
    featureRequests: row.feature_requests ?? [],
    technicalConcerns: row.technical_concerns ?? [],
    analysis: row.analysis ?? undefined,
    attachments: row.attachments ?? [],
    artifactId: row.artifact_id ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates a new Product Review. Status defaults to `'draft'` when omitted — the row exists before
 * the Business Analyst has run, mirroring `createMvp`'s "row exists before engineering begins"
 * discipline. Always inserts a NEW row — never upserts or checks for an existing review at
 * `draft.mvpId` first — so a released MVP being reviewed a second (or fifth) time is never
 * blocked; see `ProductReview`'s own "One MVP, many Product Reviews" comment.
 */
export async function createProductReview(draft: ProductReviewDraft): Promise<ProductReviewWriteResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('createProductReview');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const { data, error } = await client
      .from('builders_product_reviews')
      .insert({
        project_id: draft.projectId,
        mvp_id: draft.mvpId,
        review_type: draft.reviewType ?? 'post_release',
        status: draft.status ?? 'draft',
      })
      .select('*')
      .single();

    if (error || !data) {
      throw error ?? new Error('Insert returned no row');
    }

    return { ok: true, error: null, review: fromRow(data as ProductReviewRow) };
  } catch (error) {
    logError('createProductReview', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

/** True if `update` touches any business-content field (`PRODUCT_REVIEW_CONTENT_FIELDS`) — `status`/`artifactId` don't count, see those fields' own comments. */
function touchesBusinessContent(update: ProductReviewUpdate): boolean {
  return PRODUCT_REVIEW_CONTENT_FIELDS.some((key) => update[key] !== undefined);
}

/**
 * Updates an existing Product Review's analysis fields (and/or `status`, validated against
 * `isValidProductReviewStatusTransition` first — see `updateFeatureFields`/`updateFeatureStatus`'s
 * identical split, kept here as one function since a Product Review's analysis fields and status
 * are written together by the same caller, `productReviewEngine.ts`, at each lifecycle step).
 *
 * Sprint 82 polish — append-only enforcement: once the CURRENT row's status is `'approved'` or
 * `'archived'` (`isProductReviewImmutable`), any business-content field in `update` is refused
 * with `PRODUCT_REVIEW_IMMUTABLE_ERROR` and nothing is written — matching this codebase's other
 * append-only decision logs. A status-only update (e.g. `approved -> archived`) is still allowed
 * through the normal transition check below; only content is frozen, not the lifecycle itself.
 *
 * Sprint 82 — Transactional Consistency Review: `artifactId` may be SET exactly once (unset ->
 * a value) or re-sent with the SAME value (an idempotent retry of the same link — see
 * `productReviewEngine.completeAnalysis`'s reuse-on-retry behavior); an attempt to REPLACE an
 * already-linked artifact with a different one is refused with `PRODUCT_REVIEW_ARTIFACT_LINK_ERROR`
 * — see that constant's own comment for why. This is what makes "one Product Review, one
 * canonical Artifact" an enforced invariant rather than just a convention callers happen to
 * follow.
 */
export async function updateProductReview(
  reviewId: string,
  update: ProductReviewUpdate,
): Promise<ProductReviewUpdateResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('updateProductReview');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  const contentChange = touchesBusinessContent(update);
  const needsCurrent = update.status !== undefined || contentChange || update.artifactId !== undefined;

  if (needsCurrent) {
    const current = await getProductReview(reviewId);

    if (!current) {
      const error = `Product Review ${reviewId} not found`;
      logError('updateProductReview', new Error(error));

      return { ok: false, error };
    }

    if (contentChange && isProductReviewImmutable(current.status)) {
      logError('updateProductReview', new Error(PRODUCT_REVIEW_IMMUTABLE_ERROR));
      return { ok: false, error: PRODUCT_REVIEW_IMMUTABLE_ERROR };
    }

    if (
      update.artifactId !== undefined &&
      current.artifactId !== undefined &&
      current.artifactId !== update.artifactId
    ) {
      logError('updateProductReview', new Error(PRODUCT_REVIEW_ARTIFACT_LINK_ERROR));
      return { ok: false, error: PRODUCT_REVIEW_ARTIFACT_LINK_ERROR };
    }

    if (update.status !== undefined && !isValidProductReviewStatusTransition(current.status, update.status)) {
      const error = `Invalid Product Review status transition: ${current.status} -> ${update.status}`;
      logError('updateProductReview', new Error(error));

      return { ok: false, error };
    }
  }

  try {
    const payload: Record<string, unknown> = {};

    if (update.status !== undefined) {
      payload.status = update.status;
    }

    if (update.summary !== undefined) {
      payload.summary = update.summary;
    }

    if (update.recommendations !== undefined) {
      payload.recommendations = update.recommendations;
    }

    if (update.businessRisks !== undefined) {
      payload.business_risks = update.businessRisks;
    }

    if (update.opportunities !== undefined) {
      payload.opportunities = update.opportunities;
    }

    if (update.featureRequests !== undefined) {
      payload.feature_requests = update.featureRequests;
    }

    if (update.technicalConcerns !== undefined) {
      payload.technical_concerns = update.technicalConcerns;
    }

    if (update.analysis !== undefined) {
      payload.analysis = update.analysis;
    }

    if (update.attachments !== undefined) {
      payload.attachments = update.attachments;
    }

    if (update.artifactId !== undefined) {
      payload.artifact_id = update.artifactId;
    }

    const { error } = await client.from('builders_product_reviews').update(payload).eq('id', reviewId);

    if (error) {
      throw error;
    }

    return { ok: true, error: null };
  } catch (error) {
    logError('updateProductReview', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function getProductReview(reviewId: string): Promise<ProductReview | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getProductReview');
    return null;
  }

  try {
    const { data, error } = await client.from('builders_product_reviews').select('*').eq('id', reviewId).maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRow(data as ProductReviewRow) : null;
  } catch (error) {
    logError('getProductReview', error);
    return null;
  }
}

/** Every Product Review for a project, newest first. */
export async function listProductReviews(projectId: string): Promise<ProductReview[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listProductReviews');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_product_reviews')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ProductReviewRow[]).map(fromRow);
  } catch (error) {
    logError('listProductReviews', error);
    return [];
  }
}

/**
 * Every Product Review recorded for one MVP, newest first. Deliberately not "at most one" — a
 * single released MVP is expected to accumulate several independent reviews over its lifetime
 * (initial business review, customer-feedback review, quarterly review, security review, ...),
 * each its own row; see `ProductReview`'s own "One MVP, many Product Reviews" comment.
 */
export async function listProductReviewsByMvp(mvpId: string): Promise<ProductReview[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listProductReviewsByMvp');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_product_reviews')
      .select('*')
      .eq('mvp_id', mvpId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ProductReviewRow[]).map(fromRow);
  } catch (error) {
    logError('listProductReviewsByMvp', error);
    return [];
  }
}

export const productReviewRepository = {
  isAvailable,
  createProductReview,
  updateProductReview,
  getProductReview,
  listProductReviews,
  listProductReviewsByMvp,
};
