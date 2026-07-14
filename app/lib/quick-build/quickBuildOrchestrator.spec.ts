import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from 'ai';

/*
 * Sprint 43B — proves the actual wiring (not just generationLock.ts's own unit tests in
 * isolation): two `onFinish`-style calls for the SAME completed message run the real
 * install/build pipeline exactly once, and a late resolution from a generation a newer one
 * has already superseded never overwrites the newer generation's terminal state. Every
 * dependency finalizeQuickBuildGeneration reaches into (WebContainer writer, repair engine,
 * BuildersDB, workspace snapshot, engineering timeline) is mocked — this test is about the
 * orchestrator's own re-entrancy handling, not re-verifying those modules' own behavior
 * (already covered by their own spec files).
 */

const files: Record<string, { type: 'file'; content: string; isBinary: boolean }> = {
  '/home/project/package.json': { type: 'file', content: '{}', isBinary: false },
  '/home/project/vite.config.ts': { type: 'file', content: 'export default {}', isBinary: false },
  '/home/project/src/main.tsx': { type: 'file', content: 'import { StrictMode } from "react";', isBinary: false },
  '/home/project/src/App.tsx': {
    type: 'file',
    content: 'export default function App() { return null; }',
    isBinary: false,
  },
};

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    files: { get: () => files },
    showWorkbench: { set: vi.fn() },
    currentView: { set: vi.fn() },
  },
}));

vi.mock('~/lib/stores/projects', () => ({
  updateProjectWorkspaceState: vi.fn(),
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  buildersDbRepository: { addProjectActivity: vi.fn().mockResolvedValue(true) },
}));

vi.mock('~/lib/stores/engineeringTimeline', () => ({
  resetEngineeringTimeline: vi.fn(),
  upsertEngineeringTimelineEvent: vi.fn(),
}));

vi.mock('~/lib/workspace-snapshot', () => ({
  getWorkspaceSnapshotProvider: () => ({
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue([]),
  }),
}));

/*
 * Sprint 43B.1 — a tiny fake "disk" independent of `files` (the workbench snapshot above):
 * `writeGeneratedProjectToWebContainer` writes into it, `readGeneratedFileFromWebContainer`
 * reads straight back out of it — exactly the same separation the real functions have from
 * `workbenchStore`'s in-memory mirror, which is the whole point of the consistency check
 * these tests exercise.
 */
const diskFiles: Record<string, string> = {};
const writeGeneratedProjectToWebContainer = vi.fn(async (project: { files: { path: string; content: string }[] }) => {
  for (const file of project.files) {
    diskFiles[file.path] = file.content;
  }
});
const readGeneratedFileFromWebContainer = vi.fn(async (path: string) => diskFiles[path] ?? null);

vi.mock('~/lib/code-generation/webcontainerWriter', () => ({
  writeGeneratedProjectToWebContainer: (...args: [{ files: { path: string; content: string }[] }]) =>
    writeGeneratedProjectToWebContainer(...args),
  readGeneratedFileFromWebContainer: (...args: [string]) => readGeneratedFileFromWebContainer(...args),
  installAndStartDevServer: vi.fn().mockResolvedValue({ ok: true }),
}));

const runStaticReviewLoop = vi.fn();
const runBuildRepairLoop = vi.fn();

vi.mock('~/lib/code-review/repairEngine', () => ({
  runStaticReviewLoop: (...args: unknown[]) => runStaticReviewLoop(...args),
  runBuildRepairLoop: (...args: unknown[]) => runBuildRepairLoop(...args),
}));

function makeProject(id: string) {
  return {
    id,
    name: 'Test Project',
    icon: '⚡',
    color: 'purple',
    createdAt: new Date().toISOString(),
    projectType: 'quick_build' as const,
    createdFrom: 'quick_build' as const,
  };
}

