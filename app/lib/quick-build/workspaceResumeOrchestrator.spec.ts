import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '~/lib/stores/projects';

const {
  getSnapshotMock,
  writeGeneratedProjectToWebContainerMock,
  installDependenciesWithTimeoutMock,
  startDevServerOnlyMock,
  waitForDevServerReadyMock,
  waitForWebContainerReadyMock,
  hydrateWorkspaceStateMock,
  touchProjectLastOpenedMock,
  updateProjectWorkspaceStateMock,
  addProjectActivityMock,
} = vi.hoisted(() => ({
  getSnapshotMock: vi.fn(),
  writeGeneratedProjectToWebContainerMock: vi.fn(),
  installDependenciesWithTimeoutMock: vi.fn(),
  startDevServerOnlyMock: vi.fn(),
  waitForDevServerReadyMock: vi.fn(),
  waitForWebContainerReadyMock: vi.fn(),
  hydrateWorkspaceStateMock: vi.fn(),
  touchProjectLastOpenedMock: vi.fn(),
  updateProjectWorkspaceStateMock: vi.fn(),
  addProjectActivityMock: vi.fn(),
}));

vi.mock('~/lib/workspace-snapshot', () => ({
  getWorkspaceSnapshotProvider: () => ({ getSnapshot: getSnapshotMock }),
}));

vi.mock('~/lib/code-generation/webcontainerWriter', () => ({
  writeGeneratedProjectToWebContainer: writeGeneratedProjectToWebContainerMock,
  installDependenciesWithTimeout: installDependenciesWithTimeoutMock,
  startDevServerOnly: startDevServerOnlyMock,
  waitForDevServerReady: waitForDevServerReadyMock,
  waitForWebContainerReady: waitForWebContainerReadyMock,
}));

vi.mock('~/lib/stores/projects', () => ({
  hydrateWorkspaceState: hydrateWorkspaceStateMock,
  touchProjectLastOpened: touchProjectLastOpenedMock,
  updateProjectWorkspaceState: updateProjectWorkspaceStateMock,
}));

vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  buildersDbRepository: { addProjectActivity: addProjectActivityMock },
}));

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    showWorkbench: { set: vi.fn() },
    currentView: { set: vi.fn() },
  },
}));

