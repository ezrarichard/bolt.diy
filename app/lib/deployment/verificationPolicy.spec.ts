import { describe, expect, it } from 'vitest';
import type { ApplicationManifest, ManifestRouteDeclaration } from '~/lib/application-manifest/manifestTypes';
import type { DeploymentSupabase, DeploymentVercel } from '~/lib/deployment/deploymentTypes';
import {
  discoverVerifiableRoutes,
  expectedSupabaseUrlForRef,
  isAuthenticationRoute,
  isDynamicRoute,
  isSafeVerifiableRoute,
  MAX_VERIFIABLE_ROUTES,
  resolveVerificationPolicy,
  VERIFICATION_POLICY_VERSION,
} from './verificationPolicy';

function route(path: string, name = path): ManifestRouteDeclaration {
  return { path, name, componentName: 'X', filePath: `src/pages/X.tsx` };
}

function supabaseRow(overrides: Partial<DeploymentSupabase> = {}): DeploymentSupabase {
  return {
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
  };
}

function vercelRow(): DeploymentVercel {
  return {
    id: 'vc-1',
    deploymentId: 'dep-1',
    projectId: 'proj-1',
    vercelProjectId: 'p1',
    vercelProjectName: 'my-app',
    status: 'connected',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  };
}

function manifest(overrides: Partial<ApplicationManifest> = {}): ApplicationManifest {
  return {
    routes: [],
    requiredServices: [],
    verificationEndpoints: [],
    ...overrides,
  } as unknown as ApplicationManifest;
}

describe('route safety', () => {
  it('rejects dynamic routes', () => {
    expect(isDynamicRoute('/orders/:id')).toBe(true);
    expect(isDynamicRoute('/docs/*')).toBe(true);
    expect(isDynamicRoute('/blog/[slug]')).toBe(true);
    expect(isDynamicRoute('/about')).toBe(false);
  });

  it('rejects destructive and privileged routes', () => {
    for (const path of [
      '/logout',
      '/sign-out',
      '/account/delete',
      '/admin',
      '/checkout',
      '/billing',
      '/webhooks/stripe',
      '/api/health',
      '/settings/reset',
    ]) {
      expect(isSafeVerifiableRoute(path)).toBe(false);
    }
  });

  it('accepts ordinary application routes', () => {
    for (const path of ['/', '/about', '/appointments', '/contact-us']) {
      expect(isSafeVerifiableRoute(path)).toBe(true);
    }
  });

  it('identifies declared authentication routes', () => {
    expect(isAuthenticationRoute('/login')).toBe(true);
    expect(isAuthenticationRoute('/sign-up')).toBe(true);
    expect(isAuthenticationRoute('/auth/callback')).toBe(true);
    expect(isAuthenticationRoute('/about')).toBe(false);
  });
});

describe('discoverVerifiableRoutes', () => {
  it('returns nothing when no routes are declared', () => {
    expect(discoverVerifiableRoutes(undefined)).toEqual({ routes: [], authenticationRoutes: [], excluded: [] });
  });

  it('excludes the root route (covered by the availability checks) and marks the first other route required', () => {
    const discovered = discoverVerifiableRoutes([route('/'), route('/about'), route('/services')]);

    expect(discovered.routes.map((r) => r.path)).toEqual(['/about', '/services']);
    expect(discovered.routes[0].required).toBe(true);
    expect(discovered.routes[1].required).toBe(false);
  });

  it('separates authentication routes from ordinary ones', () => {
    const discovered = discoverVerifiableRoutes([route('/'), route('/login', 'Sign in'), route('/about')]);

    expect(discovered.authenticationRoutes.map((r) => r.path)).toEqual(['/login']);
    expect(discovered.routes.map((r) => r.path)).toEqual(['/about']);
  });

  it('excludes unsafe and dynamic routes with a stated reason', () => {
    const discovered = discoverVerifiableRoutes([route('/logout'), route('/orders/:id')]);

    expect(discovered.routes).toHaveLength(0);
    expect(discovered.excluded.map((e) => e.path)).toEqual(['/logout', '/orders/:id']);
    expect(discovered.excluded[1].reason).toMatch(/Dynamic/);
  });

  it('bounds the route list', () => {
    const declarations = Array.from({ length: 12 }, (_, index) => route(`/page-${index}`));
    const discovered = discoverVerifiableRoutes(declarations);

    expect(discovered.routes).toHaveLength(MAX_VERIFIABLE_ROUTES);
    expect(discovered.excluded.length).toBe(12 - MAX_VERIFIABLE_ROUTES);
  });
});

describe('resolveVerificationPolicy', () => {
  const base = { targetUrl: 'https://app.vercel.app', deployment: { supabase: null, vercel: vercelRow() } };

  it('pins the policy version into the plan', () => {
    const policy = resolveVerificationPolicy({ ...base, manifest: null });
    expect(policy.version).toBe(VERIFICATION_POLICY_VERSION);
  });

  it('disables Supabase checks when no Supabase provider is attached', () => {
    const policy = resolveVerificationPolicy({ ...base, manifest: null });
    expect(policy.supabase.enabled).toBe(false);
  });

  it('enables Supabase checks from the attached provider row, never from a project name', () => {
    const policy = resolveVerificationPolicy({
      ...base,
      deployment: { supabase: supabaseRow(), vercel: vercelRow() },
      manifest: null,
    });

    expect(policy.supabase).toMatchObject({
      enabled: true,
      projectRef: 'abcdefghijklmnopqrst',
      projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    });
  });

  it('enables authentication checks only when the routing declares an auth route', () => {
    expect(
      resolveVerificationPolicy({ ...base, manifest: manifest({ routes: [route('/about')] }) }).authentication.enabled,
    ).toBe(false);
    expect(
      resolveVerificationPolicy({ ...base, manifest: manifest({ routes: [route('/login')] }) }).authentication.enabled,
    ).toBe(true);
  });

  it('accepts only explicitly non-destructive GET/HEAD API endpoints', () => {
    const policy = resolveVerificationPolicy({
      ...base,
      manifest: manifest({
        verificationEndpoints: [
          { path: '/api/health', method: 'GET', expectedStatus: 200, nonDestructive: true },
          { path: '/api/reset', method: 'GET', expectedStatus: 200, nonDestructive: false },
        ],
      }),
    });

    expect(policy.api.endpoints.map((endpoint) => endpoint.path)).toEqual(['/api/health']);
  });

  it('plans no API checks by default — a safe endpoint is never inferred', () => {
    expect(resolveVerificationPolicy({ ...base, manifest: manifest() }).api.endpoints).toEqual([]);
  });
});

describe('expectedSupabaseUrlForRef', () => {
  it('derives the expected URL for a well-formed ref', () => {
    expect(expectedSupabaseUrlForRef('abcdefghijklmnopqrst')).toBe('https://abcdefghijklmnopqrst.supabase.co');
  });

  it('returns null rather than fabricating an expectation for an unrecognised ref', () => {
    expect(expectedSupabaseUrlForRef(undefined)).toBeNull();
    expect(expectedSupabaseUrlForRef('short')).toBeNull();
    expect(expectedSupabaseUrlForRef('WITH-UPPERCASE-CHARS!')).toBeNull();
  });
});
