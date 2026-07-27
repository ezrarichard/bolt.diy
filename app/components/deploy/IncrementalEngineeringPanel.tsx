import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import { INCREMENTAL_ROLE_LABELS, type IncrementalPlanRecord } from '~/lib/evolution/engineeringScopeTypes';
import { evolutionRepository } from '~/lib/evolution/evolutionRepository';
import { planIncrementalEngineering } from '~/lib/services/incrementalEngineeringRunner';
import type { Project } from '~/lib/stores/projects';
import { BuildersStatusBadge, buildersButtonVariants } from '~/components/ui/builders';

/**
 * Incremental Engineering Panel — Sprint 96, Parts 9/11.
 *
 * Displays only. Every plan rendered here is read back from
 * `builders_incremental_engineering_plans` — never component state that survived a run. That is
 * what satisfies Part 11: after a reload the panel re-reads the plans, so scope, role selection,
 * change set and reduced context are all still there with no session state to rebuild.
 *
 * This component never builds a plan and never writes one. It calls exactly one function —
 * `planIncrementalEngineering` — and re-reads afterwards. It executes nothing: there is no control
 * here that runs an AI role, generates code or deploys, because none of that exists yet.
 */

export interface IncrementalEngineeringPanelProps {
  project: Project;
  deployment: DeploymentWithProviders;
}

