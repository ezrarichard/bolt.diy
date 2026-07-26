import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import {
  isRoadmapReviewImmutable,
  isValidRoadmapReviewStatusTransition,
  ROADMAP_REVIEW_ARTIFACT_LINK_ERROR,
  ROADMAP_REVIEW_IMMUTABLE_ERROR,
} from './roadmapReviewLifecycle';
import {
  ROADMAP_REVIEW_CONTENT_FIELDS,
  type RoadmapReview,
  type RoadmapReviewDraft,
  type RoadmapReviewStatus,
  type RoadmapReviewUpdate,
  type RoadmapReviewUpdateResult,
  type RoadmapReviewWriteResult,
} from './roadmapReviewTypes';
import type { ProductOwnerRoadmapOutput } from '~/lib/projects/prompts/roadmapReview';

/**
 * Roadmap Review Repository — Sprint 83 (Product Owner Roadmap Review workflow).
 *
 * Same defensive contract as every other BuildersDB repository in this codebase
 * (`mvpRepository.ts`, `featureRepository.ts`, `productReviewRepository.ts`): guarded on
 * BuildersDB being configured, every Supabase call wrapped in try/catch, every failure path logs
 * and returns a safe fallback (`[]`/`null`, or an explicit `{ ok: false, error }`) rather than
 * throwing. Ownership/RLS is enforced entirely at the database layer (same
 * `builders_user_can_access_project`/`builders_user_can_edit_project` helpers) — this module
 * never re-checks ownership itself.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[RoadmapReview] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[RoadmapReview] ${method}() failed:`, error);
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

interface RoadmapReviewRow {
  id: string;
  project_id: string;
  product_review_id: string;
  target_mvp_id: string;
  roadmap_version: number;
  status: RoadmapReviewStatus;
  executive_summary: string | null;
  roadmap_changes: string[] | null;
  new_features: string[] | null;
  deferred_features: string[] | null;
  removed_features: string[] | null;
  priorities: string[] | null;
  dependencies: string[] | null;
  technical_risks: string[] | null;
  business_risks: string[] | null;
  assumptions: string[] | null;
  recommended_release_goal: string | null;
  approval_notes: string | null;
  analysis: ProductOwnerRoadmapOutput | null;
  artifact_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: RoadmapReviewRow): RoadmapReview {
  return {
    id: row.id,
    projectId: row.project_id,
    productReviewId: row.product_review_id,
    targetMvpId: row.target_mvp_id,
    roadmapVersion: row.roadmap_version,
    status: row.status,
    executiveSummary: row.executive_summary ?? undefined,
    roadmapChanges: row.roadmap_changes ?? [],
    newFeatures: row.new_features ?? [],
    deferredFeatures: row.deferred_features ?? [],
    removedFeatures: row.removed_features ?? [],
    priorities: row.priorities ?? [],
    dependencies: row.dependencies ?? [],
    technicalRisks: row.technical_risks ?? [],
    businessRisks: row.business_risks ?? [],
    assumptions: row.assumptions ?? [],
    recommendedReleaseGoal: row.recommended_release_goal ?? undefined,
    approvalNotes: row.approval_notes ?? undefined,
    analysis: row.analysis ?? undefined,
    artifactId: row.artifact_id ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Postgres unique-violation error code — used to give `createRoadmapReview`'s version-conflict path a distinct, recognizable message instead of a generic DB error. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/**
 * Creates a new Roadmap Review. Status defaults to `'draft'` when omitted, mirroring
 * `createProductReview`'s "row exists before the AI role has run" discipline. Always inserts a
 * NEW row — never upserts — so re-planning the same `productReviewId` a second time is never
 * blocked; see `RoadmapReview`'s own "One Product Review, many Roadmap Reviews" comment.
 *
 * **Version scope (Sprint 83 — Final Approval Integration correction).** `roadmapVersion` is
 * never supplied by the caller — this function computes it as one past the highest version
 * already recorded FOR THE PROJECT (not merely for `draft.productReviewId`), because the
 * database enforces `unique(project_id, roadmap_version)` (see the migration) — a single,
 * project-wide, ever-increasing revision counter, not a per-Product-Review restart. Multiple
 * Roadmap Reviews for the same Product Review remain fully supported; they simply don't reuse
 * version numbers `1, 2, 3...` independently of every other Roadmap Review in the project.
 *
 * **Conflict handling.** The read-then-insert here is not itself atomic — under real concurrency,
 * two calls could read the same "highest version" and both attempt to insert it. Rather than
 * silently succeeding with a duplicate (which the unique constraint would never allow anyway),
 * a conflict surfaces as a clear, distinguishable `ok: false` result (`isUniqueViolation`) so a
 * caller can safely retry (re-read the highest version, re-insert) instead of being told the
 * write outright failed for an unrelated reason. This function does not loop-and-retry itself —
 * that decision is left to the caller, matching this codebase's existing "don't hide retry
 * policy inside the repository" convention.
 */
