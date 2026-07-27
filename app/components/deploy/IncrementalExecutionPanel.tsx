import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import type { ChangeRequest } from '~/lib/evolution/changeRequestTypes';
import {
  INCREMENTAL_ROLE_LABELS,
  type IncrementalPlanRecord,
  type IncrementalRoleId,
} from '~/lib/evolution/engineeringScopeTypes';
import {
  EXECUTION_STATUS_LABELS,
  INVALIDATION_STATE_LABELS,
  type IncrementalExecution,
  type IncrementalRoleRun,
  type RoleOverride,
} from '~/lib/evolution/incrementalExecutionTypes';
import { incrementalExecutionRepository } from '~/lib/evolution/incrementalExecutionRepository';
import { resolveRoleSelection } from '~/lib/evolution/roleOverrides';
import { describeScopeDecision } from '~/lib/evolution/discoveredImpact';
import { cancelIncrementalExecution, runIncrementalExecution } from '~/lib/services/incrementalExecutionRunner';
import { useGenerateText } from '~/lib/hooks/useGenerateText';
import type { Project } from '~/lib/stores/projects';
import { BuildersStatusBadge, buildersButtonVariants } from '~/components/ui/builders';
import type { BuildersStatus } from '~/components/ui/builders/statusMeta';

/**
 * Incremental Execution Panel — Sprint 97, Part 16.
 *
 * DISPLAYS AND DISPATCHES, NOTHING ELSE. Every value rendered here is read back from
 * `builders_incremental_executions` / `builders_incremental_role_runs`, never from state that
 * survived a run — which is what makes Part 17 work: after a reload the panel re-reads the
 * execution, so completed roles, the current role, invalidations and discovered impact are all
 * still there with no session state to rebuild.
 *
 * The component sequences nothing. It calls exactly two functions — `runIncrementalExecution` and
 * `cancelIncrementalExecution` — and re-reads afterwards, per the Architectural Rule since Sprint 92.
 *
 * NO GENERATION OR DEPLOYMENT CONTROLS. There is deliberately no button here that generates
 * application code, writes a file, cuts a release or deploys: Sprint 97 executes engineering roles
 * and stops.
 */

export interface IncrementalExecutionPanelProps {
  project: Project;
  request: ChangeRequest;
  planRecord: IncrementalPlanRecord;
}

function statusTone(status: IncrementalExecution['status']): BuildersStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'running':
      return 'working';
    case 'failed':
      return 'error';
    case 'blocked':
      return 'blocked';
    case 'paused':
      return 'approval';
    case 'cancelled':
      return 'pending';
    default:
      return 'info';
  }
}

function invalidationTone(state: string): BuildersStatus {
  switch (state) {
    case 'invalidated':
      return 'error';
    case 'potentially_stale':
      return 'warning';
    case 'requires_review':
      return 'approval';
    default:
      return 'success';
  }
}

