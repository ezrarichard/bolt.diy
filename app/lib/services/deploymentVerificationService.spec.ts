import { describe, expect, it, vi } from 'vitest';
import type { ApplicationManifest, ManifestRouteDeclaration } from '~/lib/application-manifest/manifestTypes';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { VerificationCheck, VerificationProgress } from '~/lib/deployment/verificationTypes';
import { resolveVerificationTarget, verifyDeployment } from './deploymentVerificationService';

/**
 * Every test here injects `fetchImpl`/`sleep`/`now`, so the suite never touches a real URL and
 * never waits on a real warm-up delay (Part 25).
 */

const APP_HTML = `<!doctype html><html><head><title>Riverside Dental Clinic</title>
<script type="module" src="/assets/index-a1b2c3.js"></script>
<link rel="stylesheet" href="/assets/index-d4e5f6.css" /></head>
<body><div id="root"></div></body></html>`;

function response(init: { status?: number; headers?: Record<string, string>; body?: string } = {}): Response {
  return {
    status: init.status ?? 200,
    headers: new Headers({
      'content-type': 'text/html; charset=utf-8',

      // A well-configured deployment. The "missing security headers" case is asserted separately.
      'strict-transport-security': 'max-age=63072000',
      'x-content-type-options': 'nosniff',
      ...(init.headers ?? {}),
    }),
    text: async () => init.body ?? APP_HTML,
    body: null,
  } as unknown as Response;
}

function deployment(overrides: Partial<DeploymentWithProviders> = {}): DeploymentWithProviders {
  return {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'deployed',
    environment: 'preview',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    github: null,
    supabase: null,
    vercel: {
      id: 'vc-1',
      deploymentId: 'dep-1',
      projectId: 'proj-1',
      vercelProjectId: 'p1',
      vercelProjectName: 'my-app',
      productionUrl: 'my-app.vercel.app',
      status: 'connected',
      metadata: {
        latestDeploymentId: 'dpl_1',
        latestDeploymentUrl: 'my-app-abc123.vercel.app',
        latestDeploymentState: 'READY',
      },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    },
    ...overrides,
  };
}

function manifest(routes: ManifestRouteDeclaration[] = []): ApplicationManifest {
  return { routes, requiredServices: [], verificationEndpoints: [] } as unknown as ApplicationManifest;
}

function route(path: string): ManifestRouteDeclaration {
  return { path, name: path, componentName: 'X', filePath: 'src/pages/X.tsx' };
}

/** Routes every request to a matching handler; unmatched requests 404, which surfaces accidental extra requests. */
function router(handlers: Array<[RegExp, () => Response]>): typeof fetch {
  return vi.fn(async (url: string) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(url)) {
        return handler();
      }
    }

    return response({ status: 404, body: '<html><body>404</body></html>' });
  }) as unknown as typeof fetch;
}

function run(params: Partial<Parameters<typeof verifyDeployment>[0]> = {}) {
  let clock = 0;

  return verifyDeployment({
    deployment: deployment(),
    manifest: manifest(),
    fetchImpl: router([[/.*/, () => response()]]),
    now: () => (clock += 10),
    clock: () => new Date(1_800_000_000_000 + clock).toISOString(),
    sleep: async () => undefined,
    ...params,
  });
}

function find(checks: VerificationCheck[], id: string): VerificationCheck {
  const check = checks.find((candidate) => candidate.id === id);

  if (!check) {
    throw new Error(`No check "${id}" in [${checks.map((candidate) => candidate.id).join(', ')}]`);
  }

  return check;
}

describe('resolveVerificationTarget', () => {
  it('prefers the latest deployment URL over the long-lived production alias (Part 17)', () => {
    expect(resolveVerificationTarget(deployment())).toEqual({
      url: 'https://my-app-abc123.vercel.app',
      vercelDeploymentId: 'dpl_1',
    });
  });

  it('falls back to the production URL and normalises the scheme', () => {
    const target = resolveVerificationTarget(
      deployment({
        vercel: { ...deployment().vercel!, metadata: {}, productionUrl: 'my-app.vercel.app' },
      }),
    );

    expect(target.url).toBe('https://my-app.vercel.app');
  });

  it('returns nothing when no Vercel provider is attached', () => {
    expect(resolveVerificationTarget(deployment({ vercel: null }))).toEqual({});
  });
});

