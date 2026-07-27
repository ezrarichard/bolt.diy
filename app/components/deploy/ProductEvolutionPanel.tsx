import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { ReleaseRecord } from '~/lib/deployment/releaseTypes';
import {
  CHANGE_AREA_LABELS,
  CHANGE_CATEGORY_LABELS,
  CHANGE_PRIORITY_LABELS,
  CHANGE_STATUS_LABELS,
  type ChangeArea,
  type ChangeRequest,
  type ChangeRequestPriority,
} from '~/lib/evolution/changeRequestTypes';
import { evolutionRepository, type ChangeImpactRecord } from '~/lib/evolution/evolutionRepository';
import {
  COMPLEXITY_LEVEL_LABELS,
  RISK_LEVEL_LABELS,
  type ComplexityLevel,
  type RiskLevel,
} from '~/lib/evolution/impactTypes';
import { runImpactAnalysis } from '~/lib/services/evolutionRunner';
import type { Project } from '~/lib/stores/projects';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';

/**
 * Product Evolution Panel — Sprint 95, Parts 11/13.
 *
 * Displays only. Every change request, impact analysis and evolution plan rendered here is read
 * back from `builders_change_requests`/`builders_change_impact_analyses` — never component state
 * that survived a run. That is what satisfies Part 13: after a reload the panel re-reads both, so
 * requests, impact, risk, complexity and plans are all still there with no session state to rebuild.
 *
 * This component never analyses anything and never writes a record. It calls exactly two functions
 * — `evolutionRepository.createChangeRequest` and `runImpactAnalysis` — and re-reads afterwards.
 */

export interface ProductEvolutionPanelProps {
  project: Project;
  deployment: DeploymentWithProviders;
}

const AREA_OPTIONS: ChangeArea[] = [
  'ui',
  'backend',
  'database',
  'api',
  'authentication',
  'environment',
  'documentation',
];
const PRIORITY_OPTIONS: ChangeRequestPriority[] = ['low', 'medium', 'high', 'urgent'];

function riskPresentation(level: RiskLevel): { status: BuildersStatus; label: string } {
  switch (level) {
    case 'critical':
      return { status: 'error', label: RISK_LEVEL_LABELS.critical };
    case 'high':
      return { status: 'error', label: RISK_LEVEL_LABELS.high };
    case 'medium':
      return { status: 'warning', label: RISK_LEVEL_LABELS.medium };
    default:
      return { status: 'success', label: RISK_LEVEL_LABELS.low };
  }
}

