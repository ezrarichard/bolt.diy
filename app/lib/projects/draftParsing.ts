/**
 * Draft Parsing — Sprint 14.
 *
 * Shared, generic "turn the AI's raw text response into a validated draft
 * object" logic, extracted out of app/lib/projects/businessAnalystEngine.ts
 * so app/lib/projects/solutionArchitectEngine.ts (and every future AI
 * role's engine) can reuse the exact same JSON-extraction and
 * field-by-field validation instead of re-implementing it. Pure string/data
 * processing only — no LLM call, no React, no store access.
 */

export interface DraftFieldConfig<TKey extends string = string> {
  key: TKey;
  kind: 'text' | 'list';
}

export type ParsedDraftResult<T> = { ok: true; draft: T } | { ok: false; error: string };

/**
 * Pulls a JSON object out of a raw AI response, tolerating markdown code
 * fences or stray text around it — including a fence whose *closing*
 * marker never arrived because the response was truncated mid-generation.
 * In that case a naive fenced-block regex (which requires both an opening
 * and closing ```) would never match at all, leaving the literal ```json
 * marker in front of the payload; we strip a leading opening fence
 * unconditionally as a fallback so the `{`/`}` heuristic below still has a
 * chance to find the JSON body.
 */
export function extractJsonPayload(rawText: string): string {
  const fencedComplete = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedComplete) {
    return fencedComplete[1].trim();
  }

  let text = rawText.trim();
  const openingFence = text.match(/^```(?:json)?\s*/i);

  if (openingFence) {
    text = text.slice(openingFence[0].length);
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

/**
 * Heuristic: a payload that *looks like* it started as JSON (begins with
 * `{` or `[`) but doesn't end with a matching `}`/`]` as its last
 * non-whitespace character is very likely a response cut off mid-generation
 * (hit an output token limit) rather than a genuine formatting mistake —
 * used to give a clearer, actionable error message than a generic "not
 * valid JSON". Requiring a JSON-like start avoids mislabeling a plain-text
 * refusal/non-JSON response (which never looked like JSON to begin with)
 * as "truncated".
 */
function looksTruncated(payload: string): boolean {
  const trimmed = payload.trim();
  return /^[[{]/.test(trimmed) && !/[}\]]\s*$/.test(trimmed);
}

/**
 * Parses raw AI text into a draft object of shape `T`, validating
 * field-by-field against `fields` (text fields must be non-empty strings,
 * list fields must be arrays of non-empty strings — anything else for a
 * given key is silently dropped rather than failing the whole draft).
 * Returns a discriminated result rather than throwing.
 */
export function parseStructuredDraft<T extends object>(
  rawText: string,
  fields: DraftFieldConfig<Extract<keyof T, string>>[],
): ParsedDraftResult<T> {
  const payload = extractJsonPayload(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    if (looksTruncated(payload)) {
      return { ok: false, error: 'The AI response was cut off before completing valid JSON. Please regenerate.' };
    }

    return { ok: false, error: 'The AI response was not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The AI response was not a JSON object.' };
  }

  const source = parsed as Record<string, unknown>;
  const draft = {} as T;

  for (const field of fields) {
    const value = source[field.key];

    if (field.kind === 'list') {
      if (Array.isArray(value)) {
        const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

        if (items.length > 0) {
          (draft as Record<string, string[]>)[field.key] = items;
        }
      }
    } else if (typeof value === 'string' && value.trim().length > 0) {
      (draft as Record<string, string>)[field.key] = value.trim();
    }
  }

  return { ok: true, draft };
}
