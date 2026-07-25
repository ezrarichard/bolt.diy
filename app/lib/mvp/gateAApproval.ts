import { mvpRepository } from './mvpRepository';
import { featureRepository } from '~/lib/features/featureRepository';
import type { Feature } from '~/lib/features/featureTypes';
import type { ProductOwnerFeature } from '~/lib/projects/prompts/productOwner';
import type { MvpEstimatedEffort } from './mvpTypes';

/**
 * Gate A Approval Orchestration — Sprint 78 Phase 0 corrective (review item 2).
 *
 * `ProductOwnerDraftPanel.tsx`'s Approve button used to call `handleApprove()` (marks the
 * Product Owner Draft artifact `'approved'`) unconditionally, THEN attempted MVP creation +
 * Gate A approval recording + Feature promotion inside a try/catch that only ever surfaced a
 * quiet "could not be saved" info toast on failure — meaning Gate A could report success to the
 * customer while the MVP/Feature persistence it depends on had silently failed. This module
 * makes that impossible: it performs the persistence side of Gate A FIRST, as one ordered
 * sequence with every step's result checked, and returns a single `{ ok, error }` the caller
 * (`ProductOwnerDraftPanel.tsx`) uses to decide whether it's safe to mark the artifact approved
 * at all.
 *
 * **No real cross-table database transaction exists here** — `builders_mvps`, `builders_mvp_approvals`,
 * and `builders_features` are three separate Supabase calls through three separate repositories, and
 * this codebase has no cross-repository transaction primitive (see every other repository in this
 * codebase for the same constraint). Per the review's own fallback instruction, this is explicit
 * ORDERED ORCHESTRATION instead: each step's failure is checked before the next runs, and a failure
 * is returned immediately with the caller told exactly what happened rather than swallowed.
 *
 * **Idempotent by construction, not by any new bookkeeping** — every step this function calls is
 * already independently idempotent (see each repository's own comments):
 *  - `mvpRepository.listMvpsForProject` + `createMvp`: resolve-or-create by `sequence`, same
 *    lookup-before-insert `ProductOwnerDraftPanel.tsx` already did.
 *  - `mvpRepository.recordMvpApproval`: append-only by design (one row per decision — see
 *    `MvpApproval`'s own comment) — safe to call again; the MVP status write it triggers
 *    (`updateMvpStatus`) treats a same-status write as a no-op-valid transition.
 *  - `featureRepository.promoteFeaturesForMvp`: upserts by `(mvpId, code)`, never resets `status`.
 * A retry after a partial failure (e.g. MVP created, approval recorded, but promotion failed)
 * naturally resumes from wherever it left off — steps that already succeeded just repeat their own
 * no-op-safe writes.
 *
 * **BuildersDB not configured is NOT a failure** — every other repository in this codebase treats
 * an unconfigured BuildersDB as a legitimate deployment mode (`isAvailable()` false → warn and
 * return a safe fallback, never throw), not an error. Gate A stays consistent with that: if
 * BuildersDB isn't configured at all, this function returns `{ ok: true }` immediately (nothing to
 * persist, nothing to fail) so environments that never configured BuildersDB are unaffected by this
 * corrective change. Only a genuine write failure AGAINST A CONFIGURED BuildersDB blocks Gate A.
 */

export interface GateAApprovalInput {
  projectId: string;
  sequence: number;
  code?: string;
  theme?: string;
  targetRelease?: string;
  estimatedEffort?: MvpEstimatedEffort;
  decidedBy?: string;
  features: ProductOwnerFeature[];
}

export interface GateAApprovalResult {
  ok: boolean;
  mvpId?: string;
  features?: Feature[];
  error?: string;
}

export async function approveGateA(input: GateAApprovalInput): Promise<GateAApprovalResult> {
  if (!mvpRepository.isAvailable()) {
    return { ok: true };
  }

  const existing = await mvpRepository.listMvpsForProject(input.projectId);
  const existingMvp = existing.find((mvp) => mvp.sequence === input.sequence);

  let mvpId: string;

  if (existingMvp) {
    mvpId = existingMvp.id;
  } else {
    const created = await mvpRepository.createMvp({
      projectId: input.projectId,
      sequence: input.sequence,
      code: input.code,
      theme: input.theme,
      targetRelease: input.targetRelease,
      estimatedEffort: input.estimatedEffort,
      createdBy: input.decidedBy,
    });

    if (!created.ok || !created.mvp) {
      return { ok: false, error: created.error ?? `Failed to create MVP ${input.code ?? input.sequence}.` };
    }

    mvpId = created.mvp.id;
  }

  const approvalRecorded = await mvpRepository.recordMvpApproval({
    mvpId,
    projectId: input.projectId,
    stage: 'scope',
    decision: 'approved',
    decidedBy: input.decidedBy,
  });

  if (!approvalRecorded) {
    return { ok: false, mvpId, error: 'Failed to record the Gate A (Scope Approval) decision.' };
  }

  const promoted = await featureRepository.promoteFeaturesForMvp(input.projectId, mvpId, input.features);

  if (!promoted.ok) {
    return { ok: false, mvpId, error: promoted.error ?? 'Failed to promote Features for this MVP.' };
  }

  return { ok: true, mvpId, features: promoted.features };
}
