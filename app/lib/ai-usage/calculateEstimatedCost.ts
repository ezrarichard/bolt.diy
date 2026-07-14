import { resolveModelPricing } from './modelPricingRegistry';
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
export function calculateEstimatedCost(modelKey: string | null | undefined, usage: AiTokenUsage): EstimatedCost {
  const pricing = resolveModelPricing(modelKey);

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
