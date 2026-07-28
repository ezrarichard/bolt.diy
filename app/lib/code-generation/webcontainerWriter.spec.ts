// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 99C — the incremental workspace writer and the session that makes Early Preview safe.
 *
 * The WebContainer and the workbench store are the only things stubbed; the module under test is
 * the real one, so what is asserted here is the actual write/install/dev-server behaviour a run
 * performs, not a re-description of it.
 */

type FakePreview = { port: number; ready: boolean; baseUrl: string };

/** The two nanostores methods `webcontainerWriter` uses — `get`/`listen` — with no nanostores import (vi.hoisted runs before imports). */
const { createFileMock, deleteFileMock, spawnMock, previewsAtom, refreshAllPreviewsMock } = vi.hoisted(() => {
  let value: FakePreview[] = [];
  const listeners = new Set<(next: FakePreview[]) => void>();

  return {
    createFileMock: vi.fn(async (_path: string, _content: string) => true),
    deleteFileMock: vi.fn(async (_path: string) => true),
    spawnMock: vi.fn() as unknown as ReturnType<typeof vi.fn> & ((...args: any[]) => any),
    refreshAllPreviewsMock: vi.fn(),
    previewsAtom: {
      get: () => value,
      set: (next: FakePreview[]) => {
        value = next;
        listeners.forEach((listener) => listener(next));
      },
      listen: (listener: (next: FakePreview[]) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('~/lib/webcontainer', () => ({ webcontainer: Promise.resolve({ spawn: spawnMock }) }));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    createFile: createFileMock,
    deleteFile: deleteFileMock,
    previews: previewsAtom,
    refreshAllPreviews: refreshAllPreviewsMock,
  },
}));
vi.mock('~/utils/constants', () => ({ WORK_DIR: '/home/project' }));

const {
  beginWorkspaceSession,
  ensureWorkspaceRunning,
  getWorkspaceSessionState,
  propagatePhaseUpdateToPreview,
  writeGeneratedFilesToWebContainer,
  writeGeneratedProjectToWebContainer,
} = await import('./webcontainerWriter');

/** A spawned process that exits successfully and produces no output. */
function okProcess(exitCode = 0) {
  return {
    exit: Promise.resolve(exitCode),
    output: { pipeTo: () => Promise.resolve(), catch: () => undefined },
    kill: vi.fn(),
  };
}

function writtenPaths(): string[] {
  return createFileMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  previewsAtom.set([]);
  spawnMock.mockImplementation(async () => okProcess());
  beginWorkspaceSession('project-1');
});

