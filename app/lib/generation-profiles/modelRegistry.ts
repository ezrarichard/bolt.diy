/**
 * Model Registry — Sprint 39.5.
 *
 * The single source of truth mapping a LOGICAL model key (what Generation Profiles
 * reference — see defaultProfiles.ts) to everything about that real model: which
 * provider, the exact API model id, and cost/quality metadata. This is the only file in
 * the codebase that contains a raw Anthropic API model id string — a future model-id
 * change, or adding OpenAI/Gemini/DeepSeek/Mistral/Ollama/Groq/Bedrock/Cerebras/
 * OpenRouter/etc., only ever touches this file plus a new registry entry, never a
 * Generation Profile.
 *
 * Deliberately code, not a BuildersDB table, this sprint — no model-management UI is
 * being built, so there's nothing to edit at runtime yet. `resolveModelKey()` is the one
 * function every caller goes through, so swapping this for a DB-backed registry later
 * (same pattern app/lib/workspace-snapshot/ already uses for its own swappable backend)
 * is a contained change with zero call-site updates.
 *
 * Every entry's `apiModel` has been verified live against the real Anthropic API
 * (`GET /v1/models` for the id, a real `/v1/messages` call to confirm `temperature`
 * behavior) — not guessed. `supportsTemperature` is descriptive metadata only; the
 * actual runtime guard that omits `temperature` for models that reject it stays
 * centralized in app/lib/.server/llm/constants.ts's `isClaudeReasoningModel` (see that
 * file) rather than being duplicated here, so there remains exactly one place to extend
 * when a future model deprecates the parameter.
 */

export type ModelCostTier = 'low' | 'medium' | 'high';
export type ModelQualityTier = 'good' | 'better' | 'best';
export type ModelCategory = 'fast' | 'balanced' | 'production';

export interface ModelRegistryEntry {
  /** Logical key — what Generation Profiles reference (e.g. "claude-sonnet-4.6"), never the raw API model id. */
  key: string;

  /** Matches ProviderInfo.name (app/types/model.ts) — e.g. "Anthropic". */
  provider: string;

  /** The exact string passed to the provider's getModelInstance({ model }) — the only place a raw API model id lives. */
  apiModel: string;
  displayName: string;
  supportsTemperature: boolean;
  contextWindow: number;
  costTier: ModelCostTier;
  qualityTier: ModelQualityTier;
  category: ModelCategory;
}

export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  'claude-haiku-4.5': {
    key: 'claude-haiku-4.5',
    provider: 'Anthropic',
    apiModel: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    supportsTemperature: true,
    contextWindow: 200000,
    costTier: 'low',
    qualityTier: 'good',
    category: 'fast',
  },
  'claude-sonnet-4.5': {
    key: 'claude-sonnet-4.5',
    provider: 'Anthropic',
    apiModel: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    supportsTemperature: true,
    contextWindow: 64000,
    costTier: 'medium',
    qualityTier: 'better',
    category: 'balanced',
  },
  'claude-sonnet-4.6': {
    key: 'claude-sonnet-4.6',
    provider: 'Anthropic',
    apiModel: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    supportsTemperature: true,
    contextWindow: 128000,
    costTier: 'high',
    qualityTier: 'best',
    category: 'production',
  },
};

/** Returns the registry entry for a logical model key, or `undefined` for an unknown key — never throws. */
export function resolveModelKey(modelKey: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY[modelKey];
}
