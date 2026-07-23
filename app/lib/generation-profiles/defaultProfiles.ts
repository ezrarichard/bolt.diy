import type { GenerationProfileWithRoles } from './generationProfileTypes';

/**
 * Default (system) Generation Profiles — Sprint 39.5.
 *
 * Local source of truth for the 3 fixed system profiles (no custom profile
 * editing/creation this sprint) — used synchronously by `getModelForRole()`
 * (generationProfileRepository.ts) so every generation call site can resolve a role's
 * model without an extra network round trip. Every `modelKey` below must exist in
 * modelRegistry.ts's `MODEL_REGISTRY` — never a raw API model id here.
 *
 * `role_key` values match builders_ai_roles exactly (verified live against BuildersDB):
 * requirements-draft, product-owner-draft, architecture-draft, database-draft, uiux-draft,
 * backend-draft, frontend-draft, qa-draft, devops-draft, code-reviewer, repair-engineer,
 * build-validator, discovery-agent.
 *
 * Sprint 46D — live end-to-end validation found `product-owner-draft` (Sprint 46B) was
 * missing from every tier here entirely. `getRoleGenerateOptions()`
 * (generationProfileRepository.ts) returns `{}` for an unmapped roleKey, silently falling
 * back to "whatever model the user's browser cookie last had selected" instead of this
 * profile's own explicit, tested default — unlike every other pipeline role. In the live
 * validation run this surfaced as a real, pipeline-blocking failure ("Invalid or missing API
 * key") the moment the Product Owner tried to generate. Fixed by giving it the same
 * model tier as `requirements-draft` in each profile (comparable planning complexity, and
 * the next role after it in the chain).
 *
 * Sprint 57.1 — the EXACT same failure mode recurred for `discovery-agent` (the Discovery AI
 * Engine's fact extractor, `app/lib/projects/discoveryAiEngine/`, called from
 * `useInterviewSession.ts`): with no cookie-selected model and no entry here,
 * `getRoleGenerateOptions()` returned `{}`, so `useGenerateText` fell back to
 * `DEFAULT_MODEL`/`DEFAULT_PROVIDER` (app/utils/constants.ts) — an Anthropic model paired
 * with whatever provider happens to register first in `LLMManager` (not guaranteed to be
 * Anthropic), which live-verification confirmed fails with the identical "Invalid or missing
 * API key" 401. Fixed the same way: registered `discovery-agent` here with the same model
 * tier as `requirements-draft` (Interview Mode's fact extraction is the same "read Business
 * Understanding, produce structured output" complexity class as the Requirements Draft).
 */

export const DEFAULT_GENERATION_PROFILE_ID = 'balanced';

export const DEFAULT_GENERATION_PROFILES: GenerationProfileWithRoles[] = [
  {
    id: 'fast-prototype',
    name: 'Fast Prototype',
    description: 'Cheapest and fastest — best for early testing and throwaway prototypes.',
    mode: 'fast-prototype',
    isDefault: false,
    isSystem: true,
    roles: [
      { roleKey: 'requirements-draft', modelKey: 'claude-haiku-4.5', priority: 1 },
      { roleKey: 'product-owner-draft', modelKey: 'claude-haiku-4.5', priority: 2 },
      { roleKey: 'architecture-draft', modelKey: 'claude-haiku-4.5', priority: 3 },
      { roleKey: 'database-draft', modelKey: 'claude-haiku-4.5', priority: 4 },
      { roleKey: 'uiux-draft', modelKey: 'claude-haiku-4.5', priority: 5 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.5', priority: 6 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.5', priority: 7 },
      { roleKey: 'qa-draft', modelKey: 'claude-haiku-4.5', priority: 8 },
      { roleKey: 'devops-draft', modelKey: 'claude-haiku-4.5', priority: 9 },
      { roleKey: 'code-reviewer', modelKey: 'claude-haiku-4.5', priority: 10 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.5', priority: 11 },
      { roleKey: 'build-validator', modelKey: 'claude-haiku-4.5', priority: 12 },
      { roleKey: 'discovery-agent', modelKey: 'claude-haiku-4.5', priority: 13 },
    ],
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'The recommended, normal Builders default — a practical mix of speed and quality.',
    mode: 'balanced',
    isDefault: true,
    isSystem: true,
    roles: [
      { roleKey: 'requirements-draft', modelKey: 'claude-sonnet-4.5', priority: 1 },
      { roleKey: 'product-owner-draft', modelKey: 'claude-sonnet-4.5', priority: 2 },
      { roleKey: 'architecture-draft', modelKey: 'claude-sonnet-4.6', priority: 3 },
      { roleKey: 'database-draft', modelKey: 'claude-sonnet-4.5', priority: 4 },
      { roleKey: 'uiux-draft', modelKey: 'claude-sonnet-4.5', priority: 5 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.6', priority: 6 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.6', priority: 7 },
      { roleKey: 'qa-draft', modelKey: 'claude-sonnet-4.5', priority: 8 },
      { roleKey: 'devops-draft', modelKey: 'claude-sonnet-4.5', priority: 9 },
      { roleKey: 'code-reviewer', modelKey: 'claude-sonnet-4.5', priority: 10 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.6', priority: 11 },
      { roleKey: 'build-validator', modelKey: 'claude-haiku-4.5', priority: 12 },
      { roleKey: 'discovery-agent', modelKey: 'claude-sonnet-4.5', priority: 13 },
    ],
  },
  {
    id: 'production',
    name: 'Production',
    description: 'Highest quality — uses the strongest model for every role. Best for final builds.',
    mode: 'production',
    isDefault: false,
    isSystem: true,
    roles: [
      { roleKey: 'requirements-draft', modelKey: 'claude-sonnet-4.6', priority: 1 },
      { roleKey: 'product-owner-draft', modelKey: 'claude-sonnet-4.6', priority: 2 },
      { roleKey: 'architecture-draft', modelKey: 'claude-sonnet-4.6', priority: 3 },
      { roleKey: 'database-draft', modelKey: 'claude-sonnet-4.6', priority: 4 },
      { roleKey: 'uiux-draft', modelKey: 'claude-sonnet-4.6', priority: 5 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.6', priority: 6 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.6', priority: 7 },
      { roleKey: 'qa-draft', modelKey: 'claude-sonnet-4.6', priority: 8 },
      { roleKey: 'devops-draft', modelKey: 'claude-sonnet-4.6', priority: 9 },
      { roleKey: 'code-reviewer', modelKey: 'claude-sonnet-4.6', priority: 10 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.6', priority: 11 },
      { roleKey: 'build-validator', modelKey: 'claude-sonnet-4.6', priority: 12 },
      { roleKey: 'discovery-agent', modelKey: 'claude-sonnet-4.6', priority: 13 },
    ],
  },
];
