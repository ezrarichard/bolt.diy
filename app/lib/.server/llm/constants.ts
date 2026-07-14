/*
 * Maximum tokens for response generation (updated for modern model capabilities)
 * This serves as a fallback when model-specific limits are unavailable
 * Modern models like Claude 3.5, GPT-4o, and Gemini Pro support 128k+ tokens
 */
export const MAX_TOKENS = 128000;

/*
 * Provider-specific default completion token limits
 * Used as fallbacks when model doesn't specify maxCompletionTokens
 */
export const PROVIDER_COMPLETION_LIMITS: Record<string, number> = {
  OpenAI: 4096, // Standard GPT models (o1 models have much higher limits)
  Github: 4096, // GitHub Models use OpenAI-compatible limits
  Anthropic: 64000, // Conservative limit for Claude 4 models (Opus: 32k, Sonnet: 64k)
  Google: 8192, // Gemini 1.5 Pro/Flash standard limit
  Cohere: 4000,
  DeepSeek: 8192,
  Groq: 8192,
  HuggingFace: 4096,
  Mistral: 8192,
  Ollama: 8192,
  OpenRouter: 8192,
  Perplexity: 8192,
  Together: 8192,
  xAI: 8192,
  LMStudio: 8192,
  OpenAILike: 8192,
  AmazonBedrock: 8192,
  Hyperbolic: 8192,
};

/*
 * Reasoning models that require maxCompletionTokens instead of maxTokens
 * These models use internal reasoning tokens and have different API parameter requirements
 */
export function isReasoningModel(modelName: string): boolean {
  const result = /^(o1|o3|gpt-5)/i.test(modelName);

  // DEBUG: Test regex matching
  console.log(`REGEX TEST: "${modelName}" matches reasoning pattern: ${result}`);

  return result;
}

/*
 * Claude models that reject the `temperature` parameter entirely ("temperature is
 * deprecated for this model") rather than requiring it pinned to 1 like OpenAI's
 * o1/o3/gpt-5 — kept as its own check (not folded into isReasoningModel above) so
 * callers can tell "omit temperature outright" (this list) apart from "pin temperature
 * to 1" (OpenAI reasoning family); see stream-text.ts and api.llmcall.ts for where that
 * distinction matters.
 *
 * Sprint 39.5 — this is now the SINGLE centralized guard for every caller, chat included
 * and the Generation Profile-routed AI Engineering Team calls (see
 * app/lib/generation-profiles/modelRegistry.ts, whose `supportsTemperature` field is
 * descriptive metadata only — the actual enforcement always runs through this function,
 * so there remains exactly one place to extend). Verified LIVE against the real
 * Anthropic API (a real `/v1/messages` call with `temperature` set) rather than guessed:
 * 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5', and 'claude-opus-4-7' all
 * reject it; 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-opus-4-6',
 * 'claude-opus-4-5', 'claude-opus-4-1', and 'claude-haiku-4-5' all accept it normally.
 *
 * Matched by prefix so a future dated suffix on the same base name (e.g.
 * "claude-sonnet-5-20260101") is still recognized. Extend this list (and only this list)
 * when a new Claude model is confirmed to deprecate temperature.
 */
const CLAUDE_REASONING_MODEL_PREFIXES = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-opus-4-7'];

export function isClaudeReasoningModel(modelName: string): boolean {
  return CLAUDE_REASONING_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix));
}

/**
 * Sprint 44 — the non-default sampling parameters that "reasoning" models reject. Both
 * OpenAI's o1/o3/gpt-5 and the listed Claude models (Sonnet 5+, Opus 4.7/4.8, Fable 5)
 * refuse these; only the remediation differs (OpenAI pins `temperature` to 1, Claude omits
 * it entirely — the caller re-adds the pin after stripping). Kept as one list so no route
 * re-types the key set.
 */
export const REASONING_UNSUPPORTED_SAMPLING_KEYS = [
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'logprobs',
  'topLogprobs',
  'logitBias',
] as const;

/** True for any Anthropic Claude model id (every Anthropic model this app offers is named `claude-*`). */
export function isAnthropicModel(modelName: string): boolean {
  return /^claude/i.test(modelName);
}

