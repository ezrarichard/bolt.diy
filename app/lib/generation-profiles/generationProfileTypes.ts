/**
 * Generation Profile Domain — Sprint 39.5.
 *
 * A Generation Profile maps every AI Engineering Team role (the same `role_key` values
 * as builders_ai_roles — see app/lib/builders-db/repositories/buildersDbRepository.ts)
 * to a MODEL KEY (never a raw provider API model id — see modelRegistry.ts's header for
 * why). `getModelForRole()` (generationProfileRepository.ts) is what actually resolves a
 * profile+role down to a real provider/API model, going through the registry.
 */

export type GenerationProfileMode = 'fast-prototype' | 'balanced' | 'production';

export interface GenerationProfile {
  id: string;
  name: string;
  description: string;
  mode: GenerationProfileMode;
  isDefault: boolean;
  isSystem: boolean;
}

/** One role's entry within a profile — references a modelRegistry.ts key, not a raw API model id. */
export interface GenerationProfileRoleModel {
  roleKey: string;
  modelKey: string;

  /** Per-role override of the registry entry's own behavior — left undefined for every profile this sprint. */
  temperature?: number;
  maxTokens?: number;
  priority: number;
}

/** A profile plus its full role→modelKey mapping — what defaultProfiles.ts declares and generationProfileRepository.ts reads/writes. */
export interface GenerationProfileWithRoles extends GenerationProfile {
  roles: GenerationProfileRoleModel[];
}

/** What `getModelForRole()` returns after resolving profileId -> roleKey -> modelKey -> registry entry — ready to pass straight into a `generate()` call's options. */
export interface RoleModelResolution {
  provider: string;
  model: string;

  /** Sprint 42.1 — the logical registry key `model` (the raw API model id) was resolved from; carried through for AI usage-ledger attribution (see app/lib/ai-usage/). */
  modelKey: string;
  temperature?: number;
  maxTokens?: number;
}
