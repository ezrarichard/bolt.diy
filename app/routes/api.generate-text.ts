import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import type { ProviderInfo } from '~/types/model';
import { PROVIDER_LIST, DEFAULT_PROVIDER } from '~/utils/constants';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { isUnsupportedSamplingParameterError, stripUnsupportedSamplingParameters } from '~/lib/.server/llm/constants';
import { createScopedLogger } from '~/utils/logger';
import { requireAuthenticatedUser } from '~/lib/auth/requireUser';
import { recordAiUsage, getRequestAccessToken } from '~/lib/ai-usage/recordAiUsage';

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
 * (see app/lib/generation-profiles/) that want a role-specific value.
 *
 * Sprint 44 — sampling parameters are filtered through the single centralized compatibility
 * guard (`stripUnsupportedSamplingParameters`, app/lib/.server/llm/constants.ts): models that
 * accept them (Sonnet 4.5/4.6 and every other non-reasoning model) keep `temperature`; models
 * that reject them (Sonnet 5+, Opus 4.7+, OpenAI o-series) have it stripped up front. If an
 * unknown future model rejects them at runtime, the call is retried exactly once with those
 * parameters removed (`isUnsupportedSamplingParameterError`) — never for any other error.
 */
async function generateTextAction({ context, request }: ActionFunctionArgs) {
  const {
    system,
    prompt,
    model,
    provider,
    maxTokens,
    temperature,
    projectId,
    roleKey,
    modelKey,
    generationProfileId,
    requestType,
    operationId,
  } = await request.json<{
    system?: string;
    prompt: string;
    model: string;
    provider: ProviderInfo;
    maxTokens?: number;
    temperature?: number;

    /** Sprint 42.1 — AI usage-ledger attribution (see app/lib/ai-usage/); all optional, all client-supplied hints only. None of these are trusted for anything except attribution/reporting — projectId is independently re-validated inside builders_record_ai_usage() before being associated with a usage row (see the migration), and user_id is never taken from the body at all (see recordAiUsage.ts). */
    projectId?: string;
    roleKey?: string;
    modelKey?: string;
    generationProfileId?: string;
    requestType?: string;
    operationId?: string;
  }>();

  const accessToken = getRequestAccessToken(request);
  const startedAt = Date.now();

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

  const resolvedRequestType = requestType ?? roleKey ?? 'code_generation';

  try {
    const modelInstance = resolvedProvider.getModelInstance({
      model,
      serverEnv: context.cloudflare?.env as any,
      apiKeys,
      providerSettings,
    });

    const baseParams = {
      system,
      prompt,
      model: modelInstance,
      ...(typeof maxTokens === 'number' && maxTokens > 0 ? { maxTokens } : {}),
    };

    /*
     * Sprint 44 — model-aware sampling parameters via the centralized guard. Sonnet 4.5/4.6
     * (and every non-reasoning model) keep `temperature`; Sonnet 5+/Opus 4.7+/OpenAI o-series
     * have it stripped up front. An UNKNOWN future model that rejects it isn't stripped here,
     * so the one-time retry below is the safety net.
     */
    const samplingParams = stripUnsupportedSamplingParameters(
      model,
      typeof temperature === 'number' ? { temperature } : {},
    );

    let result: Awaited<ReturnType<typeof generateText>>;

    try {
      result = await generateText({ ...baseParams, ...samplingParams });
    } catch (samplingError) {
      // Sprint 44 — one-time retry ONLY for an explicit unsupported-sampling-parameter rejection: strip the sampling params and re-issue the same request exactly once. Any other error (rate limit, billing, auth, token limit) re-throws to the outer handler unchanged, and no already-completed AI role is touched.
      if (isUnsupportedSamplingParameterError(samplingError) && Object.keys(samplingParams).length > 0) {
        logger.warn(`Model "${model}" rejected sampling parameters — retrying once without temperature/topP/topK.`);
        result = await generateText({ ...baseParams });
      } else {
        throw samplingError;
      }
    }

    /*
     * Sprint 42.1 — record usage after a successful call, never blocking the response on it
     * (recordAiUsage() never throws/rejects — see its own comment). Prefer the provider-
     * reported usage the `ai` SDK already surfaced; if it's ever absent, store zeros and mark
     * metadata.usage_source so a later report can distinguish "definitely zero tokens" from
     * "we don't actually know" rather than conflating the two.
     */
    const usageSource = result.usage ? 'provider' : 'unavailable';
    recordAiUsage(accessToken, {
      projectId: projectId ?? null,
      requestType: resolvedRequestType,
      roleKey: roleKey ?? null,
      generationProfileId: generationProfileId ?? null,
      operationId: operationId ?? null,
      provider: resolvedProvider.name,
      modelKey: modelKey ?? null,
      apiModel: model,
      usage: {
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
      },
      durationMs: Date.now() - startedAt,
      status: 'success',
      metadata: { usage_source: usageSource, finish_reason: result.finishReason ?? null },
    }).catch(() => undefined);

    return Response.json({ text: result.text, finishReason: result.finishReason });
  } catch (error: unknown) {
    logger.error('Text generation failed:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isApiKeyError = error instanceof Error && errorMessage.includes('API key');
    const isTokenLimitError = error instanceof Error && /max.?tokens|context length|token limit/i.test(errorMessage);
    const errorCode = isApiKeyError
      ? 'invalid_api_key'
      : isTokenLimitError
        ? 'token_limit_exceeded'
        : 'generation_failed';

    // Sanitized: no stack trace, no request/response body, just the classified reason — see the sprint's DO NOT STORE list.
    recordAiUsage(accessToken, {
      projectId: projectId ?? null,
      requestType: resolvedRequestType,
      roleKey: roleKey ?? null,
      generationProfileId: generationProfileId ?? null,
      operationId: operationId ?? null,
      provider: resolvedProvider.name,
      modelKey: modelKey ?? null,
      apiModel: model,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      errorCode,
      errorMessage: errorCode === 'generation_failed' ? 'Text generation failed' : errorMessage,
    }).catch(() => undefined);

    if (isApiKeyError) {
      throw new Response('Invalid or missing API key', { status: 401, statusText: 'Unauthorized' });
    }

    if (isTokenLimitError) {
      throw new Response(
        'The selected model does not support the requested output length. Try a different model or a shorter request.',
        { status: 400, statusText: 'Bad Request' },
      );
    }

    throw new Response(null, { status: 500, statusText: 'Internal Server Error' });
  }
}