describe('verifyDeployment — availability', () => {
  it('passes a healthy deployment serving the generated shell', async () => {
    const report = await run();

    expect(report.status).toBe('passed');
    expect(report.summary.requiredFailed).toBe(0);
    expect(find(report.checks, 'availability.http_response').status).toBe('passed');
    expect(find(report.checks, 'application.shell').status).toBe('passed');
    expect(report.vercelDeploymentId).toBe('dpl_1');
  });

  it('fails when there is no deployment URL, and does not attempt any request', async () => {
    const fetchImpl = vi.fn();
    const report = await run({
      deployment: deployment({ vercel: { ...deployment().vercel!, metadata: {}, productionUrl: undefined } }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.status).toBe('failed');
    expect(find(report.checks, 'availability.preview_url')).toMatchObject({
      status: 'failed',
      errorCode: 'missing_url',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on an invalid URL', async () => {
    const report = await run({ targetUrl: 'https://' });

    expect(find(report.checks, 'availability.preview_url').errorCode).toBe('invalid_url');
  });

  it('refuses a private-network target', async () => {
    const report = await run({ targetUrl: 'https://10.0.0.5' });

    expect(find(report.checks, 'availability.preview_url').errorCode).toBe('blocked_host');
    expect(report.status).toBe('failed');
  });

  it('follows a safe redirect and records the final URL', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 308, headers: { location: 'https://my-app-abc123.vercel.app/home' } }))
      .mockResolvedValue(response());

    const report = await run({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(report.finalUrl).toBe('https://my-app-abc123.vercel.app/home');
    expect(find(report.checks, 'availability.http_response').status).toBe('passed');
  });

  it('fails on HTTP 500 with an actionable message', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ status: 500, body: 'error' })]]),
    });

    expect(report.status).toBe('failed');
    expect(find(report.checks, 'availability.http_response')).toMatchObject({
      status: 'failed',
      errorCode: 'http_status',
    });
    expect(report.summary.blockingFailure?.errorMessage).toMatch(/runtime logs/i);
  });

  it('fails when the deployment cannot be reached at all', async () => {
    const report = await run({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('ENOTFOUND')) as unknown as typeof fetch,
    });

    expect(find(report.checks, 'availability.http_response')).toMatchObject({
      status: 'failed',
      errorCode: 'network_error',
      retryable: true,
    });
  });
});

describe('verifyDeployment — warm-up retry (Part 18)', () => {
  it('retries a transient 404 and passes once the alias propagates', async () => {
    let calls = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? response({ status: 404, body: 'not found yet' }) : response();
    }) as unknown as typeof fetch;

    const report = await run({ fetchImpl, sleep });

    const check = find(report.checks, 'availability.http_response');
    expect(check.status).toBe('passed');
    expect(check.attempts).toBe(2);
    expect(sleep).toHaveBeenCalled();
  });

  it('gives up after the bounded attempt count rather than retrying forever', async () => {
    const fetchImpl = vi.fn(async () => response({ status: 503, body: 'warming' })) as unknown as typeof fetch;

    const report = await run({ fetchImpl, warmUp: { maxAttempts: 3, delayMs: 1 } });

    const check = find(report.checks, 'availability.http_response');
    expect(check.status).toBe('failed');
    expect(check.attempts).toBe(3);
  });

  it('does not retry a persistent application error', async () => {
    const fetchImpl = vi.fn(async () => response({ status: 500, body: 'boom' })) as unknown as typeof fetch;

    const report = await run({ fetchImpl });

    expect(find(report.checks, 'availability.http_response').attempts).toBe(1);
  });
});