function makeMessage(id: string): Message {
  const content = [
    '<boltArtifact id="a1" title="App">',
    '<boltAction type="file" filePath="src/App.tsx">export default function App() { return null; }</boltAction>',
    '</boltArtifact>',
  ].join('\n');

  return { id, role: 'assistant', content } as Message;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('finalizeQuickBuildGeneration (Sprint 43B re-entrancy)', () => {
  beforeEach(() => {
    vi.resetModules();
    runStaticReviewLoop.mockReset();
    runBuildRepairLoop.mockReset();
    writeGeneratedProjectToWebContainer.mockClear();
    readGeneratedFileFromWebContainer.mockClear();

    for (const key of Object.keys(diskFiles)) {
      delete diskFiles[key];
    }
  });

  it('runs the pipeline exactly once for several onFinish-style calls from the same send, even with different message ids', async () => {
    /*
     * Sprint 43B live audit: a single real `/api/chat` request (confirmed via network
     * inspection — exactly one POST) produced ~8 `onFinish` firings, and they did NOT all
     * share the same `message.id` (an earlier, message.id-keyed version of this lock failed
     * to collapse them for exactly that reason). This test reproduces that shape directly:
     * one `beginQuickBuildGeneration()` (one real send), several finalize calls with
     * DIFFERENT message ids — the dedupe must still hold, because it's keyed by the store's
     * own generationId, not the message id.
     */
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');

    const project = makeProject('proj-1');
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValue({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
      issues: [],
      deterministicRepairedFiles: [],
    });
    runBuildRepairLoop.mockResolvedValue({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
    });

    const generate = vi.fn();

    await Promise.all([
      finalizeQuickBuildGeneration({ project, message: makeMessage('msg-1'), generate }),
      finalizeQuickBuildGeneration({ project, message: makeMessage('msg-2'), generate }),
      finalizeQuickBuildGeneration({ project, message: makeMessage('msg-3'), generate }),
    ]);
    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-4'), generate }); // late duplicate, after success

    expect(runStaticReviewLoop).toHaveBeenCalledTimes(1);
    expect(runBuildRepairLoop).toHaveBeenCalledTimes(1);

    const { quickBuildGenerationStore } = await import('./quickBuildGenerationStore');
    expect(quickBuildGenerationStore.get().stage).toBe('ready');
  });

  it('a genuinely new generation (different message id) runs its own fresh pipeline', async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');

    const project = makeProject('proj-2');
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValue({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
      issues: [],
      deterministicRepairedFiles: [],
    });
    runBuildRepairLoop.mockResolvedValue({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
    });

    const generate = vi.fn();

    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-a'), generate });
    beginQuickBuildGeneration(project.id); // retry: new generation
    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-b'), generate });

    expect(runStaticReviewLoop).toHaveBeenCalledTimes(2);
  });

  it("a stale generation's late resolution never overwrites a newer generation's terminal state", async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');
    const { quickBuildGenerationStore } = await import('./quickBuildGenerationStore');

    const project = makeProject('proj-3');
    beginQuickBuildGeneration(project.id);

    const staleReview = deferred<{ ok: boolean; project: unknown; issues: unknown[] }>();
    runStaticReviewLoop.mockImplementationOnce(() => staleReview.promise);

    const generate = vi.fn();
    const staleRun = finalizeQuickBuildGeneration({ project, message: makeMessage('msg-stale'), generate });

    // A retry begins — a NEW generation takes over the store before the stale run resolves.
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValueOnce({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
      issues: [],
      deterministicRepairedFiles: [],
    });
    runBuildRepairLoop.mockResolvedValueOnce({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
    });

    const newRun = finalizeQuickBuildGeneration({ project, message: makeMessage('msg-new'), generate });
    await newRun;
    expect(quickBuildGenerationStore.get().stage).toBe('ready');

    // Now let the stale run's long-pending static review finally resolve.
    staleReview.resolve({
      ok: true,
      project: { projectId: project.id, templateId: 'quick-build', files: [], folders: [], generatedAt: '' },
      issues: [],
    });
    await staleRun;

    // The stale run must not have dragged the store back out of the newer generation's Ready state.
    expect(quickBuildGenerationStore.get().stage).toBe('ready');
  });
});

