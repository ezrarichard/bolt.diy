import { describe, expect, it } from 'vitest';
import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import type { GenerateFn } from './codeGenerationTypes';
import { buildGenerationPlan, runGenerationPipeline } from './generationPipeline';

describe('buildGenerationPlan — component naming (word-boundary truncation)', () => {
  it('never cuts a component name mid-word, even for a long, comma-heavy page description', () => {
    /*
     * Live-reproduced root cause (StyleHub Coimbatore smoke test): a page name this
     * descriptive used to PascalCase-then-character-slice to "...ProductGPage" — a
     * truncated fragment of "...ProductGridPage". Every word in the resulting component
     * name must be whole.
     */
    const plan = buildGenerationPlan({
      frontend: {
        pageHierarchy: ['Collections with Category Filter Tabs Men Women Product Grid Display'],
      },
    } as any);

    const componentName = plan.pages[0].componentName;

    expect(componentName.endsWith('Page')).toBe(true);

    /*
     * Every capital-letter-delimited chunk (PascalCase word) must be a real dictionary-ish
     * word from the source, i.e. reconstructing the words used must all be exact prefixes
     * of the original name's words, never a partial word.
     */
    const words = componentName.replace(/Page$/, '').match(/[A-Z][a-z]*/g) ?? [];
    const sourceWords = 'Collections with Category Filter Tabs Men Women Product Grid Display'.split(' ');

    for (const word of words) {
      expect(sourceWords.some((sourceWord) => sourceWord.toLowerCase() === word.toLowerCase())).toBe(true);
    }
  });

  it('keeps component names collision-safe when two page names truncate to the same stable prefix', () => {
    const plan = buildGenerationPlan({
      frontend: {
        pageHierarchy: ['Home', 'A'.repeat(80) + ' One', 'A'.repeat(80) + ' Two'],
      },
    } as any);

    const names = plan.pages.map((page) => page.componentName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to "HomePage" only when the name has no usable characters at all', () => {
    const plan = buildGenerationPlan({ frontend: { pageHierarchy: ['!!!'] } } as any);
    expect(plan.pages[0].componentName).toBe('HomePage');
  });

  it('produces a valid, reasonably short TypeScript identifier for every page', () => {
    const plan = buildGenerationPlan({
      frontend: {
        pageHierarchy: ['Search Results: Query display, filter controls, product grid, no-results state'],
      },
    } as any);

    const componentName = plan.pages[0].componentName;
    expect(componentName).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    expect(componentName.length).toBeLessThanOrEqual(60);
  });
});

function makeProject(): Project {
  return {
    id: 'proj-manifest-1',
    name: 'Manifest Test Project',
    icon: '⚡',
    color: 'purple',
    projectType: 'guided_engineering',
    createdFrom: 'template',
    createdAt: new Date().toISOString(),
  } as Project;
}

function makeEmptyProductPackage(): ProductPackage {
  return {
    projectId: 'proj-manifest-1',
    projectName: 'Manifest Test Project',
    assembledAt: '',
    sections: [],
    missingSections: [],
  };
}

/** Always returns one small, valid file — enough for every stage's parseGeneratedFilesResponse() to succeed without needing realistic content. */
const stubGenerate: GenerateFn = async () => ({
  ok: true,
  text: JSON.stringify({ files: [{ path: 'src/stub.ts', content: 'export {};' }] }),
});

describe('runGenerationPipeline — onPlanReady (Sprint 44.2 Application Manifest hook)', () => {
  it('calls onPlanReady with the deterministic plan before any AI generate() call', async () => {
    const calls: string[] = [];
    const generate: GenerateFn = async (...args) => {
      calls.push('generate');
      return stubGenerate(...args);
    };

    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      generate,
      () => {},
      (plan) => {
        calls.push('onPlanReady');
        expect(plan.pages.length).toBeGreaterThan(0);
      },
    );

    expect(calls[0]).toBe('onPlanReady');
    expect(calls.slice(1).every((call) => call === 'generate')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('awaits an async onPlanReady before the first AI call starts', async () => {
    const order: string[] = [];
    const generate: GenerateFn = async (...args) => {
      order.push('generate-start');
      return stubGenerate(...args);
    };

    await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      generate,
      () => {},
      async (plan) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('onPlanReady-resolved');
        void plan;
      },
    );

    expect(order[0]).toBe('onPlanReady-resolved');
    expect(order.length).toBeGreaterThan(1);
    expect(order.slice(1).every((entry) => entry === 'generate-start')).toBe(true);
  });

  it('does not fail the pipeline when onPlanReady throws — recorded as a warning issue instead', async () => {
    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      stubGenerate,
      () => {},
      () => {
        throw new Error('manifest persistence boom');
      },
    );

    expect(result.ok).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.severity === 'warning' && issue.message.includes('manifest persistence boom'),
      ),
    ).toBe(true);
  });

  it('still runs correctly with no onPlanReady provided (backward compatible)', async () => {
    const result = await runGenerationPipeline(makeProject(), makeEmptyProductPackage(), stubGenerate, () => {});
    expect(result.ok).toBe(true);
  });
});

