import { describe, expect, it, vi } from 'vitest';
import { runGenerationPipeline } from './generationPipeline';
import type { GenerateFn } from './codeGenerationTypes';
import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';
import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';

/**
 * Sprint 99, Checkpoint A — regression coverage for AR2-BUG-008 and AR2-BUG-007.
 *
 * Acceptance Round 2 lost every one of 96 backend files while the pipeline reported each feature
 * stage as complete: `last_error` stayed null, no row was marked failed, and the run ended looking
 * like an operator cancellation. Each test below fails against the pre-Sprint-99 pipeline.
 */

function makeProject(): Project {
  return {
    id: 'proj-backend-batch-1',
    name: 'Backend Batch Test',
    icon: '⚡',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'template',
    createdAt: new Date().toISOString(),
  } as Project;
}

function makeEmptyProductPackage(): ProductPackage {
  return {
    projectId: 'proj-backend-batch-1',
    projectName: 'Backend Batch Test',
    assembledAt: '',
    sections: [],
    missingSections: [],
  };
}

const MODULE: BackendModulePlan = {
  moduleSlug: 'FEAT-005',
  featureIds: ['FEAT-005'],
  databaseTables: ['registrations', 'payment_attempts'],
  apiEndpoints: ['POST /api/payments/create-order'],
} as BackendModulePlan;

/**
 * The earlier stages must SUCCEED for a run to reach 'generating-backend' at all, and each stage
 * expects its own file path. Rather than hard-code one, echo back whatever path the stage's prompt
 * asked for; fall back to a page, which is what the pages stage requires to proceed.
 */
function frontendResponseFor(prompt: string): string {
  const asked = [...prompt.matchAll(/"([\w./-]+\.(?:ts|tsx|css))"/g)].map((match) => match[1]);
  const paths = asked.length > 0 ? [...new Set(asked)] : ['src/pages/HomePage.tsx'];

  return JSON.stringify({
    files: paths.map((path) => ({
      path,
      content: path.endsWith('.tsx') ? 'export default function C() { return null; }' : 'export {};',
    })),
  });
}

/** Batch prompts are identified by the marker `buildBackendModuleBatchPrompt` emits — not by the module slug, which can also appear in earlier stages' prompts. */
const BATCH_MARKER = 'Right now, generate ONLY';

function isBackendPrompt(prompt: string | undefined): boolean {
  return Boolean(prompt && prompt.includes(BATCH_MARKER));
}

/** The paths a batch prompt is asking for, parsed out of the section after the marker. */
function askedPathsIn(prompt: string): string[] {
  const section = prompt.split(BATCH_MARKER)[1] ?? '';
  return [...section.matchAll(/- "([^"]+)"/g)].map((match) => match[1]);
}

/** Runs the pipeline with a backend module planned, using the supplied backend responder. */
async function runWithBackend(
  backendResponder: (
    prompt: string,
  ) => { ok: true; text: string; finishReason?: string } | { ok: false; error: string },
  hooks?: Record<string, unknown>,
) {
  const generate: GenerateFn = async (_system, prompt) => {
    if (isBackendPrompt(prompt)) {
      return backendResponder(prompt ?? '') as never;
    }

    return { ok: true, text: frontendResponseFor(prompt ?? '') } as never;
  };

  return runGenerationPipeline(
    makeProject(),
    makeEmptyProductPackage(),
    generate,
    () => {},
    undefined,
    (hooks ?? {}) as never,
    undefined,
    undefined,
    [MODULE],
  );
}

