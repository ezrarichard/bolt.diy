// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import type { GenerationPhaseHooks } from '~/lib/code-generation/generationPipeline';

/**
 * Sprint 99C — Early Preview, asserted through `useCodeGeneration` itself.
 *
 * `generateProject` is stubbed to DRIVE the phase hooks the hook passes it — the same hooks the
 * real pipeline calls — so what is exercised below is the actual controller
 * (`createWorkspacePhaseController`) rather than a reimplementation of it. The claim under test is
 * the sprint's headline: the workspace is written and serving after Phase 1, while Phases 2+ are
 * still generating, and nothing that happens afterwards can take that away.
 */

const { generateProjectMock, updateProjectWorkspaceStateMock, upsertTimelineMock, addProjectActivityMock } = vi.hoisted(
  () => ({
    generateProjectMock: vi.fn(),
    updateProjectWorkspaceStateMock: vi.fn(),
    upsertTimelineMock: vi.fn(),
    addProjectActivityMock: vi.fn(),
  }),
);

const writeToWebContainerMock = vi.fn();
const beginWorkspaceSessionMock = vi.fn();
const writeFilesToWebContainerMock = vi.fn(async (_projectId: string, files: { path: string }[]) => ({
  written: files.map((file) => file.path),
  skipped: [],
}));
interface EnsureResult {
  ok: boolean;
  error?: string;
  installed: boolean;
  installReason: 'first-install' | 'package-json-changed' | 'unchanged' | 'no-package-json';
  devServerStarted: boolean;
}

const ensureWorkspaceRunningMock = vi.fn(
  async (): Promise<EnsureResult> => ({
    ok: true,
    installed: true,
    installReason: 'first-install',
    devServerStarted: true,
  }),
);
const waitForDevServerReadyMock = vi.fn(
  async (): Promise<{ ok: true; url: string } | { ok: false; error: string }> => ({
    ok: true,
    url: 'http://localhost:5173',
  }),
);
const getActiveManifestMock = vi.fn(async () => null as { id: string; version: number } | null);
const reconstructFilesMock = vi.fn(async () => [] as { path: string; content: string }[]);
const propagatePhaseUpdateMock = vi.fn(async (): Promise<'hmr' | 'reloaded' | 'no-preview'> => 'hmr');
const showWorkbenchSet = vi.fn();
const currentViewSet = vi.fn();

