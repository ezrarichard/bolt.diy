import type {
  DeploymentVerification,
  VerificationCheck,
  VerificationReportStatus,
  VerificationSummary,
} from '~/lib/deployment/verificationTypes';

/**
 * BuildersDB row/frontend shape mapping for Deployment Verification — Sprint 92. Mirrors
 * `deploymentDbTypes.ts`'s convention exactly: the `BuildersDb...Row` interface is the literal
 * shape of a `builders_deployment_verifications` row (see
 * supabase/migrations/20260805100000_deployment_verification.sql), and this file is the only place
 * a row is translated into the application's camelCase shape.
 */

export interface BuildersDbDeploymentVerificationRow {
  id: string;
  deployment_id: string;
  project_id: string;
  vercel_deployment_id: string | null;
  verification_number: number;
  status: VerificationReportStatus;
  policy_version: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  target_url: string | null;
  final_url: string | null;
  summary: VerificationSummary | Record<string, never> | null;
  checks: VerificationCheck[] | null;
  message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_SUMMARY: VerificationSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  skipped: 0,
  unavailable: 0,
  requiredTotal: 0,
  requiredPassed: 0,
  requiredFailed: 0,
};

/** A row still in `running` has an empty `summary`/`checks` — normalised here so no consumer has to null-check them. */
export function fromDeploymentVerificationRow(row: BuildersDbDeploymentVerificationRow): DeploymentVerification {
  const summary = row.summary && 'total' in row.summary ? (row.summary as VerificationSummary) : EMPTY_SUMMARY;

  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    vercelDeploymentId: row.vercel_deployment_id ?? undefined,
    verificationNumber: row.verification_number,
    status: row.status,
    policyVersion: row.policy_version,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    targetUrl: row.target_url ?? '',
    finalUrl: row.final_url ?? undefined,
    summary,
    checks: row.checks ?? [],
    message: row.message ?? '',
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

export interface DeploymentVerificationStartInput {
  deploymentId: string;
  projectId: string;
  verificationNumber: number;
  policyVersion: string;
  targetUrl?: string;
  vercelDeploymentId?: string;
  createdBy?: string;
}

export function toDeploymentVerificationInsert(input: DeploymentVerificationStartInput): Record<string, unknown> {
  return {
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    verification_number: input.verificationNumber,
    policy_version: input.policyVersion,
    status: 'running',
    target_url: input.targetUrl ?? null,
    vercel_deployment_id: input.vercelDeploymentId ?? null,
    created_by: input.createdBy ?? null,
  };
}
