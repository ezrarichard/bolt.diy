import { getBuildersDbClient, isBuildersDbConfigured } from '~/lib/builders-db/client';
import type {
  Mvp,
  MvpApproval,
  MvpApprovalInput,
  MvpBusinessPriority,
  MvpDraft,
  MvpEstimatedEffort,
  MvpStatus,
  MvpWriteResult,
} from './mvpTypes';

/**
 * MVP Repository — Sprint 45 (foundation), extended Sprint 46B (AI Product Owner: adds
 * targetRelease/estimatedEffort/businessPriority on `createMvp`, and the Gate A/Gate B
 * `stage`-aware status transition in `recordMvpApproval` below).
 *
 * Same defensive contract as every other builders-db repository in this codebase
 * (buildersDbRepository.ts, applicationManifestRepository.ts, assemblyRepository.ts):
 * guarded on BuildersDB being configured, every Supabase call wrapped in try/catch,
 * every failure path logs and returns a safe fallback (`false`/`[]`/`null`, or an
 * explicit `{ ok: false, error }`) rather than throwing.
 *
 * Sprint 46B is this module's first real caller: `ProductOwnerDraftPanel.tsx` calls
 * `createMvp` on Gate A approval. The four new `builders_mvps` columns and
 * `builders_mvp_approvals.stage` this file now reads/writes require the Sprint 46B
 * migration to be applied first — see this sprint's implementation report for the staged
 * SQL. Until then, every write here fails safely (logged, `{ ok: false }`/`false`
 * returned) exactly like this module already behaves when BuildersDB itself isn't
 * configured — no different failure mode, just a different missing prerequisite.
 */

function isAvailable(): boolean {
  return isBuildersDbConfigured() && getBuildersDbClient() !== null;
}

function unavailable(method: string): void {
  console.warn(`[Mvp] ${method}() skipped — BuildersDB is not configured.`);
}

function logError(method: string, error: unknown): void {
  console.error(`[Mvp] ${method}() failed:`, error);
}

/** Same shape as every other repository's own safeErrorMessage() — a Postgrest error is a plain `{ message }` object, not an `Error` instance. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown error';
}

interface MvpRow {
  id: string;
  project_id: string;
  code: string | null;
  sequence: number;
  theme: string | null;
  status: MvpStatus;
  scope_artifact_id: string | null;
  target_release: string | null;
  estimated_effort: MvpEstimatedEffort | null;
  business_priority: MvpBusinessPriority | null;
  blocked_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

interface MvpApprovalRow {
  id: string;
  mvp_id: string;
  project_id: string;
  stage: MvpApproval['stage'];
  decision: MvpApproval['decision'];
  notes: string | null;
  decided_by: string | null;
  decided_at: string;
  created_at: string;
}

function fromMvpRow(row: MvpRow): Mvp {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code ?? undefined,
    sequence: row.sequence,
    theme: row.theme ?? undefined,
    status: row.status,
    scopeArtifactId: row.scope_artifact_id ?? undefined,
    targetRelease: row.target_release ?? undefined,
    estimatedEffort: row.estimated_effort ?? undefined,
    businessPriority: row.business_priority ?? undefined,
    blockedReason: row.blocked_reason ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? undefined,
  };
}

function fromApprovalRow(row: MvpApprovalRow): MvpApproval {
  return {
    id: row.id,
    mvpId: row.mvp_id,
    projectId: row.project_id,
    stage: row.stage,
    decision: row.decision,
    notes: row.notes ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Sprint 46C — same "MVP-{3-digit sequence}" format productOwnerEngine.ts's formatMvpId uses, kept as a separate copy rather than a shared import: that function lives in the engineering-pipeline layer, this one in the BuildersDB persistence layer, and they're allowed to compute the same value independently without one depending on the other. Used only as a fallback — see createMvp below. */
function formatFallbackMvpCode(sequence: number): string {
  return `MVP-${String(sequence).padStart(3, '0')}`;
}

/**
 * Creates a new MVP. `draft.sequence` must already be the caller's chosen, unique-per-project
 * position — this function does not compute "next sequence" itself.
 *
 * Sprint 46C — `draft.code` should normally be supplied by the caller (the AI Product Owner's
 * own proposed `currentMvp.id`, per docs/05-AI-Product-Owner/08-identity-and-traceability.md).
 * If omitted, this function generates one itself from `sequence` so no caller can ever end up
 * with an MVP row lacking a permanent identifier — the graceful-generation behavior Part 7 of
 * this sprint's instructions require.
 */
export async function createMvp(draft: MvpDraft): Promise<MvpWriteResult> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('createMvp');
    return { ok: false, error: 'BuildersDB is not configured.' };
  }

  try {
    const { data, error } = await client
      .from('builders_mvps')
      .insert({
        project_id: draft.projectId,
        code: draft.code ?? formatFallbackMvpCode(draft.sequence),
        sequence: draft.sequence,
        theme: draft.theme ?? null,
        status: draft.status ?? 'planned',
        target_release: draft.targetRelease ?? null,
        estimated_effort: draft.estimatedEffort ?? null,
        business_priority: draft.businessPriority ?? null,
        created_by: draft.createdBy ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw error ?? new Error('Insert returned no row');
    }

    return { ok: true, error: null, mvp: fromMvpRow(data as MvpRow) };
  } catch (error) {
    logError('createMvp', error);
    return { ok: false, error: safeErrorMessage(error) };
  }
}

