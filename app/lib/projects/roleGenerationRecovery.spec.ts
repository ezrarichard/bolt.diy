import { describe, expect, it, vi } from 'vitest';
import {
  generateRoleWithRecovery,
  type RecoveryGenerateFn,
  type RoleGenerationAttemptLog,
  type RoleGenerationDeps,
} from './roleGenerationRecovery';
import { parseStructuredDraft, type DraftFieldConfig } from './draftParsing';

/**
 * Sprint 44 — recovery-core tests. The recovery function is pure (the `generate` call is
 * injected), so these drive it with scripted provider responses and the REAL shared parser
 * (parseStructuredDraft), covering the reliability requirements without any network/LLM.
 */

interface TestDraft {
  summary?: string;
  items?: string[];
}

const FIELDS: DraftFieldConfig<'summary' | 'items'>[] = [
  { key: 'summary', kind: 'text' },
  { key: 'items', kind: 'list' },
];

const parseDraft = (text: string) => parseStructuredDraft<TestDraft>(text, FIELDS);

type ScriptedResponse = Awaited<ReturnType<RecoveryGenerateFn>>;

/** A fake `generate` that returns one scripted response per attempt (reusing the last once exhausted) and records every call for assertions. */
function scriptedGenerate(responses: ScriptedResponse[]) {
  const calls: { system: string | undefined; prompt: string; options: Record<string, unknown> }[] = [];

  const generate: RecoveryGenerateFn = async (system, prompt, options) => {
    calls.push({ system, prompt, options: (options ?? {}) as Record<string, unknown> });
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  };

  return { generate, calls };
}

const VALID_JSON = '{"summary":"A clear QA plan.","items":["unit","integration"]}';

function baseDeps(
  generate: RecoveryGenerateFn,
  overrides: Partial<RoleGenerationDeps<TestDraft>> = {},
): RoleGenerationDeps<TestDraft> {
  return {
    projectId: 'project-1',
    roleKey: 'qa-draft',
    system: 'SYSTEM',
    prompt: 'BASE_PROMPT',
    contextBlock: 'BUILDERSDB_CONTEXT_BLOCK',
    maxOutputTokens: 8192,
    parseDraft,
    generate,
    baseOptions: { model: 'base-model', provider: 'Anthropic' },
    ...overrides,
  };
}

