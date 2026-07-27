import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import {
  CUSTOMER_ACCEPTANCE_LABELS,
  RELEASE_NOTE_CATEGORY_LABELS,
  RELEASE_TYPE_LABELS,
  isAcceptedState,
  type CustomerAcceptanceState,
  type ReleaseRecord,
} from '~/lib/deployment/releaseTypes';
import type { ReleaseType } from '~/lib/deployment/semanticVersion';
import {
  createProjectRelease,
  recordReleaseAcceptance,
  suggestReleaseVersion,
} from '~/lib/services/releaseManagementRunner';
import type { Project } from '~/lib/stores/projects';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';

/**
 * Release Panel — Sprint 94, Parts 10/12.
 *
 * Displays only. Everything rendered here is the persisted `builders_releases` row read back
 * through `deploymentRepository.getLatestRelease` — never component state that survived a run.
 * That is what satisfies Part 12: after a reload the panel re-reads the latest release, so the
 * version, date, acceptance state and notes are all still there with no session-local state.
 *
 * This component never assembles a release, never writes one, and never sets `Deployment.status`.
 * It calls exactly two functions — `createProjectRelease` and `recordReleaseAcceptance` — and
 * re-reads the domain afterwards.
 *
 * VERSIONS ARE NEVER AUTO-APPLIED (Part 3). The version field is PREFILLED from
 * `suggestReleaseVersion` and the operator can change it; whatever they submit is validated by the
 * service. Selecting a different release type re-suggests, it does not decide.
 */

export interface ReleasePanelProps {
  project: Project;
  deployment: DeploymentWithProviders;

  /** Lets the parent card re-read the Deployment after a run that may have moved it to `released`. */
  onReleaseChanged: () => void;
}

const ACCEPTANCE_OPTIONS: CustomerAcceptanceState[] = [
  'accepted',
  'accepted_with_conditions',
  'needs_revision',
  'rejected',
];

