/**
 * Deployment Verification Model — Sprint 92 (Deployment Verification & Live Application
 * Validation).
 *
 * Part 1 audit — four DIFFERENT things in this codebase are already called "validation," and this
 * sprint is only the fourth:
 *
 *  1. Generation validation — `app/lib/code-generation/generationValidator.ts`,
 *     `dependencyValidation.ts`, `manifestBuilder.ts`'s `validateManifestFileDrafts`. Static checks
 *     over generated SOURCE before anything is deployed. Untouched here.
 *  2. Deployment readiness — `app/lib/code-generation/deploymentReadiness.ts` (a coarse
 *     ".env.example exists" boolean for Product Package display) and
 *     `app/lib/services/environmentReadinessService.ts` (per-variable resolved/missing report).
 *     Both answer "do the PREREQUISITES exist," not "does the deployed app work." Untouched here.
 *  3. Vercel deployment status — `vercelDeployService.ts`'s `pollVercelDeployment`. Confirms Vercel
 *     finished a BUILD (`readyState === 'READY'`). Reused here only as evidence (see the
 *     `'configuration'` category's provider-error check) — never as proof the app is usable.
 *  4. Live application verification — THIS sprint. Fetches the public deployed URL and proves the
 *     application is actually reachable and serving a working shell.
 *
 * These types are pure data: no network, no BuildersDB, no side effects. The service
 * (`deploymentVerificationService.ts`) produces a `VerificationReport`; the repository
 * (`deploymentRepository.recordDeploymentVerification`) is the only thing that persists one or
 * moves `Deployment.status`.
 */

/** Part 2 — a check's own outcome. `unavailable` means "this could not be checked safely/at all," which is deliberately NOT the same as `failed`. */
export type VerificationCheckStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'warning'
  | 'skipped'
  | 'unavailable';

/** Part 2 — what a check is about. Used to group checks in the UI and to let a policy enable/disable a whole family at once. */
export type VerificationCategory =
  | 'availability'
  | 'transport'
  | 'content'
  | 'route'
  | 'asset'
  | 'application'
  | 'database'
  | 'authentication'
  | 'api'
  | 'configuration'
  | 'security'
  | 'performance';

/**
 * Part 13 — the report's own final result.
 *
 *  - `passed`     — every required check passed AND no advisory check warned or was unavailable.
 *  - `warning`    — every required check passed, but at least one advisory check warned/was
 *                   unavailable. Still verifiable (see `VERIFICATION_ALLOWS_ADVISORY_WARNINGS`).
 *  - `failed`     — at least one REQUIRED check failed. Never verifiable.
 *  - `cancelled`  — the operator cancelled the run.
 *  - `incomplete` — verification could not finish because of an internal or provider problem
 *                   (distinct from `failed`: the APPLICATION was not proven broken, the
 *                   VERIFICATION SYSTEM was). Never verifiable.
 *  - `running`    — an attempt currently in flight; only ever persisted transiently.
 */
export type VerificationReportStatus = 'running' | 'passed' | 'warning' | 'failed' | 'cancelled' | 'incomplete';

/**
 * Part 13's documented rule, in one place: a `warning` report DOES permit the
 * `deployed -> verified` transition. Advisory checks are advisory by definition — an
 * unmeasurable response time or a missing `Strict-Transport-Security` header is information for
 * the operator, not evidence the application is unusable. Anything that MUST block is declared
 * `required` by the policy instead (see `verificationPolicy.ts`), which produces `failed`.
 * `deploymentRepository.recordDeploymentVerification` reads this constant rather than
 * re-implementing the rule.
 */
export const VERIFICATION_ALLOWS_ADVISORY_WARNINGS = true;

/**
 * Part 5 — a check's supporting facts. Deliberately a flat map of primitives, so persisting it as
 * JSONB is lossless and so nothing can accidentally smuggle a `Headers`/`Response` object (and the
 * cookies or `Authorization` echoes inside it) into BuildersDB. Every value written here goes
 * through `redactEvidenceValue` first — see `verificationRedaction.ts`.
 */
export type VerificationEvidence = Record<string, string | number | boolean | null>;

/** Part 2 — one executed check. */
export interface VerificationCheck {
  /** Stable within a report, and stable across attempts for the same logical check (e.g. `availability.http_response`, `route:/about`) so two reports can be diffed. */
  id: string;
  category: VerificationCategory;
  name: string;
  description: string;

  /** `true` — a failure blocks `verified`. `false` — advisory; a failure is downgraded to `warning` by the engine (see `finaliseCheck`). */
  required: boolean;
  status: VerificationCheckStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  /** What was checked — a URL, a Supabase project ref, a header name. Never a credential. */
  target?: string;
  expected?: string;
  actual?: string;
  evidence: VerificationEvidence;

  /** A stable machine-readable cause (`http_status`, `blocked_host`, `timeout`, ...) — the UI keys actionable guidance off this, not off the message text. */
  errorCode?: string;
  errorMessage?: string;

  /** Whether re-running verification could plausibly change this check's outcome (Part 17/18). */
  retryable: boolean;

  /** How many attempts this check consumed, including warm-up retries (Part 18). `1` for a check that succeeded first time. */
  attempts: number;
}

