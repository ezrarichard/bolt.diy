import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { CustomerAcceptanceState, Release, ReleaseRecord } from '~/lib/deployment/releaseTypes';
import { suggestNextVersion, type ReleaseType } from '~/lib/deployment/semanticVersion';
import type { Project } from '~/lib/stores/projects';
import { buildRelease, collectReleaseInputs } from '~/lib/services/releaseManagementService';

/**
 * Release Management Runner — Sprint 94.
 *
 * The one composition point between the pure release service (`releaseManagementService.ts`, which
 * only reads) and the repository (`deploymentRepository.createRelease`/`recordCustomerAcceptance`,
 * which own every write). Exists so no UI component sequences "collect → build → persist →
 * transition" itself — the Architectural Rule for this sprint is that the UI only displays.
 *
 * Same shape as `deploymentVerificationRunner.ts` (Sprint 92) and `deliveryPackageRunner.ts`
 * (Sprint 93), for the same reason.
 */

export type RunReleaseCode =
  | 'no_deployment'
  | 'not_delivery_ready'
  | 'invalid_version'
  | 'integrity'
  | 'duplicate_version'
  | 'persist_failed'
  | 'cancelled'
  | 'completed';

export interface RunReleaseResult {
  ok: boolean;
  code: RunReleaseCode;
  message: string;
  release?: Release;
  record?: ReleaseRecord;

  /** True only when this run moved the Deployment `delivery_ready -> released`. */
  transitioned: boolean;
  supersededReleases?: number;
}

export interface CreateReleaseParams {
  project: Project;

  /** The operator's explicit version — never derived here (Part 3). */
  semanticVersion: string;
  releaseType: ReleaseType;
  releaseName?: string;
  createdBy?: string;

  /** Operator cancellation (Part 14). Checked between collection and persistence — nothing is written once aborted. */
  signal?: AbortSignal;
  clock?: () => string;
}

export async function createProjectRelease(params: CreateReleaseParams): Promise<RunReleaseResult> {
  const { project } = params;

  const deployment = await deploymentRepository.getDeploymentWithProviders(project.id);

  if (!deployment) {
    return {
      ok: false,
      code: 'no_deployment',
      message: 'This project has no Deployment yet — there is nothing to release.',
      transitioned: false,
    };
  }

  /*
   * Checked before any collection work so an unpackaged Deployment costs nothing, and so the
   * operator gets the same message the repository would give. The transaction enforces it anyway.
   */
  if (!['delivery_ready', 'released', 'maintenance'].includes(deployment.status)) {
    return {
      ok: false,
      code: 'not_delivery_ready',
      message: `Generate a delivery package before releasing this Deployment (currently: ${deployment.status}).`,
      transitioned: false,
    };
  }

  const inputs = await collectReleaseInputs(project);

  if (!inputs) {
    return {
      ok: false,
      code: 'no_deployment',
      message: 'This project has no Deployment yet — there is nothing to release.',
      transitioned: false,
    };
  }

  if (params.signal?.aborted) {
    return {
      ok: false,
      code: 'cancelled',
      message: 'Release creation was cancelled — nothing was saved.',
      transitioned: false,
    };
  }

  const built = buildRelease({
    inputs,
    semanticVersion: params.semanticVersion,
    releaseType: params.releaseType,
    releaseName: params.releaseName,
    createdBy: params.createdBy,
    clock: params.clock,
  });

  if (!built.ok) {
    return { ok: false, code: built.code, message: built.message, transitioned: false };
  }

  const persisted = await deploymentRepository.createRelease(deployment.id, deployment.projectId, built.release, {
    deliveryPackageId: inputs.deliveryPackage?.id,
    verificationId: inputs.verification?.id,
    createdBy: params.createdBy,
  });

  if (!persisted.ok) {
    return {
      ok: false,
      code:
        persisted.code === 'duplicate_version'
          ? 'duplicate_version'
          : persisted.code === 'not_delivery_ready'
            ? 'not_delivery_ready'
            : 'persist_failed',
      message: persisted.message,
      release: built.release,
      transitioned: false,
    };
  }

  return {
    ok: true,
    code: 'completed',
    message: persisted.transitioned
      ? `Release ${built.release.semanticVersion} created — this application is now released.`
      : `Release ${built.release.semanticVersion} created.`,
    release: built.release,
    record: persisted.release,
    transitioned: persisted.transitioned,
    supersededReleases: persisted.supersededReleases,
  };
}

export interface RecordAcceptanceParams {
  releaseId: string;
  state: CustomerAcceptanceState;
  notes?: string;
  conditions?: string[];
  recordedBy?: string;
}

/** Part 5 — records the customer's decision. Release state only; no engineering artifact is touched. */
export async function recordReleaseAcceptance(params: RecordAcceptanceParams) {
  return deploymentRepository.recordCustomerAcceptance(params.releaseId, params.state, {
    notes: params.notes,
    conditions: params.conditions,
    recordedBy: params.recordedBy,
  });
}

/**
 * Part 3 — what the operator's version field should be PREFILLED with. Never applied on its own:
 * the operator can overwrite it, and `buildRelease` validates whatever they actually submit.
 * `Mvp.targetRelease` (customer-editable free text like "v1.0") is deliberately not used here —
 * it is an intention recorded long before the build existed, not a version.
 */
export function suggestReleaseVersion(latestVersion: string | undefined, type: ReleaseType): string {
  return suggestNextVersion(latestVersion, type);
}
