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
 * Claude 5-family reasoning models (Sonnet 5, Opus 4.8, Fable 5) reject the
 * `temperature` parameter entirely ("temperature is deprecated for this
 * model") rather than requiring it pinned to 1 like OpenAI's o1/o3/gpt-5 —
 * kept as its own check (not folded into isReasoningModel above) so callers
 * can tell "omit temperature outright" (Claude 5 family) apart from "pin
 * temperature to 1" (OpenAI reasoning family); see stream-text.ts and
 * api.llmcall.ts for where that distinction matters.
 *
 * Matched by prefix so a future dated suffix on the same base name (e.g.
 * "claude-sonnet-5-20260101") is still recognized, without matching
 * structurally-similar-but-different real models like "claude-sonnet-4-5"
 * (Sonnet 4.5) or "claude-opus-4-5" (Opus 4.5), which keep sending
 * temperature normally. Extend this list when a new Claude 5-family model
 * ships.
 */
const CLAUDE_REASONING_MODEL_PREFIXES = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'];

export function isClaudeReasoningModel(modelName: string): boolean {
  return CLAUDE_REASONING_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix));
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