const { resumeQuickBuildWorkspace } = await import('./workspaceResumeOrchestrator');
const { workspaceResumeStore, beginWorkspaceResume } = await import('./workspaceResumeStore');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-resume-1',
    name: 'Resume Test',
    icon: '⚡',
    color: 'amber',
    projectType: 'quick_build',
    createdFrom: 'quick_build',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const SNAPSHOT_FILES = [
  { path: 'package.json', content: '{}' },
  { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
  { path: 'src/main.tsx', content: '' },
  { path: 'vite.config.ts', content: '' },
];

describe('resumeQuickBuildWorkspace', () => {
  beforeEach(() => {
    workspaceResumeStore.set({});
    getSnapshotMock.mockReset().mockResolvedValue(SNAPSHOT_FILES);
    writeGeneratedProjectToWebContainerMock.mockReset().mockResolvedValue(undefined);
    installDependenciesWithTimeoutMock.mockReset().mockResolvedValue({ ok: true });
    startDevServerOnlyMock.mockReset().mockResolvedValue(undefined);
    waitForDevServerReadyMock.mockReset().mockResolvedValue({ ok: true, url: 'https://preview.example/' });
    waitForWebContainerReadyMock.mockReset().mockResolvedValue(undefined);
    hydrateWorkspaceStateMock.mockReset().mockResolvedValue(undefined);
    touchProjectLastOpenedMock.mockReset();
    updateProjectWorkspaceStateMock.mockReset();
    addProjectActivityMock.mockReset().mockResolvedValue(true);
  });

  it('a valid snapshot resumes exactly once and reaches ready', async () => {
    const result = await resumeQuickBuildWorkspace(makeProject());

    expect(result.ok).toBe(true);
    expect(workspaceResumeStore.get()['proj-resume-1'].stage).toBe('ready');
    expect(workspaceResumeStore.get()['proj-resume-1'].previewUrl).toBe('https://preview.example/');
    expect(installDependenciesWithTimeoutMock).toHaveBeenCalledTimes(1);
    expect(startDevServerOnlyMock).toHaveBeenCalledTimes(1);
  });

  it('duplicate concurrent calls share one promise and run the pipeline once', async () => {
    const project = makeProject();
    const [a, b] = [resumeQuickBuildWorkspace(project), resumeQuickBuildWorkspace(project)];

    expect(a).toBe(b);

    await Promise.all([a, b]);

    expect(installDependenciesWithTimeoutMock).toHaveBeenCalledTimes(1);
    expect(startDevServerOnlyMock).toHaveBeenCalledTimes(1);
  });

  it('install starts only after file restore completes (call order)', async () => {
    const order: string[] = [];
    writeGeneratedProjectToWebContainerMock.mockImplementation(async () => {
      order.push('restore');
    });
    installDependenciesWithTimeoutMock.mockImplementation(async () => {
      order.push('install');
      return { ok: true };
    });

    await resumeQuickBuildWorkspace(makeProject());

    expect(order).toEqual(['restore', 'install']);
  });

  it('two install processes cannot run concurrently for one project', async () => {
    const project = makeProject();

    await Promise.all([resumeQuickBuildWorkspace(project), resumeQuickBuildWorkspace(project)]);

    expect(installDependenciesWithTimeoutMock).toHaveBeenCalledTimes(1);
  });

  it('install failure/timeout marks Failed at installingDependencies, never hangs', async () => {
    installDependenciesWithTimeoutMock.mockResolvedValue({
      ok: false,
      error: 'npm install did not finish within 120s and was terminated.',
    });

    const result = await resumeQuickBuildWorkspace(makeProject());

    expect(result.ok).toBe(false);

    const state = workspaceResumeStore.get()['proj-resume-1'];
    expect(state.stage).toBe('failed');
    expect(state.failure?.step).toBe('installingDependencies');
    expect(startDevServerOnlyMock).not.toHaveBeenCalled();
  });

  it('dev server starts exactly once', async () => {
    await resumeQuickBuildWorkspace(makeProject());
    expect(startDevServerOnlyMock).toHaveBeenCalledTimes(1);
  });

  it('a real server-ready event transitions the resume to Ready', async () => {
    waitForDevServerReadyMock.mockResolvedValue({ ok: true, url: 'https://ready.example/' });

    await resumeQuickBuildWorkspace(makeProject());

    expect(workspaceResumeStore.get()['proj-resume-1'].stage).toBe('ready');
    expect(workspaceResumeStore.get()['proj-resume-1'].previewUrl).toBe('https://ready.example/');
  });

  it('a server-ready timeout marks Failed at startingPreview, never hangs', async () => {
    waitForDevServerReadyMock.mockResolvedValue({
      ok: false,
      error: 'Dev server did not report ready within 60s.',
    });

    const result = await resumeQuickBuildWorkspace(makeProject());

    expect(result.ok).toBe(false);

    const state = workspaceResumeStore.get()['proj-resume-1'];
    expect(state.stage).toBe('failed');
    expect(state.failure?.step).toBe('startingPreview');
  });

  it('a stale (superseded) resume cannot overwrite a newer resume attempt', async () => {
    const project = makeProject();

    let releaseSnapshot: () => void = () => undefined;
    const paused = new Promise<typeof SNAPSHOT_FILES>((resolve) => {
      releaseSnapshot = () => resolve(SNAPSHOT_FILES);
    });
    getSnapshotMock.mockReturnValueOnce(paused);

    const stalePromise = resumeQuickBuildWorkspace(project);

    // Simulate a newer resume attempt taking over while the first is still paused mid-flight.
    beginWorkspaceResume(project.id, 'newer-resume-id');

    releaseSnapshot();
    await stalePromise;

    // The stale run must not have overwritten the newer attempt's tracked state.
    expect(workspaceResumeStore.get()[project.id].resumeId).toBe('newer-resume-id');
    expect(workspaceResumeStore.get()[project.id].stage).toBe('idle');
  });

  it('a retry after failure mints a new resumeId and runs a fresh attempt', async () => {
    installDependenciesWithTimeoutMock.mockResolvedValueOnce({ ok: false, error: 'boom' });

    const project = makeProject();
    const first = await resumeQuickBuildWorkspace(project);
    expect(first.ok).toBe(false);

    const failedResumeId = workspaceResumeStore.get()[project.id].resumeId;

    installDependenciesWithTimeoutMock.mockResolvedValue({ ok: true });

    const second = await resumeQuickBuildWorkspace(project);
    expect(second.ok).toBe(true);

    expect(workspaceResumeStore.get()[project.id].resumeId).not.toBe(failedResumeId);
    expect(installDependenciesWithTimeoutMock).toHaveBeenCalledTimes(2);
  });

  it('never creates a project or a generation — only reads/writes resume + workspace state', async () => {
    await resumeQuickBuildWorkspace(makeProject());

    /*
     * No project-creation surface is imported/mocked here at all — this test documents
     * that fact by asserting only the expected resume-scoped calls happened.
     */
    expect(updateProjectWorkspaceStateMock).toHaveBeenCalledWith(
      'proj-resume-1',
      expect.objectContaining({ previewAvailable: true }),
    );
  });
});
