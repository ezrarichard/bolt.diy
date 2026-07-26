import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import {
  analyseApplicationShell,
  detectErrorPage,
  discoverCriticalAssets,
  isHtmlContentType,
} from '~/lib/deployment/verificationContent';
import {
  isTransientFetchFailure,
  isTransientHttpStatus,
  safeFetch,
  validateVerificationUrl,
  type SafeFetchOptions,
  type SafeFetchResult,
} from '~/lib/deployment/verificationHttp';
import {
  expectedSupabaseUrlForRef,
  resolveVerificationPolicy,
  type PlannedRouteCheck,
  type VerificationPolicy,
} from '~/lib/deployment/verificationPolicy';
import { redactEvidence, redactUrl } from '~/lib/deployment/verificationRedaction';
import {
  resolveReportStatus,
  summariseChecks,
  type VerificationCategory,
  type VerificationCheck,
  type VerificationCheckStatus,
  type VerificationEvidence,
  type VerificationProgress,
  type VerificationReport,
  type VerificationStage,
} from '~/lib/deployment/verificationTypes';

/**
 * Deployment Verification Service — Sprint 92, Parts 5/6/7/9/10/11/12/18.
 *
 * Proves that a DEPLOYED application is actually usable, which "Vercel says READY" does not.
 * Produces exactly one `VerificationReport` per run and does nothing else: it never writes to
 * BuildersDB, never transitions `Deployment.status`, and never records a history event — that is
 * `deploymentRepository.recordDeploymentVerification`'s sole responsibility (the same
 * "assessment lives in a service, mutation lives in the repository" boundary
 * `environmentReadinessService.ts` established in Sprint 90, and unlike `vercelDeployService.ts`,
 * which orchestrates provider mutations and therefore legitimately does call the repository).
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION (Part 4): every request this file issues goes through
 * `safeFetch`, which only ever emits `GET`/`HEAD`. There is no code path here that can POST, submit
 * a form, create a record, create a user, send a message or trigger a payment. The only credential
 * it can carry is an operator-supplied, in-memory, PUBLIC Supabase anon key for one explicitly
 * read-only query (Part 10) — it is never logged, never persisted, and never placed in evidence.
 *
 * DETERMINISTIC AND TESTABLE (Part 5): `fetchImpl`, `now`, `clock` and `sleep` are all injectable,
 * so the unit suite never touches a real URL and never waits on a real retry delay.
 */

export interface VerifyDeploymentParams {
  deployment: DeploymentWithProviders;

  /** The project's active Application Manifest — the grounded source of route declarations. `null` degrades verification to root-only, which is a real (reduced) result, not an error. */
  manifest: ApplicationManifest | null;

  /** Overrides the URL derived from the Vercel provider row. Used by the "verify a specific deployment" path. */
  targetUrl?: string;

  /**
   * Part 10 — the PUBLIC Supabase anon key, if the operator supplied one for this run (the deploy
   * dialog already holds manually-entered variable values in memory). Used for one read-only REST
   * health query and nothing else. Never persisted, never redacted-into-evidence, never returned.
   */
  supabaseAnonKey?: string;

  onProgress?: (progress: VerificationProgress) => void;
  signal?: AbortSignal;
  performedBy?: string;

  /** Injectables — see this file's header. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  clock?: () => string;
  sleep?: (ms: number) => Promise<void>;
  warmUp?: WarmUpOptions;
  requestTimeoutMs?: number;
  allowInsecureLocalTargets?: boolean;
}

/** Part 18 — bounded warm-up retry for classified transient failures only. */
export interface WarmUpOptions {
  maxAttempts?: number;
  delayMs?: number;
  totalBudgetMs?: number;
}

const DEFAULT_WARM_UP: Required<WarmUpOptions> = { maxAttempts: 3, delayMs: 2000, totalBudgetMs: 20_000 };

/**
 * Part 17 — which deployment this run targets. Prefers the LATEST deployment recorded by
 * `vercelDeployService.deployToVercel` (`metadata.latestDeploymentUrl`) over the project's
 * long-lived `productionUrl`, so a retry after a redeploy verifies the new deployment rather than
 * the old alias.
 */
export function resolveVerificationTarget(deployment: DeploymentWithProviders): {
  url?: string;
  vercelDeploymentId?: string;
} {
  const vercel = deployment.vercel;

  if (!vercel) {
    return {};
  }

  const latestUrl = vercel.metadata?.latestDeploymentUrl as string | undefined;
  const url = latestUrl || vercel.productionUrl;

  return {
    url: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : undefined,
    vercelDeploymentId: vercel.metadata?.latestDeploymentId as string | undefined,
  };
}

interface CheckSpec {
  id: string;
  category: VerificationCategory;
  name: string;
  description: string;
  required: boolean;
}

interface CheckOutcome {
  status: Exclude<VerificationCheckStatus, 'pending' | 'running'>;
  target?: string;
  expected?: string;
  actual?: string;
  evidence?: VerificationEvidence;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  attempts?: number;
}

class VerificationRun {
  readonly checks: VerificationCheck[] = [];

  constructor(
    private readonly _policy: VerificationPolicy,
    private readonly _clock: () => string,
    private readonly _now: () => number,
    private readonly _onProgress?: (progress: VerificationProgress) => void,
  ) {}

