import type { Project } from '~/lib/stores/projects';
import { hydrateWorkspaceState, touchProjectLastOpened, updateProjectWorkspaceState } from '~/lib/stores/projects';
import { buildersDbRepository } from '~/lib/builders-db/repositories/buildersDbRepository';
import { getWorkspaceSnapshotProvider } from '~/lib/workspace-snapshot';
import type { GeneratedProject } from '~/lib/code-generation/codeGenerationTypes';
import {
  installDependenciesWithTimeout,
  startDevServerOnly,
  waitForDevServerReady,
  waitForWebContainerReady,
  writeGeneratedProjectToWebContainer,
} from '~/lib/code-generation/webcontainerWriter';
import { verifyRequiredFiles } from './requiredFiles';
import { createGenerationLock } from './generationLock';
import {
  beginWorkspaceResume,
  failWorkspaceResume,
  getWorkspaceResumeState,
  isWorkspaceResumeActive,
  setWorkspaceResumeStage,
} from './workspaceResumeStore';
import type { WorkspaceResumeStage } from './workspaceResumeTypes';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('WorkspaceResumeOrchestrator');

/**
 * Workspace Resume Lifecycle — Sprint 44.
 *
 * The single authoritative "reopen an already-generated Quick Build project" function —
 * every entry point (browser refresh, sidebar click, Home Dashboard's "Continue Working"
 * card, navigating away and back) must call this, never re-implement any part of it. See
 * workspaceResumeStore.ts for the state machine this drives and Sprint 44's audit for why
 * the previous ad-hoc attempt (calling `continueQuickBuildFromSnapshot` directly from a
 * React effect) hung indefinitely: it raced against `useChatHistory.ts`'s legacy,
 * un-awaited IndexedDB file restore writing into the SAME WebContainer at the same time.
 *
 * This function does NOT reimplement `continueQuickBuildFromSnapshot` (quickBuildOrchestrator.ts)
 * — that one remains the "Continue From Last Successful Step" recovery path for a FAILED
 * generation's own retry button (Part 11), a different situation (mid-generation failure,
 * not "reopening a finished project"). The two intentionally share the same underlying
 * primitives (`writeGeneratedProjectToWebContainer`, `verifyRequiredFiles`) but have
 * different lifecycles, locks, and failure semantics — merging them was evaluated and
 * rejected as a bigger, riskier change than this sprint's actual bug needs.
 */

/*
 * Sprint 44 live verification — a genuine cold `WebContainer.boot()` (iframe/service-worker
 * sandbox init) measured 30s+ in this environment; 30s was too tight and produced false-
 * positive failures on an otherwise-healthy boot. 60s gives real cold boots headroom while
 * still failing well before a user would assume the app is simply broken. Similarly,
 * cross-referencing this same sprint's initial-generation test data (Test 4, a 20-file
 * project): `npm install` alone measured ~122s end to end via the existing, unbounded
 * `installAndStartDevServer` — 120s left effectively no margin and produced the same kind
 * of false-positive timeout live. 180s keeps a real bound (still far short of "indefinite")
 * while comfortably covering observed real install times for Quick Build-sized projects.
 */
const WEBCONTAINER_READY_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 180_000;
const SERVER_READY_TIMEOUT_MS = 60_000;

export interface WorkspaceResumeResult {
  ok: boolean;
  error?: string;
}

/** Keyed by resumeId (Sprint 44 Phase 5) — NOT projectId — so a retry (a fresh resumeId) always gets its own execution while duplicate calls for the SAME attempt collapse onto one promise. */
const resumeLock = createGenerationLock<WorkspaceResumeResult>();

