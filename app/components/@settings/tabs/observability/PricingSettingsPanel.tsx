import { useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { MODEL_PRICING_REGISTRY } from '~/lib/ai-usage/modelPricingRegistry';
import {
  pricingOverridesStore,
  resolveEffectivePricing,
  setPricingOverride,
  type PricingOverride,
} from '~/lib/observability/pricing/pricingOverrides';
import { Panel, EmptyNote } from './ObservabilityPrimitives';
import { EMPTY_VALUE } from './observabilityFormat';

/**
 * Builders Observability — model pricing configuration.
 *
 * Lets an administrator price a model without editing source. `MODEL_PRICING_REGISTRY` remains the
 * central built-in configuration; anything set here is an override layered on top of it, and the
 * table shows which of the two is in force for each model.
 *
 * Models are discovered from the usage data itself (`observedModels`), so a model that has never
 * been used does not clutter the list and a brand-new one appears the first time it is called —
 * no list of model names is hardcoded here.
 */

interface DraftState {
  input: string;
  output: string;
  cached: string;
  currency: string;
  effectiveDate: string;
}

const EMPTY_DRAFT: DraftState = { input: '', output: '', cached: '', currency: 'USD', effectiveDate: '' };

const inputClass = classNames(
  'w-full rounded-lg px-2 py-1 text-[11px] appearance-none',
  'border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-3',
  'text-bolt-elements-textPrimary',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-builders-border-focus',
);

export function PricingSettingsPanel({ observedModels }: { observedModels: string[] }) {
  const overrides = useStore(pricingOverridesStore);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  /* Every model we have seen used, plus anything already priced — so a configured model never disappears. */
  const models = useMemo(
    () => [...new Set([...observedModels, ...Object.keys(overrides), ...Object.keys(MODEL_PRICING_REGISTRY)])].sort(),
    [observedModels, overrides],
  );

  const beginEdit = (modelKey: string) => {
    const existing = overrides[modelKey];
    setEditing(modelKey);
    setDraft(
      existing
        ? {
            input: String(existing.inputPerMillionUsd),
            output: String(existing.outputPerMillionUsd),
            cached: existing.cachedInputPerMillionUsd === undefined ? '' : String(existing.cachedInputPerMillionUsd),
            currency: existing.currency,
            effectiveDate: existing.effectiveDate,
          }
        : EMPTY_DRAFT,
    );
  };

  const save = (modelKey: string) => {
    const override: PricingOverride = {
      inputPerMillionUsd: Number(draft.input),
      outputPerMillionUsd: Number(draft.output),
      cachedInputPerMillionUsd: draft.cached === '' ? undefined : Number(draft.cached),
      currency: draft.currency || 'USD',
      effectiveDate: draft.effectiveDate,

      /* Stamped so a row costed under this price is distinguishable from one costed under a later edit. */
      version: `override-${draft.effectiveDate || new Date().toISOString().slice(0, 10)}`,
    };

    setPricingOverride(modelKey, override);
    setEditing(null);
  };

  return (
    <Panel title="Model Pricing">
      {models.length === 0 ? (
        <EmptyNote>No models have been used yet. Pricing can be configured once a model appears here.</EmptyNote>
      ) : (
        <div className="space-y-2">
          {models.map((modelKey) => {
            const effective = resolveEffectivePricing(modelKey, overrides);
            const isEditing = editing === modelKey;

            return (
              <div
                key={modelKey}
                className="rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-3/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-bolt-elements-textPrimary truncate">{modelKey}</div>
                    <div className="text-[10px] text-bolt-elements-textSecondary">
                      {effective
                        ? `In ${effective.pricing.inputPerMillionUsd}/M · Out ${effective.pricing.outputPerMillionUsd}/M` +
                          `${effective.pricing.cachedInputPerMillionUsd !== undefined ? ` · Cached ${effective.pricing.cachedInputPerMillionUsd}/M` : ''}` +
                          ` · ${effective.source === 'override' ? 'Configured here' : 'Built-in registry'}`
                        : `${EMPTY_VALUE} No price configured — cost shows as "${EMPTY_VALUE}"`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {overrides[modelKey] && !isEditing && (
                      <button
                        type="button"
                        onClick={() => setPricingOverride(modelKey, null)}
                        className="text-[11px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-status-error-text transition-colors"
                      >
                        Reset
                      </button>
                    )}
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => beginEdit(modelKey)}
                        className="text-[11px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-builders-brand-primary transition-colors"
                      >
                        {overrides[modelKey] ? 'Edit' : 'Configure'}
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-2.5 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(
                        [
                          ['Input / M', 'input', '3'],
                          ['Output / M', 'output', '15'],
                          ['Cached / M', 'cached', '0.3'],
                          ['Currency', 'currency', 'USD'],
                          ['Effective', 'effectiveDate', 'YYYY-MM-DD'],
                        ] as const
                      ).map(([label, field, placeholder]) => (
                        <label key={field} className="space-y-1">
                          <span className="block text-[9px] uppercase tracking-wide text-bolt-elements-textSecondary">
                            {label}
                          </span>
                          <input
                            value={draft[field]}
                            placeholder={placeholder}
                            onChange={(changeEvent) =>
                              setDraft((current) => ({ ...current, [field]: changeEvent.target.value }))
                            }
                            className={inputClass}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="px-2.5 py-1 rounded-lg text-[11px] bg-transparent border-0 appearance-none text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => save(modelKey)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium appearance-none border-0 bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-bolt-elements-textSecondary">
        Prices are per million tokens. Configured prices apply to requests that were recorded without a cost —
        already-costed rows keep exactly what the ledger recorded, so changing a price never restates history. Move a
        confirmed price into <code>modelPricingRegistry.ts</code> to have it stored on future requests.
      </p>
    </Panel>
  );
}
