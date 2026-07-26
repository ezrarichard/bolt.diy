import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import {
  VERIFICATION_CATEGORY_LABELS,
  VERIFICATION_STAGE_LABELS,
  type DeploymentVerification,
  type VerificationCategory,
  type VerificationCheck,
  type VerificationCheckStatus,
  type VerificationProgress,
  type VerificationReportStatus,
} from '~/lib/deployment/verificationTypes';
import { runDeploymentVerification } from '~/lib/services/deploymentVerificationRunner';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';

/**
 * Deployment Verification Panel — Sprint 92, Parts 19/20/21.
 *
 * Everything rendered here comes from the Deployment verification domain — the persisted
 * `builders_deployment_verifications` row read back through
 * `deploymentRepository.getLatestDeploymentVerification`, never from component state that survived
 * a run. That is what satisfies Part 21: after a reload the panel simply reads the latest report
 * again, so the verified status, the checks and the evidence are all still there with no
 * session-local flag to restore.
 *
 * This component never sets `Deployment.status` and never writes a report. It calls exactly one
 * function — `runDeploymentVerification` — and re-reads the domain afterwards.
 *
 * Evidence is rendered as the redacted key/value pairs the engine produced
 * (`verificationRedaction.ts`); no raw response header block and no request value is ever shown.
 */

export interface DeploymentVerificationPanelProps {
  deployment: DeploymentWithProviders;
  manifest: ApplicationManifest | null;

  /** Lets the parent card re-read the Deployment after a run that may have moved it to `verified`. */
  onVerificationComplete: () => void;
}

function reportStatusPresentation(status: VerificationReportStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'passed':
      return { status: 'success', label: 'Verified' };
    case 'warning':
      return { status: 'warning', label: 'Verified with warnings' };
    case 'failed':
      return { status: 'error', label: 'Verification failed' };
    case 'cancelled':
      return { status: 'pending', label: 'Cancelled' };
    case 'incomplete':
      return { status: 'warning', label: 'Incomplete' };
    case 'running':
    default:
      return { status: 'working', label: 'Running' };
  }
}

function checkStatusPresentation(status: VerificationCheckStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'passed':
      return { status: 'success', label: 'Passed' };
    case 'failed':
      return { status: 'error', label: 'Failed' };
    case 'warning':
      return { status: 'warning', label: 'Warning' };
    case 'skipped':
      return { status: 'pending', label: 'Skipped' };
    case 'unavailable':
      return { status: 'info', label: 'Unavailable' };
    case 'running':
      return { status: 'working', label: 'Running' };
    default:
      return { status: 'pending', label: 'Pending' };
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return '—';
  }

  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function groupByCategory(checks: VerificationCheck[]): Array<[VerificationCategory, VerificationCheck[]]> {
  const groups = new Map<VerificationCategory, VerificationCheck[]>();

  for (const check of checks) {
    const existing = groups.get(check.category);

    if (existing) {
      existing.push(check);
    } else {
      groups.set(check.category, [check]);
    }
  }

  return [...groups.entries()];
}

