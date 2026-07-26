import type {
  ApplicationManifest,
  ManifestRouteDeclaration,
  ManifestVerificationEndpoint,
} from '~/lib/application-manifest/manifestTypes';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import { deriveSupabaseProjectUrl } from '~/lib/services/supabaseDeployService';

/**
 * Verification Policy — Sprint 92, Parts 3/8/11/12.
 *
 * The verification result must never come from one hard-coded HTTP request, so WHAT gets checked
 * is decided here — declaratively, from grounded sources only — and the engine
 * (`deploymentVerificationService.ts`) merely executes what this returns. Two rules shape
 * everything below:
 *
 *  - Nothing is inferred from a project or page NAME. Routes come from the Application Manifest's
 *    `routes` declarations, which `manifestBuilder.ts` copies verbatim from the same
 *    `GenerationPlanPage.routePath` list `projectScaffolder.ts` writes into the generated
 *    `App.tsx` — i.e. a record of the routing that was really generated. Supabase comes from the
 *    attached `builders_deployment_supabase` row. API endpoints come only from an explicit,
 *    explicitly-non-destructive manifest declaration.
 *  - Everything probed is read-only (Part 4). The route allow-list below is a DENY-list of
 *    anything that could mutate state, plus a rule that only `GET`/`HEAD` is ever issued.
 *
 * `policyVersion` is pinned into every report so an old report stays interpretable after this file
 * changes.
 */

export const VERIFICATION_POLICY_VERSION = '2026-08-07.1';

/** Part 8 — a hard bound on route checks, so verification can never turn into a crawl. Excludes the root route, which the availability checks already cover. */
export const MAX_VERIFIABLE_ROUTES = 4;

/** Part 9 — a hard bound on asset checks. */
export const MAX_VERIFIABLE_ASSETS = 4;

/** Part 3 — advisory only. A slow response is reported, never failed (Part 6 step 6). */
export const RESPONSE_TIME_ADVISORY_MS = 4000;

/**
 * Part 4/8 — routes verification must never touch, because a GET alone can still have effects
 * (session destruction, queued jobs, provider callbacks) or because they need credentials Builders
 * does not hold. Matched against the route path, case-insensitively, on whole path segments.
 */
const UNSAFE_ROUTE_SEGMENTS = [
  'logout',
  'log-out',
  'signout',
  'sign-out',
  'delete',
  'destroy',
  'remove',
  'purge',
  'reset',
  'revoke',
  'cancel',
  'checkout',
  'payment',
  'payments',
  'billing',
  'subscribe',
  'unsubscribe',
  'webhook',
  'webhooks',
  'callback',
  'admin',
  'impersonate',
];

/** Part 11 — route paths that indicate authentication is DECLARED by the generated routing. Never inferred from a product description. */
const AUTHENTICATION_ROUTE_SEGMENTS = ['login', 'sign-in', 'signin', 'signup', 'sign-up', 'register', 'auth'];

function pathSegments(path: string): string[] {
  return path
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

/** A dynamic route (`/orders/:id`, `/docs/*`) needs a parameter value verification cannot invent — Part 8 excludes them outright. */
export function isDynamicRoute(path: string): boolean {
  return path.includes(':') || path.includes('*') || /\[[^\]]+]/.test(path);
}

export function isSafeVerifiableRoute(path: string): boolean {
  if (!path.startsWith('/')) {
    return false;
  }

  if (isDynamicRoute(path)) {
    return false;
  }

  const segments = pathSegments(path);

  if (segments[0] === 'api') {
    // Part 12 — an API path is only ever probed through an explicit `verificationEndpoints` contract.
    return false;
  }

  return !segments.some((segment) => UNSAFE_ROUTE_SEGMENTS.includes(segment));
}

export function isAuthenticationRoute(path: string): boolean {
  return pathSegments(path).some((segment) => AUTHENTICATION_ROUTE_SEGMENTS.includes(segment));
}

