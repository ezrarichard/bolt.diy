import { extractJsonPayload } from '~/lib/projects/draftParsing';
import {
  buildDiscoveryFactExtractionPrompt,
  DISCOVERY_FACT_EXTRACTION_SYSTEM_PROMPT,
} from '~/lib/projects/prompts/discoveryFactExtraction';
import type { CandidateFact, DiscoveryContext, GenerateTextFn } from './types';

/**
 * Fact Extractor — Sprint 57, Part 3. Sprint 57.1, Task 5/8 — distinguishes a genuine
 * extraction failure from a legitimate empty result.
 *
 * The ONLY module in the Discovery AI Engine that talks to an LLM, and even then only through
 * the injected `generateText` (see `types.ts`'s `GenerateTextFn` doc comment) — never the `ai`
 * SDK directly, never a `fetch` call of its own. This mirrors `businessAnalystEngine.ts`'s own
 * "does NOT call an LLM" discipline one level down: the *engine* doesn't call an LLM either, it
 * calls whatever its caller handed it, so this file has zero knowledge of which provider/model is
 * in use, and is trivially unit-testable with a fake `generateText`.
 *
 * Per Part 3's explicit requirement, this function's return value is inert data — it never
 * writes to BuildersDB, never calls a repository, and is not itself the source of truth for
 * anything. `discoveryAiEngine.ts` is the only caller, and only after `factValidator.ts`/
 * `factNormalizer.ts`/`confidenceScorer.ts`/`contradictionDetector.ts` have all run does
 * anything from here reach a `BusinessUnderstandingModelPatch`.
 */

export interface ExtractionOutcome {
  candidates: CandidateFact[];

  /**
   * Set for a genuine failure — the `generateText` call itself failed (network/auth/provider
   * error), or the response wasn't parseable as the expected JSON shape at all (garbage/
   * provider-refusal text, truncated mid-JSON, etc.). NEVER set for a well-formed
   * `{"facts": []}` — that's the model correctly reporting nothing extractable, a normal,
   * expected outcome (architecture doc §13's "very short answers" case), not an error.
   */
  error?: string;
}

interface RawExtractionResponse {
  facts?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pulls valid `{dimension, value}` entries out of `parsed.facts`, silently dropping any entry missing a required field — Part 5's "malformed/partially valid facts" case; one bad entry never fails the whole batch. */
function extractValidEntries(facts: unknown[]): CandidateFact[] {
  const candidates: CandidateFact[] = [];

  for (const entry of facts) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const { dimension, value } = entry;

    if (typeof dimension === 'string' && typeof value === 'string') {
      candidates.push({ dimension, value });
    }
  }

  return candidates;
}

/**
 * Defensive parsing — tolerates markdown fences and leading/trailing prose (via
 * `extractJsonPayload`, the same helper `draftParsing.ts` uses for AI JSON responses
 * elsewhere). A genuinely malformed/truncated/non-JSON response (provider refusal, garbage,
 * a response cut off mid-generation) is reported as an `error`, never silently converted into
 * a trusted empty result — Part 5's explicit "do not silently convert malformed AI output into
 * trusted facts."
 */
function parseCandidateFacts(rawText: string): ExtractionOutcome {
  const payload = extractJsonPayload(rawText);

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload) as RawExtractionResponse;
  } catch {
    return { candidates: [], error: 'The AI response was not valid JSON.' };
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.facts)) {
    return { candidates: [], error: 'The AI response was not in the expected format.' };
  }

  return { candidates: extractValidEntries(parsed.facts) };
}

/**
 * Extracts candidate facts from `context.rawText` via one LLM call. Never throws — a
 * `generateText` failure (network error, invalid API key, provider timeout, etc.) is reported
 * via `error` rather than thrown, so the caller (`discoveryAiEngine.ts`) can decide how to react
 * (Task 8: a real failure must not silently advance the conversation) without a try/catch of
 * its own.
 */
export async function extractFacts(
  context: DiscoveryContext,
  generateText: GenerateTextFn,
): Promise<ExtractionOutcome> {
  const prompt = buildDiscoveryFactExtractionPrompt(context);
  const result = await generateText(DISCOVERY_FACT_EXTRACTION_SYSTEM_PROMPT, prompt);

  if (!result.ok) {
    return { candidates: [], error: result.error };
  }

  return parseCandidateFacts(result.text);
}
