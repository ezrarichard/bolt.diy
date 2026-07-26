import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import { VERIFICATION_POLICY_VERSION } from '~/lib/deployment/verificationPolicy';
import type { VerificationProgress, VerificationReport } from '~/lib/deployment/verificationTypes';
import {
  resolveVerificationTarget,
  verifyDeployment,
  type WarmUpOptions,
} from '~/lib/services/deploymentVerificationService';

/**
 * Deployment Verification Runner — Sprint 92.
 *
 * The one composition point between the pure verification engine
 * (`deploymentVerificationService.ts`, which never touches BuildersDB) and the repository
 * (`deploymentRepository.ts`, which owns every write). It exists so that no UI component has to
 * sequence "open an attempt → run the checks → finalise the attempt" itself, which is exactly the
 * Architectural Rule this sprint states: components call one function and render its result; they
 * never set `Deployment.status` and never persist a report.
 *
 * Layered the same way `vercelDeployService.deployToVercel` is — an orchestrator that calls the
 * repository, above services that do not.
 */

export interface RunDeploymentVerificationParams {
  deployment: DeploymentWithProviders;
  manifest: ApplicationManifest | null;
  performedBy?: string;

  /** Part 10 — transient, in-memory only. Passed straight to the engine, never persisted by anything in this path. */
  supabaseAnonKey?: string;

  onProgress?: (progress: VerificationProgress) => void;
  signal?: AbortSignal;

  /** Injectables, threaded to the engine so tests never hit the network or wait on real delays. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  clock?: () => string;
  sleep?: (ms: number) => Promise<void>;
  warmUp?: WarmUpOptions;
  requestTimeoutMs?: number;
  allowInsecureLocalTargets?: boolean;
}

export type RunDeploymentVerificationCode =
  | 'no_provider'
  | 'not_deployed'
  | 'already_running'
  | 'start_failed'
  | 'persist_failed'
  | 'completed';

export interface RunDeploymentVerificationResult {
  ok: boolean;
  code: RunDeploymentVerificationCode;
  message: string;
  report?: VerificationReport;

  /** True only when this run actually moved the Deployment to `verified`. */
  verified: boolean;

  /** True when the Deployment was already `verified`, so no second lifecycle event was written. */
  duplicate: boolean;
  verificationId?: string;
}

export async function runDeploymentVerification(
  params: RunDeploymentVerificationParams,
): Promise<RunDeploymentVerificationResult> {
  const { deployment } = params;

  /*
   * A Deployment with no Vercel connection has nothing to verify — refused BEFORE an attempt row
   * is created, so the verification history never contains an attempt that could not have run.
   * Every other failure (no URL, unreachable, broken app) DOES produce a full report, because in
   * those cases the evidence is the point.
   */
  if (!deployment.vercel) {
    return {
      ok: false,
      code: 'no_provider',
      message: 'This Deployment is not connected to Vercel — deploy it before verifying.',
      verified: false,
      duplicate: false,
    };
  }

  const target = resolveVerificationTarget(deployment);

  const started = await deploymentRepository.startDeploymentVerification({
    deploymentId: deployment.id,
    projectId: deployment.projectId,
    policyVersion: VERIFICATION_POLICY_VERSION,
    targetUrl: target.url,
    vercelDeploymentId: target.vercelDeploymentId,
    createdBy: params.performedBy,
  });

  if (!started.ok) {
    return {
      ok: false,
      code:
        started.code === 'not_deployed'
          ? 'not_deployed'
          : started.code === 'already_running'
            ? 'already_running'
            : 'start_failed',
      message: started.message,
      verified: false,
      duplicate: false,
    };
  }

  const report = await verifyDeployment({
    deployment,
    manifest: params.manifest,
    supabaseAnonKey: params.supabaseAnonKey,
    onProgress: params.onProgress,
    signal: params.signal,
    performedBy: params.performedBy,
    fetchImpl: params.fetchImpl,
    now: params.now,
    clock: params.clock,
    sleep: params.sleep,
    warmUp: params.warmUp,
    requestTimeoutMs: params.requestTimeoutMs,
    allowInsecureLocalTargets: params.allowInsecureLocalTargets,
  });

  const recorded = await deploymentRepository.recordDeploymentVerification(started.verification.id, report, {
    performedBy: params.performedBy,
  });

  if (!recorded.ok) {
    return {
      ok: false,
      code: 'persist_failed',
      message: recorded.message,
      report,
      verified: false,
      duplicate: false,
      verificationId: started.verification.id,
    };
  }

  return {
    ok: report.status === 'passed' || report.status === 'warning',
    code: 'completed',
    message: report.message,
    report,
    verified: recorded.transitioned,
    duplicate: recorded.duplicate,
    verificationId: started.verification.id,
  };
}
