/**
 * AI Usage Ledger — Sprint 42.1.
 *
 * Shared types for builders_ai_usage_events (see the Sprint 42 migration's "AI Usage Ledger
 * Foundation" section). One row per AI request — see recordAiUsage.ts for the write path.
 */

export type AiUsageStatus = 'success' | 'failed' | 'cancelled';

/**
 * Current callers, kept only for editor autocomplete — request_type is a plain `text` column
 * with no check constraint (see the migration), so a new AI role or request kind never needs
 * a schema change, only a new string value here (optional) and at the call site.
 */
export type KnownAiUsageRequestType =
  | 'quick_chat'
  | 'requirements'
  | 'architecture'
  | 'database'
  | 'uiux'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'devops'
  | 'code_generation'
  | 'code_review'
  | 'repair'
  | 'build_validation'
  | 'runtime_debug';

/** A known value for autocomplete, or any other string — deliberately not a rigid union. */
export type AiUsageRequestType = KnownAiUsageRequestType | (string & {});

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cachedOutputTokens?: number;

  /** Provider-reported total when available; computed as input+output otherwise (see recordAiUsage.ts). */
  totalTokens?: number;
}

export interface AiUsageEventInput {
  projectId?: string | null;
  requestType: AiUsageRequestType;
  roleKey?: string | null;
  generationProfileId?: string | null;
  operationId?: string | null;
  parentOperationId?: string | null;

  provider: string;

  /** Logical key from app/lib/generation-profiles/modelRegistry.ts, when the call went through Generation Profile routing. Null for calls that only ever had a raw provider model id (e.g. Chat's own model dropdown). */
  modelKey?: string | null;

  /** The exact string sent to the provider — always present, unlike modelKey. */
  apiModel: string;

  usage?: AiTokenUsage;
  durationMs?: number | null;
  status: AiUsageStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerRequestId?: string | null;
  repairAttemptNumber?: number | null;

  /** Operational metadata only — never a prompt, response, key, token, or header. See recordAiUsage.ts's DO NOT STORE list. */
  metadata?: Record<string, unknown>;

  inputCostUsd?: number | null;
  outputCostUsd?: number | null;
  estimatedCostUsd?: number | null;
  pricingVersion?: string | null;
}
