import { describe, expect, it } from 'vitest';
import { buildGenerationPlan } from './generationPipeline';

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