export function IncrementalExecutionPanel({ project, request, planRecord }: IncrementalExecutionPanelProps) {
  const [execution, setExecution] = useState<IncrementalExecution | null>(null);
  const [roleRuns, setRoleRuns] = useState<IncrementalRoleRun[]>([]);
  const [overrides, setOverrides] = useState<RoleOverride[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const { generate } = useGenerateText();

  const planId = planRecord.id;

  const reload = useCallback(async () => {
    const active = await incrementalExecutionRepository.getActiveExecution(planId);
    const latest =
      active ??
      (await incrementalExecutionRepository.listExecutions(request.deploymentId)).find(
        (candidate) => candidate.engineeringPlanId === planId,
      ) ??
      null;

    setExecution(latest);
    setRoleRuns(latest ? await incrementalExecutionRepository.listRoleRuns(latest.id) : []);
  }, [planId, request.deploymentId]);

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

  /* Part 4 — the operator's pending selection, validated live so an invalid graph can never be started. */
  const selection = useMemo(
    () => resolveRoleSelection({ plan: planRecord.plan, overrides }),
    [planRecord.plan, overrides],
  );

  const recommended = selection.recommendedRoles;
  const approved = selection.approvedRoles;

  const toggleRole = useCallback(
    (role: IncrementalRoleId) => {
      setOverrides((current) => {
        const existing = current.find((entry) => entry.role === role);

        if (existing) {
          return current.filter((entry) => entry.role !== role);
        }

        const action = recommended.includes(role) ? 'exclude' : 'include';
        const reason = window.prompt(
          `Reason for ${action === 'include' ? 'including' : 'excluding'} ${INCREMENTAL_ROLE_LABELS[role]}?`,
        );

        if (!reason?.trim()) {
          toast.error('Every role override needs a reason.');
          return current;
        }

        return [...current, { role, action, reason: reason.trim(), decidedAt: new Date().toISOString() }];
      });
    },
    [recommended],
  );

  async function handleStart(resume: boolean) {
    if (busy) {
      return;
    }

    if (!selection.ok) {
      toast.error(selection.violations[0]?.message ?? 'The role selection is not valid.');
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setBusy(true);

    try {
      const result = await runIncrementalExecution({
        project,
        request,
        planRecord,
        generate,
        overrides,
        executionId: resume ? (execution?.id ?? undefined) : undefined,
        signal: controller.signal,
      });

      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The execution could not be run.');
    } finally {
      setAbortController(null);
      setBusy(false);
      await reload().catch(() => undefined);
    }
  }

  async function handleCancel() {
    abortController?.abort();

    if (execution) {
      await cancelIncrementalExecution(execution, { reason: 'Cancelled from the dashboard' });
      await reload().catch(() => undefined);
    }
  }

  async function handleScopeDecision(
    decision: 'reject_expansion' | 'continue_without_expansion' | 'approve_expansion',
  ) {
    if (!execution || busy) {
      return;
    }

    const reason = window.prompt(`Reason for "${decision.replace(/_/g, ' ')}"?`);

    if (!reason?.trim()) {
      toast.error('A scope decision needs a recorded reason.');
      return;
    }

    setBusy(true);

    try {
      const result = await runIncrementalExecution({
        project,
        request,
        planRecord,
        generate,
        overrides,
        executionId: execution.id,
        scopeExpansionDecision: {
          decision,
          reason: reason.trim(),
          discoveredImpactIds: execution.discoveredImpacts.map((entry) => entry.id ?? '').filter(Boolean),
        },
      });

      toast[result.ok ? 'success' : 'info'](result.message);
    } finally {
      setBusy(false);
      await reload().catch(() => undefined);
    }
  }

  const canResume = execution && ['paused', 'running', 'ready', 'pending'].includes(execution.status);
  const isFinished = execution && ['completed', 'cancelled', 'failed'].includes(execution.status);

  return (
    <div className="mt-2 rounded-lg border border-bolt-elements-borderColor/30 bg-bolt-elements-background-depth-2/40 p-2.5">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
          Incremental Execution
        </span>
        {execution && (
          <BuildersStatusBadge
            status={statusTone(execution.status)}
            label={`#${execution.executionVersion} ${EXECUTION_STATUS_LABELS[execution.status]}`}
            compact
          />
        )}
      </div>

      {loading ? (
        <div className="h-8 rounded bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : (
        <>
          {/* Part 4 — approved role selection and operator overrides. */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {planRecord.plan.roleDecisions.map((decision) => {
              const isApproved = approved.includes(decision.role);
              const overridden = overrides.some((entry) => entry.role === decision.role);

              return (
                <button
                  key={decision.role}
                  type="button"
                  onClick={() => toggleRole(decision.role)}
                  disabled={busy || Boolean(execution && !isFinished)}
                  title={decision.reasoning}
                  className={`px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                    isApproved
                      ? 'border-bolt-elements-borderColorActive text-bolt-elements-textPrimary'
                      : 'border-bolt-elements-borderColor/40 text-bolt-elements-textTertiary line-through'
                  } ${overridden ? 'ring-1 ring-bolt-elements-borderColorActive' : ''}`}
                >
                  {INCREMENTAL_ROLE_LABELS[decision.role]}
                  {overridden && <span className="ml-1">✎</span>}
                </button>
              );
            })}
          </div>

          {!selection.ok && (
            <div className="mb-2 text-[11px] text-bolt-elements-icon-error">
              {selection.violations.map((violation) => (
                <div key={`${violation.code}-${violation.role}`}>{violation.message}</div>
              ))}
            </div>
          )}

          {overrides.length > 0 && (
            <div className="mb-2 text-[11px] text-bolt-elements-textTertiary">
              {overrides.length} override(s) pending ·{' '}
              <button type="button" className="underline" onClick={() => setOverrides([])}>
                Restore recommended selection
              </button>
            </div>
          )}

          {/* Execution progress. */}
          {execution && (
            <div className="text-[11px] text-bolt-elements-textSecondary space-y-0.5 mb-2">
              {execution.currentRole && <div>Current role: {INCREMENTAL_ROLE_LABELS[execution.currentRole]}</div>}
              <div>
                Completed: {execution.completedRoles.map((role) => INCREMENTAL_ROLE_LABELS[role]).join(', ') || '—'}
              </div>
              {execution.failedRoles.length > 0 && (
                <div className="text-bolt-elements-icon-error">
                  Failed: {execution.failedRoles.map((role) => INCREMENTAL_ROLE_LABELS[role]).join(', ')}
                </div>
              )}
              {execution.skippedRoles.length > 0 && (
                <div>Skipped: {execution.skippedRoles.map((role) => INCREMENTAL_ROLE_LABELS[role]).join(', ')}</div>
              )}
              {execution.safetyFallbacks.length > 0 && (
                <div className="text-bolt-elements-icon-error">
                  Safety fallback: {execution.safetyFallbacks.map((trigger) => trigger.detail).join(' ')}
                </div>
              )}
            </div>
          )}

          {/* Part 10 — discovered impact needs an operator decision before anything else runs. */}
          {execution && execution.discoveredImpacts.length > 0 && (
            <div className="mb-2 rounded border border-bolt-elements-borderColor/40 p-2">
              <div className="text-[11px] font-semibold text-bolt-elements-textPrimary mb-1">
                Newly discovered impact ({execution.discoveredImpacts.length})
              </div>
              <ul className="space-y-0.5 mb-1.5">
                {execution.discoveredImpacts.map((discovery, index) => (
                  <li key={discovery.id ?? index} className="text-[11px] text-bolt-elements-textSecondary">
                    <span className="text-bolt-elements-textPrimary">{discovery.affectedArtifact}</span> (
                    {discovery.severity}) — {discovery.description}
                  </li>
                ))}
              </ul>
              {execution.scopeExpansionDecisions.length === 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {(['approve_expansion', 'reject_expansion', 'continue_without_expansion'] as const).map(
                    (decision) => (
                      <button
                        key={decision}
                        type="button"
                        disabled={busy}
                        onClick={() => handleScopeDecision(decision)}
                        title={describeScopeDecision(decision)}
                        className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                      >
                        {decision.replace(/_/g, ' ')}
                      </button>
                    ),
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-bolt-elements-textTertiary">
                  {describeScopeDecision(execution.scopeExpansionDecisions.at(-1)!.decision)}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleStart(Boolean(canResume))}
              disabled={busy || !selection.ok || Boolean(isFinished && execution?.status === 'completed')}
              className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
            >
              {canResume ? 'Resume Execution' : 'Start Execution'}
            </button>
            {execution && !isFinished && (
              <button
                type="button"
                onClick={handleCancel}
                className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
              >
                Cancel
              </button>
            )}
            {execution && (
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
              >
                View Role Output
              </button>
            )}
          </div>
        </>
      )}

      {execution && detailOpen && (
        <Dialog.Root open onOpenChange={(open) => !open && setDetailOpen(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(52rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Incremental Execution #{execution.executionVersion}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                {EXECUTION_STATUS_LABELS[execution.status]} · scope {execution.scopeFingerprint}
              </Dialog.Description>

              <div className="space-y-4 text-xs">
                <Section title="Role runs">
                  {roleRuns.length === 0 ? (
                    <div className="text-[11px] text-bolt-elements-textTertiary">No role has run yet.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {roleRuns.map((run) => (
                        <li key={run.id ?? `${run.role}-${run.attempt}`}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-bolt-elements-textPrimary">
                              {INCREMENTAL_ROLE_LABELS[run.role]} · attempt {run.attempt}
                            </span>
                            <BuildersStatusBadge
                              status={
                                run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'error' : 'info'
                              }
                              label={run.status}
                              compact
                            />
                          </div>
                          {run.context && (
                            <div className="text-[11px] text-bolt-elements-textTertiary">
                              Reduced context: {run.context.affectedFiles.length} file(s),{' '}
                              {run.context.affectedFeatures.length} feature(s),{' '}
                              {Math.round(run.context.contextReductionRatio * 100)}% of the released file set
                              {run.context.usedFullContextFallback && ' · FULL CONTEXT FALLBACK'}
                            </div>
                          )}
                          {run.failure && (
                            <div className="text-[11px] text-bolt-elements-icon-error">{run.failure.message}</div>
                          )}
                          {run.output && (
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-bolt-elements-background-depth-2/60 p-2 text-[10px] text-bolt-elements-textSecondary">
                              {JSON.stringify(run.output.content, null, 2)}
                            </pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Invalidated artifacts">
                  <ul className="space-y-0.5">
                    {execution.invalidations.map((decision) => (
                      <li key={decision.role} className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bolt-elements-textPrimary">
                            {INCREMENTAL_ROLE_LABELS[decision.role]}
                          </span>
                          <span className="block text-[11px] text-bolt-elements-textTertiary">
                            {decision.reasoning}
                          </span>
                        </span>
                        <BuildersStatusBadge
                          status={invalidationTone(decision.state)}
                          label={INVALIDATION_STATE_LABELS[decision.state]}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Reviews">
                  {execution.reviews.length === 0 ? (
                    <div className="text-[11px] text-bolt-elements-textTertiary">No review has run yet.</div>
                  ) : (
                    <ul className="space-y-0.5">
                      {execution.reviews.map((review) => (
                        <li key={review.stage} className="flex items-start justify-between gap-3">
                          <span>
                            <span className="text-bolt-elements-textPrimary">{review.label}</span>
                            <span className="block text-[11px] text-bolt-elements-textTertiary">
                              {review.reasoning}
                            </span>
                          </span>
                          <BuildersStatusBadge
                            status={review.decision === 'approved' ? 'success' : 'warning'}
                            label={review.decision.replace(/_/g, ' ')}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Operator overrides">
                  {execution.overrides.length === 0 ? (
                    <div className="text-[11px] text-bolt-elements-textTertiary">
                      None — the recommended selection was executed unchanged.
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {execution.overrides.map((override) => (
                        <li key={override.role} className="text-[11px] text-bolt-elements-textSecondary">
                          <span className="text-bolt-elements-textPrimary">
                            {override.action === 'include' ? 'Added' : 'Removed'}{' '}
                            {INCREMENTAL_ROLE_LABELS[override.role]}
                          </span>{' '}
                          — {override.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}
