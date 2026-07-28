// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';

/**
 * Sprint 98C — cancellation state fidelity (DEF-1, DEF-2).
 *
 * Sprint 98A gave the operator a Stop button and generationPipeline.spec.ts covers the pipeline
 * half of it (no AI call after abort). What was never covered is what the hook does with a
 * cancelled RESULT, which is where both 98C defects lived: the run was persisted as
 * `not-generated` (indistinguishable from a project nobody ever generated) and drawn on the
 * Engineering Timeline as `failed` (a red marker for what is actually an operator decision).
 *
 * Exercised through `useCodeGeneration` itself with `generateProject` stubbed to return a
 * cancelled result — the real branch, not a reimplementation of it — so the assertions below
 * are on the persisted state, the timeline entry and the activity log that Acceptance Round 2
 * will read.
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
const installAndStartDevServerMock = vi.fn();
const beginWorkspaceSessionMock = vi.fn();
const writeFilesToWebContainerMock = vi.fn(async () => ({ written: [], skipped: [] }));
const ensureWorkspaceRunningMock = vi.fn(async () => ({
  ok: true,
  installed: false,
  installReason: 'unchanged' as const,
  devServerStarted: false,
}));
const generateTextMock = vi.fn();
const prepareManifestMock = vi.fn();

vi.mock('~/lib/code-generation/projectGenerator', () => ({ generateProject: generateProjectMock }));
vi.mock('~/lib/code-generation/webcontainerWriter', () => ({
  writeGeneratedProjectToWebContainer: writeToWebContainerMock,
  installAndStartDevServer: installAndStartDevServerMock,
  readGeneratedFileFromWebContainer: vi.fn(),

  /* Sprint 99C — the Early Preview workspace surface. A cancelled run must touch none of these. */
  beginWorkspaceSession: beginWorkspaceSessionMock,
  writeGeneratedFilesToWebContainer: writeFilesToWebContainerMock,
  ensureWorkspaceRunning: ensureWorkspaceRunningMock,
  propagatePhaseUpdateToPreview: vi.fn(async () => 'hmr'),
  waitForDevServerReady: vi.fn(async () => ({ ok: true, url: 'http://localhost:5173' })),
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
  workbenchStore: { setShowWorkbench: vi.fn(), currentView: { set: vi.fn() } },
}));
vi.mock('~/lib/builders-db/repositories/buildersDbRepository', () => ({
  buildersDbRepository: { addProjectActivity: addProjectActivityMock },
}));
vi.mock('~/lib/builders-db/schemaGuard', () => ({ verifyBuildersDbSchema: async () => ({ ok: true }) }));
vi.mock('~/lib/application-manifest/resumeOrchestrator', () => ({ prepareManifestForGeneration: prepareManifestMock }));
vi.mock('~/lib/application-manifest/applicationManifestRepository', () => ({
  getActiveApplicationManifest: async () => null,
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
  reconstructFilesFromManifest: async () => [],
  updateFileOwnership: vi.fn(),
}));
vi.mock('~/lib/code-review/repairEngine', () => ({ runStaticReviewLoop: vi.fn(), runBuildRepairLoop: vi.fn() }));
vi.mock('~/lib/mvp/mvpRepository', () => ({ mvpRepository: { resolveActiveMvpId: async () => null } }));
vi.mock('~/lib/features/featureRepository', () => ({ featureRepository: { listFeaturesForMvp: async () => [] } }));
vi.mock('~/lib/projects/databaseDesignerEngine', () => ({
  databaseDesignerEngine: { getApprovedStructuredSchema: () => null },
}));
vi.mock('~/lib/backend-generation/backendModulePlanner', () => ({ deriveBackendModulePlans: () => [] }));
vi.mock('~/lib/generation-profiles/generationProfileRepository', () => ({ getRoleGenerateOptions: () => ({}) }));
vi.mock('~/lib/workspace-snapshot', () => ({ getWorkspaceSnapshotProvider: () => null }));
vi.mock('~/lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('./useGenerateText', () => ({ useGenerateText: () => ({ generate: generateTextMock, isGenerating: false }) }));

const { useCodeGeneration } = await import('./useCodeGeneration');

const project = { id: 'project-1', name: 'Test App' } as Project;
const productPackage = { sections: [], missingSections: [], assembledAt: undefined } as unknown as ProductPackage;

/** Every `updateProjectWorkspaceState` patch this run wrote, in order. */
function workspacePatches() {
  return updateProjectWorkspaceStateMock.mock.calls.map((call) => call[1]);
}

function timelineEvent(id: string) {
  const call = [...upsertTimelineMock.mock.calls].reverse().find(([eventId]) => eventId === id);
  return call?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  addProjectActivityMock.mockResolvedValue(undefined);
  generateProjectMock.mockResolvedValue({
    ok: false,
    cancelled: true,

    // Sprint 99, AR2-BUG-007 — the real pipeline now tags every termination; only this value may persist `cancelled`.
    terminationReason: 'operator-cancelled',
    project: undefined,
    issues: [{ severity: 'info', message: 'Generation stopped by the operator.' }],
    failedStage: 'planning',
  });
});

