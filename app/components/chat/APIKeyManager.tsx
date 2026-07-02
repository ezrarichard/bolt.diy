import React, { useState, useEffect, useCallback } from 'react';
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

// cache which stores whether the provider's API key is set via environment variable
const providerEnvKeyStatusCache: Record<string, boolean> = {};

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
  const [isEnvKeySet, setIsEnvKeySet] = useState(false);

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  const checkEnvApiKey = useCallback(async () => {
    // Check cache first
    if (providerEnvKeyStatusCache[provider.name] !== undefined) {
      setIsEnvKeySet(providerEnvKeyStatusCache[provider.name]);
      return;
    }

    try {
      const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(provider.name)}`);
      const data = await response.json();
      const isSet = (data as { isSet: boolean }).isSet;

      // Cache the result
      providerEnvKeyStatusCache[provider.name] = isSet;
      setIsEnvKeySet(isSet);
    } catch (error) {
      console.error('Failed to check environment API key:', error);
      setIsEnvKeySet(false);
    }
  }, [provider.name]);

  useEffect(() => {
    checkEnvApiKey();
  }, [checkEnvApiKey]);

  const handleSave = () => {
    // Save to parent state
    setApiKey(tempKey);

    // Save to cookies
    const currentKeys = getApiKeysFromCookies();
    const newKeys = { ...currentKeys, [provider.name]: tempKey };
    Cookies.set('apiKeys', JSON.stringify(newKeys));

    setIsEditing(false);
  };

  const hasKey = Boolean(apiKey) || isEnvKeySet;

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
          title={hasKey ? 'Edit API key' : 'Set API key'}
          className={classNames(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
            hasKey
              ? 'border-green-500/30 text-green-500 hover:bg-green-500/10'
              : 'border-bolt-elements-borderColor text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
          )}
        >
          <div className={hasKey ? 'i-ph:check-circle-fill w-3 h-3' : 'i-ph:circle-dashed w-3 h-3'} />
          {apiKey ? 'API key set' : isEnvKeySet ? 'API key via env' : 'No API key'}
        </button>
      )}
      {!isEditing && !apiKey && provider?.getApiKeyLink && (
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
