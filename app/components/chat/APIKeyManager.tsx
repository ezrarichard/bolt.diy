import React, { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { ProviderInfo } from '~/types/model';
import Cookies from 'js-cookie';
import { classNames } from '~/utils/classNames';

interface APIKeyManagerProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
}

/*
 * Sprint 38.4 — batched, cookie-independent shared-key status (all providers fetched once,
 * not per-provider like the older /api/check-env-key). `undefined` = not fetched yet,
 * `null` = fetch in flight, `Record<...>` = resolved. Module-level so every
 * APIKeyManager instance shares one fetch instead of one per rendered provider.
 */
let sharedKeyStatusCache: Record<string, { configured: boolean }> | undefined;
let sharedKeyStatusPromise: Promise<Record<string, { configured: boolean }>> | null = null;

async function fetchSharedKeyStatus(): Promise<Record<string, { configured: boolean }>> {
  if (sharedKeyStatusCache) {
    return sharedKeyStatusCache;
  }

  if (!sharedKeyStatusPromise) {
    sharedKeyStatusPromise = fetch('/api/shared-key-status')
      .then((response) => response.json())
      .then((data) => {
        sharedKeyStatusCache = (data as { providers: Record<string, { configured: boolean }> }).providers;
        return sharedKeyStatusCache;
      })
      .catch((error) => {
        console.error('Failed to check shared key status:', error);
        return {};
      });
  }

  return sharedKeyStatusPromise;
}

const apiKeyMemoizeCache: { [k: string]: Record<string, string> } = {};

export function getApiKeysFromCookies() {
  const storedApiKeys = Cookies.get('apiKeys');
  let parsedKeys: Record<string, string> = {};

  if (storedApiKeys) {
    parsedKeys = apiKeyMemoizeCache[storedApiKeys];

    if (!parsedKeys) {
      parsedKeys = apiKeyMemoizeCache[storedApiKeys] = JSON.parse(storedApiKeys);
    }
  }

  return parsedKeys;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ provider, apiKey, setApiKey }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [isSharedKeySet, setIsSharedKeySet] = useState(false);

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  useEffect(() => {
    let cancelled = false;

    fetchSharedKeyStatus().then((status) => {
      if (!cancelled) {
        setIsSharedKeySet(Boolean(status[provider.name]?.configured));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [provider.name]);

  const handleSave = () => {
    // Save to parent state
    setApiKey(tempKey);

    // Save to cookies
    const currentKeys = getApiKeysFromCookies();
    const newKeys = { ...currentKeys, [provider.name]: tempKey };
    Cookies.set('apiKeys', JSON.stringify(newKeys));

    setIsEditing(false);
  };

  const hasPersonalKey = Boolean(apiKey);
  const hasKey = hasPersonalKey || isSharedKeySet;

  // Sprint 38.4 — a personal key is always an optional override, never required when the team already has a shared key configured for this provider.
  const editButtonTitle = hasPersonalKey
    ? 'Edit your API key'
    : isSharedKeySet
      ? 'Add your own key to override the shared team key'
      : 'Set API key';

  return (
    <div className="flex items-center gap-2 mt-1">
      {isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            value={tempKey}
            placeholder="Enter API Key"
            autoFocus
            onChange={(e) => setTempKey(e.target.value)}
            className="w-[220px] px-2 py-1 text-xs rounded-md border border-bolt-elements-borderColor
                      bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary
                      focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus"
          />
          <IconButton onClick={handleSave} title="Save API Key" className="text-green-500">
            <div className="i-ph:check w-3.5 h-3.5" />
          </IconButton>
          <IconButton onClick={() => setIsEditing(false)} title="Cancel" className="text-red-500">
            <div className="i-ph:x w-3.5 h-3.5" />
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          title={editButtonTitle}
          className={classNames(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
            hasKey
              ? 'border-green-500/30 text-green-500 hover:bg-green-500/10'
              : 'border-bolt-elements-borderColor text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
          )}
        >
          <div className={hasKey ? 'i-ph:check-circle-fill w-3 h-3' : 'i-ph:circle-dashed w-3 h-3'} />
          {hasPersonalKey ? 'API key set' : isSharedKeySet ? 'Shared team key configured' : 'No API key'}
        </button>
      )}
      {!isEditing && !hasPersonalKey && isSharedKeySet && (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-[11px] text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary underline-offset-2 hover:underline"
        >
          Use my own key
        </button>
      )}
      {!isEditing && !hasPersonalKey && !isSharedKeySet && provider?.getApiKeyLink && (
        <button
          type="button"
          onClick={() => window.open(provider?.getApiKeyLink)}
          className="text-[11px] text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary underline-offset-2 hover:underline"
        >
          {provider?.labelForGetApiKey || 'Get API key'}
        </button>
      )}
    </div>
  );
};
