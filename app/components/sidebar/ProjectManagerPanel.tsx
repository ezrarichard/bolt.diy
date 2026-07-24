import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { ARTIFACT_STATUS_META } from '~/lib/projects/artifacts';
import {
  projectManagerEngine,
  type ArtifactReadinessStatus,
  type EngineeringStageStatus,
} from '~/lib/projects/projectManagerEngine';
import { AUTO_ENGINEERING_ESTIMATED_SECONDS } from '~/lib/projects/autoEngineeringEngine';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';

interface ProjectManagerPanelProps {
  project: Project;

  /** Sprint UX-2 — jumps to whichever workflow tab is next-actionable; the hero's "Continue" button only renders when the caller supplies this. Purely a navigation shortcut — never approves, generates, or writes anything itself. */
  onContinue?: () => void;
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

/** Sprint UX-2 — one stat card in the "Current Stage" hero. A subtle hover lift + icon replace the old plain label/value pair from Sprint 44.1's StatusMetric. `wide` gives a card two grid columns at the `lg` breakpoint — used for Next Action, whose value is a full sentence and truncates too aggressively at one column's width. */
function StatusMetric({
  label,
  value,
  icon,
  accent,
  wide,
}: {
  label: string;
  value: string;
  icon: string;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={classNames(
        'rounded-xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        wide && 'lg:col-span-2',
        accent
          ? 'border-purple-500/30 bg-purple-50/60 dark:bg-purple-500/[0.07]'
          : 'border-bolt-elements-borderColor/40 dark:border-white/[0.06] bg-bolt-elements-background-depth-2/60',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className={classNames(
            icon,
            'w-3.5 h-3.5 shrink-0',
            accent ? 'text-purple-500' : 'text-bolt-elements-textTertiary',
          )}
        />
        <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">{label}</div>
      </div>
      <div
        className={classNames(
          'text-sm font-semibold truncate',
          accent ? 'text-purple-600 dark:text-purple-300' : 'text-bolt-elements-textPrimary',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Sprint 23 — the AI Project Manager's live dashboard view, reframed in Sprint 44.1, restyled
 * as the dashboard's hero in Sprint UX-2.
 *
 * The default view is a calm, business-friendly "Current Stage" hero: a status line, a rich
 * progress bar, and five stat cards (Current Stage / Overall Progress / Estimated Time
 * Remaining / Approval Required / Next Action) — no AI-role or engine-internal language.
 * "Current AI Engineer" (Sprint 44.1) is gone from this view entirely; the granular per-role
 * name only ever appears inside "Project details (Advanced)" below, which still preserves
 * every engineering diagnostic (readiness score, health grade, "Why Not Ready", the stage
 * grid, missing items, warnings, recommendations, and the roadmap/task/review counters)
 * verbatim, collapsed by default.
 *
 * Still a pure read of `projectManagerEngine.analyzeProject()`, recomputed on every render;
 * no AI call, no prompt, no code generation. All presentation below (including the new
 * business-friendly stage naming) is derived in this component from the exact same `health`
 * object — the engine is untouched.
 */
export function ProjectManagerPanel({ project, onContinue }: ProjectManagerPanelProps) {
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

  /*
   * Sprint UX-2 — "Current Stage", not "Current AI Engineer": Business Mode hides which
   * engineer/role is running — that per-role name (`stage.label`, e.g. "Architecture",
   * "UI/UX Design") still appears in the Engineering Pipeline grid inside Project
   * details/Advanced below. Requirements maps to the customer-facing "Business Analysis"
   * step; every engineering role (architecture..devops) collapses to one "Engineering"
   * label, since Business Mode has no per-role screen for the customer to land on anyway
   * (see ProjectDashboard.tsx's Engineering tab).
   */
  const currentStageLabel = !currentStage
    ? 'Complete'
    : currentStage.id === 'requirements'
      ? 'Business Analysis'
      : 'Engineering';

  /** Sprint UX-2 — "Approval Required" stat: true exactly when there's a generated draft sitting in front of the customer waiting for a decision (same condition the old "Review your ... work" copy used). */
  const approvalRequired = currentStage?.status === 'draft';

  const nextAction = isComplete
    ? 'Generate your prototype'
    : needsRequirements
      ? 'Add your requirements to begin'
      : approvalRequired
        ? `Review your ${currentStageLabel} output`
        : `${currentStageLabel} is in progress`;

  const statusMessage = isComplete
    ? 'Your product is ready to preview.'
    : needsRequirements
      ? 'Add your requirements so your AI team can start.'
      : approvalRequired
        ? 'Your review is needed to continue.'
        : 'Your AI team is building your product.';
  const statusTone: 'amber' | 'purple' | 'green' = needsRequirements
    ? 'amber'
    : approvalRequired
      ? 'amber'
      : isComplete
        ? 'green'
        : 'purple';
  const statusDotClass =
    statusTone === 'amber' ? 'bg-amber-500' : statusTone === 'green' ? 'bg-green-500' : 'bg-purple-500';

  const continueLabel = needsRequirements
    ? 'Add Your Requirements'
    : approvalRequired
      ? 'Review & Approve'
      : isComplete
        ? 'Generate Your App'
        : undefined;

  return (
    <div className="space-y-5">
      {/* Sprint UX-2 — "Current Stage" hero: status line, rich progress bar, stat cards, Continue CTA. */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex items-center justify-center w-2.5 h-2.5 shrink-0">
              {statusTone === 'purple' && (
                <span className="absolute inset-0 rounded-full bg-purple-500/60 workflow-node-ping" />
              )}
              <span className={classNames('relative w-2.5 h-2.5 rounded-full', statusDotClass)} />
            </span>
            <div>
              <div className="text-base font-semibold text-bolt-elements-textPrimary leading-tight">
                {isComplete ? 'Ready to Preview' : currentStageLabel}
              </div>
              <div className="text-xs text-bolt-elements-textTertiary mt-0.5">{statusMessage}</div>
            </div>
          </div>
          {continueLabel && onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 active:scale-[0.98] transition-all duration-150 shadow-sm shrink-0"
            >
              {continueLabel}
              <span className="i-ph:arrow-right w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Rich progress bar — same health.overallScore the Advanced section's "Overall Readiness" stat uses, just with a visible fill instead of a bare number. */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] text-bolt-elements-textTertiary mb-1.5">
            <span>Overall Progress</span>
            <span className="font-medium text-bolt-elements-textSecondary">{health.overallScore}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-bolt-elements-background-depth-2 overflow-hidden">
            <div
              className={classNames(
                'h-full rounded-full transition-[width] duration-700 ease-out',
                isComplete ? 'bg-green-500' : 'bg-purple-500',
              )}
              style={{ width: `${health.overallScore}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatusMetric icon="i-ph:map-pin-duotone" label="Current Stage" value={currentStageLabel} />
          <StatusMetric icon="i-ph:gauge-duotone" label="Overall Progress" value={`${health.overallScore}%`} />
          <StatusMetric icon="i-ph:clock-duotone" label="Time Remaining" value={estimatedLabel} />
          <StatusMetric
            icon={approvalRequired ? 'i-ph:hand-palm-duotone' : 'i-ph:check-circle-duotone'}
            label="Approval Required"
            value={approvalRequired ? 'Yes' : 'No'}
            accent={approvalRequired}
          />
          <StatusMetric
            icon="i-ph:arrow-right-duotone"
            label="Next Action"
            value={nextAction}
            wide
            accent={!approvalRequired}
          />
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
