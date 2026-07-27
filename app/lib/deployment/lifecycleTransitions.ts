import type { DeploymentStatus } from '~/lib/deployment/deploymentTypes';

/**
 * Centralized status-transition validation for `Deployment.status` — Sprint 87, following the
 * exact convention `app/lib/mvp/lifecycleTransitions.ts` established: a small allowed-transitions
 * table checked in one place before any status write, never re-derived at each call site.
 *
 * Linear and no-skip (Planning → Engineering → Generated → Repository Connected → Database
 * Connected → Environment Ready → Deployment Started → Deployment Successful → Verification
 * Passed → Delivery Ready → Released → Maintenance → Archived, per the Sprint 87 brief plus
 * Sprint 93's `delivery_ready` insertion), with `failed` playing
 * the same role `blocked` plays for `MvpStatus`: it can interrupt any pre-`released` state and
 * resume back into any of them — which specific state it resumes to is an application-layer
 * decision (informed by where the deployment failed), this table only says the edge is legal.
 *
 * `released` can return to `maintenance` (an already-live deployment under active upkeep), and a
 * hotfix redeploy from `maintenance` can go straight back to `released` without re-walking the
 * whole pre-release pipeline.
 */
const PRE_RELEASED_DEPLOYMENT_STATES: DeploymentStatus[] = [
  'planning',
  'engineering',
  'generated',
  'repository_connected',
  'database_connected',
  'environment_ready',
  'deploying',
  'deployed',
  'verified',
  'delivery_ready',
];

export const DEPLOYMENT_STATUS_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  planning: ['engineering', 'failed'],
  engineering: ['generated', 'failed'],
  generated: ['repository_connected', 'failed'],
  repository_connected: ['database_connected', 'failed'],
  database_connected: ['environment_ready', 'failed'],
  environment_ready: ['deploying', 'failed'],
  deploying: ['deployed', 'failed'],
  deployed: ['verified', 'failed'],
  verified: ['delivery_ready', 'failed'],

  /**
   * Sprint 93 — a Delivery Package has been assembled for this Deployment. The only forward edge
   * is `released`, which Sprint 94's Release Management will actually drive; nothing in Sprint 93
   * ever takes it.
   */
  delivery_ready: ['released', 'failed'],
  failed: PRE_RELEASED_DEPLOYMENT_STATES,
  released: ['maintenance'],
  maintenance: ['released', 'archived'],
  archived: [],
};

/** True for a legal transition OR a no-op (from === to, always valid — an idempotent retry of an already-applied status write). */
export function isValidDeploymentStatusTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  if (from === to) {
    return true;
  }

  return DEPLOYMENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
