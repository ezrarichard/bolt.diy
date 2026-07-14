/**
 * AI Usage Ledger — Sprint 42.1. Centralized pricing so cost constants never get scattered
 * across routes/engines — see calculateEstimatedCost.ts, the only reader of this file.
 */

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillionUsd: number;

  /** USD per 1,000,000 output tokens. */
  outputPerMillionUsd: number;

  /** USD per 1,000,000 cached-input tokens, when the provider bills these at a different rate. Omit to treat cached input as free/uncosted. */
  cachedInputPerMillionUsd?: number;

  /** Bumped whenever a price changes — stored on every usage row that used it (builders_ai_usage_events.pricing_version), so a later price change never makes an old row look like it used a price it didn't. */
  version: string;
}

/**
 * Keyed by the LOGICAL model key (app/lib/generation-profiles/modelRegistry.ts's
 * MODEL_REGISTRY keys), not the raw provider API model id — pricing then survives a model's
 * `apiModel` string changing.
 *
 * Deliberately empty: every model currently in MODEL_REGISTRY (claude-haiku-4.5,
 * claude-sonnet-4.5, claude-sonnet-4.6) is a placeholder/near-future identifier this codebase
 * has no confirmed published per-token price for. Inventing a number here would produce
 * `estimated_cost_usd` values that LOOK precise but aren't — worse than no estimate at all
 * (see calculateEstimatedCost.ts's null fallback, and the sprint's "do not invent a value"
 * requirement). Add a real entry, with a real `version` string, the moment the team confirms
 * actual pricing for a model — nothing else in this module needs to change.
 *
 * Example of the shape a real entry takes, once pricing is confirmed:
 *   'claude-sonnet-4.6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, version: '2026-07-10' },
 */
export const MODEL_PRICING_REGISTRY: Record<string, ModelPricing> = {};

/** Returns the registry entry for a logical model key, or `undefined` for an unpriced/unknown key — never throws, never guesses. */
export function resolveModelPricing(modelKey: string | null | undefined): ModelPricing | undefined {
  if (!modelKey) {
    return undefined;
  }

  return MODEL_PRICING_REGISTRY[modelKey];
}