function acceptancePresentation(state: CustomerAcceptanceState): { status: BuildersStatus; label: string } {
  switch (state) {
    case 'accepted':
      return { status: 'success', label: CUSTOMER_ACCEPTANCE_LABELS.accepted };
    case 'accepted_with_conditions':
      return { status: 'warning', label: CUSTOMER_ACCEPTANCE_LABELS.accepted_with_conditions };
    case 'needs_revision':
      return { status: 'warning', label: CUSTOMER_ACCEPTANCE_LABELS.needs_revision };
    case 'rejected':
      return { status: 'error', label: CUSTOMER_ACCEPTANCE_LABELS.rejected };
    default:
      return { status: 'pending', label: CUSTOMER_ACCEPTANCE_LABELS.pending };
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ReleasePanel({ project, deployment, onReleaseChanged }: ReleasePanelProps) {
  const [latest, setLatest] = useState<ReleaseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAcceptance, setShowAcceptance] = useState(false);
  const [showRelease, setShowRelease] = useState(false);

  const [releaseType, setReleaseType] = useState<ReleaseType>('minor');
  const [version, setVersion] = useState('');
  const [releaseName, setReleaseName] = useState('');

  const [acceptanceState, setAcceptanceState] = useState<CustomerAcceptanceState>('accepted');
  const [acceptanceNotes, setAcceptanceNotes] = useState('');

  const deploymentId = deployment.id;

  const reload = useCallback(async () => {
    setLatest(await deploymentRepository.getLatestRelease(deploymentId));
  }, [deploymentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    deploymentRepository
      .getLatestRelease(deploymentId)
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

  const canRelease = ['delivery_ready', 'released', 'maintenance'].includes(deployment.status);
  const hasRelease = latest !== null;

  function openCreateDialog() {
    const suggested = suggestReleaseVersion(latest?.semanticVersion, releaseType);
    setVersion(suggested);
    setReleaseName('');
    setShowCreate(true);
  }

  function handleTypeChange(nextType: ReleaseType) {
    setReleaseType(nextType);
    setVersion(suggestReleaseVersion(latest?.semanticVersion, nextType));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);

    try {
      const result = await createProjectRelease({
        project,
        semanticVersion: version,
        releaseType,
        releaseName: releaseName || undefined,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      setShowCreate(false);
      await reload();
      onReleaseChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The release could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptance(event: React.FormEvent) {
    event.preventDefault();

    if (busy || !latest) {
      return;
    }

    setBusy(true);

    try {
      const result = await recordReleaseAcceptance({
        releaseId: latest.id,
        state: acceptanceState,
        notes: acceptanceNotes || undefined,
        conditions: acceptanceState === 'accepted_with_conditions' && acceptanceNotes ? [acceptanceNotes] : undefined,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      setShowAcceptance(false);
      setAcceptanceNotes('');
      await reload();
      onReleaseChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The customer response could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const acceptance = latest ? acceptancePresentation(latest.customerAcceptance.state) : null;

  return (
    <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:rocket-launch-duotone h-4 w-4 text-bolt-elements-textSecondary" />
          <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">Release</h4>
        </div>
        {hasRelease && (
          <BuildersStatusBadge
            status={latest?.releaseStatus === 'released' ? 'success' : 'completed'}
            label={latest?.releaseStatus === 'released' ? 'Released' : 'Superseded'}
            compact
          />
        )}
      </div>

      {loading ? (
        <div className="h-12 rounded-lg bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : !hasRelease ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          No release has been created yet. A release freezes this delivery as the immutable baseline every future change
          will be measured against.
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Version</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latest?.semanticVersion} · {RELEASE_TYPE_LABELS[latest!.releaseType]}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Release Date</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latest?.releaseDate ? formatTimestamp(latest.releaseDate) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Acceptance</span>
            {acceptance && <BuildersStatusBadge {...acceptance} compact />}
          </div>
          {latest?.baseline?.deploymentUrl && (
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Released URL</span>
              <span className="text-bolt-elements-textPrimary font-mono text-[11px] truncate max-w-[60%]">
                {latest.baseline.deploymentUrl}
              </span>
            </div>
          )}
          {latest?.releaseNotes?.summary && (
            <div className="rounded-lg border border-bolt-elements-borderColor/40 p-2.5 text-xs text-bolt-elements-textSecondary">
              {latest.releaseNotes.summary}
            </div>
          )}
        </div>
      )}

      <div className="pt-3 flex flex-wrap items-center gap-2">
        {canRelease && (
          <button
            type="button"
            onClick={openCreateDialog}
            disabled={busy}
            className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
          >
            {hasRelease ? 'Create Next Release' : 'Create Release'}
          </button>
        )}
        {hasRelease && (
          <button
            type="button"
            onClick={() => setShowAcceptance(true)}
            disabled={busy}
            className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
          >
            Customer Acceptance
          </button>
        )}
        {hasRelease && (
          <button
            type="button"
            onClick={() => setShowRelease(true)}
            className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
          >
            View Release
          </button>
        )}
      </div>

      {!canRelease && (
        <div className="pt-2 text-[11px] text-bolt-elements-textTertiary">
          A release can be created once a delivery package has been generated for this Deployment.
        </div>
      )}

      {showCreate && (
        <Dialog.Root open={showCreate} onOpenChange={(open) => !open && !busy && setShowCreate(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Create Release
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                This freezes the current delivery as an immutable baseline. Versions are never chosen for you — confirm
                or change the suggestion below.
              </Dialog.Description>

              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                    Release type
                  </div>
                  <div className="flex gap-2">
                    {(['major', 'minor', 'patch'] as ReleaseType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleTypeChange(type)}
                        className={buildersButtonVariants({
                          size: 'sm',
                          variant: releaseType === type ? 'primary' : 'outline',
                        })}
                      >
                        {RELEASE_TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">Version</span>
                  <input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.0.0"
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm font-mono text-bolt-elements-textPrimary"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">
                    Release name (optional)
                  </span>
                  <input
                    value={releaseName}
                    onChange={(event) => setReleaseName(event.target.value)}
                    placeholder={`v${version}`}
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    disabled={busy}
                    className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
                  >
                    {busy ? 'Creating…' : 'Create Release'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {showAcceptance && latest && (
        <Dialog.Root open={showAcceptance} onOpenChange={(open) => !open && !busy && setShowAcceptance(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Customer Acceptance — {latest.semanticVersion}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                Records the customer's decision against this release. Nothing about the delivered application changes.
              </Dialog.Description>

              <form onSubmit={handleAcceptance} className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {ACCEPTANCE_OPTIONS.map((state) => (
                    <button
                      key={state}
                      type="button"
                      onClick={() => setAcceptanceState(state)}
                      className={buildersButtonVariants({
                        size: 'sm',
                        variant: acceptanceState === state ? 'primary' : 'outline',
                      })}
                    >
                      {CUSTOMER_ACCEPTANCE_LABELS[state]}
                    </button>
                  ))}
                </div>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">
                    {acceptanceState === 'accepted_with_conditions' ? 'Conditions' : 'Notes (optional)'}
                  </span>
                  <textarea
                    value={acceptanceNotes}
                    onChange={(event) => setAcceptanceNotes(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAcceptance(false)}
                    disabled={busy}
                    className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
                  >
                    {busy ? 'Saving…' : 'Record Response'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {showRelease && latest && (
        <Dialog.Root open={showRelease} onOpenChange={(open) => !open && setShowRelease(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(48rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                {latest.releaseName} — {latest.semanticVersion}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                Release #{latest.releaseNumber} · {RELEASE_TYPE_LABELS[latest.releaseType]} ·{' '}
                {formatTimestamp(latest.releaseDate)} · {CUSTOMER_ACCEPTANCE_LABELS[latest.customerAcceptance.state]}
              </Dialog.Description>

              <div className="space-y-4 text-xs">
                <ReleaseSection title="Summary">
                  <div className="text-bolt-elements-textSecondary">{latest.releaseNotes.summary}</div>
                </ReleaseSection>

                {latest.releaseNotes.categories
                  .filter((group) => group.entries.length > 0)
                  .map((group) => (
                    <ReleaseSection
                      key={group.category}
                      title={`${RELEASE_NOTE_CATEGORY_LABELS[group.category]} (${group.entries.length})`}
                    >
                      <ul className="space-y-1">
                        {group.entries.map((noteEntry) => (
                          <li key={noteEntry.id}>
                            <span className="text-bolt-elements-textPrimary">{noteEntry.title}</span>
                            {noteEntry.detail && (
                              <span className="block text-[11px] text-bolt-elements-textSecondary">
                                {noteEntry.detail}
                              </span>
                            )}
                            <span className="block text-[10px] uppercase tracking-wide text-bolt-elements-textTertiary">
                              {noteEntry.source}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </ReleaseSection>
                  ))}

                {latest.releaseNotes.knownIssues.length > 0 && (
                  <ReleaseSection title={`Known Issues (${latest.releaseNotes.knownIssues.length})`}>
                    <ul className="space-y-1">
                      {latest.releaseNotes.knownIssues.map((issue) => (
                        <li key={issue.id}>
                          <span className="text-bolt-elements-textPrimary">{issue.title}</span>
                          {issue.detail && (
                            <span className="block text-[11px] text-bolt-elements-textSecondary">{issue.detail}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </ReleaseSection>
                )}

                <ReleaseSection title="Baseline">
                  <BaselineRow label="Deployment URL" value={latest.baseline.deploymentUrl} mono />
                  <BaselineRow label="Repository" value={latest.baseline.repositoryFullName} mono />
                  <BaselineRow label="Branch" value={latest.baseline.branch} />
                  <BaselineRow label="Commit" value={latest.baseline.gitCommit} mono />
                  <BaselineRow
                    label="Manifest"
                    value={latest.baseline.manifestVersion ? `v${latest.baseline.manifestVersion}` : undefined}
                  />
                  <BaselineRow
                    label="Delivery package"
                    value={
                      latest.baseline.deliveryPackageNumber ? `#${latest.baseline.deliveryPackageNumber}` : undefined
                    }
                  />
                  <BaselineRow
                    label="Verification"
                    value={
                      latest.baseline.verificationNumber
                        ? `#${latest.baseline.verificationNumber} (${latest.baseline.verificationStatus})`
                        : undefined
                    }
                  />
                  <BaselineRow label="Database" value={latest.baseline.supabaseProjectRef} mono />
                  <BaselineRow
                    label="Schema"
                    value={latest.baseline.schemaVersion ? `v${latest.baseline.schemaVersion}` : undefined}
                  />
                  <BaselineRow label="MVP" value={latest.baseline.mvpCode} />
                  <BaselineRow label="Checksum" value={latest.integrity.checksum} mono />
                </ReleaseSection>

                {latest.customerAcceptance.state !== 'pending' && (
                  <ReleaseSection title="Customer acceptance">
                    <BaselineRow label="Decision" value={CUSTOMER_ACCEPTANCE_LABELS[latest.customerAcceptance.state]} />
                    <BaselineRow
                      label="Recorded"
                      value={
                        latest.customerAcceptance.recordedAt
                          ? formatTimestamp(latest.customerAcceptance.recordedAt)
                          : undefined
                      }
                    />
                    <BaselineRow label="Notes" value={latest.customerAcceptance.notes} />
                    {latest.customerAcceptance.conditions.length > 0 && (
                      <ul className="mt-1 list-disc ml-4 text-[11px] text-bolt-elements-textSecondary">
                        {latest.customerAcceptance.conditions.map((condition) => (
                          <li key={condition}>{condition}</li>
                        ))}
                      </ul>
                    )}
                    {isAcceptedState(latest.customerAcceptance.state) && (
                      <div className="mt-1 text-[11px] text-bolt-elements-textTertiary">
                        Accepting a release records the customer's decision only — no engineering artifact changed.
                      </div>
                    )}
                  </ReleaseSection>
                )}
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

function ReleaseSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function BaselineRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
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
