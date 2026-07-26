import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import { formatArtifactTimestamp } from '~/lib/projects/artifacts';
import type { MvpApprovalStage } from '~/lib/mvp/mvpTypes';
import type { Feature, FeatureStatus } from '~/lib/features/featureTypes';
import type { ProductEvolutionSelectedMvp } from '~/lib/projects/productEvolutionView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/Tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';
import { BuildersStatusBadge, type BuildersStatus } from '~/components/ui/builders';
import { ProductReviewCard } from './ProductReviewCard';
import { RoadmapReviewCard } from './RoadmapReviewCard';

/**
 * MVP Summary Card — Sprint 84B (Product Evolution Workspace).
 *
 * The selected-MVP detail experience: Overview / Features / Reviews / Approvals sub-tabs, built
 * entirely from the `ProductEvolutionSelectedMvp` the read-model (`productEvolutionView.ts`)
 * already computed — this component makes no repository calls itself. For a skeleton-only future
 * MVP (`entry.kind === 'skeleton'`), only the roadmap-skeleton fields are shown — Features/
 * Reviews/Approvals tabs render an explicit "not available yet" message rather than manufacturing
 * data (Phase 7's own constraint).
 */

export interface MvpSummaryCardProps {
  project: Project;
  selected: ProductEvolutionSelectedMvp;
  onChanged: () => void;
}

const MOSCOW_BADGE_CLASS: Record<string, string> = {
  'Must Have': 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
  'Should Have': 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Could Have': 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10',
  "Won't Have": 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
};

function featureStatusPresentation(status: FeatureStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'planned':
      return { status: 'pending', label: 'Planned' };
    case 'in_progress':
      return { status: 'working', label: 'In Progress' };
    case 'generated':
      return { status: 'info', label: 'Generated' };
    case 'qa_passed':
      return { status: 'active', label: 'QA Passed' };
    case 'deployed':
      return { status: 'success', label: 'Deployed' };
    default:
      return { status: 'pending', label: status };
  }
}

const APPROVAL_STAGE_LABEL: Record<MvpApprovalStage, string> = {
  scope: 'Gate A — Scope Approval',
  delivery: 'Gate B — Delivery Approval',
  roadmap_review: 'Roadmap Review Approval',
};

