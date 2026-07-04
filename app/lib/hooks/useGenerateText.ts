import { useState } from 'react';
import Cookies from 'js-cookie';
import type { ProviderInfo } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useGenerateText');

export interface GenerateTextResult {
  ok: true;
  text: string;
}

export interface GenerateTextError {
  ok: false;
  error: string;
}

/**
 * Generic, provider-agnostic one-shot text generation — Sprint 13.
 *
 * Reads whichever model/provider/API keys the user has already selected in
 * Chat (same cookies Chat.client.tsx reads: `selectedModel`,
 * `selectedProvider`, `apiKeys`) and posts to the generic
 * app/routes/api.generate-text.ts route. This hook has zero knowledge of
 * "Business Analyst" or any other AI role — it's the one piece of client
 * plumbing every future AI-role UI (Solution Architect, Database Designer,
 * UI Designer, Backend Engineer) can reuse unchanged; only the
 * system/prompt text passed in differs, and that text always comes from a
 * `prompts/*.ts` + `*Engine.ts` pair, never written inline in a component.
 */
export function useGenerateText() {
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async (
    system: string | undefined,
    prompt: string,
  ): Promise<GenerateTextResult | GenerateTextError> => {
    setIsGenerating(true);

    try {
      const model = Cookies.get('selectedModel') || DEFAULT_MODEL;
      const savedProviderName = Cookies.get('selectedProvider');
      const provider: ProviderInfo = (PROVIDER_LIST.find((p) => p.name === savedProviderName) ||
        DEFAULT_PROVIDER) as ProviderInfo;

      const response = await fetch('/api/generate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, prompt, model, provider }),
      });

      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        return { ok: false, error: message || `Request failed with status ${response.status}` };
      }

      const data = await response.json<{ text: string }>();

      return { ok: true, text: data.text };
    } catch (error) {
      logger.error('generate-text request failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : 'Text generation failed' };
    } finally {
      setIsGenerating(false);
    }
  };

  return { generate, isGenerating };
}
