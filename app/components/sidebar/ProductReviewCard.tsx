import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import { productReviewEngine } from '~/lib/projects/productReviewEngine';
import type { ProductReview, ProductReviewStatus } from '~/lib/product-review/productReviewTypes';
import { BuildersButton, BuildersStatusBadge, type BuildersStatus } from '~/components/ui/builders';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';
import { ConfirmationDialog } from '~/components/ui/Dialog';

/**
 * Product Review Card — Sprint 84B (Product Evolution Workspace).
 *
 * Presents one Business Analyst Product Review (Sprint 82) as a business decision — status,
 * curated summary/risks/opportunities, and (when the review is `ready_for_review`) an approval
 * action wired to the exact same `productReviewEngine.approveProductReview` the domain layer
 * already exposes. Never invents a status, never optimistically shows "approved" before the
 * engine call actually succeeds.
 */

export interface ProductReviewCardProps {
  project: Project;
  review: ProductReview;

  /** Human-readable label for the source MVP (e.g. "MVP1 — Core Website Launch") — resolved by the caller, which already has the timeline entry; this card never re-derives it. */
  sourceLabel: string;

  /** Called after a successful approval so the caller can reload persisted data — this card never mutates its own `review` prop optimistically. */
  onChanged: () => void;
}

function statusPresentation(status: ProductReviewStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'draft':
      return { status: 'pending', label: 'Draft' };
    case 'analysing':
      return { status: 'working', label: 'Analysing' };
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

export function ProductReviewCard({ project, review, sourceLabel, onChanged }: ProductReviewCardProps) {
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
      const result = await productReviewEngine.approveProductReview(review);

      if (!result.ok) {
        toast.error(result.error ?? 'Product Review approval failed.');
        return;
      }

      toast.success('Product Review approved.');
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
          <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Product Review</h4>
          <p className="text-xs text-bolt-elements-textTertiary mt-0.5">
            Source: {sourceLabel} · {review.reviewType} · {formatArtifactTimestamp(review.reviewDate)}
          </p>
        </div>
        <BuildersStatusBadge status={presentation.status} label={presentation.label} />
      </div>

      <div className="space-y-3">
        {review.summary && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
              Executive Summary
            </div>
            <p className="text-sm text-bolt-elements-textSecondary">{review.summary}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BulletGroup title="Business Risks" items={review.businessRisks} />
          <BulletGroup title="Opportunities" items={review.opportunities} />
          <BulletGroup title="Feature Requests" items={review.featureRequests} />
          <BulletGroup title="Technical Concerns" items={review.technicalConcerns} />
        </div>
        <BulletGroup title="Recommendations" items={review.recommendations} />
      </div>

      <div className="mt-4 pt-3 border-t border-bolt-elements-borderColor/30 flex flex-wrap items-center gap-3">
        {canApprove && (
          <BuildersButton
            size="sm"
            onClick={() => setConfirmOpen(true)}
            aria-label={`Approve Product Review for ${sourceLabel}`}
          >
            Approve Product Review
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
        title="Approve Product Review"
        description={`Approving the Product Review for ${sourceLabel} freezes its business content — summary, risks, opportunities, and recommendations can never be edited again. This does not start engineering or change the roadmap by itself.`}
        confirmLabel="Approve Product Review"
        isLoading={isApproving}
      />
    </div>
  );
}
