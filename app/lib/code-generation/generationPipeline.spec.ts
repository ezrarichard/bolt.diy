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
