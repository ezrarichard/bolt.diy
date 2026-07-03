import { PROJECT_BLUEPRINTS, DEFAULT_BLUEPRINT_ID } from './registry';
import type {
  ProjectBlueprint,
  BlueprintCategory,
  BlueprintRecommendation,
  BlueprintSystemPrompt,
  BlueprintStarterTemplate,
  BlueprintSuggestedEnvironmentVariable,
} from './types';

/**
 * Blueprint Engine.
 *
 * The single point of access for blueprint data.
 *
 *   BlueprintRegistry (registry.ts, raw data)
 *     -> blueprintEngine (this file)
 *       -> Project Dashboard (today)
 *       -> Future AI Builder / GitHub / Supabase (later sprints)
 *
 * Every method below just reads registry.ts — there is no computation, no
 * AI call, no network request, and nothing here mutates anything. Consumers
 * (UI components, and eventually other systems) should never import
 * registry.ts or types.ts directly; import from app/lib/blueprints (the
 * index barrel) and use blueprintEngine so the registry's internal shape
 * can change later without touching a single consumer.
 */

function getBlueprint(id: string | undefined): ProjectBlueprint | undefined {
  if (!id) {
    return undefined;
  }

  return PROJECT_BLUEPRINTS.find((blueprint) => blueprint.id === id);
}

function getAllBlueprints(): ProjectBlueprint[] {
  return PROJECT_BLUEPRINTS;
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

  // Future (Sprint 6+) — placeholders only, see comment block above
  getSystemPrompt,
  getStarterPrompt,
  getStarterTemplate,
  getSuggestedRepositoryName,
  getSuggestedDatabaseName,
  getSuggestedDeployment,
  getSuggestedEnvironmentVariables,
};