vi.mock('~/lib/code-generation/projectGenerator', () => ({ generateProject: generateProjectMock }));
vi.mock('~/lib/code-generation/webcontainerWriter', () => ({
  writeGeneratedProjectToWebContainer: writeToWebContainerMock,
  installAndStartDevServer: vi.fn(),
  readGeneratedFileFromWebContainer: vi.fn(),
  beginWorkspaceSession: beginWorkspaceSessionMock,
  writeGeneratedFilesToWebContainer: writeFilesToWebContainerMock,
  ensureWorkspaceRunning: ensureWorkspaceRunningMock,
  propagatePhaseUpdateToPreview: propagatePhaseUpdateMock,
  waitForDevServerReady: waitForDevServerReadyMock,
}));
vi.mock('~/lib/stores/projects', () => ({
  updateProjectWorkspaceState: updateProjectWorkspaceStateMock,
  getProjectArtifacts: () => [],
  isProjectDashboardOpenStore: { set: vi.fn(), get: () => false },
}));
vi.mock('~/lib/stores/engineeringTimeline', () => ({
  upsertEngineeringTimelineEvent: upsertTimelineMock,
  resetEngineeringTimeline: vi.fn(),
}));
vi.mock('~/lib/stores/chat', () => ({ chatStore: { setKey: vi.fn() } }));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: { showWorkbench: { set: showWorkbenchSet }, currentView: { set: currentViewSet } },
}));
vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  buildersDbRepository: { addProjectActivity: addProjectActivityMock },
}));
vi.mock('~/lib/builders-db/schemaGuard', () => ({ verifyBuildersDbSchema: async () => ({ ok: true }) }));
vi.mock('~/lib/application-manifest/resumeOrchestrator', () => ({
  prepareManifestForGeneration: vi.fn(async () => ({
    ok: true,
    manifest: { id: 'm1', version: 1, totalFiles: 0 },
    files: [],
  })),
}));
vi.mock('~/lib/application-manifest/applicationManifestRepository', () => ({
  activateManifestFiles: vi.fn(async () => ({ ok: true, activated: 0 })),
  getActiveApplicationManifest: getActiveManifestMock,
  listApplicationManifestFiles: async () => [],
}));
vi.mock('~/lib/generated-files/generatedFilesRepository', () => ({
  computeFileChecksum: async () => 'checksum',
  getReusableFileContent: async () => null,
  listGeneratedFiles: async () => [],
  markFileFailed: vi.fn(),
  markFileGenerating: vi.fn(),
  persistGeneratedFile: vi.fn(),
  reconcileUnplannedFile: vi.fn(),
  reconstructFilesFromManifest: reconstructFilesMock,
  updateFileOwnership: vi.fn(),
}));
vi.mock('~/lib/code-review/repairEngine', () => ({
  runStaticReviewLoop: vi.fn(async ({ project }: { project: unknown }) => ({ ok: true, project, issues: [] })),
  runBuildRepairLoop: vi.fn(async ({ project }: { project: unknown }) => ({ ok: true, project })),
}));
vi.mock('~/lib/mvp/mvpRepository', () => ({ mvpRepository: { resolveActiveMvpId: async () => null } }));
vi.mock('~/lib/features/featureRepository', () => ({ featureRepository: { listFeaturesForMvp: async () => [] } }));
vi.mock('~/lib/projects/databaseDesignerEngine', () => ({
  databaseDesignerEngine: { getApprovedStructuredSchema: () => null },
}));
vi.mock('~/lib/backend-generation/backendModulePlanner', () => ({ deriveBackendModulePlans: () => [] }));
vi.mock('~/lib/generation-profiles/generationProfileRepository', () => ({ getRoleGenerateOptions: () => ({}) }));
vi.mock('~/lib/workspace-snapshot', () => ({
  getWorkspaceSnapshotProvider: () => ({ saveSnapshot: async () => undefined, getSnapshot: async () => [] }),
}));
vi.mock('~/lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('./useGenerateText', () => ({ useGenerateText: () => ({ generate: vi.fn(), isGenerating: false }) }));
vi.mock('~/lib/generated-files/fileOwnership', () => ({
  buildFileConflict: vi.fn(),
  detectManualEdit: vi.fn(),
  resolveOverwritePolicy: vi.fn(),
  resolveOwnershipAfterEditCheck: vi.fn(),
}));

const { useCodeGeneration } = await import('./useCodeGeneration');

const project = { id: 'project-1', name: 'RunRide' } as Project;
const productPackage = { sections: [], missingSections: [], assembledAt: undefined } as unknown as ProductPackage;

const PHASE_ONE_FILES = [
  { path: 'src/components/Navbar.tsx', content: 'navbar' },
  { path: 'package.json', content: 'pkg' },
  { path: 'src/App.tsx', content: 'app' },
  { path: 'src/pages/HomePage.tsx', content: 'shell' },
];

const PHASE_TWO_FILES = [{ path: 'src/pages/HomePage.tsx', content: 'the real home page' }];

function workspacePatches() {
  return updateProjectWorkspaceStateMock.mock.calls.map((call) => call[1]);
}

function activityDescriptions(): string[] {
  return addProjectActivityMock.mock.calls.map((call) => String(call[0].description));
}

/** Drives `generateProject` as the real pipeline would: Phase 1's files, then (optionally) a later phase, then the run's outcome. */
function drivePhases(options: { laterPhase?: boolean; outcome: 'ok' | 'failed' }) {
  generateProjectMock.mockImplementation(async (...args: unknown[]) => {
    const hooks = args[10] as GenerationPhaseHooks;

    await hooks.onPhaseActivating?.(1);
    await hooks.onPhaseFiles?.(1, PHASE_ONE_FILES);
    await hooks.onPhaseCompleted?.(1);

    if (options.laterPhase) {
      await hooks.onPhaseActivating?.(2);
      await hooks.onPhaseFiles?.(2, PHASE_TWO_FILES);
      await hooks.onPhaseCompleted?.(2);
    }

    if (options.outcome === 'failed') {
      return {
        ok: false,
        issues: [{ severity: 'error', stage: 'generating-backend', message: 'Backend module failed' }],
        failedStage: 'generating-backend',
        terminationReason: 'phase-failed',
      };
    }

    return {
      ok: true,
      issues: [],
      project: {
        projectId: project.id,
        templateId: 'react-vite-ts',
        files: [...PHASE_ONE_FILES, ...PHASE_TWO_FILES],
        folders: [],
        generatedAt: '',
      },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  addProjectActivityMock.mockResolvedValue(undefined);
  writeFilesToWebContainerMock.mockImplementation(async (_projectId: string, files: { path: string }[]) => ({
    written: files.map((file) => file.path),
    skipped: [],
  }));
  ensureWorkspaceRunningMock.mockResolvedValue({
    ok: true,
    installed: true,
    installReason: 'first-install',
    devServerStarted: true,
  });
  waitForDevServerReadyMock.mockResolvedValue({ ok: true, url: 'http://localhost:5173' });
  getActiveManifestMock.mockResolvedValue(null);
  reconstructFilesMock.mockResolvedValue([]);
  propagatePhaseUpdateMock.mockResolvedValue('hmr');
});

describe('Early Preview — Phase 1 (Sprint 99C)', () => {
  it('writes Phase 1, installs, starts the dev server and makes the preview available mid-run', async () => {
    drivePhases({ outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    // Phase 1's files reached the workspace as their own write, before the whole-project write.
    expect(writeFilesToWebContainerMock).toHaveBeenCalledWith('project-1', PHASE_ONE_FILES);
    expect(ensureWorkspaceRunningMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', packageJson: 'pkg' }),
    );
    expect(waitForDevServerReadyMock).toHaveBeenCalled();

    // …and preview availability was persisted at that point, not at the end of the run.
    const previewPatch = workspacePatches().find((patch) => patch.previewAvailable === true);
    expect(previewPatch).toMatchObject({ previewAvailable: true, lastPreviewStatus: 'available' });
    expect(previewPatch.lastActivity).toContain('Builders is continuing generation');

    expect(showWorkbenchSet).toHaveBeenCalledWith(true);
    expect(currentViewSet).toHaveBeenCalledWith('preview');
  });

  it('reports a preview time and ends in the generation-complete preview state', async () => {
    drivePhases({ outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(result.current.timeToPreviewMs).toBeGreaterThanOrEqual(0);
    expect(result.current.previewState).toBe('generation-complete');
  });

  it('starts a fresh workspace session per run, so a second run rewrites everything', async () => {
    drivePhases({ outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(beginWorkspaceSessionMock).toHaveBeenCalledWith('project-1');
  });

  it('does not block generation when the preview fails to boot', async () => {
    ensureWorkspaceRunningMock.mockResolvedValue({
      ok: false,
      error: 'npm install failed (exit code 1).',
      installed: false,
      installReason: 'first-install',
      devServerStarted: false,
    });
    drivePhases({ outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    // The run still completed — the early preview is an improvement, never a new failure mode.
    expect(result.current.stage).toBe('complete');
    expect(activityDescriptions().some((entry) => entry.includes('Early preview could not start'))).toBe(true);
  });
});

describe('Early Preview — later phases (Sprint 99C)', () => {
  it('writes only that phase’s files and propagates them through HMR', async () => {
    drivePhases({ laterPhase: true, outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(writeFilesToWebContainerMock).toHaveBeenCalledWith('project-1', PHASE_TWO_FILES);
    expect(propagatePhaseUpdateMock).toHaveBeenCalled();
    expect(activityDescriptions().some((entry) => entry.includes('reached the preview via HMR'))).toBe(true);
  });

  it('reports the controlled reload when HMR does not settle', async () => {
    propagatePhaseUpdateMock.mockResolvedValue('reloaded');
    drivePhases({ laterPhase: true, outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(activityDescriptions().some((entry) => entry.includes('controlled reload'))).toBe(true);
  });

  it('does not reinstall for a later phase when package.json is unchanged', async () => {
    ensureWorkspaceRunningMock
      .mockResolvedValueOnce({ ok: true, installed: true, installReason: 'first-install', devServerStarted: true })
      .mockResolvedValue({ ok: true, installed: false, installReason: 'unchanged', devServerStarted: false });
    drivePhases({ laterPhase: true, outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    const installs = activityDescriptions().filter((entry) => entry.includes('package.json changed'));
    expect(installs).toHaveLength(0);
  });

  it('reinstalls once when a later phase changes package.json', async () => {
    ensureWorkspaceRunningMock
      .mockResolvedValueOnce({ ok: true, installed: true, installReason: 'first-install', devServerStarted: true })
      .mockResolvedValue({
        ok: true,
        installed: true,
        installReason: 'package-json-changed',
        devServerStarted: false,
      });
    drivePhases({ laterPhase: true, outcome: 'ok' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(activityDescriptions().filter((entry) => entry.includes('package.json changed'))).toHaveLength(1);
  });
});

describe('Early Preview — a later phase failing (Sprint 99C)', () => {
  it('keeps the preview available, reports the failed phase, and leaves the run retryable', async () => {
    drivePhases({ laterPhase: false, outcome: 'failed' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(result.current.stage).toBe('failed');
    expect(result.current.error).toContain('Backend module failed');

    // The preview is untouched by the failure — the whole point of the sprint.
    expect(result.current.previewState).toBe('preview-ready');

    const failurePatch = workspacePatches().at(-1);
    expect(failurePatch).toMatchObject({
      lastGenerationStatus: 'failed',
      previewAvailable: true,
      lastPreviewStatus: 'available',
    });
    expect(activityDescriptions().some((entry) => entry.includes('still available'))).toBe(true);
  });

  it('does not claim a surviving preview when none ever booted', async () => {
    waitForDevServerReadyMock.mockResolvedValue({ ok: false, error: 'Dev server did not report ready within 90s.' });
    drivePhases({ laterPhase: false, outcome: 'failed' });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(result.current.previewState).toBe('not-available');
    expect(workspacePatches().at(-1)?.previewAvailable).toBeUndefined();
  });
});

describe('Early Preview — resume (Sprint 99C)', () => {
  const RESTORED = [
    { path: 'package.json', content: 'pkg' },
    { path: 'src/main.tsx', content: 'main' },
    { path: 'src/components/Navbar.tsx', content: 'navbar' },
    { path: 'src/pages/HomePage.tsx', content: 'home' },
    { path: 'src/features/rides/service.ts', content: 'service' },
  ];

  it('reconstructs Phase 1 first and brings the preview back before the rest is restored', async () => {
    getActiveManifestMock.mockResolvedValue({ id: 'manifest-1', version: 3 });
    reconstructFilesMock.mockResolvedValue(RESTORED);

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.resumeApplication(project);
    });

    const writes = writeFilesToWebContainerMock.mock.calls.map((call) =>
      (call[1] as { path: string }[]).map((f) => f.path),
    );

    // First write is exactly the bootable Phase 1 set; the later phases follow into the running workspace.
    expect(writes[0]).toEqual(['package.json', 'src/main.tsx', 'src/components/Navbar.tsx']);
    expect(writes[1]).toEqual(['src/pages/HomePage.tsx', 'src/features/rides/service.ts']);

    // The preview was marked available BEFORE the later-phase write — that ordering is the requirement.
    const previewPatchIndex = workspacePatches().findIndex((patch) => patch.previewAvailable === true);
    expect(previewPatchIndex).toBeGreaterThanOrEqual(0);
    expect(ensureWorkspaceRunningMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', packageJson: 'pkg' }),
    );
    expect(propagatePhaseUpdateMock).toHaveBeenCalled();
    expect(result.current.previewState).toBe('generation-complete');
  });

  it('reports a failed restore without claiming a preview', async () => {
    getActiveManifestMock.mockResolvedValue({ id: 'manifest-1', version: 3 });
    reconstructFilesMock.mockResolvedValue(RESTORED);
    ensureWorkspaceRunningMock.mockResolvedValue({
      ok: false,
      error: 'npm install failed (exit code 1).',
      installed: false,
      installReason: 'first-install',
      devServerStarted: false,
    });

    const { result } = renderHook(() => useCodeGeneration());
    await act(async () => {
      await result.current.resumeApplication(project);
    });

    expect(result.current.stage).toBe('failed');
    expect(workspacePatches().some((patch) => patch.previewAvailable === true)).toBe(false);
  });
});
