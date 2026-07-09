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
 * requirements-draft, architecture-draft, database-draft, uiux-draft, backend-draft,
 * frontend-draft, qa-draft, devops-draft, code-reviewer, repair-engineer, build-validator.
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
      { roleKey: 'architecture-draft', modelKey: 'claude-haiku-4.5', priority: 2 },
      { roleKey: 'database-draft', modelKey: 'claude-haiku-4.5', priority: 3 },
      { roleKey: 'uiux-draft', modelKey: 'claude-haiku-4.5', priority: 4 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.5', priority: 5 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.5', priority: 6 },
      { roleKey: 'qa-draft', modelKey: 'claude-haiku-4.5', priority: 7 },
      { roleKey: 'devops-draft', modelKey: 'claude-haiku-4.5', priority: 8 },
      { roleKey: 'code-reviewer', modelKey: 'claude-haiku-4.5', priority: 9 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.5', priority: 10 },
      { roleKey: 'build-validator', modelKey: 'claude-haiku-4.5', priority: 11 },
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
      { roleKey: 'architecture-draft', modelKey: 'claude-sonnet-4.6', priority: 2 },
      { roleKey: 'database-draft', modelKey: 'claude-sonnet-4.5', priority: 3 },
      { roleKey: 'uiux-draft', modelKey: 'claude-sonnet-4.5', priority: 4 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.6', priority: 5 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.6', priority: 6 },
      { roleKey: 'qa-draft', modelKey: 'claude-sonnet-4.5', priority: 7 },
      { roleKey: 'devops-draft', modelKey: 'claude-sonnet-4.5', priority: 8 },
      { roleKey: 'code-reviewer', modelKey: 'claude-sonnet-4.5', priority: 9 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.6', priority: 10 },
      { roleKey: 'build-validator', modelKey: 'claude-haiku-4.5', priority: 11 },
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
      { roleKey: 'architecture-draft', modelKey: 'claude-sonnet-4.6', priority: 2 },
      { roleKey: 'database-draft', modelKey: 'claude-sonnet-4.6', priority: 3 },
      { roleKey: 'uiux-draft', modelKey: 'claude-sonnet-4.6', priority: 4 },
      { roleKey: 'backend-draft', modelKey: 'claude-sonnet-4.6', priority: 5 },
      { roleKey: 'frontend-draft', modelKey: 'claude-sonnet-4.6', priority: 6 },
      { roleKey: 'qa-draft', modelKey: 'claude-sonnet-4.6', priority: 7 },
      { roleKey: 'devops-draft', modelKey: 'claude-sonnet-4.6', priority: 8 },
      { roleKey: 'code-reviewer', modelKey: 'claude-sonnet-4.6', priority: 9 },
      { roleKey: 'repair-engineer', modelKey: 'claude-sonnet-4.6', priority: 10 },
      { roleKey: 'build-validator', modelKey: 'claude-sonnet-4.6', priority: 11 },
    ],
  },
];