/** Every MVP for a project, in roadmap order (lowest `sequence` first). */
export async function listMvpsForProject(projectId: string): Promise<Mvp[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listMvpsForProject');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_mvps')
      .select('*')
      .eq('project_id', projectId)
      .order('sequence', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as MvpRow[]).map(fromMvpRow);
  } catch (error) {
    logError('listMvpsForProject', error);
    return [];
  }
}

/**
 * Sprint 47 — the MVP the engineering pipeline/generation engine should treat as "active"
 * for a project right now: the highest-`sequence` MVP that has actually passed Gate A
 * (anything past `'planned'`) and hasn't been superseded. Returns `undefined` for a project
 * with no MVP yet at all — a legacy project, or one whose Product Owner hasn't been approved
 * yet — which is the deliberate signal for "fall back to whole-product generation" every
 * caller of this function should honor (see docs/05-AI-Product-Owner/07 and this sprint's
 * implementation report for the backward-compatibility contract this preserves).
 *
 * Deliberately does not attempt any cross-MVP logic beyond "pick the most advanced one" —
 * this codebase only ever has one MVP in active engineering/generation at a time by design
 * (see docs/01-Vision/03-mvp-first-development.md), so there is no ambiguity to resolve yet.
 */
export async function resolveActiveMvpId(projectId: string): Promise<string | undefined> {
  const mvps = await listMvpsForProject(projectId);
  const eligible = mvps.filter((mvp) => mvp.status !== 'planned' && mvp.status !== 'superseded');

  if (eligible.length === 0) {
    return undefined;
  }

  return eligible.reduce((latest, candidate) => (candidate.sequence > latest.sequence ? candidate : latest)).id;
}

export async function getMvpById(mvpId: string): Promise<Mvp | null> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('getMvpById');
    return null;
  }

  try {
    const { data, error } = await client.from('builders_mvps').select('*').eq('id', mvpId).maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromMvpRow(data as MvpRow) : null;
  } catch (error) {
    logError('getMvpById', error);
    return null;
  }
}

/** Updates an MVP's status (and, once the Product Owner exists, its scope_artifact_id). Does not touch approval history — see recordMvpApproval for that. */
export async function updateMvpStatus(
  mvpId: string,
  status: MvpStatus,
  options: { scopeArtifactId?: string | null; approvedAt?: string | null } = {},
): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('updateMvpStatus');
    return false;
  }

  try {
    const payload: Record<string, unknown> = { status };

    if (options.scopeArtifactId !== undefined) {
      payload.scope_artifact_id = options.scopeArtifactId;
    }

    if (options.approvedAt !== undefined) {
      payload.approved_at = options.approvedAt;
    }

    const { error } = await client.from('builders_mvps').update(payload).eq('id', mvpId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    logError('updateMvpStatus', error);
    return false;
  }
}

/**
 * Records a customer review decision for an MVP (append-only — see
 * docs/03-Development/01-human-approval-philosophy.md and
 * docs/05-AI-Product-Owner/05-customer-review-workflow.md's two-gate model).
 *
 * Sprint 46B — the MVP's own `status` transition depends on WHICH gate this decision is for,
 * not just whether it was approved: a Gate A ('scope') approval means Engineering may now
 * begin, so status becomes `'scoped'`. A Gate B ('delivery') approval means the delivered
 * app was accepted and the next MVP may unlock, so status becomes `'approved'` and
 * `approved_at` is stamped. A `'changes_requested'` decision at either stage never changes
 * status — the MVP stays wherever it was, awaiting a revised draft/delivery.
 */
export async function recordMvpApproval(input: MvpApprovalInput): Promise<boolean> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('recordMvpApproval');
    return false;
  }

  try {
    const decidedAt = new Date().toISOString();

    const { error: insertError } = await client.from('builders_mvp_approvals').insert({
      mvp_id: input.mvpId,
      project_id: input.projectId,
      stage: input.stage,
      decision: input.decision,
      notes: input.notes ?? null,
      decided_by: input.decidedBy ?? null,
      decided_at: decidedAt,
    });

    if (insertError) {
      throw insertError;
    }

    if (input.decision === 'approved') {
      if (input.stage === 'scope') {
        return await updateMvpStatus(input.mvpId, 'scoped');
      }

      return await updateMvpStatus(input.mvpId, 'approved', { approvedAt: decidedAt });
    }

    return true;
  } catch (error) {
    logError('recordMvpApproval', error);
    return false;
  }
}

/** Every review decision ever recorded for an MVP, newest first. */
export async function listMvpApprovals(mvpId: string): Promise<MvpApproval[]> {
  const client = getBuildersDbClient();

  if (!isAvailable() || !client) {
    unavailable('listMvpApprovals');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_mvp_approvals')
      .select('*')
      .eq('mvp_id', mvpId)
      .order('decided_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as MvpApprovalRow[]).map(fromApprovalRow);
  } catch (error) {
    logError('listMvpApprovals', error);
    return [];
  }
}

export const mvpRepository = {
  isAvailable,
  createMvp,
  listMvpsForProject,
  resolveActiveMvpId,
  getMvpById,
  updateMvpStatus,
  recordMvpApproval,
  listMvpApprovals,
};