describe('backend generation — batching (Sprint 99, AR2-BUG-008)', () => {
  it('asks for at most three files per call instead of all six', async () => {
    const backendPrompts: string[] = [];

    await runWithBackend((prompt) => {
      backendPrompts.push(prompt);

      return { ok: true, text: JSON.stringify({ files: [] }) };
    });

    expect(backendPrompts.length).toBeGreaterThan(1);

    for (const prompt of backendPrompts) {
      const askedPaths = askedPathsIn(prompt);
      expect(askedPaths.length).toBeGreaterThan(0);
      expect(askedPaths.length).toBeLessThanOrEqual(3);
    }
  });

  it('fails the batch when zero expected files are returned, and names expected vs returned', async () => {
    const onStageFailed = vi.fn();

    const result = await runWithBackend(
      () => ({ ok: true, text: JSON.stringify({ files: [{ path: 'totally/wrong.ts', content: 'x' }] }) }),
      { onStageFailed },
    );

    const backendErrors = result.issues.filter(
      (issue) => issue.stage === 'generating-backend' && issue.severity === 'error',
    );

    expect(backendErrors.length).toBeGreaterThan(0);
    expect(backendErrors[0].message).toContain('FEAT-005');
    expect(backendErrors[0].message).toContain('Expected:');
    expect(backendErrors[0].message).toContain('Returned:');
    expect(backendErrors[0].message).toContain('totally/wrong.ts');

    // The defect: this used to never fire, leaving last_error null.
    expect(onStageFailed).toHaveBeenCalled();
  });

  it('falls back to a smaller batch when a multi-file batch keeps truncating', async () => {
    const askedCounts: number[] = [];
    const ready: string[] = [];

    /*
     * Models a real 8192-token ceiling: two files never fit (always truncated), one file always
     * does. The run can therefore only produce content if the pipeline splits the batch — which is
     * exactly the fallback under test. The recovery layer's own same-size retries are exhausted
     * first; the split is what actually rescues the module.
     */
    await runWithBackend(
      (prompt) => {
        const paths = askedPathsIn(prompt);
        askedCounts.push(paths.length);

        if (paths.length > 1) {
          return { ok: true, text: '{"files":[{"path":"src/features/FEAT-005/types.ts","content":"expo' };
        }

        return {
          ok: true,
          text: JSON.stringify({ files: paths.map((path) => ({ path, content: 'export {};' })) }),
        };
      },
      { onFileReady: (file: { path: string }) => void ready.push(file.path) },
    );

    expect(askedCounts[0]).toBeGreaterThan(1);
    expect(Math.min(...askedCounts)).toBe(1);

    // The split actually rescued the files rather than merely being attempted.
    expect(ready).toContain('src/features/FEAT-005/types.ts');
    expect(ready).toContain('src/features/FEAT-005/validators.ts');
  });

  it('persists every file when batches return their expected paths', async () => {
    const ready: string[] = [];

    const result = await runWithBackend(
      (prompt) => ({
        ok: true,
        text: JSON.stringify({ files: askedPathsIn(prompt).map((path) => ({ path, content: 'export {};' })) }),
      }),

      // safeInvoke forwards only the hook's own args, so onFileReady receives (file, role).
      { onFileReady: (file: { path: string }) => void ready.push(file.path) },
    );

    const backendErrors = result.issues.filter(
      (issue) => issue.stage === 'generating-backend' && issue.severity === 'error',
    );
    expect(backendErrors).toHaveLength(0);

    for (const expected of [
      'src/features/FEAT-005/types.ts',
      'src/features/FEAT-005/validators.ts',
      'src/features/FEAT-005/repository.ts',
      'src/features/FEAT-005/service.ts',
      'src/features/FEAT-005/routes.ts',
      'api/FEAT-005/index.ts',
    ]) {
      expect(ready).toContain(expected);
    }
  });

  it('aborts immediately on a billing error instead of consuming retries', async () => {
    let backendCalls = 0;

    const result = await runWithBackend(() => {
      backendCalls += 1;
      return {
        ok: false,
        error:
          'AI_APICallError: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      };
    });

    expect(result.ok).toBe(false);
    expect(result.terminationReason).toBe('provider-error');

    // Never reported as an operator stop — the AR2-BUG-007 half of the fix.
    expect(result.cancelled).toBeUndefined();

    /*
     * Round 2 made ~800 calls against this error. The recovery layer's own bounded retry still
     * applies within a single callForFiles, but the run aborts at the first classified billing
     * failure rather than walking all three batches of all sixteen modules.
     */
    expect(backendCalls).toBeLessThanOrEqual(3);
  });
});

describe('termination reason (Sprint 99, AR2-BUG-007)', () => {
  it('marks a real operator cancellation as operator-cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      async (_system, prompt) => ({ ok: true, text: frontendResponseFor(prompt ?? '') }) as never,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    expect(result.cancelled).toBe(true);
    expect(result.terminationReason).toBe('operator-cancelled');
  });

  it('never sets cancelled for a provider failure', async () => {
    const result = await runWithBackend(() => ({ ok: false, error: 'invalid api key' }));

    expect(result.cancelled).toBeUndefined();
    expect(result.terminationReason).toBe('provider-error');
  });
});
