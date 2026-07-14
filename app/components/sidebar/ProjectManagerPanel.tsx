import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { ARTIFACT_STATUS_META, formatArtifactTimestamp, getLatestArtifact } from '~/lib/projects/artifacts';
import {
  projectManagerEngine,
  type ArtifactReadinessStatus,
  type EngineeringStageId,
  type EngineeringStageStatus,
} from '~/lib/projects/projectManagerEngine';
import { AUTO_ENGINEERING_ESTIMATED_SECONDS } from '~/lib/projects/autoEngineeringEngine';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';

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

/**
 * Sprint 44.1 — the human name a business user should see for the engineer currently
 * working, instead of the internal stage label ("Architecture", "UI/UX Design"). Keyed by
 * the same `EngineeringStageId` the Project Manager engine already emits.
 */
const ENGINEER_BY_STAGE: Record<EngineeringStageId, string> = {
  requirements: 'Business Analyst',
  architecture: 'Solution Architect',
  database: 'Database Engineer',
  uiux: 'UI/UX Designer',
  backend: 'Backend Engineer',
  frontend: 'Frontend Engineer',
  qa: 'QA Engineer',
  devops: 'DevOps Engineer',
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

/** Sprint 44.1 — one business-friendly summary stat in the Project Status hero. */
function StatusMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-3 bg-bolt-elements-background-depth-2/60">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
        {label}
      </div>
      <div
        className={classNames(
          'text-sm font-medium truncate',
          accent ? 'text-purple-600 dark:text-purple-300' : 'text-bolt-elements-textPrimary',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Sprint 23 — the AI Project Manager's live dashboard view, reframed in Sprint 44.1.
 *
 * The default view is now a calm, business-friendly "Project Status" summary: a positive
 * status line plus Overall Progress / Current AI Engineer / Estimated Time / Last Update /
 * Next. Every engineering diagnostic that used to lead this panel (readiness score, health
 * grade, "Why Not Ready", the stage grid, missing items, warnings, recommendations, and the
 * roadmap/task/review counters) is preserved verbatim inside a "Project details (Advanced)"
 * section, collapsed by default — nothing is removed, only relocated.
 *
 * Still a pure read of `projectManagerEngine.analyzeProject()`, recomputed on every render;
 * no AI call, no prompt, no code generation. All the friendlier presentation below is
 * derived in this component from the exact same `health` object — the engine is untouched.
 */
export function ProjectManagerPanel({ project }: ProjectManagerPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  /*
   * Sprint 44.1 — friendly summary derived from the same stage list the Advanced section
   * shows. `currentStage` is the first not-yet-approved stage (the one the team is on);
   * undefined once every stage is approved.
   */
  const completedCount = stages.filter((stage) => stage.status === 'approved').length;
  const currentStage = stages.find((stage) => stage.status !== 'approved');
  const isComplete = !currentStage;
  const needsRequirements = stages[0].status === 'not-generated';
  const remaining = stages.length - completedCount;
  const estimatedSeconds = remaining * AUTO_ENGINEERING_ESTIMATED_SECONDS;
  const estimatedLabel = isComplete
    ? 'Complete'
    : estimatedSeconds < 60
      ? '< 1 min'
      : `~${Math.round(estimatedSeconds / 60)} min`;

  const currentEngineer = currentStage ? ENGINEER_BY_STAGE[currentStage.id] : 'All engineers finished';

  const artifacts = getProjectArtifacts(project);
  const lastUpdatedAt = stages
    .map((stage) => getLatestArtifact(artifacts, stage.artifactType)?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();
  const lastUpdate = lastUpdatedAt ? formatArtifactTimestamp(lastUpdatedAt) : 'Not started yet';

  const nextAction = isComplete
    ? 'Generate your prototype'
    : needsRequirements
      ? 'Add your requirements to begin'
      : currentStage?.status === 'draft'
        ? `Review your ${currentEngineer}'s work`
        : `${currentEngineer} is working on it`;

  const statusMessage = isComplete
    ? 'Your product is ready to preview.'
    : needsRequirements
      ? 'Add your requirements so your AI team can start.'
      : 'Your AI team is building your product.';
  const statusDotClass = needsRequirements ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="space-y-5">
      {/* Sprint 44.1 — Project Status hero (business-friendly default view) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className={classNames('w-2.5 h-2.5 rounded-full shrink-0', statusDotClass)} />
          <span className="text-sm font-medium text-bolt-elements-textPrimary">{statusMessage}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatusMetric label="Overall Progress" value={`${health.overallScore}%`} />
          <StatusMetric label="Current AI Engineer" value={currentEngineer} />
          <StatusMetric label="Estimated Time" value={estimatedLabel} />
          <StatusMetric label="Last Update" value={lastUpdate} />
          <StatusMetric label="Next" value={nextAction} accent />
        </div>
      </div>

      {/* Sprint 44.1 — every engineering diagnostic, preserved but collapsed by default. */}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="rounded-xl border border-dashed border-bolt-elements-borderColor/50 p-4 bg-bolt-elements-background-depth-2/40">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 bg-transparent text-left appearance-none focus:outline-none"
            >
              <div className="flex items-center gap-2">
                <span
                  className={classNames(
                    'i-ph:caret-right w-3.5 h-3.5 text-bolt-elements-textTertiary transition-transform duration-150',
                    detailsOpen && 'rotate-90',
                  )}
                />
                <span className="text-sm font-medium text-bolt-elements-textPrimary">Project details</span>
                <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary">
                  Advanced
                </span>
              </div>
              <span className="text-xs text-bolt-elements-textTertiary">{detailsOpen ? 'Hide' : 'Show'}</span>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-5 pt-5 border-t border-bolt-elements-borderColor/30 space-y-5">
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
                    {health.roadmapStatus.completed} / {health.roadmapStatus.total} (
                    {health.roadmapStatus.percentComplete}%)
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
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
