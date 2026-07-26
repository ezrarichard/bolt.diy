import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { useAuth } from '~/lib/auth/AuthProvider';
import { roadmapReviewEngine } from '~/lib/projects/roadmapReviewEngine';
import type { RoadmapReview, RoadmapReviewStatus } from '~/lib/roadmap-review/roadmapReviewTypes';
import { BuildersButton, BuildersStatusBadge, type BuildersStatus } from '~/components/ui/builders';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';
import { ConfirmationDialog } from '~/components/ui/Dialog';

/**
 * Roadmap Review Card — Sprint 84B (Product Evolution Workspace).
 *
 * Presents one Product Owner Roadmap Review (Sprint 83) as a business decision. Approving here
 * calls `roadmapReviewEngine.approveRoadmapReview` — the SAME engine function that also persists
 * the authoritative `roadmap_review` `MvpApproval` against the target MVP (Sprint 83's Final
 * Approval Integration correction) — so this card never duplicates that persistence itself; it
 * only calls the one function that already does it correctly, in order, idempotently.
 */

export interface RoadmapReviewCardProps {
  project: Project;
  review: RoadmapReview;

  /** Human-readable label for the target MVP — resolved by the caller from the timeline, same discipline `ProductReviewCard.sourceLabel` uses. */
  targetLabel: string;

  /** Human-readable label for the SOURCE MVP — the MVP whose approved Product Review this Roadmap Review evaluated (`productEvolutionView.ts`'s `roadmapReviewSourceLabels`). Undefined only when that Product Review or its MVP can't be resolved from already-fetched data; the card degrades to showing only the target in that case rather than guessing. */
  sourceLabel?: string;

  onChanged: () => void;
}

function statusPresentation(status: RoadmapReviewStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'draft':
      return { status: 'pending', label: 'Draft' };
    case 'planning':
      return { status: 'working', label: 'Planning' };
    case 'ready_for_review':
      return { status: 'approval', label: 'Ready for Review' };
    case 'approved':
      return { status: 'success', label: 'Approved' };
    case 'archived':
      return { status: 'completed', label: 'Archived' };
    default:
      return { status: 'pending', label: status };
  }
}

function BulletGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
        {title}
      </div>
      <ul className="list-disc list-inside space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm text-bolt-elements-textSecondary">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoadmapReviewCard({ project, review, targetLabel, sourceLabel, onChanged }: RoadmapReviewCardProps) {
  const { user } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const presentation = statusPresentation(review.status);
  const canApprove = review.status === 'ready_for_review';
  const linkedArtifact = review.artifactId
    ? getProjectArtifacts(project).find((artifact) => artifact.id === review.artifactId)
    : undefined;

  const handleApprove = async () => {
    setIsApproving(true);

    try {
      const result = await roadmapReviewEngine.approveRoadmapReview(review, {
        decidedBy: user?.id ?? undefined,
      });

      if (!result.ok) {
        toast.error(result.error ?? 'Roadmap Review approval failed.');
        return;
      }

      toast.success('Roadmap Review approved. The roadmap_review MVP approval has been recorded.');
      setConfirmOpen(false);
      onChanged();
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Roadmap Review</h4>
          <p className="text-xs text-bolt-elements-textTertiary mt-0.5">
            {sourceLabel && <>Source: {sourceLabel} · </>}
            Target: {targetLabel} · v{review.roadmapVersion} · {formatArtifactTimestamp(review.updatedAt)}
          </p>
        </div>
        <BuildersStatusBadge status={presentation.status} label={presentation.label} />
      </div>

      <div className="space-y-3">
        {review.executiveSummary && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Executive Summary
            </div>
            <p className="text-sm text-bolt-elements-textSecondary">{review.executiveSummary}</p>
          </div>
        )}

        <BulletGroup title="Roadmap Changes" items={review.roadmapChanges} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <BulletGroup title="New Features" items={review.newFeatures} />
          <BulletGroup title="Deferred Features" items={review.deferredFeatures} />
          <BulletGroup title="Removed Features" items={review.removedFeatures} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BulletGroup title="Priorities" items={review.priorities} />
          <BulletGroup title="Dependencies" items={review.dependencies} />
          <BulletGroup title="Business Risks" items={review.businessRisks} />
          <BulletGroup title="Technical Risks" items={review.technicalRisks} />
          <BulletGroup title="Assumptions" items={review.assumptions} />
        </div>

        {review.recommendedReleaseGoal && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Release Recommendation
            </div>
            <p className="text-sm text-bolt-elements-textSecondary">{review.recommendedReleaseGoal}</p>
          </div>
        )}

        {review.approvalNotes && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Approval Notes
            </div>
            <p className="text-sm text-bolt-elements-textSecondary">{review.approvalNotes}</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-bolt-elements-borderColor/30 flex flex-wrap items-center gap-3">
        {canApprove && (
          <BuildersButton
            size="sm"
            onClick={() => setConfirmOpen(true)}
            aria-label={`Approve Roadmap Review for ${targetLabel}`}
          >
            Approve Roadmap Review
          </BuildersButton>
        )}

        {linkedArtifact && (
          <Collapsible open={reportOpen} onOpenChange={setReportOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
              >
                {reportOpen ? 'Hide full report' : 'View full report'}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 rounded-lg border border-bolt-elements-borderColor/30 p-3 bg-bolt-elements-background-depth-2/60">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary mb-2">
                  <span className="font-medium text-bolt-elements-textSecondary">{linkedArtifact.generatedBy}</span>
                  <span>·</span>
                  <span>v{linkedArtifact.version ?? 1}</span>
                  <span>·</span>
                  <span>{linkedArtifact.status}</span>
                  <span>·</span>
                  <span>{formatArtifactTimestamp(linkedArtifact.updatedAt)}</span>
                </div>
                <pre className="text-xs text-bolt-elements-textSecondary whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
                  {linkedArtifact.content}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => (isApproving ? undefined : setConfirmOpen(false))}
        onConfirm={handleApprove}
        title="Approve Roadmap Review"
        description={`Approving the Roadmap Review for ${targetLabel} freezes its business content, approves its linked report, and records the authoritative roadmap_review approval for ${targetLabel}. This does NOT start engineering, promote Features, or deploy anything — that happens at a future Engineering Gate.`}
        confirmLabel="Approve Roadmap Review"
        isLoading={isApproving}
      />
    </div>
  );
}