export function DeploymentVerificationPanel({
  deployment,
  manifest,
  onVerificationComplete,
}: DeploymentVerificationPanelProps) {
  const [latest, setLatest] = useState<DeploymentVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<VerificationProgress | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const deploymentId = deployment.id;

  const reload = useCallback(async () => {
    const result = await deploymentRepository.getLatestDeploymentVerification(deploymentId);
    setLatest(result);
  }, [deploymentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    deploymentRepository
      .getLatestDeploymentVerification(deploymentId)
      .then((result) => {
        if (!cancelled) {
          setLatest(result);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deploymentId]);

  // Cancelling an in-flight run when the panel unmounts — never leaves a request running against a project the operator has navigated away from.
  useEffect(() => () => abortRef.current?.abort(), []);

  const canVerify = deployment.status === 'deployed' || deployment.status === 'verified';
  const hasRun = latest !== null;

  async function handleRun() {
    if (running) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ stage: 'preparing', completed: 0, planned: 1 });

    try {
      const result = await runDeploymentVerification({
        deployment,
        manifest,
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (result.code === 'already_running') {
        toast.info(result.message);
      } else if (!result.ok) {
        toast.error(result.message);
      } else if (result.verified) {
        toast.success(result.message);
      } else {
        toast.info(result.message);
      }

      await reload();
      onVerificationComplete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verification could not be completed.');
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  const summary = latest?.summary;
  const presentation = latest ? reportStatusPresentation(latest.status) : null;

  const groupedChecks = useMemo(() => groupByCategory(latest?.checks ?? []), [latest]);

  return (
    <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:seal-check-duotone h-4 w-4 text-bolt-elements-textSecondary" />
          <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">Verification</h4>
        </div>
        {presentation && <BuildersStatusBadge status={presentation.status} label={presentation.label} compact />}
      </div>

      {loading ? (
        <div className="h-12 rounded-lg bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : !hasRun ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          This deployment has not been verified yet. Verification checks that the live application is actually reachable
          and serving a working shell.
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Last Verified</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latest?.completedAt ? formatTimestamp(latest.completedAt) : formatTimestamp(latest?.startedAt ?? '')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Target URL</span>
            <span className="text-bolt-elements-textPrimary font-mono text-[11px] truncate max-w-[60%]">
              {latest?.targetUrl || '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Checks</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {summary?.passed ?? 0} passed · {summary?.failed ?? 0} failed · {summary?.warnings ?? 0} warnings
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Duration</span>
            <span className="text-bolt-elements-textPrimary text-xs">{formatDuration(latest?.durationMs)}</span>
          </div>

          {summary?.blockingFailure && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">
                Blocking Failure
              </div>
              <div className="text-xs text-bolt-elements-textSecondary">
                <span className="font-medium text-bolt-elements-textPrimary">{summary.blockingFailure.name}</span>
                {summary.blockingFailure.errorMessage ? ` — ${summary.blockingFailure.errorMessage}` : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {running && progress && (
        <div className="mt-3 rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-bolt-elements-textSecondary">
              {VERIFICATION_STAGE_LABELS[progress.stage]}
              {progress.detail ? ` — ${progress.detail}` : ''}
            </span>
            <span className="text-[11px] text-bolt-elements-textTertiary">
              {progress.completed}/{progress.planned}
            </span>
          </div>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mt-2 text-[11px] underline text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
          >
            Cancel verification
          </button>
        </div>
      )}

      <div className="pt-3 flex items-center gap-2">
        {canVerify && (
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
          >
            {running ? 'Verifying…' : hasRun ? 'Retry Verification' : 'Run Verification'}
          </button>
        )}
        {hasRun && (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
          >
            View Details
          </button>
        )}
      </div>

      {!canVerify && (
        <div className="pt-2 text-[11px] text-bolt-elements-textTertiary">
          Verification becomes available once this Deployment reaches the deployed state.
        </div>
      )}

      {showDetails && latest && (
        <Dialog.Root open={showDetails} onOpenChange={(open) => !open && setShowDetails(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(48rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Verification #{latest.verificationNumber}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                {latest.message} · policy {latest.policyVersion}
                {latest.finalUrl ? ` · final URL ${latest.finalUrl}` : ''}
              </Dialog.Description>

              <div className="space-y-4">
                {groupedChecks.map(([category, checks]) => (
                  <div key={category}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
                      {VERIFICATION_CATEGORY_LABELS[category]}
                    </div>
                    <div className="space-y-1.5">
                      {checks.map((check) => {
                        const checkPresentation = checkStatusPresentation(check.status);

                        return (
                          <div
                            key={check.id}
                            className="rounded-lg border border-bolt-elements-borderColor/40 p-2.5 text-xs"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className="font-medium text-bolt-elements-textPrimary">{check.name}</span>
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
                                  {check.required ? 'Required' : 'Advisory'}
                                </span>
                              </div>
                              <BuildersStatusBadge
                                status={checkPresentation.status}
                                label={checkPresentation.label}
                                compact
                              />
                            </div>

                            <div className="mt-1 text-bolt-elements-textSecondary">{check.description}</div>

                            {check.target && (
                              <div className="mt-1 font-mono text-[11px] text-bolt-elements-textTertiary break-all">
                                {check.target}
                              </div>
                            )}

                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-bolt-elements-textTertiary">
                              {check.expected && <span>Expected: {check.expected}</span>}
                              {check.actual && <span>Actual: {check.actual}</span>}
                              <span>Duration: {formatDuration(check.durationMs)}</span>
                              {check.attempts > 1 && <span>Attempts: {check.attempts}</span>}
                            </div>

                            {check.errorMessage && (
                              <div
                                className={`mt-1.5 ${check.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-bolt-elements-textSecondary'}`}
                              >
                                {check.errorMessage}
                              </div>
                            )}

                            {Object.keys(check.evidence).length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-bolt-elements-textTertiary">
                                {Object.entries(check.evidence).map(([key, value]) => (
                                  <span key={key} className="font-mono">
                                    {key}: {String(value)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