describe('verifyDeployment — content and error pages', () => {
  it('fails on an empty response body', async () => {
    const report = await run({ fetchImpl: router([[/.*/, () => response({ body: '' })]]) });

    expect(find(report.checks, 'content.body')).toMatchObject({ status: 'failed', errorCode: 'empty_response' });
    expect(report.status).toBe('failed');
  });

  it('fails on a non-HTML content type at the root', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ headers: { 'content-type': 'application/json' }, body: '{}' })]]),
    });

    expect(find(report.checks, 'content.body')).toMatchObject({
      status: 'failed',
      errorCode: 'unexpected_content_type',
    });
  });

  it('fails an HTTP 200 that is really a Vercel error page', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ body: '<html><body>Code: DEPLOYMENT_NOT_FOUND</body></html>' })]]),
    });

    expect(find(report.checks, 'application.error_page')).toMatchObject({
      status: 'failed',
      errorCode: 'vercel_deployment_not_found',
    });
    expect(report.status).toBe('failed');
  });

  it('fails an HTTP 200 carrying the x-vercel-error header', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ headers: { 'x-vercel-error': 'NOT_FOUND' } })]]),
    });

    expect(find(report.checks, 'application.error_page').errorCode).toBe('vercel_error_header');
  });

  it('fails a blank shell with no application bundle', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ body: '<html><body><div id="root"></div></body></html>' })]]),
    });

    expect(find(report.checks, 'application.shell')).toMatchObject({ status: 'failed', errorCode: 'empty_shell' });
  });

  it('fails when the provider itself reports a deployment error', async () => {
    const report = await run({
      deployment: deployment({
        vercel: { ...deployment().vercel!, metadata: { latestDeploymentState: 'ERROR' } },
      }),
    });

    expect(find(report.checks, 'configuration.provider_state')).toMatchObject({
      status: 'failed',
      errorCode: 'provider_error',
    });
  });

  it('reports missing security headers as advisory, never as a failure', async () => {
    const report = await run({
      fetchImpl: router([
        [
          /.*/,
          () =>
            ({
              status: 200,
              headers: new Headers({ 'content-type': 'text/html' }),
              text: async () => APP_HTML,
              body: null,
            }) as unknown as Response,
        ],
      ]),
    });

    const check = find(report.checks, 'security.headers');
    expect(check).toMatchObject({ status: 'warning', required: false, errorCode: 'missing_security_headers' });
    expect(report.summary.requiredFailed).toBe(0);
    expect(report.status).toBe('warning');
  });

  it('reports response time as advisory, never as a failure', async () => {
    let clock = 0;
    const report = await run({ now: () => (clock += 5000) });

    const check = find(report.checks, 'performance.response_time');
    expect(check.required).toBe(false);
    expect(check.status).toBe('warning');
    expect(report.summary.requiredFailed).toBe(0);
  });
});

