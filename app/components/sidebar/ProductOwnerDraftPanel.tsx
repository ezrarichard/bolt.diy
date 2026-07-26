import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import {
  ARTIFACT_TYPES,
  formatArtifactTimestamp,
  getResumableArtifact,
  parseArtifactContent,
} from '~/lib/projects/artifacts';
import { productOwnerEngine, type ProductOwnerContext } from '~/lib/projects/productOwnerEngine';
import type { ProductOwnerDraft } from '~/lib/projects/prompts/productOwner';
import { useDraftPanel } from '~/lib/hooks/useDraftPanel';
import { useAuth } from '~/lib/auth/AuthProvider';
import { approveGateA } from '~/lib/mvp/gateAApproval';

interface ProductOwnerDraftPanelProps {
  project: Project;

  /**
   * Sprint 84C — switches the dashboard to the Product tab (`ProjectDashboard.tsx`'s
   * `handleTabChange('product')`). Optional so this panel still renders standalone (e.g. in
   * tests) without needing a dashboard around it; when omitted, the "View Product Roadmap" link
   * below simply isn't rendered rather than being a dead button.
   */
  onViewProductRoadmap?: () => void;
}

const ARTIFACT_TYPE = ARTIFACT_TYPES.PRODUCT_OWNER_DRAFT;

/** Matches every other role's auto-engineering budget (see autoEngineeringEngine.ts's AUTO_ENGINEERING_MAX_OUTPUT_TOKENS) — this panel's manual "Generate" uses the same budget the automatic pipeline already requests for this role. */
const MAX_OUTPUT_TOKENS = 8192;

const MOSCOW_BADGE_CLASS: Record<string, string> = {
  'Must Have': 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
  'Should Have': 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Could Have': 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10',
  "Won't Have": 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
};