/*
 * Sprint 44 — the Claude models KNOWN to accept non-default sampling parameters (temperature
 * etc.). Any Anthropic model NOT matched here (and not in the reject-list above) is treated as
 * an unknown/future family and has its sampling parameters omitted conservatively — the safer
 * default for a new model whose requirements aren't verified yet, backed by the one-time
 * unsupported-parameter retry. Matched by prefix so dated suffixes (e.g.
 * "claude-sonnet-4-5-20250929") and both `-`/`.` separators are covered. Extend this list when
 * a new Claude model is confirmed to accept sampling parameters.
 */
const CLAUDE_SAMPLING_COMPATIBLE_PREFIXES = [
  'claude-3', // Claude 3 / 3.5 / 3.7 families — standard sampling-compatible models
  'claude-sonnet-4-5',
  'claude-sonnet-4.5',
  'claude-sonnet-4-6',
  'claude-sonnet-4.6',
  'claude-haiku-4-5',
  'claude-haiku-4.5',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
];

function isKnownSamplingCompatibleClaudeModel(modelName: string): boolean {
  return CLAUDE_SAMPLING_COMPATIBLE_PREFIXES.some((prefix) => modelName.startsWith(prefix));
}

/**
 * Sprint 44 — the single predicate every generation route shares to decide whether a model
 * rejects non-default sampling parameters. Combines the centralized prefix guards so model
 * names live in exactly one place:
 *  - OpenAI reasoning (o1/o3/gpt-5) → rejects.
 *  - Explicit Claude reject-list (Sonnet 5+, Opus 4.7/4.8, Fable 5) → rejects.
 *  - Any OTHER Anthropic model that isn't a KNOWN sampling-compatible Claude (Sonnet 4.5/4.6,
 *    Haiku 4.5, Claude 3.x, …) → rejects. This makes the default for an unknown/future
 *    Anthropic family CONSERVATIVE (omit), not permissive.
 *  - Every non-Anthropic, non-reasoning model → allowed (unchanged).
 *
 * A known-compatible model that is later found to reject params (or an unknown model that
 * actually accepts them) is still handled at runtime by isUnsupportedSamplingParameterError +
 * the one-time retry.
 */
export function modelRejectsSamplingParameters(modelName: string): boolean {
  if (isReasoningModel(modelName) || isClaudeReasoningModel(modelName)) {
    return true;
  }

  if (isAnthropicModel(modelName)) {
    return !isKnownSamplingCompatibleClaudeModel(modelName);
  }

  return false;
}

/**
 * Sprint 44 — the single centralized compatibility filter used by every generation route
 * (Software Factory generation, Quick Build/chat, and the direct LLM-call route). Returns
 * `options` with the unsupported sampling parameters removed for a model that rejects them,
 * and unchanged otherwise. Pure — no model-prefix logic of its own beyond
 * modelRejectsSamplingParameters.
 */
export function stripUnsupportedSamplingParameters(
  modelName: string,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!options || !modelRejectsSamplingParameters(modelName)) {
    return options ?? {};
  }

  const unsupportedKeys = REASONING_UNSUPPORTED_SAMPLING_KEYS as readonly string[];

  return Object.fromEntries(Object.entries(options).filter(([key]) => !unsupportedKeys.includes(key)));
}

/**
 * Sprint 44 — true only when a provider error is specifically a rejection of a non-default
 * sampling parameter (temperature / top_p / top_k), e.g. Anthropic's "temperature is
 * deprecated for this model". Callers use this to strip those parameters and retry the same
 * request exactly once — never for unrelated failures (rate limits, billing, truncation,
 * auth), which must not trigger a sampling-param retry.
 */
export function isUnsupportedSamplingParameterError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();

  if (!message) {
    return false;
  }

  const mentionsSamplingParam = /\btemperature\b|top[\s_-]?p|top[\s_-]?k|sampling parameter/.test(message);
  const mentionsRejection =
    /unsupported|not supported|not permitted|is not allowed|deprecated|unexpected|cannot be|must be removed|invalid/.test(
      message,
    );

  return mentionsSamplingParam && mentionsRejection;
}

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
  lockedByFolder?: string;
}

export interface Folder {
  type: 'folder';
  isLocked?: boolean;
  lockedByFolder?: string;
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yml',
];