  progress(stage: VerificationStage, detail?: string): void {
    this._onProgress?.({
      stage,
      detail,
      completed: this.checks.length,
      planned: Math.max(this._policy.plannedCheckCount, this.checks.length),
    });
  }

  /**
   * Records one finished check. An ADVISORY check can never report `failed` — it is downgraded to
   * `warning` here, in one place, so no individual check has to remember Part 3's rule that only
   * required checks block.
   */
  record(spec: CheckSpec, startedAtMs: number, startedAtIso: string, outcome: CheckOutcome): VerificationCheck {
    const completedAtMs = this._now();
    const status = !spec.required && outcome.status === 'failed' ? 'warning' : outcome.status;

    const check: VerificationCheck = {
      ...spec,
      status,
      startedAt: startedAtIso,
      completedAt: this._clock(),
      durationMs: completedAtMs - startedAtMs,
      target: outcome.target ? redactUrl(outcome.target) : undefined,
      expected: outcome.expected,
      actual: outcome.actual,
      evidence: redactEvidence(outcome.evidence ?? {}),
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      retryable: outcome.retryable ?? false,
      attempts: outcome.attempts ?? 1,
    };

    this.checks.push(check);

    return check;
  }

  async run(spec: CheckSpec, executor: () => Promise<CheckOutcome>): Promise<VerificationCheck> {
    const startedAtMs = this._now();
    const startedAtIso = this._clock();

    try {
      return this.record(spec, startedAtMs, startedAtIso, await executor());
    } catch (error) {
      /*
       * A throw inside a check is a VERIFICATION-SYSTEM fault, not evidence the application is
       * broken (Part 23) — reported `unavailable`, which keeps a required check out of `passed`
       * (the report becomes `incomplete`) without asserting the deployment failed.
       */
      return this.record(spec, startedAtMs, startedAtIso, {
        status: 'unavailable',
        errorCode: 'verification_error',
        errorMessage: error instanceof Error ? error.message : 'Verification check could not run.',
        retryable: true,
      });
    }
  }

  skip(spec: CheckSpec, reason: string, target?: string): VerificationCheck {
    const at = this._now();
    return this.record(spec, at, this._clock(), { status: 'skipped', errorMessage: reason, target });
  }
}

interface FetchAttemptResult {
  result: SafeFetchResult;
  attempts: number;
}

/**
 * Part 18 — issues a request, retrying ONLY classified transient failures (network/timeout, and
 * the small set of HTTP statuses that legitimately occur while an alias propagates or a function
 * cold-starts), within both an attempt cap and a wall-clock budget. A persistent application error
 * (a 500 that keeps being a 500, a real 404 on a route that does not exist) is retried up to the
 * same small bound and then reported — it is never retried indefinitely. Retries are recorded as
 * `attempts` on the check, never as extra Deployment History events.
 */
async function fetchWithWarmUp(
  url: string,
  options: SafeFetchOptions,
  warmUp: Required<WarmUpOptions>,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<FetchAttemptResult> {
  const startedAt = now();
  let attempts = 0;
  let last: SafeFetchResult | undefined;

  for (let attempt = 1; attempt <= warmUp.maxAttempts; attempt += 1) {
    attempts = attempt;
    last = await safeFetch(url, options);

    const retryable = last.ok ? isTransientHttpStatus(last.status) : isTransientFetchFailure(last.code);

    if (!retryable) {
      return { result: last, attempts };
    }

    if (!last.ok && last.code === 'cancelled') {
      return { result: last, attempts };
    }

    if (attempt >= warmUp.maxAttempts || now() - startedAt >= warmUp.totalBudgetMs || options.signal?.aborted) {
      return { result: last, attempts };
    }

    await sleep(warmUp.delayMs);
  }

  return { result: last as SafeFetchResult, attempts };
}

function joinPath(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function fetchFailureEvidence(result: SafeFetchResult): VerificationEvidence {
  if (result.ok) {
    return {
      status: result.status,
      finalUrl: result.finalUrl,
      redirects: result.redirectCount,
      durationMs: result.durationMs,
      contentType: result.contentType ?? null,
    };
  }

  return {
    errorCode: result.code,
    finalUrl: result.finalUrl ?? null,
    redirects: result.redirectCount,
    durationMs: result.durationMs,
  };
}

/** Part 23 — turns a transport/HTTP failure into an ACTIONABLE message, distinguishing an application fault from a verification-system fault. */
function describeFetchFailure(result: Extract<SafeFetchResult, { ok: false }>): string {
  switch (result.code) {
    case 'timeout':
      return 'The deployment did not respond in time. If it was just deployed, retry verification in a moment.';
    case 'network_error':
      return `The deployment could not be reached (${result.message}). Check that the deployment alias resolves and the deployment was not deleted.`;
    case 'redirect_loop':
      return "The deployment redirects to itself in a loop — check the application's routing/redirect configuration.";
    case 'too_many_redirects':
      return 'The deployment exceeded the redirect limit before serving a page.';
    case 'unsafe_redirect':
      return `${result.message} Verification refuses to follow redirects to private or non-HTTPS destinations.`;
    case 'blocked_host':
    case 'unsupported_scheme':
    case 'invalid_url':
    case 'missing_url':
      return result.message;
    case 'cancelled':
      return 'Verification was cancelled.';
    default:
      return result.message;
  }
}

export async function verifyDeployment(params: VerifyDeploymentParams): Promise<VerificationReport> {
  const now = params.now ?? (() => Date.now());
  const clock = params.clock ?? (() => new Date().toISOString());
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const warmUp = { ...DEFAULT_WARM_UP, ...(params.warmUp ?? {}) };
  const startedAtIso = clock();
  const startedAtMs = now();

  const target = resolveVerificationTarget(params.deployment);
  const targetUrl = params.targetUrl ?? target.url ?? '';

  const policy = resolveVerificationPolicy({
    targetUrl,
    deployment: params.deployment,
    manifest: params.manifest,
  });

  const run = new VerificationRun(policy, clock, now, params.onProgress);

  const httpOptions = (overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
    fetchImpl: params.fetchImpl,
    now,
    signal: params.signal,
    timeoutMs: params.requestTimeoutMs,
    allowInsecureLocalTargets: params.allowInsecureLocalTargets,
    ...overrides,
  });

  const finalise = (terminalOverride?: 'cancelled' | 'incomplete', finalUrl?: string): VerificationReport => {
    run.progress('finalising_report');

    const checks = run.checks;
    const summary = summariseChecks(checks);
    const status = resolveReportStatus(checks, terminalOverride);

    return {
      status,
      policyVersion: policy.version,
      targetUrl: targetUrl ? redactUrl(targetUrl) : '',
      finalUrl: finalUrl ? redactUrl(finalUrl) : undefined,
      vercelDeploymentId: target.vercelDeploymentId,
      startedAt: startedAtIso,
      completedAt: clock(),
      durationMs: now() - startedAtMs,
      checks,
      summary,
      message: describeReport(status, summary),
    };
  };

  const cancelled = () => params.signal?.aborted === true;

  run.progress('preparing');

  // ── Part 6 step 1/2: preview URL validation and transport ────────────────
  run.progress('validating_url');

  const urlCheck = await run.run(
    {
      id: 'availability.preview_url',
      category: 'availability',
      name: 'Preview URL',
      description: 'A deployment URL exists, is syntactically valid, and points at a public host.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      const validation = validateVerificationUrl(targetUrl, {
        allowInsecureLocalTargets: params.allowInsecureLocalTargets,
      });

      if (!validation.ok) {
        return {
          status: 'failed',
          target: targetUrl,
          expected: 'A public https:// deployment URL',
          actual: targetUrl || '(none)',
          errorCode: validation.code,
          errorMessage:
            validation.code === 'missing_url'
              ? 'This Deployment has no Vercel deployment URL to verify — deploy it first.'
              : validation.message,
          retryable: validation.code === 'missing_url',
        };
      }

      return {
        status: 'passed',
        target: validation.url.toString(),
        expected: 'A public https:// deployment URL',
        actual: validation.url.origin,
        evidence: { host: validation.url.host, scheme: validation.url.protocol.replace(':', '') },
      };
    },
  );

