import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { ARTIFACT_STATUS_META } from '~/lib/projects/artifacts';
import {
  projectManagerEngine,
  type ArtifactReadinessStatus,
  type EngineeringStageStatus,
} from '~/lib/projects/projectManagerEngine';

interface ProjectManagerPanelProps {
  project: Project;
}

/** Extends ARTIFACT_STATUS_META (draft/approved/discarded) with the one status it has no concept of — an artifact that was never generated. */
const STAGE_STATUS_META: Record<ArtifactReadinessStatus, { label: string; className: string }> = {
  'not-generated': {
    label: 'Not Generated',
    className: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
  },
  draft: ARTIFACT_STATUS_META.draft,
  discarded: ARTIFACT_STATUS_META.discarded,
  approved: ARTIFACT_STATUS_META.approved,
};

function getHealthMeta(score: number): { label: string; className: string } {
  if (score >= 90) {
    return { label: 'Excellent', className: 'text-green-600 dark:text-green-400' };
  }

  if (score >= 70) {
    return { label: 'Good', className: 'text-blue-600 dark:text-blue-400' };
  }

  if (score >= 40) {
    return { label: 'At Risk', className: 'text-amber-600 dark:text-amber-400' };
  }

  return { label: 'Critical', className: 'text-red-600 dark:text-red-400' };
}

interface StagePillProps {
  stage: EngineeringStageStatus;
}

function StagePill({ stage }: StagePillProps) {
  const meta = STAGE_STATUS_META[stage.status];

  return (
    <div
      className={classNames(
        'rounded-lg border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-3',
        'bg-bolt-elements-background-depth-2/60',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-bolt-elements-textSecondary truncate">{stage.label}</span>
        <span
          className={classNames(
            'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
            meta.className,
          )}
        >
          {meta.label}
        </span>
      </div>
      <div className="text-[11px] text-bolt-elements-textTertiary">{stage.detail}</div>
    </div>
  );
}

/**
 * Sprint 23 — the AI Project Manager's live dashboard view. Unlike every
 * "*DraftPanel" component, this one never generates, approves, or discards
 * anything — it is a pure read of `projectManagerEngine.analyzeProject()`,
 * recomputed on every render straight from the `Project` object, so it
 * updates immediately whenever an artifact is approved/discarded, a task
 * changes status, a review is decided, or the roadmap changes. No AI call,
 * no prompt, no code generation.
 */
export function ProjectManagerPanel({ project }: ProjectManagerPanelProps) {
  const health = projectManagerEngine.analyzeProject(project);
  const healthMeta = getHealthMeta(health.overallScore);

  const stages: EngineeringStageStatus[] = [
    health.requirementsStatus,
    health.architectureStatus,
    health.databaseStatus,
    health.uiuxStatus,
    health.backendStatus,
    health.frontendStatus,
    health.qaStatus,
    health.devopsStatus,
  ];

  const missingItems = [
    ...health.missingArtifacts.map((entry) => ({ ...entry, kind: 'Not Approved' as const })),
    ...health.missingApprovals.map((entry) => ({ ...entry, kind: 'Awaiting Approval' as const })),
  ];

  return (
    <div className="space-y-5">
      {/* Top-line readiness */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className={classNames(
            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
            'bg-bolt-elements-background-depth-2/60',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Overall Readiness
          </div>
          <div className="text-2xl font-semibold text-bolt-elements-textPrimary">{health.overallScore}%</div>
        </div>

        <div
          className={classNames(
            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
            'bg-bolt-elements-background-depth-2/60',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Overall Health
          </div>
          <div className={classNames('text-lg font-semibold', healthMeta.className)}>{healthMeta.label}</div>
        </div>

        <div
          className={classNames(
            'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
            'bg-bolt-elements-background-depth-2/60',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Ready for Code Generation
          </div>
          <span
            className={classNames(
              'text-sm font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border',
              health.readyForGeneration
                ? 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10'
                : 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
            )}
          >
            {health.readyForGeneration ? 'YES' : 'NO'}
          </span>
        </div>
      </div>

      {/* Next Recommended Action */}
      <div
        className={classNames(
          'rounded-xl border border-purple-500/30 p-4',
          'bg-purple-50/70 dark:bg-purple-500/[0.08] backdrop-blur-md',
        )}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-1.5">
          Next Recommended Action
        </div>
        <div className="text-sm text-bolt-elements-textPrimary">{health.nextRecommendedAction.message}</div>
      </div>

      {/* Why not ready */}
      {!health.readyForGeneration && health.readinessBlockers.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1.5">
            Why Not Ready
          </div>
          <ul className="space-y-1">
            {health.readinessBlockers.map((reason) => (
              <li key={reason} className="text-xs text-bolt-elements-textSecondary flex gap-1.5">
                <span className="i-ph:x-circle-duotone w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Engineering stage grid */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-2">
          Engineering Pipeline
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stages.map((stage) => (
            <StagePill key={stage.id} stage={stage} />
          ))}
        </div>
      </div>

      {/* Missing items */}
      {missingItems.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Missing Items ({missingItems.length})
          </div>
          <ul className="space-y-1">
            {missingItems.map((entry) => (
              <li
                key={`${entry.id}-${entry.kind}`}
                className="text-xs text-bolt-elements-textSecondary rounded-md px-2.5 py-1.5 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/40 flex items-center justify-between gap-2"
              >
                <span>{entry.reason}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary shrink-0">
                  {entry.kind}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {health.warnings.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1.5">
            Warnings ({health.warnings.length})
          </div>
          <ul className="space-y-1">
            {health.warnings.map((warning) => (
              <li key={warning} className="text-xs text-amber-600 dark:text-amber-400">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {health.recommendations.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
            Recommendations
          </div>
          <ul className="space-y-1">
            {health.recommendations.map((recommendation) => (
              <li key={recommendation} className="text-xs text-bolt-elements-textSecondary flex gap-1.5">
                <span className="i-ph:lightbulb-duotone w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
                {recommendation}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Roadmap / Task / Review counters */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
            Roadmap
          </div>
          <div className="text-sm text-bolt-elements-textSecondary">
            {health.roadmapStatus.completed} / {health.roadmapStatus.total} ({health.roadmapStatus.percentComplete}%)
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
            Tasks
          </div>
          <div className="text-sm text-bolt-elements-textSecondary">
            {health.taskStatus.completed} / {health.taskStatus.total} ({health.taskStatus.percentComplete}%)
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
            Reviews Pending
          </div>
          <div className="text-sm text-bolt-elements-textSecondary">{health.reviewStatus.pending}</div>
        </div>
      </div>
    </div>
  );
}
