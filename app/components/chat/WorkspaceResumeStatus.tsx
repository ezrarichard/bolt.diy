import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { workspaceResumeStore } from '~/lib/quick-build/workspaceResumeStore';
import { WORKSPACE_RESUME_STAGE_LABEL } from '~/lib/quick-build/workspaceResumeTypes';
import { resumeQuickBuildWorkspace } from '~/lib/quick-build/workspaceResumeOrchestrator';
import type { Project } from '~/lib/stores/projects';
import { workbenchStore } from '~/lib/stores/workbench';

interface WorkspaceResumeStatusProps {
  project: Project | undefined;
}

/**
 * Workspace Resume Lifecycle — Sprint 44 (Phase 12).
 *
 * A small, transient status banner shown while `resumeQuickBuildWorkspace()` is restoring
 * an already-generated Quick Build project (browser refresh, sidebar click, "Continue
 * Working", navigating back). Renders nothing once the resume reaches `ready` (the actual
 * Preview panel takes over from there — this banner is only for the in-between states the
 * Preview panel has no concept of) or when no resume has ever run for this project (a
 * brand-new generation uses QuickBuildGenerationStatus.tsx instead, a different lifecycle).
 */
export const WorkspaceResumeStatus = memo(({ project }: WorkspaceResumeStatusProps) => {
  const allResumes = useStore(workspaceResumeStore);
  const resume = project ? allResumes[project.id] : undefined;

  if (!resume || resume.stage === 'idle' || resume.stage === 'ready') {
    return null;
  }

  const isFailed = resume.stage === 'failed';

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-workbench w-[min(480px,90vw)] rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg p-4">
      <div className="flex items-start gap-3">
        <div
          className={
            isFailed
              ? 'i-ph:warning-circle-fill text-xl text-bolt-elements-icon-error shrink-0 mt-0.5'
              : 'i-ph:arrows-clockwise text-xl text-bolt-elements-icon-success shrink-0 mt-0.5 animate-spin'
          }
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">
            {isFailed ? 'Workspace Resume Failed' : WORKSPACE_RESUME_STAGE_LABEL[resume.stage]}
          </div>
          {isFailed && resume.failure && (
            <>
              <div className="text-xs text-bolt-elements-textSecondary mt-1">
                Failed at <span className="font-medium">{resume.failure.step}</span>
              </div>
              <div className="text-xs text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-2 max-h-24 overflow-y-auto">
                {resume.failure.reason}
              </div>
            </>
          )}
          {isFailed && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover"
                onClick={() => {
                  if (project) {
                    resumeQuickBuildWorkspace(project);
                  }
                }}
              >
                Retry Resume
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-md text-xs font-medium border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3"
                onClick={() => {
                  workbenchStore.showWorkbench.set(true);
                  workbenchStore.currentView.set('code');
                }}
              >
                Open Code Anyway
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
