/**
 * Builders Observability / AI Usage — read-time cost enrichment.
 *
 * Fills in a cost for rows the write path could not price, using whatever pricing is configured
 * now (see pricingOverrides.ts for why this happens at read time rather than at write time).
 *
 * Two rules keep this honest:
 *  - A row that ALREADY has a stored cost is never touched. The ledger's recorded value always
 *    wins, so changing a price today can never silently restate what yesterday actually cost.
 *  - A row with no stored cost and no configured price stays null, and still renders as "—".
 *
 * The arithmetic is not reimplemented here: it delegates to the same `calculateEstimatedCost()`
 * the write path uses.
 */

import { calculateEstimatedCost } from '~/lib/ai-usage/calculateEstimatedCost';
import { resolveEffectivePricing, type PricingOverrideMap } from '~/lib/observability/pricing/pricingOverrides';
import type { AiUsageEvent } from './aiUsageQueryTypes';

export interface CostEnrichmentResult {
  events: AiUsageEvent[];

  /** How many rows were priced here rather than by the write path — surfaced so the UI can say so. */
  enrichedCount: number;
}

export function enrichEventCosts(events: AiUsageEvent[], overrides: PricingOverrideMap): CostEnrichmentResult {
  if (Object.keys(overrides).length === 0) {
    return { events, enrichedCount: 0 };
  }

  let enrichedCount = 0;

  const enriched = events.map((event) => {
    if (event.estimatedCostUsd !== null) {
      return event;
    }

    const effective = resolveEffectivePricing(event.modelKey ?? event.apiModel, overrides);

    if (!effective || effective.source !== 'override') {
      return event;
    }

    const cost = calculateEstimatedCost(
      event.modelKey,
      {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cachedInputTokens: event.cachedInputTokens,
        totalTokens: event.totalTokens,
      },
      effective.pricing,
    );

    if (cost.estimatedCostUsd === null) {
      return event;
    }

    enrichedCount += 1;

    return { ...event, estimatedCostUsd: cost.estimatedCostUsd, costSource: 'override' as const };
  });

  return { events: enriched, enrichedCount };
}