  await run.run(
    {
      id: 'transport.https',
      category: 'transport',
      name: 'HTTPS transport',
      description: 'The deployment is served over HTTPS.',
      required: !params.allowInsecureLocalTargets,
    },
    async (): Promise<CheckOutcome> => {
      if (urlCheck.status !== 'passed') {
        return { status: 'skipped', errorMessage: 'The deployment URL is not usable.' };
      }

      const scheme = new URL(urlCheck.target as string).protocol;

      if (scheme === 'https:') {
        return { status: 'passed', target: urlCheck.target, expected: 'https', actual: 'https' };
      }

      return {
        status: params.allowInsecureLocalTargets ? 'skipped' : 'failed',
        target: urlCheck.target,
        expected: 'https',
        actual: scheme.replace(':', ''),
        errorCode: 'insecure_transport',
        errorMessage: 'The deployment is not served over HTTPS.',
      };
    },
  );

  if (urlCheck.status !== 'passed') {
    return finalise();
  }

  const resolvedTargetUrl = urlCheck.target as string;

  // ── Part 6 steps 3-6: availability, content, shell ───────────────────────
  run.progress('checking_availability', resolvedTargetUrl);

  let rootResponse: SafeFetchResult | undefined;

  const availabilityCheck = await run.run(
    {
      id: 'availability.http_response',
      category: 'availability',
      name: 'HTTP response',
      description: 'The deployment answers an HTTPS request with a successful status, following redirects safely.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      const { result, attempts } = await fetchWithWarmUp(resolvedTargetUrl, httpOptions(), warmUp, sleep, now);
      rootResponse = result;

      if (!result.ok) {
        return {
          status: result.code === 'cancelled' ? 'skipped' : 'failed',
          target: resolvedTargetUrl,
          expected: 'HTTP 2xx',
          actual: result.code,
          evidence: fetchFailureEvidence(result),
          errorCode: result.code,
          errorMessage: describeFetchFailure(result),
          retryable: isTransientFetchFailure(result.code),
          attempts,
        };
      }

      const ok = result.status >= 200 && result.status < 300;

      return {
        status: ok ? 'passed' : 'failed',
        target: resolvedTargetUrl,
        expected: 'HTTP 2xx',
        actual: `HTTP ${result.status}`,
        evidence: fetchFailureEvidence(result),
        errorCode: ok ? undefined : 'http_status',
        errorMessage: ok
          ? undefined
          : result.status >= 500
            ? `The deployment returned HTTP ${result.status} — the application failed at runtime. Check the Vercel runtime logs.`
            : `The deployment returned HTTP ${result.status} at its root URL.`,
        retryable: !ok && isTransientHttpStatus(result.status),
        attempts,
      };
    },
  );

