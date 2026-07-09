import { useCallback, useState } from 'react';
import { isProjectDashboardOpenStore, updateProjectWorkspaceState, type Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import { buildProductSummaryMarkdown } from '~/lib/product-assembly/assemblyMarkdown';
import { generateProject } from '~/lib/code-generation/projectGenerator';
import {
  installAndStartDevServer,
  writeGeneratedProjectToWebContainer,
} from '~/lib/code-generation/webcontainerWriter';
import type { GenerateFn, GenerationResult, GenerationStage } from '~/lib/code-generation/codeGenerationTypes';
import { runBuildRepairLoop, runStaticReviewLoop } from '~/lib/code-review/repairEngine';
import type { OnRepairLoopEvent } from '~/lib/code-review/codeReviewTypes';
import { getRoleGenerateOptions } from '~/lib/generation-profiles/generationProfileRepository';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { resetEngineeringTimeline, upsertEngineeringTimelineEvent } from '~/lib/stores/engineeringTimeline';
import { buildersDbRepository } from '~/lib/builders-db/repositories/buildersDbRepository';
import { getWorkspaceSnapshotProvider } from '~/lib/workspace-snapshot';
import { useGenerateText } from './useGenerateText';

/**
 * Sprint 38 — orchestrates the whole "Generate Application" flow: runs the code
 * generation pipeline (app/lib/code-generation/projectGenerator.ts, in-memory only),
 * then — only once that succeeds — writes the result into the live WebContainer,
 * installs dependencies, starts the dev server, and switches the workbench to the
 * Preview tab. Mirrors every other AI-role hook's shape in this codebase
 * (useDraftPanel.ts, useAutoEngineeringPipeline.ts): a thin React wrapper around
 * pure/testable engine functions, with all the browser/store side effects (and now,
 * new this sprint, the WebContainer writes) living here rather than in the engine
 * layer.
 *
 * Sprint 38.1 (UI handoff fix) — `isProjectDashboardOpenStore.set(false)` is called
 * here, at the start of the `writing-files` stage, rather than reactively (e.g. a
 * `useEffect` in ProductPackagePanel.tsx watching for `stage === 'complete'`, the
 * previous approach). This closes the Dialog (see ProjectDashboard.tsx, which reads
 * this exact store) BEFORE `workbenchStore.showWorkbench`/`currentView` are ever
 * touched later at the `launching-preview` stage — eliminating the race that let the
 * still-open, only-70%-opaque-and-blurred Dialog overlay visually coexist with the
 * Workbench sliding in underneath it. Reused directly rather than plumbed through an
 * `onClose` prop: `isProjectDashboardOpenStore` (app/lib/stores/projects.ts) is the
 * same store Menu.client.tsx already uses to open/close this exact dialog, so this
 * hook closing it directly is not a new mechanism, just the existing one called from
 * one more place.
 */

/** Maps every fine-grained GenerationStage onto the 5 labels the sprint's UI spec calls for (Planning/Generating/Writing Files/Installing/Launching Preview) — the underlying GenerationResult still records which exact stage ran. */
const STAGE_GROUP_LABELS: Record<GenerationStage, string> = {
  planning: 'Planning',
  'generating-types': 'Generating',
  'generating-services': 'Generating',
  'generating-pages': 'Generating',
  'generating-components': 'Generating',
  validating: 'Generating',
  assembling: 'Generating',
  'writing-files': 'Writing Files',
  installing: 'Installing',
  'launching-preview': 'Launching Preview',
  complete: 'Complete',
};

/** Same grouping as STAGE_GROUP_LABELS, but as stable ids for the Engineering Timeline (app/lib/stores/engineeringTimeline.ts) — repeated fine-grained stages within one group update the same timeline entry instead of appending a new one. */
const STAGE_TIMELINE_ID: Record<GenerationStage, string> = {
  planning: 'planning',
  'generating-types': 'generating',
  'generating-services': 'generating',
  'generating-pages': 'generating',
  'generating-components': 'generating',
  validating: 'generating',
  assembling: 'generating',
  'writing-files': 'writing-files',
  installing: 'installing',
  'launching-preview': 'launching-preview',
  complete: 'launching-preview',
};

export interface CodeGenerationState {
  isRunning: boolean;
  stage: GenerationStage | 'idle' | 'failed';
  stageLabel: string;
  detail?: string;
  result?: GenerationResult;
  error?: string;
}

const IDLE_STATE: CodeGenerationState = { isRunning: false, stage: 'idle', stageLabel: 'Idle' };

function logActivity(projectId: string, activityType: string, description: string): void {
  buildersDbRepository
    .addProjectActivity({ projectId, activityType, description })
    .catch((error) => console.error(`[CodeGeneration] ${activityType} activity log failed:`, error));
}

/**
 * Sprint 39 — translates the Code Reviewer/Repair Engineer/Build Validator loops'
 * `RepairLoopEvent`s into Engineering Timeline entries (labeled with the role name, so
 * repair activity reads as engineering-team work, not background plumbing) plus the same
 * activity-log/workspace-state side effects every other stage already gets. Mirrors exactly
 * how `runGenerationPipeline`'s `onProgress` is consumed above — the loop functions
 * themselves (repairEngine.ts) stay pure/testable, this hook owns every store write.
 */
function createRepairEventHandler(projectId: string, onAttempt: (attemptNumber: number) => void): OnRepairLoopEvent {
  return (event) => {
    switch (event.type) {
      case 'code-review-started':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: reviewing generated code',
          status: 'active',
        });
        logActivity(projectId, 'code_review_started', 'Code Reviewer started reviewing generated code');
        break;
      case 'static-validation-passed':
        upsertEngineeringTimelineEvent('code-review', { label: 'Code Reviewer: validation passed', status: 'done' });
        break;
      case 'static-validation-failed':
        upsertEngineeringTimelineEvent('code-review', {
          label: 'Code Reviewer: issues found',
          status: 'failed',
          detail: `${event.issues.length} issue(s) found`,
        });
        break;
      case 'repair-attempt-started':
        onAttempt(event.attemptNumber);
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: `Repair Engineer: attempting fix (${event.attemptNumber}/${event.maxAttempts})`,
          status: 'active',
          detail: event.stage === 'static' ? 'Fixing code review issues' : 'Fixing build/runtime error',
        });
        updateProjectWorkspaceState(projectId, { lastRepairStatus: 'repairing', repairAttempts: event.attemptNumber });
        logActivity(
          projectId,
          'repair_attempt_started',
          `Repair Engineer attempt ${event.attemptNumber}/${event.maxAttempts} (${event.stage})`,
        );
        break;
      case 'repair-patch-applied':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: patch applied',
          status: 'done',
          detail: event.summary,
        });
        logActivity(projectId, 'repair_patch_applied', `Repair Engineer applied a patch: ${event.summary}`);
        break;
      case 'repair-failed':
        upsertEngineeringTimelineEvent('repair-attempt', {
          label: 'Repair Engineer: repair failed',
          status: 'failed',
          detail: event.reason,
        });
        logActivity(
          projectId,
          'repair_failed',
          `Repair Engineer's attempt ${event.attemptNumber} failed: ${event.reason}`,
        );
        break;
      case 'build-validation-started':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: installing & starting dev server',
          status: 'active',
        });
        break;
      case 'preview-validation-passed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: preview stable',
          status: 'done',
        });
        break;
      case 'preview-validation-failed':
        upsertEngineeringTimelineEvent('build-validation', {
          label: 'Build Validator: build/runtime error detected',
          status: 'failed',
          detail: event.error.message,
        });
        break;
      case 'manual-attention-required':
        upsertEngineeringTimelineEvent('manual-attention', {
          label: 'Manual attention required',
          status: 'failed',
          detail: event.detail,
        });
        logActivity(
          projectId,
          'manual_attention_required',
          `Manual attention required (${event.stage}): ${event.detail}`,
        );
        break;
    }
  };
}