/** Part 2 — the counts the dashboard renders without re-walking `checks`. */
export interface VerificationSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  unavailable: number;
  requiredTotal: number;
  requiredPassed: number;
  requiredFailed: number;

  /** The first required failure, for the "latest blocking failure" line in the dashboard (Part 19). */
  blockingFailure?: { checkId: string; name: string; errorCode?: string; errorMessage?: string };
}

/** Part 2 — the single structured artefact one verification attempt produces. */
export interface VerificationReport {
  status: VerificationReportStatus;

  /** Which policy produced this report — pinned so an old report stays interpretable after the policy changes (Part 15). */
  policyVersion: string;

  /** The URL verification was pointed at, before redirects. */
  targetUrl: string;

  /** Where the root request actually landed after safe redirects, when it got that far. */
  finalUrl?: string;

  /** The Vercel deployment identity this attempt targeted (Part 17: a retry after a redeploy must target the LATEST one). */
  vercelDeploymentId?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  checks: VerificationCheck[];
  summary: VerificationSummary;

  /** One human-readable sentence for the dashboard and the Deployment History event. */
  message: string;
}

/** A persisted attempt — a `builders_deployment_verifications` row, in application shape. */
export interface DeploymentVerification extends VerificationReport {
  id: string;
  deploymentId: string;
  projectId: string;

  /** 1-based, per deployment. Attempt N+1 never overwrites attempt N (Part 15). */
  verificationNumber: number;
  createdBy?: string;
  createdAt: string;
}

/** Part 20 — the stages a run reports as it progresses, so the UI never invents its own status. */
export type VerificationStage =
  | 'preparing'
  | 'validating_url'
  | 'checking_availability'
  | 'checking_application_shell'
  | 'checking_routes'
  | 'checking_assets'
  | 'checking_supabase'
  | 'checking_authentication'
  | 'finalising_report';

export interface VerificationProgress {
  stage: VerificationStage;
  detail?: string;

  /** Checks completed so far / checks planned. Planned count is known up front from the policy. */
  completed: number;
  planned: number;
}

export const VERIFICATION_STAGE_LABELS: Record<VerificationStage, string> = {
  preparing: 'Preparing',
  validating_url: 'Validating URL',
  checking_availability: 'Checking availability',
  checking_application_shell: 'Checking application shell',
  checking_routes: 'Checking routes',
  checking_assets: 'Checking assets',
  checking_supabase: 'Checking Supabase',
  checking_authentication: 'Checking authentication readiness',
  finalising_report: 'Finalising report',
};

export const VERIFICATION_CATEGORY_LABELS: Record<VerificationCategory, string> = {
  availability: 'Availability',
  transport: 'Transport',
  content: 'Content',
  route: 'Routes',
  asset: 'Assets',
  application: 'Application',
  database: 'Database',
  authentication: 'Authentication',
  api: 'API',
  configuration: 'Configuration',
  security: 'Security',
  performance: 'Performance',
};

/**
 * Part 13 — derives the summary and the final report status from the executed checks alone. Pure,
 * total, and the ONLY place the pass/warning/fail rule lives; the service and the repository both
 * call it rather than each deciding for themselves.
 *
 * `terminalOverride` exists for `cancelled`/`incomplete`, which are properties of the RUN, not of
 * the checks (a cancelled run may well have every completed check passing — it still isn't a pass).
 */
export function summariseChecks(checks: VerificationCheck[]): VerificationSummary {
  const requiredChecks = checks.filter((check) => check.required);
  const blocking = requiredChecks.find((check) => check.status === 'failed');

  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
    unavailable: checks.filter((check) => check.status === 'unavailable').length,
    requiredTotal: requiredChecks.length,
    requiredPassed: requiredChecks.filter((check) => check.status === 'passed').length,
    requiredFailed: requiredChecks.filter((check) => check.status === 'failed').length,
    blockingFailure: blocking
      ? {
          checkId: blocking.id,
          name: blocking.name,
          errorCode: blocking.errorCode,
          errorMessage: blocking.errorMessage,
        }
      : undefined,
  };
}

export function resolveReportStatus(
  checks: VerificationCheck[],
  terminalOverride?: 'cancelled' | 'incomplete',
): VerificationReportStatus {
  if (terminalOverride) {
    return terminalOverride;
  }

  if (checks.some((check) => check.required && check.status === 'failed')) {
    return 'failed';
  }

  /*
   * A required check that never resolved (still pending/running, or reported `unavailable`) is not
   * a pass: `passed` means every required check was actually PROVEN. `unavailable` on a required
   * check means the engine could not obtain the evidence, which is an incomplete verification, not
   * a broken application — hence `incomplete` rather than `failed` (Part 23's "distinguish
   * application failure from verification-system failure").
   */
  if (checks.some((check) => check.required && (check.status === 'pending' || check.status === 'running'))) {
    return 'incomplete';
  }

  if (checks.some((check) => check.required && check.status === 'unavailable')) {
    return 'incomplete';
  }

  if (checks.some((check) => check.status === 'warning' || check.status === 'unavailable')) {
    return 'warning';
  }

  return 'passed';
}

/** Part 13/14 — the one predicate `recordDeploymentVerification` consults before transitioning to `verified`. */
export function reportPermitsVerified(report: Pick<VerificationReport, 'status' | 'summary'>): boolean {
  if (report.summary.requiredFailed > 0) {
    return false;
  }

  if (report.status === 'passed') {
    return true;
  }

  return report.status === 'warning' && VERIFICATION_ALLOWS_ADVISORY_WARNINGS;
}