function complexityPresentation(level: ComplexityLevel): { status: BuildersStatus; label: string } {
  switch (level) {
    case 'very_large':
    case 'large':
      return { status: 'warning', label: COMPLEXITY_LEVEL_LABELS[level] };
    default:
      return { status: 'info', label: COMPLEXITY_LEVEL_LABELS[level] };
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ProductEvolutionPanel({ project, deployment }: ProductEvolutionPanelProps) {
  const [release, setRelease] = useState<ReleaseRecord | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [analyses, setAnalyses] = useState<ChangeImpactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [businessReason, setBusinessReason] = useState('');
  const [priority, setPriority] = useState<ChangeRequestPriority>('medium');
  const [areas, setAreas] = useState<ChangeArea[]>([]);

  const deploymentId = deployment.id;

  const reload = useCallback(async () => {
    const [latestRelease, changeRequests, impactAnalyses] = await Promise.all([
      deploymentRepository.getLatestRelease(deploymentId),
      evolutionRepository.listChangeRequests(deploymentId),
      evolutionRepository.listImpactAnalyses(deploymentId),
    ]);

    setRelease(latestRelease);
    setRequests(changeRequests);
    setAnalyses(impactAnalyses);
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

  const hasRelease = release !== null && release.releaseStatus === 'released';

  /** Each request's most recent analysis — the list is already ordered newest-first per request. */
  const latestAnalysisFor = (requestId: string) => analyses.find((analysis) => analysis.changeRequestId === requestId);

  function toggleArea(area: ChangeArea) {
    setAreas((current) => (current.includes(area) ? current.filter((entry) => entry !== area) : [...current, area]));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (busy || !release) {
      return;
    }

    setBusy(true);

    try {
      const result = await evolutionRepository.createChangeRequest({
        projectId: project.id,
        deploymentId,
        releaseId: release.id,
        releaseVersion: release.semanticVersion,
        title,
        description,
        businessReason: businessReason || undefined,
        priority,
        category: 'unknown',
        scope: 'unknown',
        declaredAreas: areas,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(`Change request #${result.request.requestNumber} raised.`);
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setBusinessReason('');
      setAreas([]);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The change request could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyse(request: ChangeRequest) {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      const result = await runImpactAnalysis({ project, request });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The impact analysis could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const openRequest = requests.find((request) => request.id === openRequestId);
  const openAnalysis = openRequestId ? latestAnalysisFor(openRequestId) : undefined;

  return (
    <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:tree-structure-duotone h-4 w-4 text-bolt-elements-textSecondary" />
          <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">
            Product Evolution
          </h4>
        </div>
        {hasRelease && <BuildersStatusBadge status="info" label={`Baseline ${release?.semanticVersion}`} compact />}
      </div>

      {loading ? (
        <div className="h-12 rounded-lg bg-bolt-elements-background-depth-2/60 animate-pulse" />
      ) : !hasRelease ? (
        <div className="text-xs text-bolt-elements-textTertiary">
          Product Evolution measures change against a released baseline. Create a release before raising change
          requests.
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Active Release</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {release?.semanticVersion} · {release?.releaseName}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Change Requests</span>
            <span className="text-bolt-elements-textPrimary text-xs">{requests.length}</span>
          </div>

          {requests.length === 0 ? (
            <div className="text-xs text-bolt-elements-textTertiary">
              No change requests have been raised against this release yet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {requests.map((request) => {
                const analysis = latestAnalysisFor(request.id);

                return (
                  <li key={request.id} className="rounded-lg border border-bolt-elements-borderColor/40 p-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-xs font-medium text-bolt-elements-textPrimary">
                          #{request.requestNumber} {request.title}
                        </span>
                        <span className="block text-[11px] text-bolt-elements-textTertiary">
                          {CHANGE_STATUS_LABELS[request.status]} · {CHANGE_PRIORITY_LABELS[request.priority]} priority
                          {analysis ? ` · ${CHANGE_CATEGORY_LABELS[analysis.classification]}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {analysis && <BuildersStatusBadge {...riskPresentation(analysis.riskLevel)} compact />}
                        {analysis && (
                          <BuildersStatusBadge {...complexityPresentation(analysis.complexityLevel)} compact />
                        )}
                      </div>
                    </div>

                    {analysis && (
                      <div className="mt-1 text-[11px] text-bolt-elements-textSecondary">
                        {analysis.impact?.summary?.affectedSections ?? 0} impact area(s) ·{' '}
                        {analysis.impact?.summary?.affectedFeatures ?? 0} feature(s) ·{' '}
                        {analysis.impact?.summary?.affectedFiles ?? 0} file(s)
                        {analysis.requiresHumanReview && ' · needs engineer review'}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      {request.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleAnalyse(request)}
                          disabled={busy}
                          className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                        >
                          {analysis ? 'Re-analyse' : 'Analyse Impact'}
                        </button>
                      )}
                      {analysis && (
                        <button
                          type="button"
                          onClick={() => setOpenRequestId(request.id)}
                          className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                        >
                          View Analysis
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {hasRelease && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={busy}
            className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
          >
            Raise Change Request
          </button>
        </div>
      )}

      {showCreate && release && (
        <Dialog.Root open={showCreate} onOpenChange={(open) => !open && !busy && setShowCreate(false)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(32rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                Raise Change Request
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                Raised against release {release.semanticVersion}. Impact analysis matches this text against the released
                features, pages and tables — naming them makes the analysis far more precise.
              </Dialog.Description>

              <form onSubmit={handleCreate} className="space-y-3">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">Title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Allow patients to cancel an appointment"
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">
                    Business reason (optional)
                  </span>
                  <textarea
                    value={businessReason}
                    onChange={(event) => setBusinessReason(event.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                </label>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                    Priority
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PRIORITY_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setPriority(option)}
                        className={buildersButtonVariants({
                          size: 'sm',
                          variant: priority === option ? 'primary' : 'outline',
                        })}
                      >
                        {CHANGE_PRIORITY_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary mb-1">
                    Affected areas (optional)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AREA_OPTIONS.map((area) => (
                      <button
                        key={area}
                        type="button"
                        onClick={() => toggleArea(area)}
                        className={buildersButtonVariants({
                          size: 'sm',
                          variant: areas.includes(area) ? 'primary' : 'outline',
                        })}
                      >
                        {CHANGE_AREA_LABELS[area]}
                      </button>
                    ))}
                  </div>
                </div>

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
                    {busy ? 'Saving…' : 'Raise Request'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {openRequest && openAnalysis && (
        <Dialog.Root open onOpenChange={(open) => !open && setOpenRequestId(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(50rem,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5 shadow-xl">
              <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary mb-1">
                #{openRequest.requestNumber} {openRequest.title}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-bolt-elements-textTertiary mb-4">
                Analysis #{openAnalysis.analysisNumber} against release {openAnalysis.releaseVersion} ·{' '}
                {CHANGE_CATEGORY_LABELS[openAnalysis.classification]} · {RISK_LEVEL_LABELS[openAnalysis.riskLevel]} risk
                · {COMPLEXITY_LEVEL_LABELS[openAnalysis.complexityLevel]} · {formatTimestamp(openAnalysis.analysedAt)}
              </Dialog.Description>

              {openAnalysis.requiresHumanReview && (
                <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px] text-bolt-elements-textSecondary">
                  This analysis is deterministic matching against the released baseline, not an understanding of intent.
                  Confirm the affected areas with an engineer before planning work.
                </div>
              )}

              <div className="space-y-4 text-xs">
                <EvolutionSection title="Affected areas">
                  {(openAnalysis.impact?.sections ?? [])
                    .filter((section) => section.affected)
                    .map((section) => (
                      <div key={section.id} className="mb-2">
                        <div className="text-bolt-elements-textPrimary font-medium">{section.label}</div>
                        <div className="text-[11px] text-bolt-elements-textSecondary">{section.detail}</div>
                        {section.items.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5">
                            {section.items.map((item) => (
                              <li key={`${item.kind}:${item.identifier}`} className="text-[11px]">
                                <span className="font-mono text-bolt-elements-textPrimary">{item.identifier}</span>
                                <span className="ml-1 text-bolt-elements-textTertiary">
                                  — {item.evidence} ({item.confidence} confidence)
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                </EvolutionSection>

                {(openAnalysis.impact?.unaffectedAreas ?? []).length > 0 && (
                  <EvolutionSection title="Can remain untouched">
                    <ul className="space-y-0.5">
                      {openAnalysis.impact.unaffectedAreas.map((area) => (
                        <li key={area.area} className="text-[11px] text-bolt-elements-textSecondary">
                          <span className="text-bolt-elements-textPrimary">{CHANGE_AREA_LABELS[area.area]}</span> —{' '}
                          {area.detail}
                        </li>
                      ))}
                    </ul>
                  </EvolutionSection>
                )}

                <EvolutionSection title={`Risk — ${RISK_LEVEL_LABELS[openAnalysis.riskLevel]}`}>
                  <div className="text-[11px] text-bolt-elements-textSecondary">
                    {openAnalysis.impact?.risk?.reasoning}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {(openAnalysis.impact?.risk?.factors ?? []).map((factor) => (
                      <li key={factor.id} className="text-[11px]">
                        <span className="text-bolt-elements-textPrimary">{factor.label}</span>
                        <span className="block text-bolt-elements-textTertiary">{factor.detail}</span>
                      </li>
                    ))}
                  </ul>
                </EvolutionSection>

                <EvolutionSection title={`Complexity — ${COMPLEXITY_LEVEL_LABELS[openAnalysis.complexityLevel]}`}>
                  <div className="text-[11px] text-bolt-elements-textSecondary">
                    {openAnalysis.impact?.complexity?.reasoning}
                  </div>
                </EvolutionSection>

                {openAnalysis.evolutionPlan && (
                  <>
                    <EvolutionSection title="Evolution plan">
                      <div className="text-[11px] text-bolt-elements-textSecondary mb-1">
                        {openAnalysis.evolutionPlan.summary}
                      </div>
                      <div className="text-[11px] text-bolt-elements-textPrimary">
                        {openAnalysis.evolutionPlan.suggestedMvp.label}
                      </div>
                      <div className="text-[11px] text-bolt-elements-textTertiary">
                        {openAnalysis.evolutionPlan.suggestedMvp.reasoning}
                      </div>
                    </EvolutionSection>

                    <EvolutionSection title="Roles and phases">
                      <ul className="space-y-0.5">
                        {openAnalysis.evolutionPlan.requiredRoles.map((role) => (
                          <li key={role.role} className="text-[11px]">
                            <span className="text-bolt-elements-textPrimary">{role.label}</span>
                            <span className="block text-bolt-elements-textTertiary">{role.reason}</span>
                          </li>
                        ))}
                      </ul>
                      <ol className="mt-1.5 list-decimal ml-4 space-y-0.5">
                        {openAnalysis.evolutionPlan.estimatedPhases.map((phase) => (
                          <li key={phase.id} className="text-[11px] text-bolt-elements-textSecondary">
                            <span className="text-bolt-elements-textPrimary">{phase.name}</span> — {phase.detail}
                          </li>
                        ))}
                      </ol>
                    </EvolutionSection>

                    <EvolutionSection title="Out of scope for this plan">
                      <ul className="list-disc ml-4 space-y-0.5">
                        {openAnalysis.evolutionPlan.futureScope.map((entry) => (
                          <li key={entry} className="text-[11px] text-bolt-elements-textTertiary">
                            {entry}
                          </li>
                        ))}
                      </ul>
                    </EvolutionSection>
                  </>
                )}

                <EvolutionSection title="Reasoning">
                  <ol className="list-decimal ml-4 space-y-0.5">
                    {(openAnalysis.impact?.reasoning ?? []).map((line) => (
                      <li key={line} className="text-[11px] text-bolt-elements-textSecondary">
                        {line}
                      </li>
                    ))}
                  </ol>
                </EvolutionSection>
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

function EvolutionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bolt-elements-textTertiary mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}