describe('runGenerationPipeline — file lifecycle hooks (Sprint 44.2 Phase 2, incremental persistence)', () => {
  it('persists each file incrementally: onFilesStarting then onFileReady fire per file, before the whole run finishes', async () => {
    const events: string[] = [];

    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      stubGenerate,
      () => {},
      undefined,
      {
        onFilesStarting: (role, path) => {
          events.push(`starting:${role}:${path ?? '(batch)'}`);
        },
        onFileReady: (file, role) => {
          events.push(`ready:${role}:${file.path}`);
        },
        onStageFailed: (role) => {
          events.push(`failed:${role}`);
        },
      },
    );

    expect(result.ok).toBe(true);

    /*
     * types and services each get a starting/ready pair before pages ever begin.
     * `onFilesStarting`'s path is the canonical EXPECTED path (known before the AI call);
     * `onFileReady`'s path is whatever the stub actually returned — deliberately not
     * asserted to be identical, since a real model isn't guaranteed to match its own
     * prompt's requested path either (see manifestBuilder.ts's own header comment on
     * this — reconciliation, not equality, is Phase 2's answer to that gap).
     */
    expect(events[0]).toBe('starting:code-gen-types:src/types/index.ts');
    expect(events[1]).toBe('ready:code-gen-types:src/stub.ts');
    expect(events[2]).toBe('starting:code-gen-services:src/services/api.ts');
    expect(events[3]).toBe('ready:code-gen-services:src/stub.ts');

    // Every 'starting' has a corresponding 'ready' later in the same run — nothing is generated without a lifecycle event.
    const startingCount = events.filter((e) => e.startsWith('starting:')).length;
    const readyCount = events.filter((e) => e.startsWith('ready:')).length;
    expect(readyCount).toBeGreaterThan(0);
    expect(startingCount).toBeGreaterThan(0);
  });

  it('persists deterministic scaffold files too, not just AI-generated ones (requirement F)', async () => {
    const readyFiles: { path: string; role: string }[] = [];

    await runGenerationPipeline(makeProject(), makeEmptyProductPackage(), stubGenerate, () => {}, undefined, {
      onFileReady: (file, role) => {
        readyFiles.push({ path: file.path, role });
      },
    });

    const scaffoldReady = readyFiles.filter((entry) => entry.role === 'scaffold');
    const scaffoldPaths = scaffoldReady.map((entry) => entry.path);

    expect(scaffoldPaths).toEqual(
      expect.arrayContaining(['package.json', 'src/App.tsx', 'src/main.tsx', 'index.html']),
    );
  });

  it('a page failure preserves already-persisted files — onStageFailed fires only for the failed page, prior onFileReady calls stand', async () => {
    let callCount = 0;
    const generate: GenerateFn = async (...args) => {
      callCount += 1;

      /*
       * The default (empty Product Package) plan calls generate() in order: types,
       * services, then the one page. callForFiles() retries a failure up to 2 more times
       * (generateRoleWithRecovery's bounded retry) before giving up, so every call from
       * the page's first attempt onward must fail for the page to actually exhaust
       * retries and report failed — a single failed call would just get silently
       * retried-and-succeed, which is not what this test is checking.
       */
      if (callCount >= 3) {
        return { ok: false, error: 'model quota exceeded' };
      }

      return stubGenerate(...args);
    };

    const readyPaths: string[] = [];
    const failedPaths: string[] = [];

    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      generate,
      () => {},
      undefined,
      {
        onFileReady: (file) => {
          readyPaths.push(file.path);
        },
        onStageFailed: (_role, _error, path) => {
          if (path) {
            failedPaths.push(path);
          }
        },
      },
    );

    // types/services succeeded and were persisted before the page exhausted its retries — that prior work is untouched, even though the overall run still fails validation (its only page never materialized).
    expect(readyPaths.filter((path) => path === 'src/stub.ts')).toHaveLength(2);
    expect(failedPaths).toContain('src/pages/HomePage.tsx');
    expect(result.failedStage).toBe('validating');
  });

  it('reports an extra file returned beyond the one planned page path via onFileReady (surfacing an unplanned file for reconciliation)', async () => {
    const generate: GenerateFn = async () => ({
      ok: true,
      text: JSON.stringify({
        files: [
          { path: 'src/pages/HomePage.tsx', content: 'export default function HomePage() { return null; }' },
          { path: 'src/pages/BonusWidget.tsx', content: 'export default function BonusWidget() { return null; }' },
        ],
      }),
    });

    const readyPaths: string[] = [];

    await runGenerationPipeline(makeProject(), makeEmptyProductPackage(), generate, () => {}, undefined, {
      onFileReady: (file) => {
        readyPaths.push(file.path);
      },
    });

    expect(readyPaths).toContain('src/pages/BonusWidget.tsx');
  });

  it('a thrown file-lifecycle hook is recorded as a warning issue, never a pipeline failure', async () => {
    const result = await runGenerationPipeline(
      makeProject(),
      makeEmptyProductPackage(),
      stubGenerate,
      () => {},
      undefined,
      {
        onFileReady: () => {
          throw new Error('persistence boom');
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(
      result.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('persistence boom')),
    ).toBe(true);
  });

  it('runs correctly with no fileHooks provided at all (backward compatible)', async () => {
    const result = await runGenerationPipeline(makeProject(), makeEmptyProductPackage(), stubGenerate, () => {});
    expect(result.ok).toBe(true);
  });
});