function mintResumeId(projectId: string): string {
  return `resume_${projectId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function logActivity(projectId: string, activityType: string, description: string): void {
  buildersDbRepository
    .addProjectActivity({ projectId, activityType, description })
    .catch((error) => logger.warn(`Activity log failed (${activityType}):`, error));
}

/**
 * Public entry point. Reuses an already-in-flight resume for `project.id` (returns the SAME
 * promise) rather than starting a second one — "one project reopen = one resume execution."
 * A project whose previous resume already reached `ready`/`failed` gets a brand-new
 * `resumeId` and a fresh attempt, exactly like a generation retry.
 */
export function resumeQuickBuildWorkspace(project: Project): Promise<WorkspaceResumeResult> {
  const existing = getWorkspaceResumeState(project.id);
  const reuseExisting = !!existing && isWorkspaceResumeActive(project.id);
  const resumeId = reuseExisting ? existing!.resumeId : mintResumeId(project.id);

  if (!reuseExisting) {
    beginWorkspaceResume(project.id, resumeId);
  }

  return resumeLock.run(resumeId, () => runWorkspaceResume(project, resumeId));
}

async function runWorkspaceResume(project: Project, resumeId: string): Promise<WorkspaceResumeResult> {
  const projectId = project.id;

  /*
   * Re-checked before every stage write below — if a NEWER resumeId has since taken over
   * (a retry started while this one was still in flight), this stale run stops touching
   * shared state entirely rather than clobbering the newer attempt's progress. Same pattern
   * quickBuildOrchestrator.ts's `isStillActiveGeneration()` already uses.
   */
  const isStillActive = (): boolean => getWorkspaceResumeState(projectId)?.resumeId === resumeId;

  const fail = (step: WorkspaceResumeStage, reason: string): WorkspaceResumeResult => {
    logger.error(`resume failed at ${step}:`, reason);

    if (isStillActive()) {
      failWorkspaceResume(projectId, resumeId, { step, reason });
      logActivity(projectId, 'workspace_resume_failed', `Workspace resume failed at ${step}: ${reason}`);
      updateProjectWorkspaceState(projectId, { lastGenerationStatus: 'failed', lastError: reason });
    }

    return { ok: false, error: reason };
  };

  try {
    setWorkspaceResumeStage(projectId, resumeId, 'hydratingProject');
    logActivity(projectId, 'workspace_resume_started', 'Workspace resume started');
    touchProjectLastOpened(projectId);
    await hydrateWorkspaceState(projectId);

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    // ── loadingSnapshot — BuildersDB is the sole authoritative file source for a resume ──
    setWorkspaceResumeStage(projectId, resumeId, 'loadingSnapshot');

    const files = await getWorkspaceSnapshotProvider().getSnapshot(projectId);

    if (files.length === 0) {
      return fail('loadingSnapshot', 'No saved workspace snapshot exists to resume from.');
    }

    logActivity(projectId, 'snapshot_loaded', `${files.length} file(s) loaded from the saved snapshot`);

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    // ── waitingForWebContainer — bounded, never an unbounded await ──
    setWorkspaceResumeStage(projectId, resumeId, 'waitingForWebContainer');

    try {
      await waitForWebContainerReady(WEBCONTAINER_READY_TIMEOUT_MS);
    } catch (error) {
      return fail(
        'waitingForWebContainer',
        error instanceof Error ? error.message : 'WebContainer did not become ready.',
      );
    }

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    /*
     * ── restoringFiles — the ONLY writer for a quick_build resume; useChatHistory.ts's
     * legacy IndexedDB restore is skipped upstream whenever this path is taken (see that
     * file's own comment) so exactly one thing ever writes files into the WebContainer ──
     */
    setWorkspaceResumeStage(projectId, resumeId, 'restoringFiles');

    const restoredProject: GeneratedProject = {
      projectId,
      templateId: 'quick-build',
      files,
      folders: [],
      generatedAt: new Date().toISOString(),
    };

    await writeGeneratedProjectToWebContainer(restoredProject);

    const requiredFiles = verifyRequiredFiles(files.map((file) => file.path));

    if (!requiredFiles.ok) {
      return fail('restoringFiles', `Required file(s) missing after restore: ${requiredFiles.missing.join(', ')}.`);
    }

    logActivity(projectId, 'files_restored', `${files.length} file(s) restored to the workspace`);

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    // ── installingDependencies — bounded timeout, kills the process rather than hanging ──
    setWorkspaceResumeStage(projectId, resumeId, 'installingDependencies');
    logActivity(projectId, 'dependency_install_started', 'Installing dependencies');

    const installResult = await installDependenciesWithTimeout(INSTALL_TIMEOUT_MS);

    if (!installResult.ok) {
      return fail('installingDependencies', installResult.error);
    }

    logActivity(projectId, 'dependency_install_completed', 'Dependencies installed successfully');

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    // ── startingPreview — real server-ready event, bounded timeout ──
    setWorkspaceResumeStage(projectId, resumeId, 'startingPreview');
    logActivity(projectId, 'preview_start_started', 'Starting the dev server');

    await startDevServerOnly();

    const readyResult = await waitForDevServerReady(SERVER_READY_TIMEOUT_MS);

    if (!readyResult.ok) {
      return fail('startingPreview', readyResult.error);
    }

    if (!isStillActive()) {
      return { ok: false, error: 'superseded' };
    }

    workbenchStore.showWorkbench.set(true);
    workbenchStore.currentView.set('preview');

    setWorkspaceResumeStage(projectId, resumeId, 'ready', { previewUrl: readyResult.url });
    logActivity(projectId, 'preview_ready', 'Preview restored and ready');
    updateProjectWorkspaceState(projectId, {
      currentStage: 'complete',
      lastActivity: 'Workspace resumed and preview restored',
      lastGenerationStatus: 'generated',
      previewAvailable: true,
      lastPreviewStatus: 'available',
    });

    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unexpected error while resuming the workspace.';
    const stage = getWorkspaceResumeState(projectId)?.stage ?? 'hydratingProject';

    return fail(stage === 'ready' || stage === 'failed' ? 'hydratingProject' : stage, reason);
  }
}
