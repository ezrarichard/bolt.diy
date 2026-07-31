/**
 * Builders Observability — configurable model pricing.
 *
 * `MODEL_PRICING_REGISTRY` (app/lib/ai-usage/modelPricingRegistry.ts) remains the ONE central
 * pricing configuration and the built-in default. This module adds a user-editable override layer
 * on top of it, so an administrator can price a model without editing source and redeploying.
 *
 * ## Why overrides apply at READ time
 *
 * Cost is calculated server-side, at write time, inside `/api/generate-text` — and the server has
 * no access to a browser's stored settings. Rather than add a per-request pricing round-trip or a
 * migration, an override is applied when the dashboard reads a row whose `estimated_cost_usd` is
 * null, using the SAME `calculateEstimatedCost()` the write path uses. So:
 *
 *  - A row already costed by the registry keeps its stored value, exactly as recorded.
 *  - A row with no stored cost is costed from overrides for display, and labelled as an override.
 *
 * That keeps the ledger immutable and honest — nothing is rewritten — while making the number
 * visible. Move a confirmed price into the registry to have it stored on future rows.
 */

import { atom } from 'nanostores';
import type { ModelPricing } from '~/lib/ai-usage/modelPricingRegistry';
import { resolveModelPricing } from '~/lib/ai-usage/modelPricingRegistry';

const STORAGE_KEY = 'builders.observability.pricingOverrides';

export interface PricingOverride extends ModelPricing {
  /** Currency of the entered figures. Stored for display; the ledger's own columns are USD. */
  currency: string;

  /** ISO date the price came into effect, entered by the administrator. */
  effectiveDate: string;
}

export type PricingOverrideMap = Record<string, PricingOverride>;

function isPositiveNumber(value: unknown): value is number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

/** Anything malformed is dropped rather than partially applied — a half-valid price is worse than none. */
function sanitizeEntry(value: unknown): PricingOverride | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (!isPositiveNumber(candidate.inputPerMillionUsd) || !isPositiveNumber(candidate.outputPerMillionUsd)) {
    return null;
  }

  return {
    inputPerMillionUsd: Number(candidate.inputPerMillionUsd),
    outputPerMillionUsd: Number(candidate.outputPerMillionUsd),
    cachedInputPerMillionUsd: isPositiveNumber(candidate.cachedInputPerMillionUsd)
      ? Number(candidate.cachedInputPerMillionUsd)
      : undefined,
    version: typeof candidate.version === 'string' && candidate.version ? candidate.version : 'override',
    currency: typeof candidate.currency === 'string' && candidate.currency ? candidate.currency : 'USD',
    effectiveDate: typeof candidate.effectiveDate === 'string' ? candidate.effectiveDate : '',
  };
}

export function sanitizeOverrides(value: unknown): PricingOverrideMap {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: PricingOverrideMap = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeEntry(entry);

    if (sanitized) {
      result[key] = sanitized;
    }
  }

  return result;
}

function read(): PricingOverrideMap {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export const pricingOverridesStore = atom<PricingOverrideMap>(read());

export function setPricingOverride(modelKey: string, override: PricingOverride | null): void {
  const next = { ...pricingOverridesStore.get() };

  if (override === null) {
    delete next[modelKey];
  } else {
    const sanitized = sanitizeEntry(override);

    if (!sanitized) {
      return;
    }

    next[modelKey] = sanitized;
  }

  pricingOverridesStore.set(next);

  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage blocked — the in-memory store still reflects the change for this session. */
  }
}

export interface EffectivePricing {
  pricing: ModelPricing;

  /** `registry` = the built-in central configuration; `override` = configured in the Control Panel. */
  source: 'registry' | 'override';
}

/**
 * The price to use for a model: an override when one is configured, otherwise the central
 * registry, otherwise nothing. Never guesses and never falls back to another model's price.
 */
export function resolveEffectivePricing(
  modelKey: string | null | undefined,
  overrides: PricingOverrideMap = pricingOverridesStore.get(),
): EffectivePricing | undefined {
  if (!modelKey) {
    return undefined;
  }

  const override = overrides[modelKey];

  if (override) {
    return { pricing: override, source: 'override' };
  }

  const registry = resolveModelPricing(modelKey);

  return registry ? { pricing: registry, source: 'registry' } : undefined;
}
