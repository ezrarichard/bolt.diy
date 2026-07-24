import { PROJECT_BLUEPRINTS, DEFAULT_BLUEPRINT_ID } from './registry';
import type {
  ProjectBlueprint,
  BlueprintCategory,
  BlueprintRecommendation,
  BlueprintSystemPrompt,
  BlueprintStarterTemplate,
  BlueprintSuggestedEnvironmentVariable,
  RoadmapItem,
} from './types';

/**
 * Blueprint Engine.
 *
 * The single point of access for blueprint data.
 *
 *   BlueprintRegistry (registry.ts, hardcoded seed data)
 *     -> activeBlueprints (this file's in-memory cache, below)
 *       -> blueprintEngine (this file's public, synchronous API)
 *         -> Project Dashboard, New Project dialog, every AI role's buildContext() (today)
 *
 * Every public method below is still 100% synchronous and still just reads an in-memory
 * array — there is no computation, no AI call, no network request in any of them, and nothing
 * here mutates anything. This is deliberate: every existing call site (27+ across the AI role
 * engines and UI components) calls `blueprintEngine.getBlueprint()`/`getDefaultBlueprint()`/etc.
 * synchronously, with no `await`, and per the Sprint 59 brief none of them may change — so the
 * public API's shape and its output must stay identical no matter where the data underneath it
 * came from.
 *
 * Sprint 59 (Blueprint Foundation) adds `hydrateBlueprints()`, an async, fire-and-forget
 * function (called once at app boot — see `AuthProvider.tsx`) that swaps `activeBlueprints`
 * from the hardcoded `PROJECT_BLUEPRINTS` registry to the same data read back from BuildersDB
 * (`builders_blueprints`, seeded from this exact registry — see
 * supabase/migrations/20260729100000_blueprint_foundation.sql). Every synchronous getter below
 * reads whatever `activeBlueprints` currently holds, so:
 *   - before hydration completes, or if BuildersDB is unconfigured/unreachable/empty: every
 *     getter behaves exactly as it always has (reads the hardcoded registry) — zero behavior
 *     change, invisible to any consumer.
 *   - after a successful hydration: every getter reads BuildersDB-sourced data instead — but
 *     because that data is a byte-for-byte seed of the same registry, every getter's OUTPUT is
 *     still identical. This sprint is infrastructure only; it changes where the data lives, not
 *     what it says.
 * Consumers should never import registry.ts or types.ts directly; import from
 * app/lib/blueprints (the index barrel) and use blueprintEngine so the storage shape can keep
 * changing later without touching a single consumer.
 */

let activeBlueprints: ProjectBlueprint[] = PROJECT_BLUEPRINTS;

/**
 * Sprint 59 — fire-and-forget boot hydration (see `AuthProvider.tsx`'s call site, mirroring
 * `hydrateProjectsFromBuildersDb()`'s own convention exactly). Never throws, never awaited by
 * anything that would block on it, and only swaps `activeBlueprints` when BuildersDB actually
 * returned at least one row — an empty/unavailable/errored result leaves the hardcoded registry
 * in place rather than ever leaving the app with zero blueprints.
 */
export async function hydrateBlueprints(): Promise<void> {
  try {
    const { listActiveBlueprints } = await import('~/lib/builders-db/repositories/blueprintRepository');
    const blueprints = await listActiveBlueprints();

    if (blueprints.length > 0) {
      activeBlueprints = blueprints;
    }
  } catch (error) {
    console.error('[BlueprintEngine] hydrateBlueprints() failed, keeping the built-in registry:', error);
  }
}

function getBlueprint(id: string | undefined): ProjectBlueprint | undefined {
  if (!id) {
    return undefined;
  }

  return activeBlueprints.find((blueprint) => blueprint.id === id);
}

function getAllBlueprints(): ProjectBlueprint[] {
  return activeBlueprints;
}

function getDefaultBlueprint(): ProjectBlueprint {
  const fallback = getBlueprint(DEFAULT_BLUEPRINT_ID);

  if (!fallback) {
    // Registry misconfiguration, not a runtime/user condition — fail loudly.
    throw new Error(`blueprintEngine: default blueprint "${DEFAULT_BLUEPRINT_ID}" is missing from the registry`);
  }

  return fallback;
}

