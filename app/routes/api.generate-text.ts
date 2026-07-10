import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import type { ProviderInfo } from '~/types/model';
import { PROVIDER_LIST, DEFAULT_PROVIDER } from '~/utils/constants';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { isClaudeReasoningModel } from '~/lib/.server/llm/constants';
import { createScopedLogger } from '~/utils/logger';
import { requireAuthenticatedUser } from '~/lib/auth/requireUser';

const logger = createScopedLogger('api.generate-text');

export async function action(args: ActionFunctionArgs) {
  await requireAuthenticatedUser(args.request, args.context);
  return generateTextAction(args);
}

/**
 * Generic, provider-agnostic one-shot text generation endpoint — Sprint 13,
 * extended Sprint 14 with an optional output token limit.
 *
 * This route contains no business logic of its own. It exists purely so
 * server-only engines (app/lib/projects/businessAnalystEngine.ts,
 * app/lib/projects/solutionArchitectEngine.ts today; future AI roles later)
 * can ask "run this system+prompt through whichever provider/model the user
 * has selected" without importing the LLM provider abstraction
 * (app/lib/modules/llm/) themselves. Every future AI role reuses this exact
 * route unchanged — only the caller's prompt/context building (and,
 * optionally, how large a response it expects) differs. `maxTokens` is
 * accepted generically for that reason — this file has no notion of
 * "Architecture" or any other specific role. Mirrors api.enhancer.ts's
 * provider resolution and cookie handling, but returns the full generated
 * text as JSON (not a stream), since callers need the complete response
 * before parsing it as structured data.
 *
 * Sprint 39.5 — `temperature` is now accepted too, for Generation Profile-routed callers
 * (see app/lib/generation-profiles/) that want a role-specific value. Only ever forwarded
 * to `generateText()` when the selected model is confirmed to accept it
 * (`!isClaudeReasoningModel`, app/lib/.server/llm/constants.ts) — omitted otherwise,
 * exactly like every other caller of that same centralized guard.
 */
async function generateTextAction({ context, request }: ActionFunctionArgs) {
  const { system, prompt, model, provider, maxTokens, temperature } = await request.json<{
    system?: string;
    prompt: string;
    model: string;
    provider: ProviderInfo;
    maxTokens?: number;
    temperature?: number;
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
    const canSendTemperature = !isClaudeReasoningModel(model);

    const result = await generateText({
      system,
      prompt,
      ...(typeof maxTokens === 'number' && maxTokens > 0 ? { maxTokens } : {}),
      ...(typeof temperature === 'number' && canSendTemperature ? { temperature } : {}),
      model: resolvedProvider.getModelInstance({
        model,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
    });

    return Response.json({ text: result.text, finishReason: result.finishReason });
  } catch (error: unknown) {
    logger.error('Text generation failed:', error);

    if (error instanceof Error && error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', { status: 401, statusText: 'Unauthorized' });
    }

    if (error instanceof Error && /max.?tokens|context length|token limit/i.test(error.message)) {
      throw new Response(
        'The selected model does not support the requested output length. Try a different model or a shorter request.',
        { status: 400, statusText: 'Bad Request' },
      );
    }

    throw new Response(null, { status: 500, statusText: 'Internal Server Error' });
  }
}
