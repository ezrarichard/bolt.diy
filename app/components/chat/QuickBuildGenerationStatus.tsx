import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { quickBuildGenerationStore, resetQuickBuildGeneration } from '~/lib/quick-build/quickBuildGenerationStore';
import { continueQuickBuildFromSnapshot } from '~/lib/quick-build/quickBuildOrchestrator';
import type { Project } from '~/lib/stores/projects';
import { classNames } from '~/utils/classNames';

interface QuickBuildGenerationStatusProps {
  project: Project | undefined;
  onRetry: () => void;
}

/**
 * Quick Build Generation Lifecycle — Sprint 43A (Part 10/11).
 *
 * Renders nothing unless the active chat's Quick Build project's generation is in a
 * `failed` state — never overlaps the Hero/Workbench (rendered as a sibling of `<BaseChat>`
 * in Chat.client.tsx, not inside it, so it doesn't need to touch BaseChat.tsx/Workbench.client.tsx
 * at all). "Retry Generation" re-sends the last chat message (reuses `reload()`, the same
 * mechanism the existing `length`-finish-reason continuation already uses — see
 * Chat.client.tsx). "Continue From Last Successful Step" is disabled when no snapshot exists
 * yet to resume from (see `hasWrittenFiles` — Part 11 never invents a resume point).
 */
export const QuickBuildGenerationStatus = memo(({ project, onRetry }: QuickBuildGenerationStatusProps) => {
  const generation = useStore(quickBuildGenerationStore);

  if (generation.stage !== 'failed' || !project || generation.projectId !== project.id) {
    return null;
  }

  const canContinue = generation.hasWrittenFiles;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-workbench w-[min(560px,90vw)] rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg p-4">
      <div className="flex items-start gap-3">
        <div className="i-ph:warning-circle-fill text-xl text-bolt-elements-icon-error shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Generation Failed</div>
          <div className="text-xs text-bolt-elements-textSecondary mt-1">
            Failed at <span className="font-medium">{generation.failure?.step ?? 'unknown step'}</span>
            {generation.failure?.reason ? `: ${generation.failure.reason}` : ''}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover"
              onClick={() => {
                resetQuickBuildGeneration();
                onRetry();
              }}
            >
              Retry Generation
            </button>
            <button
              type="button"
              disabled={!canContinue}
              className={classNames(
                'px-3 py-1.5 rounded-md text-xs font-medium border border-bolt-elements-borderColor text-bolt-elements-textPrimary',
                canContinue ? 'hover:bg-bolt-elements-background-depth-3' : 'opacity-40 cursor-not-allowed',
              )}
              onClick={() => {
                if (canContinue && project) {
                  continueQuickBuildFromSnapshot(project);
                }
              }}
            >
              Continue From Last Successful Step
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