describe('verifyDeployment — routes', () => {
  it('verifies declared routes, requiring only the first', async () => {
    const report = await run({ manifest: manifest([route('/'), route('/about'), route('/services')]) });

    expect(find(report.checks, 'route:/about')).toMatchObject({ status: 'passed', required: true });
    expect(find(report.checks, 'route:/services')).toMatchObject({ status: 'passed', required: false });
  });

  it('fails the report when a required route fails', async () => {
    const report = await run({
      manifest: manifest([route('/about')]),
      fetchImpl: router([
        [/\/about$/, () => response({ status: 404, body: '<html><body>nope</body></html>' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'route:/about').status).toBe('failed');
    expect(report.status).toBe('failed');
  });

  it('downgrades an optional route failure to a warning, keeping the report verifiable', async () => {
    const report = await run({
      manifest: manifest([route('/about'), route('/services')]),
      fetchImpl: router([
        [/\/services$/, () => response({ status: 500, body: 'boom' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'route:/services').status).toBe('warning');
    expect(report.status).toBe('warning');
    expect(report.summary.requiredFailed).toBe(0);
  });

  it('fails a route that returns an error page under HTTP 200', async () => {
    const report = await run({
      manifest: manifest([route('/about')]),
      fetchImpl: router([
        [/\/about$/, () => response({ body: '<html><body>FUNCTION_INVOCATION_FAILED</body></html>' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'route:/about').status).toBe('failed');
  });

  it('skips unsafe routes with a stated reason instead of probing them', async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as typeof fetch;
    const report = await run({ manifest: manifest([route('/logout')]), fetchImpl });

    expect(find(report.checks, 'route:/logout').status).toBe('skipped');
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.some((call) => String(call[0]).includes('logout')),
    ).toBe(false);
  });

  it('records that no routes were declared rather than inventing any', async () => {
    const report = await run({ manifest: null });

    expect(find(report.checks, 'route.none_declared').status).toBe('skipped');
  });
});

describe('verifyDeployment — assets', () => {
  it('passes when the critical bundle and stylesheet load', async () => {
    const report = await run();

    expect(find(report.checks, 'asset:script:https://my-app-abc123.vercel.app/assets/index-a1b2c3.js')).toMatchObject({
      status: 'passed',
      required: true,
    });
    expect(
      find(report.checks, 'asset:stylesheet:https://my-app-abc123.vercel.app/assets/index-d4e5f6.css').status,
    ).toBe('passed');
  });

  it('fails when the primary JavaScript bundle is missing', async () => {
    const report = await run({
      fetchImpl: router([
        [/index-a1b2c3\.js$/, () => response({ status: 404 })],
        [/.*/, () => response()],
      ]),
    });

    const check = find(report.checks, 'asset:script:https://my-app-abc123.vercel.app/assets/index-a1b2c3.js');
    expect(check.status).toBe('failed');
    expect(report.status).toBe('failed');
  });

  it('does not fail on a missing third-party asset', async () => {
    const html = APP_HTML.replace(
      '<link rel="stylesheet" href="/assets/index-d4e5f6.css" />',
      '<script src="https://cdn.example.com/analytics.js"></script>',
    );

    const report = await run({
      fetchImpl: router([
        [/cdn\.example\.com/, () => response({ status: 404 })],
        [/.*/, () => response({ body: html })],
      ]),
    });

    expect(find(report.checks, 'asset:script:https://cdn.example.com/analytics.js')).toMatchObject({
      status: 'warning',
      required: false,
    });
    expect(report.summary.requiredFailed).toBe(0);
  });

  it('records that no assets were discovered when the HTML references none', async () => {
    const report = await run({
      fetchImpl: router([[/.*/, () => response({ body: '<html><body><h1>Hi</h1></body></html>' })]]),
    });

    expect(find(report.checks, 'asset.none_discovered').status).toBe('skipped');
  });
});

describe('verifyDeployment — Supabase (Part 10)', () => {
  const withSupabase = (overrides: Record<string, unknown> = {}) =>
    deployment({
      supabase: {
        id: 'sb-1',
        deploymentId: 'dep-1',
        projectId: 'proj-1',
        supabaseProjectRef: 'abcdefghijklmnopqrst',
        supabaseProjectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
        status: 'connected',
        metadata: {},
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
        ...overrides,
      },
    });

  it('skips the whole category when no Supabase project is attached', async () => {
    const report = await run();

    expect(find(report.checks, 'database.not_configured').status).toBe('skipped');
  });

  it('verifies the URL matches the recorded project ref and the endpoint answers', async () => {
    const report = await run({
      deployment: withSupabase(),
      fetchImpl: router([
        [/supabase\.co\/auth\/v1\/health/, () => response({ status: 200, body: '{"ok":true}' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'database.supabase_url').status).toBe('passed');
    expect(find(report.checks, 'database.supabase_reachable').status).toBe('passed');
  });

  it('fails when the configured URL belongs to a different project ref', async () => {
    const report = await run({
      deployment: withSupabase({ supabaseProjectUrl: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }),
    });

    expect(find(report.checks, 'database.supabase_url')).toMatchObject({
      status: 'failed',
      errorCode: 'project_ref_mismatch',
    });
    expect(report.status).toBe('failed');
  });

  it('fails when the Supabase endpoint is unreachable', async () => {
    const report = await run({
      deployment: withSupabase(),
      fetchImpl: router([
        [/supabase\.co/, () => response({ status: 503, body: 'unavailable' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'database.supabase_reachable').status).toBe('failed');
  });

  it('reports the functional query as unavailable when no public key was supplied, rather than fabricating success', async () => {
    const report = await run({ deployment: withSupabase() });

    expect(find(report.checks, 'database.functional_query')).toMatchObject({
      status: 'unavailable',
      errorCode: 'no_public_key',
      required: false,
    });
    expect(report.status).toBe('warning');
  });

  it('uses a supplied public anon key for one read-only request, and never persists it in the report', async () => {
    const fetchImpl = vi.fn(async () => response({ status: 200, body: '{}' })) as unknown as typeof fetch;

    const report = await run({
      deployment: withSupabase(),
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature',
      fetchImpl,
    });

    const restCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).includes('/rest/v1/'),
    );

    expect(restCall?.[1].method).toBe('GET');
    expect(find(report.checks, 'database.functional_query').status).toBe('passed');
    expect(JSON.stringify(report)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});

describe('verifyDeployment — authentication readiness (Part 11)', () => {
  it('records that authentication is not declared, without probing anything', async () => {
    const report = await run();

    expect(find(report.checks, 'authentication.not_declared').status).toBe('skipped');
  });

  it('verifies a declared login route responds', async () => {
    const report = await run({ manifest: manifest([route('/login')]) });

    expect(find(report.checks, 'authentication:/login').status).toBe('passed');
  });

  it('fails when the declared auth route does not respond', async () => {
    const report = await run({
      manifest: manifest([route('/login')]),
      fetchImpl: router([
        [/\/login$/, () => response({ status: 500, body: 'boom' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'authentication:/login').status).toBe('failed');
    expect(report.status).toBe('failed');
  });

  it('never issues a non-GET request anywhere in a run — no user is created, no form is submitted', async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as typeof fetch;

    await run({ manifest: manifest([route('/login'), route('/about')]), fetchImpl });

    const methods = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].method);
    expect(methods.every((method: string) => method === 'GET' || method === 'HEAD')).toBe(true);
  });
});

describe('verifyDeployment — API endpoints (Part 12)', () => {
  it('skips the category when no safe endpoint is declared', async () => {
    const report = await run();

    expect(find(report.checks, 'api.none_declared').status).toBe('skipped');
    expect(report.summary.requiredFailed).toBe(0);
  });

  it('verifies a declared non-destructive endpoint against its declared contract', async () => {
    const report = await run({
      manifest: {
        routes: [],
        verificationEndpoints: [
          { path: '/api/health', method: 'GET', expectedStatus: 200, nonDestructive: true, required: true },
        ],
      } as unknown as ApplicationManifest,
      fetchImpl: router([
        [/\/api\/health$/, () => response({ status: 200, body: 'ok' })],
        [/.*/, () => response()],
      ]),
    });

    expect(find(report.checks, 'api:GET:/api/health').status).toBe('passed');
  });

  it('marks an endpoint needing credentials as unavailable instead of attempting it', async () => {
    const report = await run({
      manifest: {
        routes: [],
        verificationEndpoints: [
          {
            path: '/api/me',
            method: 'GET',
            expectedStatus: 200,
            nonDestructive: true,
            requiresAuthentication: true,
          },
        ],
      } as unknown as ApplicationManifest,
    });

    expect(find(report.checks, 'api:GET:/api/me')).toMatchObject({
      status: 'unavailable',
      errorCode: 'requires_credentials',
    });
  });
});

describe('verifyDeployment — progress and cancellation (Part 20)', () => {
  it('reports structured progress stages', async () => {
    const stages: VerificationProgress[] = [];
    await run({ onProgress: (progress) => stages.push(progress) });

    const names = stages.map((stage) => stage.stage);
    expect(names).toContain('preparing');
    expect(names).toContain('validating_url');
    expect(names).toContain('checking_availability');
    expect(names).toContain('checking_routes');
    expect(names).toContain('finalising_report');
    expect(stages.every((stage) => stage.planned >= stage.completed)).toBe(true);
  });

  it('returns a cancelled report when the operator aborts, without asserting the application failed', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return response();
    }) as unknown as typeof fetch;

    const report = await run({ signal: controller.signal, fetchImpl });

    expect(report.status).toBe('cancelled');
    expect(report.message).toMatch(/cancelled/i);
  });
});

describe('verifyDeployment — project isolation (Part 22)', () => {
  it("never lets one project's URL or checks leak into another project's report", async () => {
    const projectA = deployment({
      id: 'dep-a',
      projectId: 'proj-a',
      vercel: {
        ...deployment().vercel!,
        metadata: { latestDeploymentUrl: 'app-a.vercel.app', latestDeploymentId: 'dpl_a' },
      },
    });
    const projectB = deployment({
      id: 'dep-b',
      projectId: 'proj-b',
      vercel: {
        ...deployment().vercel!,
        metadata: { latestDeploymentUrl: 'app-b.vercel.app', latestDeploymentId: 'dpl_b' },
      },
    });
    const projectC = deployment({
      id: 'dep-c',
      projectId: 'proj-c',
      vercel: {
        ...deployment().vercel!,
        metadata: { latestDeploymentUrl: 'app-c.vercel.app', latestDeploymentId: 'dpl_c' },
      },
    });

    const [reportA, reportB, reportC] = await Promise.all([
      run({ deployment: projectA, manifest: manifest([route('/a-only')]) }),
      run({ deployment: projectB, manifest: manifest([route('/b-only')]) }),
      run({ deployment: projectC, manifest: null }),
    ]);

    expect(reportA.targetUrl).toBe('https://app-a.vercel.app');
    expect(reportB.targetUrl).toBe('https://app-b.vercel.app');
    expect(reportC.targetUrl).toBe('https://app-c.vercel.app');

    expect(reportA.vercelDeploymentId).toBe('dpl_a');
    expect(reportB.vercelDeploymentId).toBe('dpl_b');

    expect(JSON.stringify(reportA)).not.toContain('app-b.vercel.app');
    expect(JSON.stringify(reportB)).not.toContain('/a-only');
    expect(reportC.checks.some((check) => check.id === 'route.none_declared')).toBe(true);
  });
});