  if (cancelled()) {
    return finalise('cancelled', rootResponse?.ok ? rootResponse.finalUrl : undefined);
  }

  const rootOk = availabilityCheck.status === 'passed' && rootResponse?.ok === true;
  const rootBody = rootOk && rootResponse?.ok ? rootResponse.body : '';
  const finalUrl = rootResponse?.ok ? rootResponse.finalUrl : undefined;

  await run.run(
    {
      id: 'performance.response_time',
      category: 'performance',
      name: 'Response time',
      description: 'How long the root request took. Advisory — a slow response never blocks verification.',
      required: false,
    },
    async (): Promise<CheckOutcome> => {
      if (!rootResponse?.ok) {
        return { status: 'skipped', errorMessage: 'The root request did not complete.' };
      }

      const durationMs = rootResponse.durationMs;
      const slow = durationMs > policy.performance.advisoryThresholdMs;

      return {
        status: slow ? 'warning' : 'passed',
        target: resolvedTargetUrl,
        expected: `< ${policy.performance.advisoryThresholdMs}ms`,
        actual: `${durationMs}ms`,
        evidence: { durationMs, thresholdMs: policy.performance.advisoryThresholdMs },
        errorCode: slow ? 'slow_response' : undefined,
        errorMessage: slow ? 'The deployment responded slowly — this may just be a serverless cold start.' : undefined,
      };
    },
  );

  await run.run(
    {
      id: 'security.headers',
      category: 'security',
      name: 'Security headers',
      description: 'Common hardening headers. Advisory — reported, never blocking.',
      required: false,
    },
    async (): Promise<CheckOutcome> => {
      if (!rootResponse?.ok) {
        return { status: 'skipped', errorMessage: 'The root request did not complete.' };
      }

      const missing = ['strict-transport-security', 'x-content-type-options'].filter(
        (header) => !rootResponse?.ok || !rootResponse.headers[header],
      );

      return {
        status: missing.length > 0 ? 'warning' : 'passed',
        target: resolvedTargetUrl,
        expected: 'strict-transport-security, x-content-type-options',
        actual: missing.length > 0 ? `missing: ${missing.join(', ')}` : 'present',
        evidence: { missingHeaders: missing.join(', ') || 'none' },
        errorCode: missing.length > 0 ? 'missing_security_headers' : undefined,
        errorMessage: missing.length > 0 ? 'The deployment does not send some common security headers.' : undefined,
      };
    },
  );

  run.progress('checking_application_shell');

