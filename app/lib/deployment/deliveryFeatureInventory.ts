import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import type {
  DeliveryFeature,
  DeliveryFeatureInventory,
  DeliveryFeatureState,
  DeliveryFeatureVerificationState,
} from '~/lib/deployment/deliveryPackageTypes';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeploymentVerification } from '~/lib/deployment/verificationTypes';
import type { Feature } from '~/lib/features/featureTypes';

/**
 * Delivery Feature Inventory — Sprint 93, Part 3.
 *
 * Builds the "what was actually delivered" list from GROUNDED sources only:
 *
 *  1. `builders_features` — the promoted Feature registry (the AI Product Owner's committed MVP
 *     scope, already validated and persisted). This is the primary source.
 *  2. `ApplicationManifest.featureScope.outOfScopeFeatureDescriptions` — scope explicitly DEFERRED
 *     at generation time. Free text by construction (a deferred feature never gets an id minted —
 *     see `GenerationPlanScope`), so these are listed as `future`, never as delivered.
 *  3. `ApplicationManifest.routes` — the routing that was really generated (Sprint 92, Part 8),
 *     used only as a fallback when the Feature registry is empty, so a legacy/no-MVP project still
 *     produces an honest inventory instead of an empty one.
 *  4. Connected providers — a Supabase connection is a real, delivered capability.
 *
 * NOTHING is inferred from a project or page NAME (Part 3's explicit prohibition). A route-derived
 * entry is labelled as a page, with its own evidence line saying exactly that.
 *
 * Pure and total.
 */

export interface FeatureInventoryInput {
  features: Feature[];
  manifest: ApplicationManifest | null;
  deployment: DeploymentWithProviders;
  verification: DeploymentVerification | null;
}

/** MoSCoW priorities that mark a feature as explicitly optional rather than committed. */
const OPTIONAL_PRIORITIES = new Set(['Could Have', "Won't Have"]);

/** `Feature.status` values that mean generated code for this feature exists. */
const IMPLEMENTED_STATUSES = new Set(['generated', 'qa_passed', 'deployed']);

function normalisePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Whether the latest verification actually exercised the live application successfully. A feature
 * can only be `verified` if this is true — the Feature registry's own `deployed` status only says
 * code was deployed, never that the running application was checked.
 */
function deploymentIsVerified(verification: DeploymentVerification | null): boolean {
  return verification !== null && (verification.status === 'passed' || verification.status === 'warning');
}

function resolveFeatureState(feature: Feature, verified: boolean): DeliveryFeatureState {
  if (feature.priority && OPTIONAL_PRIORITIES.has(feature.priority)) {
    return 'optional';
  }

  if (!IMPLEMENTED_STATUSES.has(feature.status)) {
    return 'future';
  }

  return verified && feature.status === 'deployed' ? 'verified' : 'implemented';
}

function resolveVerificationState(
  state: DeliveryFeatureState,
  verification: DeploymentVerification | null,
): DeliveryFeatureVerificationState {
  if (!verification) {
    return 'unavailable';
  }

  if (state === 'verified') {
    return 'verified';
  }

  return state === 'future' || state === 'optional' ? 'unavailable' : 'not_verified';
}

export function buildFeatureInventory(input: FeatureInventoryInput): DeliveryFeatureInventory {
  const { features, manifest, deployment, verification } = input;
  const verified = deploymentIsVerified(verification);
  const entries: DeliveryFeature[] = [];

  for (const feature of features) {
    const state = resolveFeatureState(feature, verified);

    entries.push({
      code: feature.code,
      title: feature.title,
      description: feature.description,
      priority: feature.priority,
      state,
      verificationState: resolveVerificationState(state, verification),
      source: 'feature_registry',
      evidence:
        state === 'verified'
          ? `Feature status "${feature.status}" in the Feature registry, on a deployment whose verification ${verification?.status}.`
          : `Feature status "${feature.status}" in the Feature registry.`,
    });
  }

  /*
   * Fallback only. A project with a Feature registry already describes its scope properly; adding
   * route-derived entries alongside real Features would double-count the same delivery.
   */
  if (features.length === 0) {
    for (const route of manifest?.routes ?? []) {
      const path = normalisePath(route.path);
      const routeCheck = verification?.checks.find(
        (check) => check.id === `route:${path}` || (path === '/' && check.id === 'availability.http_response'),
      );
      const routeVerified = routeCheck?.status === 'passed';

      entries.push({
        code: `PAGE${path === '/' ? ':root' : path}`,
        title: route.name || path,
        description: `Generated application page served at ${path}.`,
        state: routeVerified ? 'verified' : 'implemented',
        verificationState: !verification ? 'unavailable' : routeVerified ? 'verified' : 'not_verified',
        source: 'manifest_routes',
        evidence: routeVerified
          ? `Declared in the Application Manifest and confirmed by verification check "${routeCheck?.id}".`
          : 'Declared in the Application Manifest as a generated page. No Feature registry entry exists for this project.',
      });
    }
  }

  if (deployment.supabase) {
    const databaseVerified =
      verification?.checks.some((check) => check.id === 'database.supabase_reachable' && check.status === 'passed') ??
      false;

    entries.push({
      code: 'CAP:database',
      title: 'Managed database (Supabase)',
      description: 'The application is connected to a managed Supabase project.',
      state: 'connected',
      verificationState: !verification ? 'unavailable' : databaseVerified ? 'verified' : 'not_verified',
      source: 'provider',
      evidence: databaseVerified
        ? 'The Supabase provider row is connected and its public endpoint responded during verification.'
        : 'A Supabase provider row is attached to this Deployment.',
    });
  }

  const configuredVariables = (manifest?.environmentRequirements ?? []).length;

  if (configuredVariables > 0) {
    entries.push({
      code: 'CAP:runtime_configuration',
      title: 'Runtime configuration',
      description: `${configuredVariables} environment variable(s) are wired into the deployed application.`,
      state: 'configured',
      verificationState: 'unavailable',
      source: 'manifest_scope',
      evidence: "From the Application Manifest's declared environment requirements.",
    });
  }

  for (const description of manifest?.featureScope?.outOfScopeFeatureDescriptions ?? []) {
    entries.push({
      code: `FUTURE:${description.slice(0, 40)}`,
      title: description,
      state: 'future',
      verificationState: 'unavailable',
      source: 'manifest_scope',
      evidence: 'Explicitly deferred during MVP scoping — recorded on the Application Manifest as out of scope.',
    });
  }

  return {
    features: entries,
    implementedCount: entries.filter((entry) => entry.state === 'implemented' || entry.state === 'verified').length,
    verifiedCount: entries.filter((entry) => entry.state === 'verified').length,
    futureCount: entries.filter((entry) => entry.state === 'future').length,
    optionalCount: entries.filter((entry) => entry.state === 'optional').length,
  };
}