describe('writeGeneratedFilesToWebContainer — incremental writes', () => {
  it('writes only the files it is given — a phase write is not a whole-project write', async () => {
    const result = await writeGeneratedFilesToWebContainer('project-1', [
      { path: 'src/components/Navbar.tsx', content: 'navbar' },
      { path: 'package.json', content: 'pkg' },
    ]);

    expect(result.written).toEqual(['src/components/Navbar.tsx', 'package.json']);
    expect(writtenPaths()).toEqual(['/home/project/src/components/Navbar.tsx', '/home/project/package.json']);
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it('does not write the same content twice within a session', async () => {
    await writeGeneratedFilesToWebContainer('project-1', [{ path: 'package.json', content: 'pkg' }]);
    createFileMock.mockClear();

    const second = await writeGeneratedFilesToWebContainer('project-1', [{ path: 'package.json', content: 'pkg' }]);

    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual(['package.json']);
    expect(createFileMock).not.toHaveBeenCalled();
  });

  it('rewrites a path whose content changed — the real page replacing its shell', async () => {
    await writeGeneratedFilesToWebContainer('project-1', [{ path: 'src/pages/HomePage.tsx', content: 'shell' }]);
    createFileMock.mockClear();

    await writeGeneratedFilesToWebContainer('project-1', [{ path: 'src/pages/HomePage.tsx', content: 'real page' }]);

    expect(createFileMock).toHaveBeenCalledWith('/home/project/src/pages/HomePage.tsx', 'real page');
  });

  it('a new session forgets the ledger — a fresh WebContainer is written in full', async () => {
    await writeGeneratedFilesToWebContainer('project-1', [{ path: 'package.json', content: 'pkg' }]);
    beginWorkspaceSession('project-1');
    createFileMock.mockClear();

    const again = await writeGeneratedFilesToWebContainer('project-1', [{ path: 'package.json', content: 'pkg' }]);

    expect(again.written).toEqual(['package.json']);
  });
});

describe('writeGeneratedProjectToWebContainer — wrapper compatibility', () => {
  it('still writes every file and still removes stale ones', async () => {
    await writeGeneratedProjectToWebContainer({
      projectId: 'project-1',
      templateId: 'react-vite-ts',
      files: [
        { path: 'src/main.tsx', content: 'main' },
        { path: 'src/pages/Old.tsx', content: 'old' },
      ],
      folders: [],
      generatedAt: '',
    });

    beginWorkspaceSession('project-1');
    createFileMock.mockClear();

    await writeGeneratedProjectToWebContainer({
      projectId: 'project-1',
      templateId: 'react-vite-ts',
      files: [{ path: 'src/main.tsx', content: 'main' }],
      folders: [],
      generatedAt: '',
    });

    expect(writtenPaths()).toEqual(['/home/project/src/main.tsx']);
    expect(deleteFileMock).toHaveBeenCalledWith('/home/project/src/pages/Old.tsx');
  });

  it('after incremental phase writes, the whole-project write re-writes nothing that is unchanged', async () => {
    await writeGeneratedFilesToWebContainer('project-1', [
      { path: 'package.json', content: 'pkg' },
      { path: 'src/components/Navbar.tsx', content: 'navbar' },
    ]);
    createFileMock.mockClear();

    await writeGeneratedProjectToWebContainer({
      projectId: 'project-1',
      templateId: 'react-vite-ts',
      files: [
        { path: 'package.json', content: 'pkg' },
        { path: 'src/components/Navbar.tsx', content: 'navbar' },
        { path: 'src/pages/HomePage.tsx', content: 'home' },
      ],
      folders: [],
      generatedAt: '',
    });

    expect(writtenPaths()).toEqual(['/home/project/src/pages/HomePage.tsx']);

    // The two files written incrementally are NOT treated as stale by the whole-project cleanup.
    expect(deleteFileMock).not.toHaveBeenCalled();
  });
});

describe('ensureWorkspaceRunning — install once, dev server once', () => {
  function commands(): string[] {
    return spawnMock.mock.calls.map((call) => `${String(call[0])} ${(call[1] as string[]).join(' ')}`);
  }

  it('installs and starts the dev server on the first call', async () => {
    const result = await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });

    expect(result).toMatchObject({ ok: true, installed: true, installReason: 'first-install', devServerStarted: true });
    expect(commands()).toEqual(['npm install', 'npm run dev']);
  });

  it('does neither on a later call with an unchanged package.json', async () => {
    await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });
    spawnMock.mockClear();

    const result = await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });

    expect(result).toMatchObject({ ok: true, installed: false, installReason: 'unchanged', devServerStarted: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reinstalls — and only reinstalls — when package.json actually changed', async () => {
    await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });
    spawnMock.mockClear();

    const result = await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg + supabase' });

    expect(result).toMatchObject({ installed: true, installReason: 'package-json-changed', devServerStarted: false });

    // Crucially: no SECOND dev server against the same WebContainer.
    expect(commands()).toEqual(['npm install']);
  });

  it('never starts a second dev server across many phase updates', async () => {
    await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });

    for (let phase = 2; phase <= 6; phase++) {
      await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });
    }

    expect(commands().filter((command) => command === 'npm run dev')).toHaveLength(1);
    expect(commands().filter((command) => command === 'npm install')).toHaveLength(1);
  });

  it('reports a failed install without marking the session installed', async () => {
    spawnMock.mockImplementationOnce(async () => okProcess(1));

    const result = await ensureWorkspaceRunning({ projectId: 'project-1', packageJson: 'pkg' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('npm install failed');
    expect(getWorkspaceSessionState().installed).toBe(false);
  });
});

describe('propagatePhaseUpdateToPreview — HMR with a controlled reload fallback', () => {
  it('reports HMR when a preview is already serving and stays ready', async () => {
    previewsAtom.set([{ port: 5173, ready: true, baseUrl: 'http://localhost:5173' }]);

    await expect(propagatePhaseUpdateToPreview(50)).resolves.toBe('hmr');
    expect(refreshAllPreviewsMock).not.toHaveBeenCalled();
  });

  it('falls back to a controlled reload when nothing reports ready within the window', async () => {
    previewsAtom.set([{ port: 5173, ready: false, baseUrl: 'http://localhost:5173' }]);

    await expect(propagatePhaseUpdateToPreview(20)).resolves.toBe('reloaded');
    expect(refreshAllPreviewsMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when no preview exists yet', async () => {
    await expect(propagatePhaseUpdateToPreview(20)).resolves.toBe('no-preview');
    expect(refreshAllPreviewsMock).not.toHaveBeenCalled();
  });
});