  await run.run(
    {
      id: 'content.body',
      category: 'content',
      name: 'Content present',
      description: 'The deployment returns a non-empty HTML document.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      if (!rootOk || !rootResponse?.ok) {
        return { status: 'skipped', errorMessage: 'The root request did not succeed.' };
      }

      const html = isHtmlContentType(rootResponse.contentType);
      const nonEmpty = rootResponse.body.trim().length > 0;

      if (!nonEmpty) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'A non-empty HTML document',
          actual: 'empty response body',
          evidence: { bytes: rootResponse.bytes, contentType: rootResponse.contentType ?? null },
          errorCode: 'empty_response',
          errorMessage: 'The deployment returned an empty response — the build produced no output to serve.',
        };
      }

      if (!html) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'text/html',
          actual: rootResponse.contentType ?? '(none)',
          evidence: { bytes: rootResponse.bytes, contentType: rootResponse.contentType ?? null },
          errorCode: 'unexpected_content_type',
          errorMessage: 'The deployment root did not serve an HTML document.',
        };
      }

      return {
        status: 'passed',
        target: resolvedTargetUrl,
        expected: 'A non-empty HTML document',
        actual: `${rootResponse.bytes} bytes of ${rootResponse.contentType}`,
        evidence: {
          bytes: rootResponse.bytes,
          contentType: rootResponse.contentType ?? null,
          truncated: rootResponse.truncated,
        },
      };
    },
  );

  await run.run(
    {
      id: 'application.error_page',
      category: 'application',
      name: 'No deployment error page',
      description:
        'The response is the application, not a platform error page. A deployment can return HTTP 200 and still be broken.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      if (!rootOk || !rootResponse?.ok) {
        return { status: 'skipped', errorMessage: 'The root request did not succeed.' };
      }

      const detection = detectErrorPage(rootBody, rootResponse.headers['x-vercel-error']);

      if (detection.detected) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'The application shell',
          actual: detection.reason,
          evidence: { pattern: detection.code ?? 'unknown' },
          errorCode: detection.code,
          errorMessage: `${detection.reason} Check the Vercel build and runtime logs for this deployment.`,
        };
      }

      return {
        status: 'passed',
        target: resolvedTargetUrl,
        expected: 'The application shell',
        actual: 'No error page detected',
      };
    },
  );

  await run.run(
    {
      id: 'application.shell',
      category: 'application',
      name: 'Application shell',
      description:
        'The HTML contains a real document with the generated application root element and a script to fill it.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      if (!rootOk) {
        return { status: 'skipped', errorMessage: 'The root request did not succeed.' };
      }

      const shell = analyseApplicationShell(rootBody);
      const evidence: VerificationEvidence = {
        hasHtmlDocument: shell.hasHtmlDocument,
        hasBody: shell.hasBody,
        hasRootElement: shell.hasRootElement,
        hasModuleScript: shell.hasModuleScript,
        title: shell.title ?? null,
      };

      if (!shell.hasHtmlDocument || !shell.hasBody) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'An HTML document with a body',
          actual: 'no HTML document structure',
          evidence,
          errorCode: 'missing_document',
          errorMessage: 'The deployment did not return a complete HTML document.',
        };
      }

      if (shell.isEmptyShell) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'An application shell that loads the application',
          actual: 'an empty document with no scripts',
          evidence,
          errorCode: 'empty_shell',
          errorMessage: 'The deployment served an empty page with no application bundle — the build output is missing.',
        };
      }

      if (!shell.hasRootElement && !shell.hasModuleScript) {
        return {
          status: 'failed',
          target: resolvedTargetUrl,
          expected: 'A mount element or an application script',
          actual: 'neither present',
          evidence,
          errorCode: 'missing_shell',
          errorMessage: 'The page contains neither the application root element nor an application script.',
        };
      }

      return {
        status: 'passed',
        target: resolvedTargetUrl,
        expected: 'A loadable application shell',
        actual: shell.hasRootElement ? 'root element present' : 'application script present',
        evidence,
      };
    },
  );

  await run.run(
    {
      id: 'configuration.provider_state',
      category: 'configuration',
      name: 'Provider deployment state',
      description: 'The Vercel provider reports no deployment-level error for the deployment being verified.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      const vercel = params.deployment.vercel;

      if (!vercel) {
        return {
          status: 'failed',
          expected: 'A connected Vercel deployment',
          actual: 'no Vercel provider attached',
          errorCode: 'no_provider',
          errorMessage: 'This Deployment has no Vercel connection — there is nothing to verify.',
        };
      }

      const state = (vercel.metadata?.latestDeploymentState as string | undefined) ?? undefined;
      const providerError = vercel.status === 'error' || state === 'ERROR' || state === 'CANCELED';

      return {
        status: providerError ? 'failed' : 'passed',
        target: vercel.vercelProjectName ?? vercel.vercelProjectId,
        expected: 'No provider-level deployment error',
        actual: `provider ${vercel.status}${state ? `, last deployment ${state}` : ''}`,
        evidence: {
          providerStatus: vercel.status,
          latestDeploymentState: state ?? null,
          vercelDeploymentId: target.vercelDeploymentId ?? null,
        },
        errorCode: providerError ? 'provider_error' : undefined,
        errorMessage: providerError
          ? (vercel.lastError ?? 'Vercel reports an error for the most recent deployment of this project.')
          : undefined,
      };
    },
  );

  if (cancelled()) {
    return finalise('cancelled', finalUrl);
  }

  // ── Part 8: declared routes ──────────────────────────────────────────────
  run.progress('checking_routes');

  for (const excluded of policy.excludedRoutes) {
    run.skip(
      {
        id: `route:${excluded.path}`,
        category: 'route',
        name: `Route ${excluded.path}`,
        description: 'Declared by the application, deliberately not verified.',
        required: false,
      },
      excluded.reason,
      joinPath(resolvedTargetUrl, excluded.path),
    );
  }

  for (const route of policy.routes) {
    if (cancelled()) {
      return finalise('cancelled', finalUrl);
    }

    await run.run(routeSpec(route, 'route'), () =>
      verifyRoute(route, resolvedTargetUrl, rootOk, httpOptions, warmUp, sleep, now),
    );
  }

  if (policy.routes.length === 0 && policy.excludedRoutes.length === 0) {
    run.skip(
      {
        id: 'route.none_declared',
        category: 'route',
        name: 'Declared routes',
        description: 'Route verification requires route declarations from the Application Manifest.',
        required: false,
      },
      "This project's Application Manifest declares no additional routes — only the root route was verified.",
    );
  }

  // ── Part 9: critical assets ──────────────────────────────────────────────
  run.progress('checking_assets');

  const assets = rootOk ? discoverCriticalAssets(rootBody, finalUrl ?? resolvedTargetUrl, policy.assets.maxAssets) : [];

  if (assets.length === 0) {
    run.skip(
      {
        id: 'asset.none_discovered',
        category: 'asset',
        name: 'Critical assets',
        description: 'Assets are discovered from the returned HTML.',
        required: false,
      },
      rootOk
        ? 'The returned HTML references no scripts or stylesheets to verify.'
        : 'The root request did not succeed, so no assets could be discovered.',
    );
  }

  for (const asset of assets) {
    if (cancelled()) {
      return finalise('cancelled', finalUrl);
    }

    await run.run(
      {
        id: `asset:${asset.kind}:${asset.url}`,
        category: 'asset',
        name: `${asset.kind === 'script' ? 'Script' : asset.kind === 'stylesheet' ? 'Stylesheet' : 'Icon'} ${new URL(asset.url).pathname}`,
        description: asset.critical
          ? 'A same-origin asset the page cannot render without.'
          : 'A non-critical or third-party asset. Advisory only.',
        required: asset.critical,
      },
      async (): Promise<CheckOutcome> => {
        const { result, attempts } = await fetchWithWarmUp(
          asset.url,
          httpOptions({ method: 'HEAD', maxBytes: 0 }),
          warmUp,
          sleep,
          now,
        );

        if (!result.ok) {
          return {
            status: result.code === 'cancelled' ? 'skipped' : 'failed',
            target: asset.url,
            expected: 'HTTP 2xx',
            actual: result.code,
            evidence: fetchFailureEvidence(result),
            errorCode: result.code,
            errorMessage: `The ${asset.kind} referenced by the page could not be loaded: ${describeFetchFailure(result)}`,
            retryable: isTransientFetchFailure(result.code),
            attempts,
          };
        }

        const ok = result.status >= 200 && result.status < 300;

        return {
          status: ok ? 'passed' : 'failed',
          target: asset.url,
          expected: 'HTTP 2xx',
          actual: `HTTP ${result.status}`,
          evidence: fetchFailureEvidence(result),
          errorCode: ok ? undefined : 'asset_missing',
          errorMessage: ok
            ? undefined
            : `The page references a ${asset.kind} that returns HTTP ${result.status} — the application will not render correctly.`,
          retryable: !ok && isTransientHttpStatus(result.status),
          attempts,
        };
      },
    );
  }

  // ── Part 10: Supabase ────────────────────────────────────────────────────
  run.progress('checking_supabase');
  await runSupabaseChecks(run, policy, params, httpOptions, warmUp, sleep, now);

  // ── Part 11: authentication readiness ────────────────────────────────────
  run.progress('checking_authentication');

  if (!policy.authentication.enabled) {
    run.skip(
      {
        id: 'authentication.not_declared',
        category: 'authentication',
        name: 'Authentication readiness',
        description: 'Checked only when the generated routing declares an authentication route.',
        required: false,
      },
      'This application declares no authentication route.',
    );
  } else {
    for (const route of policy.authentication.routes) {
      if (cancelled()) {
        return finalise('cancelled', finalUrl);
      }

      await run.run(routeSpec(route, 'authentication'), () =>
        verifyRoute(route, resolvedTargetUrl, rootOk, httpOptions, warmUp, sleep, now),
      );
    }
  }

  // ── Part 12: explicitly-declared safe API endpoints ──────────────────────
  if (policy.api.endpoints.length === 0) {
    run.skip(
      {
        id: 'api.none_declared',
        category: 'api',
        name: 'API health endpoint',
        description:
          'Checked only for an endpoint explicitly declared non-destructive in the Application Manifest. A safe endpoint is never inferred from a route name.',
        required: false,
      },
      'No non-destructive API endpoint is declared for this application.',
    );
  } else {
    for (const endpoint of policy.api.endpoints) {
      if (cancelled()) {
        return finalise('cancelled', finalUrl);
      }

      await run.run(
        {
          id: `api:${endpoint.method}:${endpoint.path}`,
          category: 'api',
          name: `${endpoint.method} ${endpoint.path}`,
          description: 'A declared non-destructive endpoint.',
          required: endpoint.required === true,
        },
        async (): Promise<CheckOutcome> => {
          if (endpoint.requiresAuthentication) {
            return {
              status: 'unavailable',
              target: joinPath(resolvedTargetUrl, endpoint.path),
              errorCode: 'requires_credentials',
              errorMessage: 'This endpoint requires credentials Builders does not hold.',
            };
          }

          const url = joinPath(resolvedTargetUrl, endpoint.path);
          const { result, attempts } = await fetchWithWarmUp(
            url,
            httpOptions({ method: endpoint.method, timeoutMs: endpoint.timeoutMs ?? params.requestTimeoutMs }),
            warmUp,
            sleep,
            now,
          );

          if (!result.ok) {
            return {
              status: 'failed',
              target: url,
              expected: `HTTP ${endpoint.expectedStatus}`,
              actual: result.code,
              evidence: fetchFailureEvidence(result),
              errorCode: result.code,
              errorMessage: describeFetchFailure(result),
              retryable: isTransientFetchFailure(result.code),
              attempts,
            };
          }

          const statusOk = result.status === endpoint.expectedStatus;
          const typeOk =
            !endpoint.expectedContentType ||
            (result.contentType ?? '').toLowerCase().includes(endpoint.expectedContentType.toLowerCase());

          return {
            status: statusOk && typeOk ? 'passed' : 'failed',
            target: url,
            expected: `HTTP ${endpoint.expectedStatus}${endpoint.expectedContentType ? ` (${endpoint.expectedContentType})` : ''}`,
            actual: `HTTP ${result.status}${result.contentType ? ` (${result.contentType})` : ''}`,
            evidence: fetchFailureEvidence(result),
            errorCode: statusOk && typeOk ? undefined : 'endpoint_contract',
            errorMessage:
              statusOk && typeOk ? undefined : 'The declared endpoint did not respond with its declared contract.',
            retryable: isTransientHttpStatus(result.status),
            attempts,
          };
        },
      );
    }
  }

  if (cancelled()) {
    return finalise('cancelled', finalUrl);
  }

  return finalise(undefined, finalUrl);
}

