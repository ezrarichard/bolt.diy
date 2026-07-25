import type { MvpStatus } from './mvpTypes';
import type { FeatureStatus } from '~/lib/features/featureTypes';

/**
 * Centralized status-transition validation — Sprint 78 Phase 0, per the sprint's own
 * implementation guardrail: "a small allowed-transitions table checked in one place before any
 * status write, the same way `classifyResumeAction`
 * (app/lib/application-manifest/resumeOrchestrator.ts) centralizes status-based branching today
 * rather than leaving it to be reimplemented at each call site."
 *
 * One file, both entities, because `Mvp` and `Feature` are the two halves of the single
 * `Product → MVP → Features → Engineering → Deployment` lifecycle
 * (docs/product-lifecycle/Product-Lifecycle-Architecture.md) — keeping their transition rules
 * side by side makes it obvious neither has drifted into its own, disconnected state machine.
 *
 * Both tables reject same-state transitions as `false` from the table lookup, but both exported
 * `isValid*Transition` functions treat "no-op" (from === to) as valid separately — an idempotent
 * retry of an already-applied status write must never be treated as an illegal transition.
 */

/**
 * `Mvp.status` — a single, strictly linear field (Product Lifecycle Architecture §2's revision:
 * "Provisioned"/"Generated"/"QA Passed"/"Ready for Deployment" are DERIVED facts read live from
 * the systems that already own them — `Project.databaseActivation` (Sprint 76), the
 * `ApplicationManifest` (Sprint 77), and this MVP's `Feature` rows' own `status` — never a second,
 * parallel set of stored `Mvp.status` values. Storing them as sequential enum values here would
 * either force an artificial ordering on two genuinely independent processes (database
 * provisioning and code generation, which Sprint 75/76 already established can complete in either
 * order) or require a second field tracking "is the other one also done," recreating exactly the
 * parallel-state-machine problem this architecture is required to avoid. `released` therefore
 * transitions directly from `approved`; the application-layer readiness check (provisioned ∧
 * generated ∧ qa_passed) gates WHEN that transition may be invoked, not what value is stored.
 *
 * `blocked` can interrupt any pre-`released` state and resume back into any of them (the specific
 * state it resumes to is an application-layer decision informed by `blockedReason`/where the
 * caller left off — this table only says the edge is legal, not which one a given caller should
 * pick).
 */
const PRE_RELEASED_MVP_STATES: MvpStatus[] = ['planned', 'scoped', 'generating', 'ready_for_review', 'approved'];

export const MVP_STATUS_TRANSITIONS: Record<MvpStatus, MvpStatus[]> = {
  planned: ['scoped', 'blocked'],
  scoped: ['generating', 'blocked'],
  generating: ['ready_for_review', 'blocked'],
  ready_for_review: ['approved', 'blocked'],
  approved: ['released', 'blocked'],
  blocked: PRE_RELEASED_MVP_STATES,
  released: ['superseded'],
  superseded: [],
};

/** True for a legal transition OR a no-op (from === to, always valid — an idempotent retry of an already-applied write). */
export function isValidMvpStatusTransition(from: MvpStatus, to: MvpStatus): boolean {
  if (from === to) {
    return true;
  }

  return MVP_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * `Feature.status` — linear, no-skip, no-regress-except-via-an-explicit-correction (Sprint 77's
 * own guardrail). Every engineering role advances a Feature exactly one step: Database/Backend/
 * Frontend generation → `in_progress` → `generated`; QA → `qa_passed`; Deployment → `deployed`.
 */
export const FEATURE_STATUS_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  planned: ['in_progress'],
  in_progress: ['generated'],
  generated: ['qa_passed'],
  qa_passed: ['deployed'],
  deployed: [],
};

/** True for a legal transition OR a no-op (from === to). */
export function isValidFeatureStatusTransition(from: FeatureStatus, to: FeatureStatus): boolean {
  if (from === to) {
    return true;
  }

  return FEATURE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