describe('finalizeQuickBuildGeneration (Sprint 43B.1 repaired-file persistence)', () => {
  beforeEach(() => {
    vi.resetModules();
    runStaticReviewLoop.mockReset();
    runBuildRepairLoop.mockReset();
    writeGeneratedProjectToWebContainer.mockClear();
    readGeneratedFileFromWebContainer.mockClear();

    for (const key of Object.keys(diskFiles)) {
      delete diskFiles[key];
    }
  });

  const repairedProject = (projectId: string) => ({
    projectId,
    templateId: 'quick-build',
    files: [
      { path: 'package.json', content: '{}' },
      { path: 'vite.config.ts', content: 'export default {}' },
      { path: 'src/main.tsx', content: "import { StrictMode } from 'react';\nimport App from './App';\n" },
      { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
    ],
    folders: [],
    generatedAt: '',
  });

  it('writes the deterministically-repaired main.tsx to the WebContainer disk', async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');

    const project = makeProject('proj-repair-1');
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValue({
      ok: true,
      project: repairedProject(project.id),
      issues: [],
      deterministicRepairedFiles: ['src/main.tsx'],
    });
    runBuildRepairLoop.mockResolvedValue({ ok: true, project: repairedProject(project.id) });

    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-1'), generate: vi.fn() });

    expect(diskFiles['src/main.tsx']).toContain(`from 'react'`);
    expect(runBuildRepairLoop).toHaveBeenCalledTimes(1);
  });

  it('fails with an internal consistency error, and never calls runBuildRepairLoop, when a stale write reverts the repair on disk before build', async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');
    const { quickBuildGenerationStore } = await import('./quickBuildGenerationStore');

    const project = makeProject('proj-repair-2');
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValue({
      ok: true,
      project: repairedProject(project.id),
      issues: [],
      deterministicRepairedFiles: ['src/main.tsx'],
    });
    runBuildRepairLoop.mockResolvedValue({ ok: true, project: repairedProject(project.id) });

    /*
     * Simulate the exact race this sprint is about: our write lands, but something else
     * (e.g. the chat-streaming action-runner's own original, still-in-flight write for the
     * same path) settles after it and reverts the file back to the buggy import.
     */
    writeGeneratedProjectToWebContainer.mockImplementationOnce(
      async (proj: { files: { path: string; content: string }[] }) => {
        for (const file of proj.files) {
          diskFiles[file.path] = file.content;
        }
        diskFiles['src/main.tsx'] = "import { StrictMode } from './App.tsx';\nimport App from './App';\n";
      },
    );

    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-1'), generate: vi.fn() });

    expect(runBuildRepairLoop).not.toHaveBeenCalled();

    const state = quickBuildGenerationStore.get();
    expect(state.stage).toBe('failed');
    expect(state.failure?.reason).toContain('Internal consistency error');
    expect(state.failure?.reason).toContain('StrictMode');
  });

  it('runBuildRepairLoop receives the project whose repaired content actually persisted to disk', async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');

    const project = makeProject('proj-repair-3');
    beginQuickBuildGeneration(project.id);

    runStaticReviewLoop.mockResolvedValue({
      ok: true,
      project: repairedProject(project.id),
      issues: [],
      deterministicRepairedFiles: ['src/main.tsx'],
    });
    runBuildRepairLoop.mockResolvedValue({ ok: true, project: repairedProject(project.id) });

    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-1'), generate: vi.fn() });

    expect(runBuildRepairLoop).toHaveBeenCalledTimes(1);

    const passedProject = (
      runBuildRepairLoop.mock.calls[0][0] as { project: { files: { path: string; content: string }[] } }
    ).project;
    const mainFile = passedProject.files.find((file) => file.path === 'src/main.tsx');
    expect(mainFile?.content).toContain(`from 'react'`);
  });

  it('a retry after a consistency-error failure starts fresh and can still reach Ready', async () => {
    const { finalizeQuickBuildGeneration, beginQuickBuildGeneration } = await import('./quickBuildOrchestrator');
    const { quickBuildGenerationStore } = await import('./quickBuildGenerationStore');

    const project = makeProject('proj-repair-4');
    const generate = vi.fn();

    // First attempt: repair applied, but disk is stale — fails with the consistency error.
    beginQuickBuildGeneration(project.id);
    runStaticReviewLoop.mockResolvedValueOnce({
      ok: true,
      project: repairedProject(project.id),
      issues: [],
      deterministicRepairedFiles: ['src/main.tsx'],
    });
    writeGeneratedProjectToWebContainer.mockImplementationOnce(
      async (proj: { files: { path: string; content: string }[] }) => {
        for (const file of proj.files) {
          diskFiles[file.path] = file.content;
        }
        diskFiles['src/main.tsx'] = "import { StrictMode } from './App.tsx';\n";
      },
    );
    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-1'), generate });
    expect(quickBuildGenerationStore.get().stage).toBe('failed');

    /*
     * Retry: a new generation, disk write behaves normally this time, and the pipeline
     * reaches Ready — the earlier failure must not block or poison this new attempt.
     */
    beginQuickBuildGeneration(project.id);
    runStaticReviewLoop.mockResolvedValueOnce({
      ok: true,
      project: repairedProject(project.id),
      issues: [],
      deterministicRepairedFiles: ['src/main.tsx'],
    });
    runBuildRepairLoop.mockResolvedValueOnce({ ok: true, project: repairedProject(project.id) });

    await finalizeQuickBuildGeneration({ project, message: makeMessage('msg-2'), generate });

    expect(quickBuildGenerationStore.get().stage).toBe('ready');
    expect(diskFiles['src/main.tsx']).toContain(`from 'react'`);
  });
});
