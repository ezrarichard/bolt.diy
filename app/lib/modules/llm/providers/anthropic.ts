import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModelV1 } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { createAnthropic } from '@ai-sdk/anthropic';

export default class AnthropicProvider extends BaseProvider {
  name = 'Anthropic';
  getApiKeyLink = 'https://console.anthropic.com/settings/keys';

  config = {
    apiTokenKey: 'ANTHROPIC_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Current-generation fallback models, available even before dynamic
     * model loading runs. Order matches the platform's model preference:
     * Sonnet 5 (default), Opus 4.8, Haiku 4.5, Fable 5.
     */
    {
      name: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'Anthropic',
      maxTokenAllowed: 1000000,
      maxCompletionTokens: 128000,
    },

    {
      name: 'claude-opus-4-8',
      label: 'Claude Opus 4.8',
      provider: 'Anthropic',
      maxTokenAllowed: 1000000,
      maxCompletionTokens: 128000,
    },

    {
      name: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 64000,
    },

    {
      name: 'claude-fable-5',
      label: 'Claude Fable 5',
      provider: 'Anthropic',
      maxTokenAllowed: 1000000,
      maxCompletionTokens: 128000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.anthropic.com/v1/models`, {
      headers: {
        'x-api-key': `${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter((model: any) => model.type === 'model' && !staticModelIds.includes(model.id));

    return data.map((m: any) => {
      let contextWindow: number;
      let maxCompletionTokens: number;

      // Current-generation models — fixed limits regardless of what the API reports, matching the static fallbacks above.
      if (m.id?.includes('claude-sonnet-5')) {
        contextWindow = 1000000;
        maxCompletionTokens = 128000;
      } else if (m.id?.includes('claude-opus-4-8')) {
        contextWindow = 1000000;
        maxCompletionTokens = 128000;
      } else if (m.id?.includes('claude-fable-5')) {
        contextWindow = 1000000;
        maxCompletionTokens = 128000;
      } else if (m.id?.includes('claude-haiku-4-5')) {
        contextWindow = 200000;
        maxCompletionTokens = 64000;
      } else {
        // Older Claude 3 / 3.5 / 4 models — unchanged, safe fallback behavior.
        contextWindow = 32000; // default fallback

        // Anthropic provides max_tokens in their API response
        if (m.max_tokens) {
          contextWindow = m.max_tokens;
        } else if (m.id?.includes('claude-3-5-sonnet')) {
          contextWindow = 200000; // Claude 3.5 Sonnet has 200k context
        } else if (m.id?.includes('claude-3-haiku')) {
          contextWindow = 200000; // Claude 3 Haiku has 200k context
        } else if (m.id?.includes('claude-3-opus')) {
          contextWindow = 200000; // Claude 3 Opus has 200k context
        } else if (m.id?.includes('claude-3-sonnet')) {
          contextWindow = 200000; // Claude 3 Sonnet has 200k context
        }

        // Determine completion token limits based on specific model
        maxCompletionTokens = 128000; // default for older Claude 3 models

        if (m.id?.includes('claude-opus-4')) {
          maxCompletionTokens = 32000; // Claude 4 Opus: 32K output limit
        } else if (m.id?.includes('claude-sonnet-4')) {
          maxCompletionTokens = 64000; // Claude 4 Sonnet: 64K output limit
        } else if (m.id?.includes('claude-4')) {
          maxCompletionTokens = 32000; // Other Claude 4 models: conservative 32K limit
        }
      }

      return {
        name: m.id,
        label: `${m.display_name} (${Math.floor(contextWindow / 1000)}k context)`,
        provider: this.name,
        maxTokenAllowed: contextWindow,
        maxCompletionTokens,
      };
    });
  }

  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1 = (options) => {
    const { apiKeys, providerSettings, serverEnv, model } = options;
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });
    const anthropic = createAnthropic({
      apiKey,
      headers: { 'anthropic-beta': 'output-128k-2025-02-19' },
    });

    return anthropic(model);
  };
}