function percentageTone(percentage: number): 'success' | 'warning' | 'info' {
  if (percentage >= 50) {
    return 'warning';
  }

  return percentage > 0 ? 'info' : 'success';
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function IncrementalEngineeringPanel({ project, deployment }: IncrementalEngineeringPanelProps) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [plans, setPlans] = useState<IncrementalPlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  const deploymentId = deployment.id;

  const reload = useCallback(async () => {
    const [changeRequests, incrementalPlans] = await Promise.all([
      evolutionRepository.listChangeRequests(deploymentId),
      evolutionRepository.listIncrementalPlans(deploymentId),
    ]);

    setRequests(changeRequests);
    setPlans(incrementalPlans);
  }, [deploymentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    reload()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** Only a request that has been analysed can be planned — the runner enforces this too. */
  const plannableRequests = requests.filter((request) => ['analyzed', 'planned'].includes(request.status));
  const latestPlanFor = (requestId: string) => plans.find((plan) => plan.changeRequestId === requestId);

  async function handlePlan(request: ChangeRequest) {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      const result = await planIncrementalEngineering({ project, request });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The engineering plan could not be created.');
    } finally {
      setBusy(false);
    }
  }

  const openPlan = plans.find((plan) => plan.id === openPlanId);

  return (
    <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:git-branch-duotone h-4 w-4 text-bolt-elements-textSecondary" />
          <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">
            Incremental Engineering
          </h4>
        </div>
      </div>

      {loading ? (
        <div className="h-12 rounded-lg bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : plannableRequests.length === 0 ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          Analyse a change request first. Incremental engineering plans which roles and files a change actually needs,
          so the whole application is never regenerated.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {plannableRequests.map((request) => {
            const plan = latestPlanFor(request.id);

            return (
              <li key={request.id} className="rounded-lg border border-bolt-elements-borderColor/40 p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium text-bolt-elements-textPrimary">
                      #{request.requestNumber} {request.title}
                    </span>
                    {plan && (
                      <span className="block text-[11px] text-bolt-elements-textTertiary">
                        Plan #{plan.planNumber} · {formatTimestamp(plan.createdAt)}
                      </span>
                    )}
                  </div>
                  {plan && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <BuildersStatusBadge status="info" label={`${plan.selectedRoles.length}/9 roles`} compact />
                      <BuildersStatusBadge
                        status={percentageTone(plan.touchedPercentage)}
                        label={`${plan.touchedPercentage}% of files`}
                        compact
                      />
                    </div>
                  )}
                </div>

                {plan && (
                  <div className="mt-1 text-[11px] text-bolt-elements-textSecondary">
                    {plan.selectedRoles.map((role) => INCREMENTAL_ROLE_LABELS[role]).join(' → ')}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handlePlan(request)}
                    disabled={busy}
                    className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {plan ? 'Re-plan' : 'Plan Engineering'}
                  </button>
                  {plan && (
                    <button
                      type="button"
                      onClick={() => setOpenPlanId(plan.id)}
                      className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      View Plan
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openPlan && (
        <Dialog.Root open onOpenChange={(open) => !open && setOpenPlanId(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(52rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Incremental Engineering Plan #{openPlan.planNumber}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                {openPlan.plan?.summary}
              </Dialog.Description>

              <div className="space-y-4 text-xs">
                <PlanSection title="Execution order">
                  {(openPlan.plan?.executionOrder ?? []).length === 0 ? (
                    <div className="text-[11px] text-bolt-elements-textTertiary">No role is required.</div>
                  ) : (
                    <ol className="list-decimal ml-4 space-y-0.5">
                      {openPlan.plan.executionOrder.map((phase) => (
                        <li key={phase.role} className="text-[11px] text-bolt-elements-textSecondary">
                          <span className="text-bolt-elements-textPrimary">{phase.label}</span>
                          {phase.artifactType && (
                            <span className="ml-1 font-mono text-bolt-elements-textTertiary">{phase.artifactType}</span>
                          )}
                          <span className="block">{phase.reasoning}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </PlanSection>

                <PlanSection title="Role selection">
                  <ul className="space-y-1">
                    {(openPlan.plan?.roleDecisions ?? []).map((decision) => (
                      <li key={decision.role} className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bolt-elements-textPrimary">{decision.label}</span>
                          <span className="block text-[11px] text-bolt-elements-textTertiary">
                            {decision.reasoning}
                          </span>
                        </span>
                        <BuildersStatusBadge
                          status={decision.selected ? 'success' : 'pending'}
                          label={decision.selected ? 'Yes' : 'No'}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </PlanSection>

                <PlanSection title="Engineering scope">
                  <ScopeRow label="Features" items={openPlan.plan?.scope?.affectedFeatures} />
                  <ScopeRow label="Pages" items={openPlan.plan?.scope?.affectedPages} />
                  <ScopeRow label="Components" items={openPlan.plan?.scope?.affectedComponents} />
                  <ScopeRow label="Database objects" items={openPlan.plan?.scope?.affectedDatabaseObjects} />
                  <ScopeRow label="APIs" items={openPlan.plan?.scope?.affectedApis} />
                  <ScopeRow label="Environment" items={openPlan.plan?.scope?.affectedEnvironment} />
                  <ScopeRow label="Documents" items={openPlan.plan?.scope?.affectedDocuments} />
                </PlanSection>

                <PlanSection
                  title={`Change set — ${openPlan.plan?.changeSet?.summary?.modifyCount ?? 0} of ${openPlan.plan?.changeSet?.summary?.totalReleasedFiles ?? 0} files`}
                >
                  <ul className="space-y-0.5">
                    {(openPlan.plan?.changeSet?.filesToModify ?? []).map((file) => (
                      <li key={file.path} className="text-[11px]">
                        <span className="font-mono text-bolt-elements-textPrimary">{file.path}</span>
                        <span className="ml-1 text-bolt-elements-textTertiary">
                          ({file.category}) — {file.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 text-[11px] text-bolt-elements-textTertiary">
                    {openPlan.plan?.changeSet?.summary?.unchangedCount ?? 0} released file(s) remain untouched.
                  </div>
                </PlanSection>

                <PlanSection title="Reduced context">
                  <ul className="space-y-1">
                    {(openPlan.plan?.reducedContexts ?? []).map((context) => (
                      <li key={context.role}>
                        <span className="text-bolt-elements-textPrimary">{context.label}</span>
                        <span className="block text-[11px] text-bolt-elements-textSecondary">
                          {context.includedFiles.length} file(s), {context.includedFeatures.length} feature(s),{' '}
                          {context.includedDatabaseObjects.length} table(s) ·{' '}
                          {Math.round(context.contextReductionRatio * 100)}% of the released file set
                        </span>
                        <span className="block text-[11px] text-bolt-elements-textTertiary">
                          Excludes: {context.excluded.join('; ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </PlanSection>

                <PlanSection title="Reviews">
                  <ul className="space-y-0.5">
                    {(openPlan.plan?.reviewRequirements ?? []).map((review) => (
                      <li key={review.stage} className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bolt-elements-textPrimary">{review.label}</span>
                          <span className="block text-[11px] text-bolt-elements-textTertiary">{review.reasoning}</span>
                        </span>
                        <BuildersStatusBadge
                          status={review.required ? 'warning' : 'pending'}
                          label={review.required ? 'Required' : 'Skipped'}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </PlanSection>

                <PlanSection title="Out of scope for this plan">
                  <ul className="list-disc ml-4 space-y-0.5">
                    {(openPlan.plan?.outOfScope ?? []).map((entry) => (
                      <li key={entry} className="text-[11px] text-bolt-elements-textTertiary">
                        {entry}
                      </li>
                    ))}
                  </ul>
                </PlanSection>
              </div>

              <div className="mt-5 flex justify-end">
                <Dialog.Close className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}>
                  Close
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

function PlanSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function ScopeRow({ label, items }: { label: string; items?: Array<{ identifier: string; label: string }> }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-bolt-elements-textTertiary">{label}</span>
      <span className="text-bolt-elements-textPrimary text-right font-mono text-[11px] break-all">
        {items.map((item) => item.identifier).join(', ')}
      </span>
    </div>
  );
}