const SEVERITY_BADGE_CLASS: Record<string, string> = {
  Critical: 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10',
  High: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  Medium: 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10',
  Low: 'text-bolt-elements-textTertiary border-bolt-elements-borderColor/50',
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={classNames(
        'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border',
        className,
      )}
    >
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] | undefined }) {
  if (!items || items.length === 0) {
    return <div className="text-sm text-bolt-elements-textTertiary">None</div>;
  }

  return (
    <ul className="list-disc list-inside space-y-0.5">
      {items.map((item, index) => (
        <li key={index} className="text-sm text-bolt-elements-textSecondary">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Sprint 46B — AI Product Owner Draft Panel. Same `useDraftPanel` state machine as every
 * other role's panel (Architecture, Database, ...), but with a bespoke preview (the draft's
 * nested features/risks/engineering-handoff shape doesn't fit the generic flat-field grid
 * every other panel uses — see prompts/productOwner.ts's header comment) and one deliberate
 * addition: Approve here also creates MVP 1 in BuildersDB and records the Gate A (Scope
 * Approval) decision, per docs/05-AI-Product-Owner/05-customer-review-workflow.md. Unlike
 * every other role, this draft is NEVER auto-approved by the automatic pipeline (see
 * useAutoEngineeringPipeline.ts) — this panel's Approve button is the ONLY path that can
 * move it to 'approved', whether the draft itself was generated automatically or manually.
 */
export function ProductOwnerDraftPanel({ project, onViewProductRoadmap }: ProductOwnerDraftPanelProps) {
  const { user } = useAuth();
  const [isCreatingMvp, setIsCreatingMvp] = useState(false);

  /**
   * Sprint 46C — the draft as it exists BEFORE this render's regeneration, read independently
   * of `useDraftPanel`'s own `latestDraft` (which is only available AFTER that hook returns,
   * too late to feed into its own `parseDraft` config). Read via the same public helpers
   * `useDraftPanel` itself uses internally (`getResumableArtifact` + `parseArtifactContent`),
   * so both stay consistent without this component reaching into that hook's internals.
   * Closed over below so `productOwnerEngine.parseDraft` can carry forward matching features'
   * permanent IDs across a regeneration — see that function's own comment.
   */
  const previousArtifact = getResumableArtifact(getProjectArtifacts(project), ARTIFACT_TYPE);
  const previousDraftForParsing = previousArtifact
    ? parseArtifactContent<ProductOwnerDraft>(previousArtifact.content)
    : undefined;

  const {
    phase,
    setPhase,
    errorMessage,
    isGenerating,
    canGenerate,
    latest,
    latestDraft,
    isPreviewing,
    isPendingApproval,
    statusMeta,
    runGeneration,
    handleApprove,
    handleDiscard,
  } = useDraftPanel<ProductOwnerDraft, ProductOwnerContext>({
    project,
    artifactType: ARTIFACT_TYPE,
    titlePrefix: 'Product Owner Draft',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    canGenerate: productOwnerEngine.canGenerateProductOwner,
    buildContext: productOwnerEngine.buildProductOwnerContext,
    buildPrompt: productOwnerEngine.buildProductOwnerPrompt,
    parseDraft: (rawText: string) => productOwnerEngine.parseDraft(rawText, previousDraftForParsing),
    createDraftArtifact: productOwnerEngine.createDraftArtifact,
  });

  /**
   * Gate A — Sprint 78 Phase 0 corrective: unlike every other role's approval (a local artifact
   * status flip, effectively can't fail), Gate A's persistence (MVP creation, the Scope Approval
   * decision, and Feature promotion) is NOT optional fire-and-forget here — the review explicitly
   * requires Gate A never report success while it failed. So this now runs `approveGateA`
   * (`app/lib/mvp/gateAApproval.ts`, ordered, idempotent, every step checked) BEFORE
   * `handleApprove()`, and only calls `handleApprove()` — the thing that actually marks the draft
   * `'approved'` and unblocks Engineering — if that persistence succeeded (or BuildersDB was never
   * configured at all, a legitimate no-op deployment mode `approveGateA` itself distinguishes from
   * a real failure). A failure leaves the draft exactly where it was — still pending approval —
   * so the customer sees an explicit error and can simply press Approve again; every step
   * `approveGateA` performs is independently safe to repeat.
   */
  const handleApproveAndCreateMvp = async () => {
    const draft = latestDraft;

    if (!draft?.currentMvp) {
      handleApprove();
      return;
    }

    setIsCreatingMvp(true);

    try {
      const roadmapEntry = draft.roadmapSkeleton?.find((entry) => entry.sequence === draft.currentMvp!.sequence);

      const result = await approveGateA({
        projectId: project.id,
        sequence: draft.currentMvp.sequence,
        code: draft.currentMvp.id,
        theme: roadmapEntry?.theme,
        targetRelease: roadmapEntry?.targetRelease,
        estimatedEffort: roadmapEntry?.estimatedEffort,
        decidedBy: user?.id ?? undefined,
        features: draft.currentMvp.features,
      });

      if (!result.ok) {
        toast.error(result.error ?? 'Gate A approval failed — the MVP/Feature record could not be saved.');
        return;
      }

      handleApprove();
    } finally {
      setIsCreatingMvp(false);
    }
  };

  if (!canGenerate && !latest) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Complete requirements first."
          className="flex gap-2 items-center bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textTertiary cursor-not-allowed opacity-60 rounded-lg px-4 py-2"
        >
          <span className="inline-block i-ph:sparkle h-4 w-4" />
          <span className="text-sm font-medium">Generate Product Owner Draft</span>
        </button>
        <span className="text-xs text-bolt-elements-textTertiary">Complete requirements first.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isPreviewing ? (
        <div
          className={classNames(
            'rounded-xl border border-purple-500/30 p-5',
            'bg-purple-50/70 dark:bg-purple-500/[0.08] backdrop-blur-md',
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
              Product Owner Draft Preview — MVP {latestDraft?.currentMvp?.sequence ?? 1}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!isPendingApproval && statusMeta && <Badge label={statusMeta.label} className={statusMeta.className} />}
              <Badge
                label={`v${latest?.version ?? 1}`}
                className="border-purple-500/30 text-purple-600 dark:text-purple-300"
              />
            </div>
          </div>

          <div className="space-y-4">
            {latestDraft?.productVision && (
              <Section title="Product Vision">
                <div className="text-sm text-bolt-elements-textSecondary">{latestDraft.productVision}</div>
              </Section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section title="Business Objectives">
                <BulletList items={latestDraft?.businessObjectives} />
              </Section>
              <Section title="In Scope / Out of Scope">
                <div className="text-sm text-bolt-elements-textSecondary">
                  <span className="font-medium">In scope:</span>{' '}
                  {latestDraft?.productScope?.inScope?.join(', ') || 'None'}
                </div>
                <div className="text-sm text-bolt-elements-textSecondary mt-1">
                  <span className="font-medium">Out of scope:</span>{' '}
                  {latestDraft?.productScope?.outOfScope?.join(', ') || 'None'}
                </div>
              </Section>
            </div>

            {/*
              Sprint 84C — this used to render the full `roadmapSkeleton` list inline (every
              future MVP + its effort chip), the exact buried-three-interactions-deep surface
              docs/product-management/Sprint-84-Product-Evolution-UX-Plan.md's Finding UI-9
              identified as the only place the roadmap could be seen at all. Now that the Product
              tab (Sprint 84B) is the one authoritative place for it, this shrinks to a single
              link so the roadmap is never shown in two places — see that same doc's own
              "Duplicate-state risk" note.
            */}
            {latestDraft?.roadmapSkeleton && latestDraft.roadmapSkeleton.length > 0 && onViewProductRoadmap && (
              <button
                type="button"
                onClick={onViewProductRoadmap}
                className="flex items-center gap-1.5 text-sm font-medium text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
              >
                <span className="i-ph:map-trifold-duotone h-4 w-4" />
                View Product Roadmap ({latestDraft.roadmapSkeleton.length} MVP
                {latestDraft.roadmapSkeleton.length === 1 ? '' : 's'} planned)
              </button>
            )}

            {latestDraft?.currentMvp && (
              <>
                <Section title={`${latestDraft.currentMvp.id} — Features`}>
                  <ul className="space-y-2">
                    {latestDraft.currentMvp.features.map((feature) => (
                      <li
                        key={feature.id}
                        className="text-sm text-bolt-elements-textSecondary rounded-lg border border-bolt-elements-borderColor/30 p-2.5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge label={feature.id} className="border-bolt-elements-borderColor/50" />
                          <span className="font-medium text-bolt-elements-textPrimary">{feature.name}</span>
                          <Badge label={feature.priority} className={MOSCOW_BADGE_CLASS[feature.priority]} />
                        </div>
                        <div className="mt-1">{feature.description}</div>
                        {feature.dependsOn.length > 0 && (
                          <div className="text-xs text-bolt-elements-textTertiary mt-1">
                            Depends on: {feature.dependsOn.join(', ')}
                          </div>
                        )}
                        <div className="text-xs text-bolt-elements-textTertiary mt-1">Why: {feature.customerValue}</div>
                      </li>
                    ))}
                  </ul>
                </Section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Section title="Acceptance Criteria">
                    <BulletList items={latestDraft.currentMvp.acceptanceCriteria} />
                  </Section>
                  <Section title="Success Metrics (business value, not per-feature)">
                    <BulletList items={latestDraft.currentMvp.successMetrics} />
                  </Section>
                  <Section title="Exit Criteria (release readiness)">
                    <BulletList items={latestDraft.currentMvp.exitCriteria} />
                  </Section>
                  <Section title="Risks">
                    {latestDraft.currentMvp.risks.length === 0 ? (
                      <div className="text-sm text-bolt-elements-textTertiary">None</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {latestDraft.currentMvp.risks.map((risk, index) => (
                          <li key={index} className="text-sm text-bolt-elements-textSecondary">
                            <Badge label={risk.severity} className={SEVERITY_BADGE_CLASS[risk.severity]} />{' '}
                            {risk.description}
                            {risk.mitigation && (
                              <div className="text-xs text-bolt-elements-textTertiary mt-0.5">
                                Mitigation: {risk.mitigation}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                  <Section title="Assumptions">
                    <BulletList items={latestDraft.currentMvp.assumptions} />
                  </Section>
                  <Section title="Open Questions">
                    <BulletList items={latestDraft.currentMvp.openQuestions} />
                  </Section>
                </div>

                <Section title="Engineering Handoff (what Solution Architect actually receives — by Feature ID, not name)">
                  <div className="rounded-lg border border-bolt-elements-borderColor/30 p-2.5 space-y-1.5 text-sm text-bolt-elements-textSecondary">
                    <div>
                      <span className="font-medium text-bolt-elements-textPrimary">Scope:</span>{' '}
                      {latestDraft.currentMvp.engineeringHandoff.scope.join(', ') || 'None'}
                    </div>
                    <div>
                      <span className="font-medium text-bolt-elements-textPrimary">Features:</span>{' '}
                      {latestDraft.currentMvp.engineeringHandoff.features.length > 0
                        ? latestDraft.currentMvp.engineeringHandoff.features
                            .map((feature) => `[${feature.id}] ${feature.name} (${feature.priority})`)
                            .join(', ')
                        : 'None'}
                    </div>
                    <div>
                      <span className="font-medium text-bolt-elements-textPrimary">Out of scope (hard boundary):</span>{' '}
                      {latestDraft.currentMvp.engineeringHandoff.outOfScopeFeatures.join(', ') || 'None'}
                    </div>
                    <div>
                      <span className="font-medium text-bolt-elements-textPrimary">Architecture goals:</span>{' '}
                      {latestDraft.currentMvp.engineeringHandoff.architectureGoals.join(', ') || 'None'}
                    </div>
                  </div>
                </Section>
              </>
            )}

            {latestDraft?.futureEnhancements && latestDraft.futureEnhancements.length > 0 && (
              <Section title="Future Enhancements (unscheduled — not planned in detail yet)">
                <BulletList items={latestDraft.futureEnhancements} />
              </Section>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-purple-500/20 flex flex-wrap gap-3">
            {isPendingApproval && (
              <>
                <button
                  type="button"
                  onClick={handleApproveAndCreateMvp}
                  disabled={isCreatingMvp}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50"
                >
                  {isCreatingMvp ? 'Approving…' : 'Approve Roadmap (Gate A)'}
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/50 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                >
                  Discard
                </button>
              </>
            )}
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => runGeneration(latest)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-bolt-elements-textPrimary disabled:opacity-50"
            >
              {isGenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>
      ) : phase === 'confirm' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-bolt-elements-borderColor/60 p-3">
          <span className="text-xs text-bolt-elements-textTertiary">
            The AI Product Owner will plan the first MVP from your approved requirements — a Product Vision, a
            lightweight roadmap of future MVPs, and a fully-elaborated plan for MVP 1. Nothing is saved until you
            approve it, and Engineering never begins until you do.
          </span>
          <div className="flex gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => runGeneration()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            >
              Generate Draft
            </button>
          </div>
        </div>
      ) : phase === 'generating' || isGenerating ? (
        <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary px-1">
          <span className="i-svg-spinners:90-ring-with-bg w-3.5 h-3.5 text-purple-500" />
          The AI Product Owner is planning MVP 1…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPhase('confirm')}
            className="flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
          >
            <span className="inline-block i-ph:sparkle h-4 w-4" />
            <span className="text-sm font-medium">Generate Product Owner Draft</span>
          </button>
          {phase === 'error' && (
            <span className="text-xs text-red-500">{errorMessage || 'Draft generation failed.'}</span>
          )}
        </div>
      )}

      {latest && !isPreviewing && statusMeta && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-bolt-elements-textTertiary px-1">
          <span className="font-medium text-bolt-elements-textSecondary">Product Owner Draft</span>
          <Badge label={statusMeta.label} className={statusMeta.className} />
          <span>{formatArtifactTimestamp(latest.updatedAt)}</span>
          <span>·</span>
          <span>{latest.generatedBy ?? 'Unknown generator'}</span>
          <span>·</span>
          <span>v{latest.version ?? 1}</span>
        </div>
      )}
    </div>
  );
}
