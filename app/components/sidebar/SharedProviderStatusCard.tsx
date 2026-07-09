import { useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * Sprint 38.5 — Workspace tab card summarizing shared AI provider key status (Sprint
 * 38.4's `/api/shared-key-status`, which returns booleans only, never a key value — see
 * that route's own header comment). A thin display wrapper; all the actual detection
 * logic lives in app/lib/modules/llm/manager.ts's `getSharedKeyStatus()`.
 */
export function SharedProviderStatusCard() {
  const [providers, setProviders] = useState<Record<string, { configured: boolean }> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/shared-key-status')
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setProviders((data as { providers: Record<string, { configured: boolean }> }).providers);
        }
      })
      .catch((error) => console.error('Failed to load shared provider status:', error));

    return () => {
      cancelled = true;
    };
  }, []);

  const configuredProviders = providers ? Object.entries(providers).filter(([, status]) => status.configured) : [];

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 ring-1 ring-purple-500/15 shrink-0">
          <div className="i-ph:key-duotone w-4 h-4 text-purple-600/80 dark:text-purple-400/80" />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Shared AI Provider</div>
      </div>
      {providers === null ? (
        <div className="text-xs text-bolt-elements-textTertiary">Checking…</div>
      ) : configuredProviders.length === 0 ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          No shared provider keys configured — team members enter their own API keys.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {configuredProviders.map(([name]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-green-500/30 text-green-600 dark:text-green-400 bg-green-500/5"
            >
              <div className="i-ph:check-circle-fill w-3 h-3" />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
