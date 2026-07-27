import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import { listDeliveryExportFormats } from '~/lib/deployment/deliveryExport';
import type {
  DeliveryChecklistState,
  DeliveryCompletenessLevel,
  DeliveryPackageRecord,
} from '~/lib/deployment/deliveryPackageTypes';
import { generateDeliveryPackage } from '~/lib/services/deliveryPackageRunner';
import type { Project } from '~/lib/stores/projects';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';

/**
 * Delivery Package Panel — Sprint 93, Parts 12/13.
 *
 * Displays only. Everything rendered here is the persisted
 * `builders_delivery_packages` row read back through
 * `deploymentRepository.getLatestDeliveryPackage` — never component state that survived a
 * generation run. That is what satisfies Part 13: after a reload the panel re-reads the latest
 * package, so the version, completeness and full contents are still there with no session-local
 * state to rebuild.
 *
 * This component never assembles a package, never writes one, and never sets `Deployment.status`.
 * It calls exactly one function — `generateDeliveryPackage` — and re-reads the domain afterwards.
 *
 * The Export control is deliberately disabled: `listDeliveryExportFormats` is the single source of
 * what is available (Part 11), so when a later sprint registers a renderer this UI needs no change.
 */

export interface DeliveryPackagePanelProps {
  project: Project;
  deployment: DeploymentWithProviders;

  /** Lets the parent card re-read the Deployment after a run that may have moved it to `delivery_ready`. */
  onPackageGenerated: () => void;
}

function completenessPresentation(level: DeliveryCompletenessLevel): { status: BuildersStatus; label: string } {
  switch (level) {
    case 'complete':
      return { status: 'success', label: 'Complete' };
    case 'almost_complete':
      return { status: 'warning', label: 'Almost complete' };
    default:
      return { status: 'error', label: 'Incomplete' };
  }
}