function getRecommendedStack(id: string | undefined): string[] {
  return getBlueprint(id)?.recommendedStack ?? [];
}

function getRecommendedIntegrations(id: string | undefined): string[] {
  return getBlueprint(id)?.recommendedIntegrations ?? [];
}

function getRecommendedNextSteps(id: string | undefined): string[] {
  return getBlueprint(id)?.recommendedNextSteps ?? [];
}

function getBlueprintRecommendation(id: string | undefined): BlueprintRecommendation {
  return {
    stack: getRecommendedStack(id),
    integrations: getRecommendedIntegrations(id),
    nextSteps: getRecommendedNextSteps(id),
  };
}

function getBlueprintCategory(id: string | undefined): BlueprintCategory | undefined {
  return getBlueprint(id)?.category;
}

function getBlueprintProductType(id: string | undefined): string | undefined {
  return getBlueprint(id)?.productType;
}

/**
 * Sprint 8 — the blueprint's structured Project Roadmap (static content
 * only: key/title/description). Per-project status is never stored here —
 * it lives on the project itself (Project.roadmapStatus in
 * app/lib/stores/projects.ts) and is merged in by the caller (the Project
 * Dashboard). This is the only way any consumer should read roadmap data —
 * never import registry.ts directly.
 */
function getRoadmap(id: string | undefined): RoadmapItem[] {
  return getBlueprint(id)?.roadmap ?? [];
}

/*
 * ------------------------------------------------------------------------
 * Future extension points (Sprint 6+).
 *
 * These define the contract only. Every method below returns undefined/an
 * empty value and does nothing else — no AI generation, no template fetch,
 * no repository creation, no database provisioning, no deployment. A
 * future sprint implements the body; callers written against these
 * signatures today won't need to change when that happens.
 *
 * Payments note for whoever implements getSuggestedEnvironmentVariables /
 * getSuggestedDeployment later: this platform is India-first. Default
 * payment-related suggestions must come from Razorpay, UPI, PhonePe,
 * Paytm, or Cashfree (see SuggestedPaymentProvider in types.ts) — never
 * Stripe.
 * ----------------------------------------------------------------------
 */

// TODO(Sprint 6+): return the blueprint's AI system prompt.
function getSystemPrompt(_id: string | undefined): BlueprintSystemPrompt | undefined {
  return undefined;
}

// TODO(Sprint 6+): return the default chat/starter prompt for this blueprint.
function getStarterPrompt(_id: string | undefined): string | undefined {
  return undefined;
}

// TODO(Sprint 6+): return the starter template/scaffold reference for this blueprint.
function getStarterTemplate(_id: string | undefined): BlueprintStarterTemplate | undefined {
  return undefined;
}

// TODO(Sprint 6+): return a suggested GitHub repository name for this blueprint.
function getSuggestedRepositoryName(_id: string | undefined): string | undefined {
  return undefined;
}

// TODO(Sprint 6+): return a suggested Supabase database/project name for this blueprint.
function getSuggestedDatabaseName(_id: string | undefined): string | undefined {
  return undefined;
}

// TODO(Sprint 6+): return a suggested deployment target for this blueprint.
function getSuggestedDeployment(_id: string | undefined): string | undefined {
  return undefined;
}

/*
 * TODO(Sprint 6+): return suggested environment variables for this blueprint.
 * Payment-related suggestions must default to Razorpay/UPI/PhonePe/Paytm/Cashfree, not Stripe.
 */
function getSuggestedEnvironmentVariables(_id: string | undefined): BlueprintSuggestedEnvironmentVariable[] {
  return [];
}

export const blueprintEngine = {
  // Today
  getBlueprint,
  getAllBlueprints,
  getDefaultBlueprint,
  getRecommendedStack,
  getRecommendedIntegrations,
  getRecommendedNextSteps,
  getBlueprintRecommendation,
  getBlueprintCategory,
  getBlueprintProductType,
  getRoadmap,

  // Future (Sprint 6+) — placeholders only, see comment block above
  getSystemPrompt,
  getStarterPrompt,
  getStarterTemplate,
  getSuggestedRepositoryName,
  getSuggestedDatabaseName,
  getSuggestedDeployment,
  getSuggestedEnvironmentVariables,
};
