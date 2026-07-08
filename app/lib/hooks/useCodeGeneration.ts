import { useCallback, useState } from 'react';
import { isProjectDashboardOpenStore, type Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import { generateProject } from '~/lib/code-generation/projectGenerator';
import {
  installAndStartDevServer,
  writeGeneratedProjectToWebContainer,
} from '~/lib/code-generation/webcontainerWriter';
import type { GenerationResult, GenerationStage } from '~/lib/code-generation/codeGenerationTypes';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { resetEngineeringTimeline, upsertEngineeringTimelineEvent } from '~/lib/stores/engineeringTimeline';
import { buildersDbRepository } from '~/lib/builders-db/repositories/buildersDbRepository';
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

export function useCodeGeneration() {
  const { generate } = useGenerateText();
  const [state, setState] = useState<CodeGenerationState>(IDLE_STATE);

  const runGeneration = useCallback(
    async (project: Project, productPackage: ProductPackage) => {
      setState({ isRunning: true, stage: 'planning', stageLabel: STAGE_GROUP_LABELS.planning });
      logActivity(project.id, 'generation_started', `Code generation started for "${project.name}"`);

      // Reveal the Engineering Timeline / conversation area in place of the landing hero (see Chat.client.tsx's sync of this flag onto local `chatStarted` state).
      resetEngineeringTimeline();
      chatStore.setKey('started', true);
      upsertEngineeringTimelineEvent('generation-started', {
        label: 'Generation started',
        status: 'done',
        detail: `Generating "${project.name}"`,
      });
      upsertEngineeringTimelineEvent('planning', { label: 'Planning', status: 'active' });

      const result = await generateProject(project, productPackage, generate, (progress) => {
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

        return;
      }

      const generatedProject = result.project;

      try {
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

        setState((prev) => ({ ...prev, stage: 'installing', stageLabel: STAGE_GROUP_LABELS.installing }));
        upsertEngineeringTimelineEvent('installing', { label: 'Installing dependencies', status: 'active' });

        const installResult = await installAndStartDevServer();

        if (!installResult.ok) {
          setState({ isRunning: false, stage: 'failed', stageLabel: 'Failed', result, error: installResult.error });
          logActivity(project.id, 'generation_failed', `Generation failed while installing: ${installResult.error}`);
          upsertEngineeringTimelineEvent('installing', {
            label: 'Installing dependencies failed',
            status: 'failed',
            detail: installResult.error,
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
      }
    },
    [generate],
  );

  const reset = useCallback(() => setState(IDLE_STATE), []);

  return { ...state, runGeneration, reset };
}