function FeatureRow({ feature }: { feature: Feature }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = featureStatusPresentation(feature.status);
  const hasDetail = Boolean(feature.description) || feature.dependsOn.length > 0;

  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/30 p-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary shrink-0">
            {feature.code}
          </span>
          <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{feature.title}</span>
          <span className="text-[11px] text-bolt-elements-textTertiary shrink-0">{feature.moduleSlug}</span>
          {feature.priority && (
            <span
              className={classNames(
                'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0',
                MOSCOW_BADGE_CLASS[feature.priority],
              )}
            >
              {feature.priority}
            </span>
          )}
        </div>
        <BuildersStatusBadge status={presentation.status} label={presentation.label} compact />
      </div>

      {hasDetail && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-1.5 text-[11px] font-medium text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
            >
              {detailsOpen ? 'Hide details' : 'Show details'}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 text-xs text-bolt-elements-textSecondary space-y-1">
              {feature.description && <p>{feature.description}</p>}
              {feature.dependsOn.length > 0 && (
                <p className="text-bolt-elements-textTertiary">Depends on: {feature.dependsOn.join(', ')}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function MvpSummaryCard({ project, selected, onChanged }: MvpSummaryCardProps) {
  const { entry, features, featureSummary, approvals, productReviews, roadmapReviews, roadmapReviewSourceLabels } =
    selected;
  const isSkeleton = entry.kind === 'skeleton';
  const label = `${entry.code}${entry.theme ? ` — ${entry.theme}` : ''}`;

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="text-base font-semibold text-bolt-elements-textPrimary">{label}</h3>
          <p className="text-xs text-bolt-elements-textTertiary mt-0.5">Sequence {entry.sequence}</p>
        </div>
        {entry.targetRelease && (
          <span className="text-[11px] text-bolt-elements-textTertiary">Target: {entry.targetRelease}</span>
        )}
      </div>

      {isSkeleton ? (
        <div className="rounded-lg border border-dashed border-bolt-elements-borderColor/50 p-4 text-sm text-bolt-elements-textSecondary">
          This is a future MVP sketched in the roadmap — nothing has been committed to it yet, so Features, Reviews, and
          Approvals aren't available until it becomes a real MVP.
          {entry.estimatedEffort && (
            <div className="mt-2 text-xs text-bolt-elements-textTertiary">
              Estimated effort: {entry.estimatedEffort}
            </div>
          )}
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="features">Features ({featureSummary.total})</TabsTrigger>
            <TabsTrigger value="reviews">Reviews ({productReviews.length + roadmapReviews.length})</TabsTrigger>
            <TabsTrigger value="approvals">Approvals ({approvals.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-bolt-elements-borderColor/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                  Status
                </div>
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{entry.status}</div>
              </div>
              <div className="rounded-lg border border-bolt-elements-borderColor/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                  Features
                </div>
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{featureSummary.total}</div>
              </div>
              <div className="rounded-lg border border-bolt-elements-borderColor/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                  Modules
                </div>
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{featureSummary.moduleCount}</div>
              </div>
              <div className="rounded-lg border border-bolt-elements-borderColor/30 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                  Created
                </div>
                <div className="text-sm font-medium text-bolt-elements-textPrimary">
                  {entry.mvp ? formatArtifactTimestamp(entry.mvp.createdAt) : '—'}
                </div>
              </div>
            </div>

            {entry.mvp?.approvedAt && (
              <div className="text-xs text-bolt-elements-textTertiary">
                Approved: {formatArtifactTimestamp(entry.mvp.approvedAt)}
              </div>
            )}

            {Object.keys(featureSummary.byStatus).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(featureSummary.byStatus).map(([status, count]) => (
                  <span
                    key={status}
                    className="text-[11px] text-bolt-elements-textSecondary rounded-full border border-bolt-elements-borderColor/40 px-2 py-0.5"
                  >
                    {status}: {count}
                  </span>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="features" className="space-y-2">
            {features.length === 0 ? (
              <div className="text-sm text-bolt-elements-textTertiary">No Features recorded for this MVP yet.</div>
            ) : (
              features.map((feature) => <FeatureRow key={feature.id} feature={feature} />)
            )}
          </TabsContent>

          <TabsContent value="reviews" className="space-y-4">
            {productReviews.length === 0 && roadmapReviews.length === 0 ? (
              <div className="text-sm text-bolt-elements-textTertiary">
                No Product Review recorded for this release yet.
              </div>
            ) : (
              <>
                {productReviews.map((review) => (
                  <ProductReviewCard
                    key={review.id}
                    project={project}
                    review={review}
                    sourceLabel={label}
                    onChanged={onChanged}
                  />
                ))}
                {roadmapReviews.map((review) => (
                  <RoadmapReviewCard
                    key={review.id}
                    project={project}
                    review={review}
                    targetLabel={label}
                    sourceLabel={roadmapReviewSourceLabels[review.id]}
                    onChanged={onChanged}
                  />
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="approvals" className="space-y-2">
            {approvals.length === 0 ? (
              <div className="text-sm text-bolt-elements-textTertiary">No approvals recorded for this MVP yet.</div>
            ) : (
              approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="rounded-lg border border-bolt-elements-borderColor/30 p-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div>
                    <div className="text-sm font-medium text-bolt-elements-textPrimary">
                      {APPROVAL_STAGE_LABEL[approval.stage]}
                    </div>
                    <div className="text-xs text-bolt-elements-textTertiary mt-0.5">
                      {formatArtifactTimestamp(approval.decidedAt)}
                      {approval.decidedBy && ` · ${approval.decidedBy}`}
                    </div>
                    {approval.notes && (
                      <div className="text-xs text-bolt-elements-textSecondary mt-1">{approval.notes}</div>
                    )}
                  </div>
                  <BuildersStatusBadge
                    status={approval.decision === 'approved' ? 'success' : 'warning'}
                    label={approval.decision === 'approved' ? 'Approved' : 'Changes Requested'}
                  />
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
