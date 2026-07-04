import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import type { ProviderInfo } from '~/types/model';
import { PROVIDER_LIST, DEFAULT_PROVIDER } from '~/utils/constants';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.generate-text');

export async function action(args: ActionFunctionArgs) {
  return generateTextAction(args);
}

/**
 * Generic, provider-agnostic one-shot text generation endpoint — Sprint 13.
 *
 * This route contains no business logic of its own. It exists purely so
 * server-only engines (app/lib/projects/businessAnalystEngine.ts today;
 * future AI Solution Architect / Database Designer / UI Designer / Backend
 * Engineer engines later) can ask "run this system+prompt through whichever
 * provider/model the user has selected" without importing the LLM provider
 * abstraction (app/lib/modules/llm/) themselves. Every future AI role
 * reuses this exact route unchanged — only the caller's prompt/context
 * building differs. Mirrors api.enhancer.ts's provider resolution and
 * cookie handling, but returns the full generated text as JSON (not a
 * stream), since callers need the complete response before parsing it as
 * structured data.
 */
async function generateTextAction({ context, request }: ActionFunctionArgs) {
  const { system, prompt, model, provider } = await request.json<{
    system?: string;
    prompt: string;
    model: string;
    provider: ProviderInfo;
  }>();

  if (!prompt || typeof prompt !== 'string') {
    throw new Response('Invalid or missing prompt', { status: 400, statusText: 'Bad Request' });
  }

  if (!model || typeof model !== 'string') {
    throw new Response('Invalid or missing model', { status: 400, statusText: 'Bad Request' });
  }

  if (!provider?.name || typeof provider.name !== 'string') {
    throw new Response('Invalid or missing provider', { status: 400, statusText: 'Bad Request' });
  }

  const resolvedProvider = PROVIDER_LIST.find((candidate) => candidate.name === provider.name) || DEFAULT_PROVIDER;

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  try {
    const result = await generateText({
      system,
      prompt,
      model: resolvedProvider.getModelInstance({
        model,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
    });

    return Response.json({ text: result.text });
  } catch (error: unknown) {
    logger.error('Text generation failed:', error);

    if (error instanceof Error && error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', { status: 401, statusText: 'Unauthorized' });
    }

    throw new Response(null, { status: 500, statusText: 'Internal Server Error' });
  }
}