export function useCodeGeneration() {
  const { generate } = useGenerateText();
  const [state, setState] = useState<CodeGenerationState>(IDLE_STATE);

  const runGeneration = useCallback(
    async (project: Project, productPackage: ProductPackage) => {
      setState({ isRunning: true, stage: 'planning', stageLabel: STAGE_GROUP_LABELS.planning });
      logActivity(project.id, 'generation_started', `Code generation started for "${project.name}"`);
      updateProjectWorkspaceState(project.id, {
        lastGenerationStatus: 'generating',
        currentStage: 'planning',
        lastActivity: `Generation started for "${project.name}"`,
        lastError: undefined,
      });

      // Reveal the Engineering Timeline / conversation area in place of the landing hero (see Chat.client.tsx's sync of this flag onto local `chatStarted` state).
      resetEngineeringTimeline();
      chatStore.setKey('started', true);
      upsertEngineeringTimelineEvent('generation-started', {
        label: 'Generation started',
        status: 'done',
        detail: `Generating "${project.name}"`,
      });
      upsertEngineeringTimelineEvent('planning', { label: 'Planning', status: 'active' });

      /*
       * Sprint 39.5 — the code-generation pipeline's types/services/pages/components
       * stages are treated as one unit driven by the Frontend Engineer's model this
       * sprint (not split per fine-grained stage — see the plan's Known Limitations).
       * Falls back to the user's own dropdown selection when the profile/role doesn't
       * resolve, exactly like every other Generation Profile-routed call site.
       */
      const codeGenGenerate: GenerateFn = (system, prompt, opts) =>
        generate(system, prompt, { ...opts, ...getRoleGenerateOptions(project, 'frontend-draft') });

      const result = await generateProject(project, productPackage, codeGenGenerate, (progress) => {
        setState((prev) => ({
          ...prev,
          stage: progress.stage,
          stageLabel: STAGE_GROUP_LABELS[progress.stage],
          detail: progress.detail,
        }));
        logActivity(
          project.id,
          'generation_stage_completed',
          `${STAGE_GROUP_LABELS[progress.stage]}${progress.detail ? ` — ${progress.detail}` : ''}`,
        );
        upsertEngineeringTimelineEvent(STAGE_TIMELINE_ID[progress.stage], {
          label: STAGE_GROUP_LABELS[progress.stage],
          status: 'active',
          detail: progress.detail,
        });
      });

      if (!result.ok || !result.project) {
        const message = result.issues.find((issue) => issue.severity === 'error')?.message ?? 'Generation failed.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
        logActivity(
          project.id,
          'generation_failed',
          `Generation failed at ${result.failedStage ?? 'unknown stage'}: ${message}`,
        );
        upsertEngineeringTimelineEvent(STAGE_TIMELINE_ID[result.failedStage ?? 'planning'], {
          label: `${STAGE_GROUP_LABELS[result.failedStage ?? 'planning']} failed`,
          status: 'failed',
          detail: message,
        });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'failed',
          currentStage: result.failedStage ?? 'planning',
          lastError: message,
        });

        return;
      }

      let generatedProject = result.project;
      let totalRepairAttempts = 0;
      const handleRepairEvent = createRepairEventHandler(project.id, (attemptNumber) => {
        totalRepairAttempts = Math.max(totalRepairAttempts, attemptNumber);
      });
      const productPackageSummary = buildProductSummaryMarkdown(
        project,
        productPackage.sections,
        productPackage.missingSections,
        productPackage.assembledAt,
      );

      /*
       * Sprint 39.5 — the Repair Engineer's own AI call (repairEngine.ts's requestRepair)
       * is routed through the project's selected Generation Profile the same way every
       * other role is — falls back to the user's own dropdown selection when unresolved.
       */
      const repairGenerate: GenerateFn = (system, prompt, opts) =>
        generate(system, prompt, { ...opts, ...getRoleGenerateOptions(project, 'repair-engineer') });

      try {
        /*
         * Sprint 39 — the Code Reviewer runs (and, if needed, the Repair Engineer patches)
         * entirely in memory BEFORE anything is written to the WebContainer — a failure
         * here never touches whatever project was already running, same guarantee
         * generationPipeline.ts's own validation stage already gives (see
         * runStaticReviewLoop's header comment in repairEngine.ts).
         */
        const reviewResult = await runStaticReviewLoop({
          project: generatedProject,
          projectId: project.id,
          projectName: project.name,
          productPackageSummary,
          generate: repairGenerate,
          onEvent: handleRepairEvent,
        });

        if (!reviewResult.ok) {
          const message =
            reviewResult.issues.find((issue) => issue.severity === 'error')?.message ??
            'Code review found issues that could not be automatically repaired.';
          setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
          logActivity(project.id, 'generation_failed', `Code review failed after repair attempts: ${message}`);
          updateProjectWorkspaceState(project.id, {
            lastGenerationStatus: 'failed',
            lastError: message,
            lastRepairStatus: 'failed',
            repairAttempts: totalRepairAttempts,
          });

          return;
        }

        generatedProject = reviewResult.project;

        setState((prev) => ({ ...prev, stage: 'writing-files', stageLabel: STAGE_GROUP_LABELS['writing-files'] }));

        /*
         * Close the Project Dashboard now — before the workspace is touched and well
         * before `showWorkbench`/`currentView` reveal the Workbench below — so there is
         * no window where both are visible at once (see this file's header comment).
         */
        isProjectDashboardOpenStore.set(false);
        upsertEngineeringTimelineEvent('writing-files', { label: 'Writing files', status: 'active' });

        await writeGeneratedProjectToWebContainer(generatedProject);
        logActivity(
          project.id,
          'filesystem_written',
          `${generatedProject.files.length} file(s) written to the workspace`,
        );

        /*
         * Sprint 38.5 — durably persist the generated app's file CONTENT (not just paths,
         * which webcontainerWriter.ts already caches locally for stale-file cleanup) as a
         * single workspace snapshot (see app/lib/workspace-snapshot/) so a later "Continue
         * Development" can re-materialize it into a freshly-booted WebContainer without
         * calling the LLM again. Fire-and-forget, like every other BuildersDB mirror in
         * this codebase — a failure here never fails the generation the user is actively
         * watching. Goes through the pluggable provider selector, not a BuildersDB
         * repository directly, so a future GitHub-backed snapshot provider is a
         * zero-call-site-change swap.
         */
        const saveSnapshot = (files: typeof generatedProject.files) => {
          getWorkspaceSnapshotProvider()
            .saveSnapshot(project.id, files)
            .catch((error) => console.error('[CodeGeneration] Failed to persist generated files for resume:', error));
        };

        saveSnapshot(generatedProject.files);
        updateProjectWorkspaceState(project.id, { workbenchFilesCreated: true, currentStage: 'writing-files' });

        setState((prev) => ({ ...prev, stage: 'installing', stageLabel: STAGE_GROUP_LABELS.installing }));
        upsertEngineeringTimelineEvent('installing', { label: 'Installing dependencies', status: 'active' });

        /*
         * Sprint 39 — the Build Validator installs dependencies, starts the dev server, and
         * watches a short bounded window for a Vite/runtime failure (see errorCollector.ts).
         * On failure the Repair Engineer patches the ALREADY-WRITTEN files, re-writes them,
         * and retries — up to a fixed attempt limit — before this is reported as failed.
         */
        const buildResult = await runBuildRepairLoop({
          project: generatedProject,
          projectId: project.id,
          projectName: project.name,
          productPackageSummary,
          generate: repairGenerate,
          onEvent: handleRepairEvent,
          installAndStartDevServer,
          writeProjectToWebContainer: writeGeneratedProjectToWebContainer,
          saveSnapshot,
        });

        generatedProject = buildResult.project;

        if (!buildResult.ok) {
          setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: buildResult.error });
          logActivity(project.id, 'generation_failed', `Generation failed while installing: ${buildResult.error}`);
          updateProjectWorkspaceState(project.id, {
            lastGenerationStatus: 'failed',
            currentStage: 'installing',
            lastError: buildResult.error,
            lastRepairStatus: 'failed',
            repairAttempts: totalRepairAttempts,
          });

          return;
        }

        setState((prev) => ({
          ...prev,
          stage: 'launching-preview',
          stageLabel: STAGE_GROUP_LABELS['launching-preview'],
        }));
        upsertEngineeringTimelineEvent('launching-preview', { label: 'Launching preview', status: 'active' });
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
        logActivity(project.id, 'preview_started', 'Preview launched for the generated application');
        upsertEngineeringTimelineEvent('preview-ready', { label: 'Preview ready', status: 'done' });

        setState({ isRunning: false, stage: 'complete', stageLabel: STAGE_GROUP_LABELS.complete, result });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'generated',
          generatedApplicationExists: true,
          previewAvailable: true,
          lastPreviewStatus: 'available',
          workbenchFilesCreated: true,
          currentStage: 'complete',
          lastGenerationTime: new Date().toISOString(),
          lastActivity: 'Application generated and preview launched',
          lastError: undefined,
          repairAttempts: totalRepairAttempts,
          lastRepairStatus: totalRepairAttempts > 0 ? 'succeeded' : 'not-attempted',
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error while writing files or launching the preview.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: message });
        logActivity(
          project.id,
          'generation_failed',
          `Generation failed while writing files/launching preview: ${message}`,
        );
        upsertEngineeringTimelineEvent('launching-preview', {
          label: 'Generation failed',
          status: 'failed',
          detail: message,
        });
        updateProjectWorkspaceState(project.id, {
          lastGenerationStatus: 'failed',
          lastError: message,
        });
      }
    },
    [generate],
  );

  /**
   * Sprint 38.5 — "Continue Development": re-materializes a PREVIOUSLY generated
   * application into a freshly-booted WebContainer, without calling the LLM again. This
   * is what "resume, don't regenerate" concretely means — a page reload always boots an
   * empty WebContainer (see webcontainerWriter.ts's header comment), so there is no
   * "resume a suspended container" operation to perform; the fastest equivalent is
   * re-writing the exact same files the last successful generation produced, which are
   * durably stored in `builders_generated_files` (see generatedFilesRepository.ts) for
   * exactly this purpose. Reuses the same `state`/stage machinery as `runGeneration` so
   * the Engineering Timeline shows consistent progress feedback, just skipping straight
   * to `writing-files` — no `planning`/`generating-*` stages, since nothing is being
   * generated.
   */
  const resumeApplication = useCallback(async (project: Project) => {
    setState({ isRunning: true, stage: 'writing-files', stageLabel: STAGE_GROUP_LABELS['writing-files'] });
    logActivity(project.id, 'generation_started', `Resuming development on "${project.name}"`);

    resetEngineeringTimeline();
    chatStore.setKey('started', true);
    upsertEngineeringTimelineEvent('generation-started', {
      label: 'Resuming development',
      status: 'done',
      detail: `Restoring "${project.name}" from the last build`,
    });
    updateProjectWorkspaceState(project.id, { currentStage: 'writing-files', lastError: undefined });

    try {
      const files = await getWorkspaceSnapshotProvider().getSnapshot(project.id);

      if (files.length === 0) {
        const message = 'No previously generated files were found for this project.';
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: message });
        upsertEngineeringTimelineEvent('writing-files', { label: 'Resume failed', status: 'failed', detail: message });
        updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: message });

        return;
      }

      isProjectDashboardOpenStore.set(false);
      upsertEngineeringTimelineEvent('writing-files', { label: 'Restoring files', status: 'active' });

      await writeGeneratedProjectToWebContainer({
        projectId: project.id,
        templateId: 'resumed',
        files,
        folders: [],
        generatedAt: new Date().toISOString(),
      });

      setState((prev) => ({ ...prev, stage: 'installing', stageLabel: STAGE_GROUP_LABELS.installing }));
      upsertEngineeringTimelineEvent('installing', { label: 'Installing dependencies', status: 'active' });

      const installResult = await installAndStartDevServer();

      if (!installResult.ok) {
        setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: installResult.error });
        upsertEngineeringTimelineEvent('installing', {
          label: 'Installing dependencies failed',
          status: 'failed',
          detail: installResult.error,
        });
        updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: installResult.error });

        return;
      }

      setState((prev) => ({
        ...prev,
        stage: 'launching-preview',
        stageLabel: STAGE_GROUP_LABELS['launching-preview'],
      }));
      upsertEngineeringTimelineEvent('launching-preview', { label: 'Launching preview', status: 'active' });
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('preview');
      logActivity(project.id, 'preview_started', 'Preview relaunched while resuming development');
      upsertEngineeringTimelineEvent('preview-ready', { label: 'Preview ready', status: 'done' });

      setState({ isRunning: false, stage: 'complete', stageLabel: STAGE_GROUP_LABELS.complete });
      updateProjectWorkspaceState(project.id, {
        previewAvailable: true,
        lastPreviewStatus: 'available',
        currentStage: 'complete',
        lastActivity: 'Resumed development',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error while resuming development.';
      setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', error: message });
      upsertEngineeringTimelineEvent('launching-preview', {
        label: 'Resume failed',
        status: 'failed',
        detail: message,
      });
      updateProjectWorkspaceState(project.id, { lastGenerationStatus: 'failed', lastError: message });
    }
  }, []);

  const reset = useCallback(() => setState(IDLE_STATE), []);

  return { ...state, runGeneration, resumeApplication, reset };
}