function checklistPresentation(state: DeliveryChecklistState): { status: BuildersStatus; label: string } {
  switch (state) {
    case 'satisfied':
      return { status: 'success', label: 'Satisfied' };
    case 'not_satisfied':
      return { status: 'error', label: 'Not satisfied' };
    case 'not_applicable':
      return { status: 'info', label: 'N/A' };
    default:
      return { status: 'pending', label: 'Pending' };
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function DeliveryPackagePanel({ project, deployment, onPackageGenerated }: DeliveryPackagePanelProps) {
  const [latest, setLatest] = useState<DeliveryPackageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const deploymentId = deployment.id;

  const reload = useCallback(async () => {
    setLatest(await deploymentRepository.getLatestDeliveryPackage(deploymentId));
  }, [deploymentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    deploymentRepository
      .getLatestDeliveryPackage(deploymentId)
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const canGenerate = deployment.status === 'verified' || deployment.status === 'delivery_ready';
  const hasPackage = latest !== null;
  const summary = latest?.deliverySummary;
  const exportFormats = listDeliveryExportFormats();

  async function handleGenerate() {
    if (generating) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);

    try {
      const result = await generateDeliveryPackage({ project, signal: controller.signal });

      if (!result.ok) {
        toast.error(result.message);
      } else {
        toast.success(result.message);
      }

      await reload();
      onPackageGenerated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The delivery package could not be generated.');
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:package-duotone h-4 w-4 text-bolt-elements-textSecondary" />
          <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">
            Delivery Package
          </h4>
        </div>
        {hasPackage && <BuildersStatusBadge status="success" label="Delivery Package Ready" compact />}
      </div>

      {loading ? (
        <div className="h-12 rounded-lg bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : !hasPackage ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          No delivery package has been generated yet. The package assembles everything the customer needs for handover
          from this project's own engineering, deployment and verification records.
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Package</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              #{latest?.packageNumber} · v{latest?.packageVersion}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Generated</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latest?.generatedAt ? formatTimestamp(latest.generatedAt) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Completeness</span>
            <span className="flex items-center gap-2">
              <span className="text-bolt-elements-textPrimary text-xs">{latest?.completenessScore}%</span>
              {latest && <BuildersStatusBadge {...completenessPresentation(latest.completenessLevel)} compact />}
            </span>
          </div>
          {summary?.deploymentSummary?.previewUrl && (
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Preview URL</span>
              <span className="text-bolt-elements-textPrimary font-mono text-[11px] truncate max-w-[60%]">
                {summary.deploymentSummary.previewUrl}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="pt-3 flex flex-wrap items-center gap-2">
        {canGenerate && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
          >
            {generating ? 'Generating…' : hasPackage ? 'Regenerate Package' : 'Generate Package'}
          </button>
        )}
        {hasPackage && (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
          >
            View Package
          </button>
        )}
        {hasPackage && (
          <button
            type="button"
            disabled
            title={exportFormats.find((format) => !format.available)?.unavailableReason}
            className={`${buildersButtonVariants({ size: 'sm', variant: 'outline' })} opacity-50 cursor-not-allowed`}
          >
            Export
          </button>
        )}
      </div>

      {!canGenerate && (
        <div className="pt-2 text-[11px] text-bolt-elements-textTertiary">
          A delivery package can be generated once this Deployment has been verified.
        </div>
      )}

      {showDetails && latest && summary && (
        <Dialog.Root open={showDetails} onOpenChange={(open) => !open && setShowDetails(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(52rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Delivery Package #{latest.packageNumber} — {summary.projectInformation?.projectName}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                Model v{latest.packageVersion} · generator v{latest.generatorVersion} · {latest.completenessScore}%
                complete
              </Dialog.Description>

              <div className="space-y-4 text-xs">
                <PackageSection title="Deployment">
                  <Row label="Status" value={summary.deploymentSummary?.lifecycleStatus} />
                  <Row label="Preview URL" value={summary.deploymentSummary?.previewUrl} mono />
                  <Row label="Vercel project" value={summary.deploymentSummary?.vercelProjectName} />
                  <Row label="Repository" value={summary.repositoryInformation?.repositoryFullName} mono />
                  <Row label="Branch" value={summary.repositoryInformation?.branch} />
                  <Row label="Database" value={summary.databaseInformation?.projectRef} mono />
                  <Row label="Region" value={summary.databaseInformation?.region} />
                </PackageSection>

                <PackageSection title="Verification">
                  <Row label="Status" value={summary.verificationSummary?.status ?? 'Not verified'} />
                  <Row
                    label="Required checks"
                    value={`${summary.verificationSummary?.requiredPassed ?? 0}/${summary.verificationSummary?.requiredTotal ?? 0}`}
                  />
                  <Row label="Warnings" value={String(summary.verificationSummary?.warnings ?? 0)} />
                  <Row label="Blocking failure" value={summary.verificationSummary?.blockingFailure} />
                </PackageSection>

                <PackageSection title={`Features delivered (${summary.featureInventory?.features?.length ?? 0})`}>
                  <ul className="space-y-1">
                    {(summary.featureInventory?.features ?? []).map((feature) => (
                      <li key={feature.code} className="flex items-start justify-between gap-3">
                        <span className="text-bolt-elements-textSecondary">
                          <span className="font-mono text-[10px] text-bolt-elements-textTertiary mr-1">
                            {feature.code}
                          </span>
                          <span className="text-bolt-elements-textPrimary">{feature.title}</span>
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary shrink-0">
                          {feature.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                </PackageSection>

                <PackageSection title="Acceptance checklist">
                  <ul className="space-y-1">
                    {(summary.acceptanceChecklist?.items ?? []).map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bolt-elements-textPrimary">{item.label}</span>
                          <span className="block text-[11px] text-bolt-elements-textTertiary">{item.evidence}</span>
                        </span>
                        <BuildersStatusBadge {...checklistPresentation(item.state)} compact />
                      </li>
                    ))}
                  </ul>
                </PackageSection>

                {(summary.knownLimitations?.length ?? 0) > 0 && (
                  <PackageSection title={`Known limitations (${summary.knownLimitations.length})`}>
                    <ul className="space-y-1">
                      {summary.knownLimitations.map((limitation) => (
                        <li key={limitation.id}>
                          <span className="text-bolt-elements-textPrimary">{limitation.title}</span>
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
                            {limitation.severity}
                          </span>
                          <span className="block text-[11px] text-bolt-elements-textSecondary">
                            {limitation.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </PackageSection>
                )}

                <PackageSection title="Admin guide">
                  <Row label="Preview URL" value={summary.adminGuide?.previewUrl} mono />
                  <Row label="Repository" value={summary.adminGuide?.repositoryUrl} mono />
                  <Row label="Build version" value={summary.adminGuide?.buildVersion} />
                  <div className="mt-1">
                    <div className="text-bolt-elements-textTertiary text-[11px] uppercase tracking-wide mb-1">
                      Environment variables
                    </div>
                    <ul className="space-y-0.5">
                      {(summary.adminGuide?.environmentVariables ?? []).map((variable) => (
                        <li key={variable.name} className="text-[11px] text-bolt-elements-textSecondary">
                          <span className="font-mono text-bolt-elements-textPrimary">{variable.name}</span> —{' '}
                          {variable.requiresManualEntry ? 'entered manually at deploy time' : variable.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {(summary.adminGuide?.procedures ?? []).map((procedure) => (
                    <div key={procedure.id} className="mt-2">
                      <div className="text-bolt-elements-textPrimary font-medium">{procedure.title}</div>
                      <ol className="list-decimal ml-4 space-y-0.5 text-[11px] text-bolt-elements-textSecondary">
                        {procedure.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </PackageSection>

                <PackageSection title="Completeness">
                  <ul className="space-y-1">
                    {(summary.completeness?.dimensions ?? []).map((entry) => (
                      <li key={entry.id} className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bolt-elements-textPrimary">{entry.label}</span>
                          <span className="block text-[11px] text-bolt-elements-textTertiary">{entry.detail}</span>
                        </span>
                        <span className="text-bolt-elements-textSecondary shrink-0">
                          {Math.round(entry.score * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </PackageSection>

                <PackageSection title="Support">
                  <div className="text-[11px] text-bolt-elements-textSecondary">{summary.support?.note}</div>
                  <ul className="mt-1 space-y-0.5">
                    {(summary.support?.consoles ?? []).map((console) => (
                      <li key={console.url} className="text-[11px] text-bolt-elements-textTertiary font-mono">
                        {console.label}: {console.url}
                      </li>
                    ))}
                  </ul>
                </PackageSection>
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

function PackageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) {
    return null;
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-bolt-elements-textTertiary">{label}</span>
      <span className={`text-bolt-elements-textPrimary text-right break-all ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </span>
    </div>
  );
}
