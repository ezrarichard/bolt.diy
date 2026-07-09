import { useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { getProjectActivity, isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { reviewEngine } from '~/lib/projects/reviewEngine';
import { ReviewTimeline } from './ReviewComponents';

interface ProjectHistoryPanelProps {
  project: Project;
}

interface ActivityEntry {
  activityType: string;
  description: string;
  createdAt: string;
}

/** One icon per activity type actually logged across the codebase (useCodeGeneration.ts, projects.ts, assemblyRepository.ts, buildersDbContextProvider.ts) — falls back to a generic dot for anything unrecognized, so a future activity type never renders broken. */
const ACTIVITY_ICON: Record<string, string> = {
  generation_started: 'i-ph:rocket-launch-duotone text-purple-500',
  generation_stage_completed: 'i-ph:gear-duotone text-blue-500',
  generation_failed: 'i-ph:x-circle-duotone text-red-500',
  filesystem_written: 'i-ph:file-code-duotone text-blue-500',
  preview_started: 'i-ph:play-circle-duotone text-green-500',
  role_output_saved: 'i-ph:user-check-duotone text-purple-500',
  role_output_version_created: 'i-ph:git-commit-duotone text-purple-500',
  product_package_assembled: 'i-ph:package-duotone text-amber-500',
  product_package_file_created: 'i-ph:file-plus-duotone text-amber-500',
  product_package_file_updated: 'i-ph:file-text-duotone text-amber-500',
  missing_role_output: 'i-ph:warning-duotone text-amber-500',
  context_trace_stored: 'i-ph:brain-duotone text-blue-500',
};

const DEFAULT_ICON = 'i-ph:circle-duotone text-bolt-elements-textTertiary';

/**
 * Sprint 38.5 — History tab. Reads `builders_project_activity` via `getProjectActivity`
 * (buildersDbRepository.ts) — that function existed since Sprint 34/35 but had zero
 * callers anywhere in the app until this component; every generation/role-output/
 * package/context event already logged throughout the codebase finally has somewhere to
 * be read back. Falls back to an empty/explanatory state when BuildersDB is unavailable
 * — this panel never blocks the dashboard from opening.
 */
export function ProjectHistoryPanel({ project }: ProjectHistoryPanelProps) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    getProjectActivity(project.id).then((entries) => {
      if (!cancelled) {
        setActivity(entries);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const taskHistory = Object.entries(project.taskHistory ?? {});

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
          Generation &amp; Activity History
        </h3>

        {!isBuildersDbAvailable() ? (
          <div className="text-xs text-bolt-elements-textTertiary px-1">
            BuildersDB isn't connected, so no persisted activity history is available for this project — see the
            Workspace tab for connection status.
          </div>
        ) : isLoading ? (
          <div className="text-xs text-bolt-elements-textTertiary px-1">Loading history…</div>
        ) : activity.length === 0 ? (
          <div className="text-xs text-bolt-elements-textTertiary px-1">
            No activity recorded yet — history appears here once you generate, review, or assemble something.
          </div>
        ) : (
          <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md divide-y divide-bolt-elements-borderColor/20">
            {activity.map((entry, index) => (
              <div key={`${entry.createdAt}-${index}`} className="flex items-start gap-3 px-4 py-3">
                <div
                  className={classNames(ACTIVITY_ICON[entry.activityType] ?? DEFAULT_ICON, 'w-4 h-4 mt-0.5 shrink-0')}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-bolt-elements-textPrimary">{entry.description}</div>
                  <div className="text-[10px] text-bolt-elements-textTertiary mt-0.5">
                    {formatArtifactTimestamp(entry.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {taskHistory.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
            Task Review History
          </h3>
          <div className="space-y-4">
            {taskHistory.map(([taskId, events]) => (
              <div
                key={taskId}
                className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4 bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md"
              >
                <div className="text-xs font-semibold text-bolt-elements-textPrimary mb-2">{taskId}</div>
                <ReviewTimeline events={events} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-bolt-elements-textTertiary mb-4">
          Review Summary
        </h3>
        <div className="text-xs text-bolt-elements-textTertiary px-1">
          {reviewEngine.getReviewSummary(project).pending} pending, {reviewEngine.getReviewSummary(project).approved}{' '}
          approved, {reviewEngine.getReviewSummary(project).changesRequested} changes requested — see the Engineering
          tab to act on pending reviews.
        </div>
      </div>
    </div>
  );
}
