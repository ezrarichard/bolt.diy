import { describe, expect, it, vi } from 'vitest';
import type { GenerateFn, GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import { runStaticReviewLoop } from './repairEngine';
import type { OnRepairLoopEvent, RepairLoopEvent } from './codeReviewTypes';

function project(files: Record<string, string>): GeneratedProject {
  return {
    projectId: 'p1',
    templateId: 'quick-build',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    folders: [],
    generatedAt: new Date().toISOString(),
  };
}

function collectEvents(): { onEvent: OnRepairLoopEvent; events: RepairLoopEvent[] } {
  const events: RepairLoopEvent[] = [];
  return { onEvent: (event) => events.push(event), events };
}

const baseParams = {
  projectId: 'p1',
  projectName: 'Test Project',
  productPackageSummary: 'summary',
};

describe('runStaticReviewLoop — deterministic assembly repair (no LLM call needed)', () => {
  it('repairs a missing barrel export deterministically and never calls generate()', async () => {
    const p = project({
      'package.json': '{}',
      'src/main.tsx': "import App from './App'",
      'src/App.tsx': 'export default function App() { return null; }\n',
      'src/types/product.ts': 'export interface Product { id: string; }\n',
      'src/types/index.ts': 'export {};\n',
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { const x: Product[] = []; return null; }',
      ].join('\n'),
    });

    const generate = vi.fn<GenerateFn>();
    const { onEvent, events } = collectEvents();

    const result = await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent });

    expect(result.ok).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(result.deterministicRepairedFiles).toContain('src/types/index.ts');
    expect(events.some((e) => e.type === 'static-validation-passed')).toBe(true);
    expect(events.some((e) => e.type === 'repair-patch-applied')).toBe(true);
  });
});

describe('runStaticReviewLoop — repair limit', () => {
  it('stops after maxAttempts LLM repair attempts and reports failure, never looping forever', async () => {
    // An issue with no deterministic fix available (symbol genuinely doesn't exist anywhere).
    const p = project({
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { return null; }',
      ].join('\n'),
      'src/types/index.ts': 'export {};\n',
    });

    /*
     * The "Repair Engineer" keeps returning a patch that touches an irrelevant file, so the
     * issue never actually resolves — this is exactly the scenario a real, stubborn LLM
     * failure would produce.
     */
    const generate = vi.fn<GenerateFn>().mockImplementation(async () => ({
      ok: true,
      text: JSON.stringify({
        filesToCreate: [],
        filesToUpdate: [
          { path: 'src/types/index.ts', content: `export {}; // attempt ${generate.mock.calls.length}\n` },
        ],
        filesToDelete: [],
        explanation: 'attempted fix',
        confidence: 0.5,
        remainingRisks: [],
      }),
    }));

    const { onEvent, events } = collectEvents();
    const result = await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent, maxAttempts: 2 });

    expect(result.ok).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === 'repair-attempt-started')).toHaveLength(2);
    expect(events.some((e) => e.type === 'manual-attention-required')).toBe(true);

    const manualAttention = events.find((e) => e.type === 'manual-attention-required');
    expect(manualAttention?.type).toBe('manual-attention-required');

    if (manualAttention?.type === 'manual-attention-required') {
      expect(manualAttention.attemptsPerformed).toBe(2);
      expect(manualAttention.affectedFiles).toContain('src/pages/CollectionsPage.tsx');
    }
  });

  it('never applies the exact same LLM patch twice in a row', async () => {
    const p = project({
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { return null; }',
      ].join('\n'),
      'src/types/index.ts': 'export {};\n',
    });

    const fixedPatch = JSON.stringify({
      filesToCreate: [],
      filesToUpdate: [{ path: 'src/types/index.ts', content: 'export {}; // same every time\n' }],
      filesToDelete: [],
      explanation: 'same patch every time',
      confidence: 0.5,
      remainingRisks: [],
    });
    const generate = vi.fn<GenerateFn>().mockResolvedValue({ ok: true, text: fixedPatch });

    const { onEvent, events } = collectEvents();
    await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent, maxAttempts: 3 });

    /*
     * First call applies the patch; every subsequent call gets the identical patch back and
     * must be rejected as a repeat rather than silently re-applied.
     */
    const repairFailedEvents = events.filter(
      (e) => e.type === 'repair-failed' && e.reason.includes('identical to the previous attempt'),
    );
    expect(repairFailedEvents.length).toBeGreaterThan(0);
  });
});

describe('runStaticReviewLoop — previous application preserved on failure', () => {
  it('never mutates files unrelated to the reported issue, even after a failed repair loop', async () => {
    const untouchedContent = 'export default function AboutPage() { return "about"; }\n';
    const p = project({
      'src/pages/AboutPage.tsx': untouchedContent,
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { return null; }',
      ].join('\n'),
      'src/types/index.ts': 'export {};\n',
    });

    const generate = vi.fn<GenerateFn>().mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        filesToCreate: [],
        filesToUpdate: [{ path: 'src/types/index.ts', content: `export {}; // ${Math.random()}\n` }],
        filesToDelete: [],
        explanation: 'attempt',
        confidence: 0.4,
        remainingRisks: [],
      }),
    });

    const { onEvent } = collectEvents();
    const result = await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent, maxAttempts: 2 });

    expect(result.ok).toBe(false);

    const aboutFile = result.project.files.find((f) => f.path === 'src/pages/AboutPage.tsx');
    expect(aboutFile?.content).toBe(untouchedContent);
  });

  it('a caller only writes to the workbench when the loop reports ok:true (contract check)', async () => {
    const p = project({
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { return null; }',
      ].join('\n'),
      'src/types/index.ts': 'export {};\n',
    });

    const generate = vi.fn<GenerateFn>().mockResolvedValue({ ok: false, error: 'quota exceeded' });
    const writeToWebContainer = vi.fn();

    const { onEvent } = collectEvents();
    const result = await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent, maxAttempts: 1 });

    /*
     * Mirrors useCodeGeneration.ts's actual control flow: writeGeneratedProjectToWebContainer
     * is only ever called after `if (!reviewResult.ok) { return; }`.
     */
    if (result.ok) {
      writeToWebContainer(result.project);
    }

    expect(result.ok).toBe(false);
    expect(writeToWebContainer).not.toHaveBeenCalled();
  });
});

describe('runStaticReviewLoop — successful repair proceeds to completion', () => {
  it('returns ok:true with the repaired project once validation passes', async () => {
    const p = project({
      'package.json': '{}',
      'src/main.tsx': "import App from './App'",
      'src/App.tsx': 'export default function App() { return null; }\n',
      'src/types/product.ts': 'export interface Product { id: string; }\n',
      'src/types/index.ts': 'export {};\n',
      'src/pages/CollectionsPage.tsx': [
        "import type { Product } from '../types';",
        'export default function CollectionsPage() { const x: Product[] = []; return null; }',
      ].join('\n'),
    });

    const generate = vi.fn<GenerateFn>();
    const { onEvent } = collectEvents();
    const result = await runStaticReviewLoop({ ...baseParams, project: p, generate, onEvent });

    expect(result.ok).toBe(true);
    expect(result.project.files.find((f) => f.path === 'src/types/index.ts')?.content).toContain(
      "export type { Product } from './product';",
    );
  });
});