export async function createRoadmapReview(draft: RoadmapReviewDraft): Promise<RoadmapReviewWriteResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('createRoadmapReview');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const existing = await listRoadmapReviews(draft.projectId);
    const nextVersion = existing.reduce((highest, review) => Math.max(highest, review.roadmapVersion), 0) + 1;

    const { data, error } = await client
      .from('builders_roadmap_reviews')
      .insert({
        project_id: draft.projectId,
        product_review_id: draft.productReviewId,
        target_mvp_id: draft.targetMvpId,
        roadmap_version: nextVersion,
        status: draft.status ?? 'draft',
        created_by: draft.createdBy ?? null,
      })
      .select('*')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        const conflictMessage = `Roadmap Review version ${nextVersion} was just taken by a concurrent request for this project — retry to get the next available version.`;
        logError('createRoadmapReview', new Error(conflictMessage));

        return { ok: false, error: conflictMessage };
      }

      throw error;
    }

    if (!data) {
      throw new Error('Insert returned no row');
    }

    return { ok: true, error: null, review: fromRow(data as RoadmapReviewRow) };
  } catch (error) {
    logError('createRoadmapReview', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

/** True if `update` touches any business-content field (`ROADMAP_REVIEW_CONTENT_FIELDS`) — `status`/`artifactId` don't count. */
function touchesBusinessContent(update: RoadmapReviewUpdate): boolean {
  return ROADMAP_REVIEW_CONTENT_FIELDS.some((key) => update[key] !== undefined);
}

/**
 * Updates an existing Roadmap Review's content fields (and/or `status`, validated against
 * `isValidRoadmapReviewStatusTransition` first) — same split `updateProductReview` established.
 *
 * Append-only enforcement: once the CURRENT row's status is `'approved'`/`'archived'`
 * (`isRoadmapReviewImmutable`), any business-content field in `update` is refused with
 * `ROADMAP_REVIEW_IMMUTABLE_ERROR`. `artifactId` may be set exactly once or re-sent identically —
 * an attempt to replace it with a different value is refused with
 * `ROADMAP_REVIEW_ARTIFACT_LINK_ERROR`. Both checks mirror `updateProductReview`'s identical
 * guards exactly.
 */
export async function updateRoadmapReview(
  reviewId: string,
  update: RoadmapReviewUpdate,
): Promise<RoadmapReviewUpdateResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('updateRoadmapReview');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  const contentChange = touchesBusinessContent(update);
  const needsCurrent = update.status !== undefined || contentChange || update.artifactId !== undefined;

  if (needsCurrent) {
    const current = await getRoadmapReview(reviewId);

    if (!current) {
      const error = `Roadmap Review ${reviewId} not found`;
      logError('updateRoadmapReview', new Error(error));

      return { ok: false, error };
    }

    if (contentChange && isRoadmapReviewImmutable(current.status)) {
      logError('updateRoadmapReview', new Error(ROADMAP_REVIEW_IMMUTABLE_ERROR));
      return { ok: false, error: ROADMAP_REVIEW_IMMUTABLE_ERROR };
    }

    if (
      update.artifactId !== undefined &&
      current.artifactId !== undefined &&
      current.artifactId !== update.artifactId
    ) {
      logError('updateRoadmapReview', new Error(ROADMAP_REVIEW_ARTIFACT_LINK_ERROR));
      return { ok: false, error: ROADMAP_REVIEW_ARTIFACT_LINK_ERROR };
    }

    if (update.status !== undefined && !isValidRoadmapReviewStatusTransition(current.status, update.status)) {
      const error = `Invalid Roadmap Review status transition: ${current.status} -> ${update.status}`;
      logError('updateRoadmapReview', new Error(error));

      return { ok: false, error };
    }
  }

  try {
    const payload: Record<string, unknown> = {};

    if (update.status !== undefined) {
      payload.status = update.status;
    }

    if (update.executiveSummary !== undefined) {
      payload.executive_summary = update.executiveSummary;
    }

    if (update.roadmapChanges !== undefined) {
      payload.roadmap_changes = update.roadmapChanges;
    }

    if (update.newFeatures !== undefined) {
      payload.new_features = update.newFeatures;
    }

    if (update.deferredFeatures !== undefined) {
      payload.deferred_features = update.deferredFeatures;
    }

    if (update.removedFeatures !== undefined) {
      payload.removed_features = update.removedFeatures;
    }

    if (update.priorities !== undefined) {
      payload.priorities = update.priorities;
    }

    if (update.dependencies !== undefined) {
      payload.dependencies = update.dependencies;
    }

    if (update.technicalRisks !== undefined) {
      payload.technical_risks = update.technicalRisks;
    }

    if (update.businessRisks !== undefined) {
      payload.business_risks = update.businessRisks;
    }

    if (update.assumptions !== undefined) {
      payload.assumptions = update.assumptions;
    }

    if (update.recommendedReleaseGoal !== undefined) {
      payload.recommended_release_goal = update.recommendedReleaseGoal;
    }

    if (update.approvalNotes !== undefined) {
      payload.approval_notes = update.approvalNotes;
    }

    if (update.analysis !== undefined) {
      payload.analysis = update.analysis;
    }

    if (update.artifactId !== undefined) {
      payload.artifact_id = update.artifactId;
    }

    const { error } = await client.from('builders_roadmap_reviews').update(payload).eq('id', reviewId);

    if (error) {
      throw error;
    }

    return { ok: true, error: null };
  } catch (error) {
    logError('updateRoadmapReview', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function getRoadmapReview(reviewId: string): Promise<RoadmapReview | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getRoadmapReview');
    return null;
  }

  try {
    const { data, error } = await client.from('builders_roadmap_reviews').select('*').eq('id', reviewId).maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRow(data as RoadmapReviewRow) : null;
  } catch (error) {
    logError('getRoadmapReview', error);
    return null;
  }
}

/** Every Roadmap Review for a project, newest first. */
export async function listRoadmapReviews(projectId: string): Promise<RoadmapReview[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listRoadmapReviews');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_roadmap_reviews')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as RoadmapReviewRow[]).map(fromRow);
  } catch (error) {
    logError('listRoadmapReviews', error);
    return [];
  }
}

/**
 * Every Roadmap Review recorded for one source Product Review, newest first. Deliberately not "at
 * most one" — see `RoadmapReview`'s own "One Product Review, many Roadmap Reviews" comment; this
 * is also what `createRoadmapReview` reads to compute the next `roadmapVersion`.
 */
export async function listRoadmapReviewsByProductReview(productReviewId: string): Promise<RoadmapReview[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listRoadmapReviewsByProductReview');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_roadmap_reviews')
      .select('*')
      .eq('product_review_id', productReviewId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as RoadmapReviewRow[]).map(fromRow);
  } catch (error) {
    logError('listRoadmapReviewsByProductReview', error);
    return [];
  }
}

export const roadmapReviewRepository = {
  isAvailable,
  createRoadmapReview,
  updateRoadmapReview,
  getRoadmapReview,
  listRoadmapReviews,
  listRoadmapReviewsByProductReview,
};