describe('generateRoleWithRecovery', () => {
  it('(1) accepts a valid JSON response on the first attempt', async () => {
    const { generate, calls } = scriptedGenerate([{ ok: true, text: VALID_JSON, finishReason: 'stop' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, attempts: 1 });

    if (result.ok) {
      expect(result.draft).toEqual({ summary: 'A clear QA plan.', items: ['unit', 'integration'] });
    }

    expect(calls).toHaveLength(1);
  });

  it('(14) leaves the normal (first) attempt unchanged: base prompt + context block + base budget, no JSON-only instruction', async () => {
    const { generate, calls } = scriptedGenerate([{ ok: true, text: VALID_JSON, finishReason: 'stop' }]);

    await generateRoleWithRecovery(baseDeps(generate));

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe('BASE_PROMPT\n\nBUILDERSDB_CONTEXT_BLOCK');
    expect(calls[0].prompt).not.toContain('IMPORTANT: Your previous response was cut off');
    expect(calls[0].options.maxTokens).toBe(8192);
    expect(calls[0].options.model).toBe('base-model');
  });

  it('(2) treats finishReason "length" as truncated and retries instead of parsing it', async () => {
    const { generate, calls } = scriptedGenerate([
      // Even though this looks like complete JSON, finishReason "length" means it must not be trusted/parsed.
      { ok: true, text: VALID_JSON, finishReason: 'length' },
      { ok: true, text: VALID_JSON, finishReason: 'stop' },
    ]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('(2b) retry drops the redundant context block, adds a JSON-only instruction, and raises the output budget', async () => {
    const { generate, calls } = scriptedGenerate([
      { ok: true, text: '{"summary":"cut', finishReason: 'length' },
      { ok: true, text: VALID_JSON, finishReason: 'stop' },
    ]);

    await generateRoleWithRecovery(baseDeps(generate));

    expect(calls[1].prompt).toContain('IMPORTANT: Your previous response was cut off');
    expect(calls[1].prompt).not.toContain('BUILDERSDB_CONTEXT_BLOCK');
    expect(Number(calls[1].options.maxTokens)).toBeGreaterThan(8192);
  });

  it('(3, 7) leaves the stage failed after exhausting retries when every attempt is truncated (never returns a draft)', async () => {
    const { generate, calls } = scriptedGenerate([
      { ok: true, text: '{"summary":"cut off here', finishReason: 'length' },
    ]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.kind).toBe('truncated');
      expect(result.attempts).toBe(3);
    }

    // 1 initial + 2 retries === 3 total attempts, never more (no infinite loop).
    expect(calls).toHaveLength(3);
  });

  it('(3b) detects incomplete JSON with no finishReason via the shared parser truncation signal', async () => {
    const { generate } = scriptedGenerate([{ ok: true, text: '{"summary":"starts but never closes' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.kind).toBe('truncated');
    }
  });

  it('(10) parses valid JSON wrapped in a markdown code fence', async () => {
    const fenced = '```json\n' + VALID_JSON + '\n```';
    const { generate } = scriptedGenerate([{ ok: true, text: fenced, finishReason: 'stop' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.summary).toBe('A clear QA plan.');
    }
  });

  it('(11) parses valid JSON surrounded by explanatory prose', async () => {
    const withProse = `Here is the QA strategy you asked for:\n\n${VALID_JSON}\n\nLet me know if you want changes.`;
    const { generate } = scriptedGenerate([{ ok: true, text: withProse, finishReason: 'stop' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.draft.items).toEqual(['unit', 'integration']);
    }
  });

  it('(12) rejects a JSON object that matches none of the schema fields, never inventing content', async () => {
    const wrongShape = '{"totallyUnknownKey":"value","another":123}';
    const { generate } = scriptedGenerate([{ ok: true, text: wrongShape, finishReason: 'stop' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.kind).toBe('invalid');
    }
  });

  it('(9) an empty response is retried and never returned as a draft', async () => {
    const { generate, calls } = scriptedGenerate([{ ok: true, text: '   ', finishReason: 'stop' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.kind).toBe('empty');
    }

    expect(calls).toHaveLength(3);
  });

  it('respects a maxRetries of 0 (single attempt, no automatic retry)', async () => {
    const { generate, calls } = scriptedGenerate([{ ok: true, text: '{"summary":"cut', finishReason: 'length' }]);

    const result = await generateRoleWithRecovery(baseDeps(generate, { maxRetries: 0 }));

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('uses the stronger fallback model only on the final retry when one is configured', async () => {
    const { generate, calls } = scriptedGenerate([{ ok: true, text: '{"summary":"cut', finishReason: 'length' }]);

    await generateRoleWithRecovery(
      baseDeps(generate, { fallbackOptions: { model: 'strong-fallback-model', provider: 'Anthropic' } }),
    );

    expect(calls).toHaveLength(3);
    expect(calls[0].options.model).toBe('base-model');
    expect(calls[1].options.model).toBe('base-model');
    expect(calls[2].options.model).toBe('strong-fallback-model');
  });

  it('(13) applies the same recovery behaviour to any role, not only QA', async () => {
    const { generate, calls } = scriptedGenerate([
      { ok: true, text: VALID_JSON, finishReason: 'length' },
      { ok: true, text: VALID_JSON, finishReason: 'stop' },
    ]);

    const result = await generateRoleWithRecovery(baseDeps(generate, { roleKey: 'architecture-draft' }));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('retries a hard generate error, then succeeds within the bound', async () => {
    const { generate, calls } = scriptedGenerate([
      { ok: false, error: 'network blip' },
      { ok: true, text: VALID_JSON, finishReason: 'stop' },
    ]);

    const result = await generateRoleWithRecovery(baseDeps(generate));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('emits only safe, non-sensitive telemetry per attempt (no prompt/system/keys)', async () => {
    const logs: RoleGenerationAttemptLog[] = [];
    const onAttempt = vi.fn((log: RoleGenerationAttemptLog) => logs.push(log));
    const { generate } = scriptedGenerate([
      { ok: true, text: '{"summary":"cut', finishReason: 'length' },
      { ok: true, text: VALID_JSON, finishReason: 'stop' },
    ]);

    await generateRoleWithRecovery(baseDeps(generate, { onAttempt }));

    expect(logs.length).toBe(2);

    const allowedKeys = new Set([
      'projectId',
      'roleKey',
      'provider',
      'model',
      'maxOutputTokens',
      'attempt',
      'isRetry',
      'ok',
      'finishReason',
      'outcome',
    ]);

    for (const log of logs) {
      for (const key of Object.keys(log)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    }

    expect(logs[0]).toMatchObject({ outcome: 'truncated', finishReason: 'length', isRetry: false });
    expect(logs[1]).toMatchObject({ outcome: 'success', isRetry: true });
  });
});
