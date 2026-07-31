import { resolveModelPricing, type ModelPricing } from './modelPricingRegistry';
import type { AiTokenUsage } from './aiUsageTypes';

export interface EstimatedCost {
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
}

const NULL_COST: EstimatedCost = {
  inputCostUsd: null,
  outputCostUsd: null,
  estimatedCostUsd: null,
  pricingVersion: null,
};

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * AI Usage Ledger — Sprint 42.1. Never fabricates a number: every field is `null` whenever
 * `modelKey` isn't in modelPricingRegistry.ts, rather than falling back to a guess or
 * another model's price. Cached input tokens are billed at `cachedInputPerMillionUsd` (or
 * treated as free if that rate isn't set) instead of the full input rate, and excluded from
 * the "billable" input count so they're never double-counted.
 */
export function calculateEstimatedCost(
  modelKey: string | null | undefined,
  usage: AiTokenUsage,

  /**
   * Explicit pricing, bypassing the registry lookup. Additive and optional — the write path calls
   * this exactly as before. The Observability dashboard passes configured overrides here so an
   * unpriced historical row can be costed for display without duplicating this arithmetic
   * (see app/lib/observability/pricing/pricingOverrides.ts).
   */
  explicitPricing?: ModelPricing,
): EstimatedCost {
  const pricing = explicitPricing ?? resolveModelPricing(modelKey);

  if (!pricing) {
    return NULL_COST;
  }

  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const billableInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);

  const inputCostUsd =
    (billableInputTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (cachedInputTokens / 1_000_000) * (pricing.cachedInputPerMillionUsd ?? 0);

  const outputCostUsd = (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;

  return {
    inputCostUsd: round(inputCostUsd),
    outputCostUsd: round(outputCostUsd),
    estimatedCostUsd: round(inputCostUsd + outputCostUsd),
    pricingVersion: pricing.version,
  };
}