describe('useCodeGeneration — cancelled run state (Sprint 98C)', () => {
  it('persists lastGenerationStatus as "cancelled", not "not-generated" or "failed" (DEF-1)', async () => {
    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    const statuses = workspacePatches().map((patch) => patch.lastGenerationStatus);

    // 'generating' on entry, then the terminal state — and the terminal state is the cancellation.
    expect(statuses).toEqual(['generating', 'cancelled']);

    const terminal = workspacePatches().at(-1);
    expect(terminal).toMatchObject({
      lastGenerationStatus: 'cancelled',
      lastActivity: 'Generation stopped by the operator',
    });

    // A cancellation is not an error: nothing is left behind for a "Needs Repair" banner to read.
    expect(terminal?.lastError).toBeUndefined();
  });

  it('records the timeline entry as "cancelled" rather than "failed" (DEF-2)', async () => {
    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(timelineEvent('planning')).toMatchObject({
      label: 'Generation stopped',
      status: 'cancelled',
      detail: 'Stopped by the operator',
    });

    // No entry anywhere on the timeline claims this run failed.
    expect(upsertTimelineMock.mock.calls.some(([, patch]) => patch.status === 'failed')).toBe(false);
  });

  it('logs the stop as its own activity type with the operator wording', async () => {
    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(addProjectActivityMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      activityType: 'generation_cancelled',
      description: 'Generation stopped by the operator',
    });
    expect(addProjectActivityMock.mock.calls.some(([entry]) => entry.activityType === 'generation_failed')).toBe(false);
  });

  it('stops cleanly: no file write, no install, no auto-resume, no further AI calls', async () => {
    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(writeToWebContainerMock).not.toHaveBeenCalled();
    expect(installAndStartDevServerMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();

    // The run is over and reported as stopped — not left running and not retried.
    expect(result.current.isRunning).toBe(false);
    expect(result.current.stageLabel).toBe('Stopped');
    expect(result.current.error).toBeUndefined();
  });

  it('never persists cancelled for an internal abort (Sprint 99, AR2-BUG-007)', async () => {
    /*
     * Acceptance Round 2 twice recorded a run that died of 96 consecutive provider failures as
     * "Generation stopped by the operator". A result that is aborted but NOT operator-cancelled
     * must land in the failure branch with a real lastError.
     */
    generateProjectMock.mockResolvedValue({
      ok: false,
      cancelled: true,
      terminationReason: 'provider-error',
      project: undefined,
      issues: [{ severity: 'error', message: 'FEAT-005 (types & validators): credit balance is too low.' }],
      failedStage: 'generating-backend',
    });

    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    const terminal = workspacePatches().at(-1);
    expect(terminal?.lastGenerationStatus).toBe('failed');
    expect(terminal?.lastError).toContain('credit balance is too low');

    expect(addProjectActivityMock.mock.calls.some(([entry]) => entry.activityType === 'generation_cancelled')).toBe(
      false,
    );
    expect(upsertTimelineMock.mock.calls.some(([, patch]) => patch.status === 'cancelled')).toBe(false);
  });

  it('leaves a failed run untouched — cancellation handling did not swallow real failures', async () => {
    generateProjectMock.mockResolvedValue({
      ok: false,
      project: undefined,
      issues: [{ severity: 'error', message: 'Planning failed.' }],
      failedStage: 'planning',
    });

    const { result } = renderHook(() => useCodeGeneration());

    await act(async () => {
      await result.current.runGeneration(project, productPackage);
    });

    expect(workspacePatches().at(-1)).toMatchObject({ lastGenerationStatus: 'failed', lastError: 'Planning failed.' });
    expect(timelineEvent('planning')?.status).toBe('failed');
  });
});