function routeSpec(route: PlannedRouteCheck, category: 'route' | 'authentication'): CheckSpec {
  return {
    id: `${category}:${route.path}`,
    category,
    name: category === 'authentication' ? `Auth route ${route.path}` : `Route ${route.path}`,
    description:
      category === 'authentication'
        ? 'The declared authentication page is served. Readiness only — no sign-in is attempted.'
        : route.required
          ? 'A declared application route that must respond.'
          : 'A declared application route. Advisory.',
    required: route.required,
  };
}

async function verifyRoute(
  route: PlannedRouteCheck,
  baseUrl: string,
  rootOk: boolean,
  httpOptions: (overrides?: Partial<SafeFetchOptions>) => SafeFetchOptions,
  warmUp: Required<WarmUpOptions>,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<CheckOutcome> {
  if (!rootOk) {
    return { status: 'skipped', errorMessage: 'The root route did not respond, so this route was not checked.' };
  }

  const url = joinPath(baseUrl, route.path);
  const { result, attempts } = await fetchWithWarmUp(url, httpOptions(), warmUp, sleep, now);

  if (!result.ok) {
    return {
      status: result.code === 'cancelled' ? 'skipped' : 'failed',
      target: url,
      expected: 'HTTP 2xx',
      actual: result.code,
      evidence: fetchFailureEvidence(result),
      errorCode: result.code,
      errorMessage: describeFetchFailure(result),
      retryable: isTransientFetchFailure(result.code),
      attempts,
    };
  }

  const statusOk = result.status >= 200 && result.status < 300;

  /*
   * A client-rendered SPA serves the SAME shell for every route, so a route "responding" means the
   * shell was served for it — and an error page served at 200 is still a failure (same rule as the
   * root check).
   */
  const errorPage = detectErrorPage(result.body, result.headers['x-vercel-error']);

  if (statusOk && errorPage.detected) {
    return {
      status: 'failed',
      target: url,
      expected: 'The application shell',
      actual: errorPage.reason,
      evidence: { ...fetchFailureEvidence(result), pattern: errorPage.code ?? 'unknown' },
      errorCode: errorPage.code,
      errorMessage: `${route.path} returned an error page instead of the application. ${errorPage.reason}`,
      attempts,
    };
  }

  return {
    status: statusOk ? 'passed' : 'failed',
    target: url,
    expected: 'HTTP 2xx',
    actual: `HTTP ${result.status}`,
    evidence: fetchFailureEvidence(result),
    errorCode: statusOk ? undefined : 'http_status',
    errorMessage: statusOk ? undefined : `${route.path} returned HTTP ${result.status}.`,
    retryable: !statusOk && isTransientHttpStatus(result.status),
    attempts,
  };
}

/**
 * Part 10 — safe Supabase checks only. Never uses a service-role key, a database password or the
 * Management API PAT; none of those are even reachable from here. The only credential that can be
 * involved is the operator-supplied PUBLIC anon key, used for a single read-only REST request and
 * never written anywhere.
 */
async function runSupabaseChecks(
  run: VerificationRun,
  policy: VerificationPolicy,
  params: VerifyDeploymentParams,
  httpOptions: (overrides?: Partial<SafeFetchOptions>) => SafeFetchOptions,
  warmUp: Required<WarmUpOptions>,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<void> {
  if (!policy.supabase.enabled) {
    run.skip(
      {
        id: 'database.not_configured',
        category: 'database',
        name: 'Supabase connectivity',
        description: 'Checked only when a Supabase project is attached to this Deployment.',
        required: false,
      },
      'This Deployment has no Supabase connection.',
    );

    return;
  }

  const configuredUrl = policy.supabase.projectUrl;
  const expectedUrl = expectedSupabaseUrlForRef(policy.supabase.projectRef);

  const urlCheck = await run.run(
    {
      id: 'database.supabase_url',
      category: 'database',
      name: 'Supabase project URL',
      description: 'The configured Supabase URL is valid and belongs to the expected project reference.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      const validation = validateVerificationUrl(configuredUrl);

      if (!validation.ok) {
        return {
          status: 'failed',
          target: configuredUrl,
          expected: expectedUrl ?? 'A public https:// Supabase URL',
          actual: configuredUrl ?? '(none)',
          errorCode: validation.code,
          errorMessage: `The Deployment's Supabase URL is not usable: ${validation.message}`,
        };
      }

      if (!expectedUrl) {
        return {
          status: 'unavailable',
          target: validation.url.toString(),
          expected: 'A URL matching the recorded project reference',
          actual: validation.url.origin,
          errorCode: 'unknown_project_ref',
          errorMessage:
            'No recognisable Supabase project reference is recorded, so the URL could not be matched to a project.',
        };
      }

      const matches = validation.url.origin === new URL(expectedUrl).origin;

      return {
        status: matches ? 'passed' : 'failed',
        target: validation.url.toString(),
        expected: expectedUrl,
        actual: validation.url.origin,
        evidence: { projectRef: policy.supabase.projectRef ?? null },
        errorCode: matches ? undefined : 'project_ref_mismatch',
        errorMessage: matches
          ? undefined
          : 'The configured Supabase URL does not belong to the Supabase project recorded on this Deployment.',
      };
    },
  );

  const reachable = await run.run(
    {
      id: 'database.supabase_reachable',
      category: 'database',
      name: 'Supabase endpoint reachable',
      description: 'The Supabase project answers its public health endpoint.',
      required: true,
    },
    async (): Promise<CheckOutcome> => {
      if (!configuredUrl || urlCheck.status === 'failed') {
        return { status: 'skipped', errorMessage: 'The Supabase URL is not usable.' };
      }

      const url = joinPath(configuredUrl, '/auth/v1/health');
      const { result, attempts } = await fetchWithWarmUp(url, httpOptions(), warmUp, sleep, now);

      if (!result.ok) {
        return {
          status: result.code === 'cancelled' ? 'skipped' : 'failed',
          target: url,
          expected: 'A response from the Supabase project',
          actual: result.code,
          evidence: fetchFailureEvidence(result),
          errorCode: result.code,
          errorMessage: `The Supabase project could not be reached — it may have been paused or deleted. (${describeFetchFailure(result)})`,
          retryable: isTransientFetchFailure(result.code),
          attempts,
        };
      }

      /*
       * A deleted or non-existent project ref does not 200 — Supabase's edge returns a 5xx/404 for
       * an unknown subdomain. Anything below 500 proves the project answered, which is all this
       * check claims.
       */
      const alive = result.status < 500;

      return {
        status: alive ? 'passed' : 'failed',
        target: url,
        expected: 'HTTP < 500 from the Supabase project',
        actual: `HTTP ${result.status}`,
        evidence: fetchFailureEvidence(result),
        errorCode: alive ? undefined : 'supabase_unavailable',
        errorMessage: alive
          ? undefined
          : `The Supabase project returned HTTP ${result.status} — check that the project is active and not paused.`,
        retryable: !alive && isTransientHttpStatus(result.status),
        attempts,
      };
    },
  );

  await run.run(
    {
      id: 'database.functional_query',
      category: 'database',
      name: 'Supabase read-only query',
      description:
        'A single read-only REST request using the public anon key, when the operator supplied one for this run. Advisory.',
      required: false,
    },
    async (): Promise<CheckOutcome> => {
      if (reachable.status !== 'passed' || !configuredUrl) {
        return { status: 'skipped', errorMessage: 'The Supabase endpoint was not reachable.' };
      }

      if (!params.supabaseAnonKey) {
        /*
         * Part 10's explicit instruction: when no safe query is possible, report `unavailable`
         * rather than fabricating success. Builders never persists the anon key
         * (`environmentReadinessService.ts` deliberately leaves `VITE_SUPABASE_ANON_KEY`
         * unresolved and value-less), so this is the normal outcome unless the operator typed one
         * into the deploy dialog during this session.
         */
        return {
          status: 'unavailable',
          target: configuredUrl,
          errorCode: 'no_public_key',
          errorMessage:
            'No public Supabase anon key was supplied for this run, so functional database access could not be verified.',
        };
      }

      const url = joinPath(configuredUrl, '/rest/v1/');
      const result = await safeFetch(
        url,
        httpOptions({
          method: 'GET',

          // The key travels as a header, never in the URL, and is dropped on any cross-origin redirect.
          headers: { apikey: params.supabaseAnonKey, Authorization: `Bearer ${params.supabaseAnonKey}` },
        }),
      );

      if (!result.ok) {
        return {
          status: 'warning',
          target: url,
          expected: 'HTTP 2xx from the REST endpoint',
          actual: result.code,
          evidence: fetchFailureEvidence(result),
          errorCode: result.code,
          errorMessage: describeFetchFailure(result),
        };
      }

      const authorised = result.status >= 200 && result.status < 300;

      return {
        status: authorised ? 'passed' : 'warning',
        target: url,
        expected: 'HTTP 2xx from the REST endpoint',
        actual: `HTTP ${result.status}`,
        evidence: { status: result.status },
        errorCode: authorised ? undefined : 'anon_key_rejected',
        errorMessage: authorised
          ? undefined
          : `The Supabase REST endpoint rejected the supplied public key (HTTP ${result.status}).`,
      };
    },
  );

  if (policy.authentication.enabled) {
    await run.run(
      {
        id: 'authentication.supabase_endpoint',
        category: 'authentication',
        name: 'Supabase auth endpoint',
        description:
          'The Supabase auth service answers. Readiness only — no user is created and no sign-in is attempted.',
        required: false,
      },
      async (): Promise<CheckOutcome> => {
        if (reachable.status !== 'passed') {
          return { status: 'skipped', errorMessage: 'The Supabase endpoint was not reachable.' };
        }

        return {
          status: 'passed',
          target: joinPath(configuredUrl as string, '/auth/v1/health'),
          expected: 'The Supabase auth service responds',
          actual: 'reachable',
        };
      },
    );
  }
}

function describeReport(status: VerificationReport['status'], summary: VerificationReport['summary']): string {
  switch (status) {
    case 'passed':
      return `Verification passed — ${summary.requiredPassed}/${summary.requiredTotal} required checks passed.`;
    case 'warning':
      return `Verification passed with ${summary.warnings + summary.unavailable} advisory item(s) — ${summary.requiredPassed}/${summary.requiredTotal} required checks passed.`;
    case 'failed':
      return summary.blockingFailure
        ? `Verification failed — ${summary.blockingFailure.name}: ${summary.blockingFailure.errorMessage ?? 'required check failed'}`
        : 'Verification failed.';
    case 'cancelled':
      return 'Verification was cancelled.';
    case 'incomplete':
      return 'Verification could not be completed — one or more required checks could not be evaluated.';
    default:
      return 'Verification is running.';
  }
}