function normalisePath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed) {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export interface PlannedRouteCheck {
  path: string;
  name: string;

  /** Part 3 — exactly one non-root application route is required (the "critical declared route" the brief calls for); the rest are advisory so a single optional page never blocks a working deployment. */
  required: boolean;
}

export interface DiscoveredRoutes {
  /** Non-root, safe, bounded application routes. */
  routes: PlannedRouteCheck[];

  /** Declared authentication routes, kept separate so they land in the `authentication` category. */
  authenticationRoutes: PlannedRouteCheck[];

  /** Routes that were declared but deliberately not verified, with the reason — surfaced as `skipped` checks so the operator sees the boundary rather than silently missing coverage. */
  excluded: Array<{ path: string; reason: string }>;
}

/**
 * Part 8 — turns the manifest's declared routes into a bounded, safe check plan. Root is never
 * included here (the availability/content/shell checks already verify it). The FIRST safe
 * non-root route is the required one; every other is advisory.
 */
export function discoverVerifiableRoutes(declarations: ManifestRouteDeclaration[] | undefined): DiscoveredRoutes {
  const excluded: Array<{ path: string; reason: string }> = [];
  const routes: PlannedRouteCheck[] = [];
  const authenticationRoutes: PlannedRouteCheck[] = [];
  const seen = new Set<string>(['/']);

  for (const declaration of declarations ?? []) {
    const path = normalisePath(declaration.path);

    if (seen.has(path)) {
      continue;
    }

    seen.add(path);

    if (isDynamicRoute(path)) {
      excluded.push({ path, reason: 'Dynamic route — verification cannot invent a parameter value.' });
      continue;
    }

    if (!isSafeVerifiableRoute(path)) {
      excluded.push({ path, reason: 'Excluded by the non-destructive route policy.' });
      continue;
    }

    if (isAuthenticationRoute(path)) {
      authenticationRoutes.push({ path, name: declaration.name || path, required: true });
      continue;
    }

    if (routes.length >= MAX_VERIFIABLE_ROUTES) {
      excluded.push({ path, reason: `Beyond the ${MAX_VERIFIABLE_ROUTES}-route verification bound.` });
      continue;
    }

    routes.push({ path, name: declaration.name || path, required: routes.length === 0 });
  }

  return { routes, authenticationRoutes, excluded };
}

export interface VerificationPolicy {
  version: string;

  /** The URL every check is resolved against — already normalised to an absolute `https://` URL by the caller. */
  targetUrl: string;
  routes: PlannedRouteCheck[];
  excludedRoutes: Array<{ path: string; reason: string }>;

  assets: { enabled: boolean; maxAssets: number };

  /** Part 10 — enabled only when a Supabase provider row is actually attached to this Deployment. */
  supabase: { enabled: boolean; projectRef?: string; projectUrl?: string };

  /** Part 11 — enabled only when the generated routing itself declares an auth route. */
  authentication: { enabled: boolean; routes: PlannedRouteCheck[] };

  /** Part 12 — only endpoints explicitly declared `nonDestructive: true`. Empty today: nothing populates `verificationEndpoints` yet, and inferring one is forbidden. */
  api: { endpoints: ManifestVerificationEndpoint[] };

  performance: { advisoryThresholdMs: number };

  /** How many checks this policy plans to run, so the UI's progress bar has a denominator before the run starts (Part 20). */
  plannedCheckCount: number;
}

export interface VerificationPolicyInput {
  targetUrl: string;
  deployment: Pick<DeploymentWithProviders, 'supabase' | 'vercel'>;
  manifest: Pick<ApplicationManifest, 'routes' | 'requiredServices' | 'verificationEndpoints'> | null;
}

/**
 * The fixed checks every policy always includes: preview URL, HTTPS transport, HTTP response,
 * response time, security headers, content present, error page, application shell, provider state.
 * See `deploymentVerificationService.ts` for each one's implementation.
 */
const BASE_CHECK_COUNT = 9;

export function resolveVerificationPolicy(input: VerificationPolicyInput): VerificationPolicy {
  const discovered = discoverVerifiableRoutes(input.manifest?.routes);
  const supabaseRow = input.deployment.supabase;

  const endpoints = (input.manifest?.verificationEndpoints ?? []).filter(
    (endpoint) => endpoint.nonDestructive === true && (endpoint.method === 'GET' || endpoint.method === 'HEAD'),
  );

  const supabase = {
    enabled: Boolean(supabaseRow),
    projectRef: supabaseRow?.supabaseProjectRef,
    projectUrl: supabaseRow?.supabaseProjectUrl,
  };

  const authentication = {
    enabled: discovered.authenticationRoutes.length > 0,
    routes: discovered.authenticationRoutes,
  };

  /*
   * Supabase contributes three checks (URL shape, reachability, functional read-only query — the
   * last always reported `unavailable` today, see the service's own comment); authentication
   * contributes one per declared auth route plus one endpoint-reachability check when Supabase is
   * also present.
   */
  const plannedCheckCount =
    BASE_CHECK_COUNT +
    discovered.routes.length +
    discovered.excluded.length +
    (supabase.enabled ? 3 : 1) +
    (authentication.enabled ? authentication.routes.length : 1) +
    (endpoints.length > 0 ? endpoints.length : 1) +
    MAX_VERIFIABLE_ASSETS;

  return {
    version: VERIFICATION_POLICY_VERSION,
    targetUrl: input.targetUrl,
    routes: discovered.routes,
    excludedRoutes: discovered.excluded,
    assets: { enabled: true, maxAssets: MAX_VERIFIABLE_ASSETS },
    supabase,
    authentication,
    api: { endpoints },
    performance: { advisoryThresholdMs: RESPONSE_TIME_ADVISORY_MS },
    plannedCheckCount,
  };
}

/**
 * Part 10 — the public URL a Supabase project ref must map to. Reuses
 * `supabaseDeployService.deriveSupabaseProjectUrl` (the existing owner of that derivation) rather
 * than repeating the format, so the two can never drift. Used to confirm the CONFIGURED URL really
 * belongs to the expected project ref rather than pointing somewhere else entirely. Returns `null`
 * when the ref is absent or not in Supabase's own 20-character lowercase-alphanumeric format, in
 * which case the check reports `unavailable` rather than fabricating an expectation.
 */
export function expectedSupabaseUrlForRef(projectRef: string | undefined): string | null {
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
    return null;
  }

  return deriveSupabaseProjectUrl(projectRef);
}
