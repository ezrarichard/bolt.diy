import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeliveryPackage, DeliveryPackageRecord } from '~/lib/deployment/deliveryPackageTypes';
import type { Project } from '~/lib/stores/projects';
import { buildDeliveryPackage, collectDeliveryPackageInputs } from '~/lib/services/deliveryPackageService';

/**
 * Delivery Package Runner — Sprint 93.
 *
 * The one composition point between the pure assembly service (`deliveryPackageService.ts`, which
 * only reads) and the repository (`deploymentRepository.recordDeliveryPackage`, which owns every
 * write). Exists so no UI component sequences "collect → build → persist → transition" itself —
 * the Architectural Rule for this sprint is that the UI only displays.
 *
 * Same shape as `deploymentVerificationRunner.ts` (Sprint 92), for the same reason.
 */

export type RunDeliveryPackageCode = 'no_deployment' | 'not_verified' | 'persist_failed' | 'cancelled' | 'completed';

export interface RunDeliveryPackageResult {
  ok: boolean;
  code: RunDeliveryPackageCode;
  message: string;
  package?: DeliveryPackage;
  record?: DeliveryPackageRecord;

  /** True only when this run moved the Deployment `verified -> delivery_ready`. */
  transitioned: boolean;

  /** `delivery_package_generated` on the first package, `delivery_package_updated` on a regeneration. */
  eventType?: string;
}

export interface RunDeliveryPackageParams {
  project: Project;
  generatedBy?: string;

  /** Operator cancellation (Part 16). Checked between the collect and persist phases — nothing is written once aborted. */
  signal?: AbortSignal;

  /** Injectable for deterministic tests. */
  clock?: () => string;
}

export async function generateDeliveryPackage(params: RunDeliveryPackageParams): Promise<RunDeliveryPackageResult> {
  const { project } = params;

  const deployment = await deploymentRepository.getDeploymentWithProviders(project.id);

  if (!deployment) {
    return {
      ok: false,
      code: 'no_deployment',
      message: 'This project has no Deployment yet — there is nothing to package.',
      transitioned: false,
    };
  }

  /*
   * Checked before any collection work so an unverified Deployment costs nothing, and so the
   * operator gets the same message the repository would give. The database transaction enforces
   * the rule regardless (see `builders_record_delivery_package`).
   */
  if (deployment.status !== 'verified' && deployment.status !== 'delivery_ready') {
    return {
      ok: false,
      code: 'not_verified',
      message: `This Deployment must be verified before a delivery package can be generated (currently: ${deployment.status}).`,
      transitioned: false,
    };
  }

  const existing = await deploymentRepository.getLatestDeliveryPackage(deployment.id);
  const packageNumber = (existing?.packageNumber ?? 0) + 1;

  const inputs = await collectDeliveryPackageInputs(project, { packageNumber, generatedBy: params.generatedBy });

  if (!inputs) {
    return {
      ok: false,
      code: 'no_deployment',
      message: 'This project has no Deployment yet — there is nothing to package.',
      transitioned: false,
    };
  }

  if (params.signal?.aborted) {
    return {
      ok: false,
      code: 'cancelled',
      message: 'Package generation was cancelled — nothing was saved.',
      transitioned: false,
    };
  }

  const pkg = buildDeliveryPackage({ ...inputs, clock: params.clock });

  const recorded = await deploymentRepository.recordDeliveryPackage(deployment.id, deployment.projectId, pkg, {
    verificationId: inputs.verification?.id,
    generatedBy: params.generatedBy,
  });

  if (!recorded.ok) {
    return {
      ok: false,
      code: recorded.code === 'not_verified' ? 'not_verified' : 'persist_failed',
      message: recorded.message,
      package: pkg,
      transitioned: false,
    };
  }

  return {
    ok: true,
    code: 'completed',
    message: recorded.transitioned
      ? `Delivery package #${recorded.record.packageNumber} generated — this Deployment is now ready for handover (${pkg.completeness.score}% complete).`
      : `Delivery package #${recorded.record.packageNumber} regenerated (${pkg.completeness.score}% complete).`,
    package: pkg,
    record: recorded.record,
    transitioned: recorded.transitioned,
    eventType: recorded.eventType,
  };
}
