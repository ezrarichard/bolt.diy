import { describe, expect, it } from 'vitest';
import {
  buildPreviewShellFiles,
  decideInstall,
  describePreviewState,
  isPreviewAvailable,
  nextPreviewState,
  planIncrementalWrite,
  PREVIEW_READY_BANNER,
  recordWrites,
  type PreviewLifecycleEvent,
  type PreviewLifecycleState,
  type WorkspaceWriteLedger,
} from './incrementalWorkspace';
import type { GenerationPlanPage } from './codeGenerationTypes';

function ledgerWith(files: { path: string; content: string }[]): WorkspaceWriteLedger {
  const ledger: WorkspaceWriteLedger = new Map();
  recordWrites(ledger, files);

  return ledger;
}

describe('planIncrementalWrite — incremental writes, no duplicates', () => {
  it('writes everything the first time', () => {
    const plan = planIncrementalWrite(new Map(), [
      { path: 'src/main.tsx', content: 'a' },
      { path: 'package.json', content: 'b' },
    ]);

    expect(plan.toWrite.map((file) => file.path)).toEqual(['src/main.tsx', 'package.json']);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a file whose content is byte-identical to the last write', () => {
    const ledger = ledgerWith([{ path: 'package.json', content: '{"name":"app"}' }]);

    const plan = planIncrementalWrite(ledger, [{ path: 'package.json', content: '{"name":"app"}' }]);

    expect(plan.toWrite).toEqual([]);
    expect(plan.skipped).toEqual(['package.json']);
  });

  it('rewrites a file whose content changed — a shell replaced by its real page', () => {
    const ledger = ledgerWith([{ path: 'src/pages/HomePage.tsx', content: 'shell' }]);

    const plan = planIncrementalWrite(ledger, [{ path: 'src/pages/HomePage.tsx', content: 'the real page' }]);

    expect(plan.toWrite).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it('collapses a duplicate path within one batch to its last occurrence', () => {
    const plan = planIncrementalWrite(new Map(), [
      { path: 'src/pages/HomePage.tsx', content: 'shell' },
      { path: 'src/pages/HomePage.tsx', content: 'real' },
    ]);

    expect(plan.toWrite).toHaveLength(1);
    expect(plan.toWrite[0].content).toBe('real');
  });

  it('a whole-project write after phase writes re-writes only what changed', () => {
    const ledger = new Map();
    const phaseOne = [
      { path: 'package.json', content: 'pkg' },
      { path: 'src/components/Navbar.tsx', content: 'navbar' },
    ];
    recordWrites(ledger, planIncrementalWrite(ledger, phaseOne).toWrite);

    const wholeProject = planIncrementalWrite(ledger, [
      ...phaseOne,
      { path: 'src/pages/HomePage.tsx', content: 'home' },
    ]);

    expect(wholeProject.toWrite.map((file) => file.path)).toEqual(['src/pages/HomePage.tsx']);
    expect(wholeProject.skipped.sort()).toEqual(['package.json', 'src/components/Navbar.tsx']);
  });
});

describe('decideInstall — install once, reinstall only on a real package.json change', () => {
  it('installs the first time', () => {
    expect(decideInstall(undefined, '{"deps":1}')).toMatchObject({ install: true, reason: 'first-install' });
  });

  it('does not reinstall when package.json is unchanged', () => {
    const first = decideInstall(undefined, '{"deps":1}');
    expect(decideInstall(first.checksum, '{"deps":1}')).toMatchObject({ install: false, reason: 'unchanged' });
  });

  it('reinstalls when package.json actually changed', () => {
    const first = decideInstall(undefined, '{"deps":1}');
    const second = decideInstall(first.checksum, '{"deps":2}');

    expect(second).toMatchObject({ install: true, reason: 'package-json-changed' });
    expect(second.checksum).not.toBe(first.checksum);
  });

  it('never reinstalls repeatedly for the same content — the duplicate-installer failure mode', () => {
    let checksum = decideInstall(undefined, 'pkg').checksum;
    const decisions = [];

    for (let call = 0; call < 5; call++) {
      const decision = decideInstall(checksum, 'pkg');
      decisions.push(decision.install);
      checksum = decision.checksum;
    }

    expect(decisions).toEqual([false, false, false, false, false]);
  });

  it('with no package.json to compare, installs only if nothing was ever installed', () => {
    expect(decideInstall(undefined, undefined)).toMatchObject({ install: true, reason: 'first-install' });
    expect(decideInstall('abc', undefined)).toMatchObject({ install: false, reason: 'no-package-json' });
  });
});

describe('nextPreviewState — preview lifecycle', () => {
  it('walks the designed path: not-available → booting → preview-ready → updating → ready → complete', () => {
    let state: PreviewLifecycleState = 'not-available';
    const seen: PreviewLifecycleState[] = [];

    for (const event of [
      'phase-one-written',
      'dev-server-ready',
      'phase-written',
      'phase-settled',
      'generation-complete',
    ] as PreviewLifecycleEvent[]) {
      state = nextPreviewState(state, event);
      seen.push(state);
    }

    expect(seen).toEqual(['booting', 'preview-ready', 'updating', 'ready', 'generation-complete']);
  });

  it('NEVER takes an available preview back to unavailable — for any event', () => {
    const available: PreviewLifecycleState[] = ['preview-ready', 'updating', 'ready', 'generation-complete'];
    const events: PreviewLifecycleEvent[] = [
      'phase-one-written',
      'dev-server-ready',
      'boot-failed',
      'phase-written',
      'phase-settled',
      'phase-failed',
      'generation-complete',
    ];

    for (const state of available) {
      for (const event of events) {
        expect(isPreviewAvailable(nextPreviewState(state, event))).toBe(true);
      }
    }
  });

  it('a later phase failing leaves the preview exactly where it was', () => {
    expect(nextPreviewState('ready', 'phase-failed')).toBe('ready');
    expect(nextPreviewState('updating', 'phase-failed')).toBe('updating');
    expect(nextPreviewState('generation-complete', 'phase-failed')).toBe('generation-complete');
  });

  it('reports not-available when the boot itself fails before a preview ever existed', () => {
    expect(nextPreviewState(nextPreviewState('not-available', 'phase-one-written'), 'boot-failed')).toBe(
      'not-available',
    );
  });

  it('ignores update events when no preview is running', () => {
    expect(nextPreviewState('not-available', 'phase-written')).toBe('not-available');
    expect(nextPreviewState('booting', 'phase-settled')).toBe('booting');
    expect(nextPreviewState('not-available', 'generation-complete')).toBe('not-available');
  });

  it('shows the sprint-specified banner while generation continues', () => {
    expect(describePreviewState('preview-ready')).toBe(PREVIEW_READY_BANNER);
    expect(describePreviewState('ready')).toBe(PREVIEW_READY_BANNER);
    expect(describePreviewState('generation-complete')).toContain('generation complete');
  });
});

describe('buildPreviewShellFiles — a bootable Phase 1', () => {
  const pages: GenerationPlanPage[] = [
    { name: 'Home', componentName: 'HomePage', routePath: '/', fileName: 'HomePage.tsx' },
    {
      name: 'Admin Dashboard',
      componentName: 'AdminDashboardPage',
      routePath: '/admin',
      fileName: 'AdminDashboardPage.tsx',
    },
  ];

  it('creates a valid module at every planned page path that does not exist yet', () => {
    const shells = buildPreviewShellFiles(pages, []);

    expect(shells.map((file) => file.path)).toEqual(['src/pages/HomePage.tsx', 'src/pages/AdminDashboardPage.tsx']);
    expect(shells[0].content).toContain('export default function HomePage()');
    expect(shells[1].content).toContain('export default function AdminDashboardPage()');
  });

  it('never overwrites a page that has genuinely been generated', () => {
    const shells = buildPreviewShellFiles(pages, ['src/pages/HomePage.tsx']);

    expect(shells.map((file) => file.path)).toEqual(['src/pages/AdminDashboardPage.tsx']);
  });

  it('produces nothing when every page already exists', () => {
    expect(buildPreviewShellFiles(pages, ['src/pages/HomePage.tsx', 'src/pages/AdminDashboardPage.tsx'])).toEqual([]);
  });
});
