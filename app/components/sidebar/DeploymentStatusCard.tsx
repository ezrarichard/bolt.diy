import { useEffect, useState } from 'react';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type {
  DeploymentHistoryEvent,
  DeploymentStatus,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';
import type { Project } from '~/lib/stores/projects';
import { assessSupabaseReadiness } from '~/lib/services/supabaseDeployService';
import { assessEnvironmentReadiness } from '~/lib/services/environmentReadinessService';
import { getActiveApplicationManifest } from '~/lib/application-manifest/applicationManifestRepository';
import { VercelDeployDialog } from '~/components/deploy/VercelDeployDialog';
import { DeploymentVerificationPanel } from '~/components/deploy/DeploymentVerificationPanel';
import { DeliveryPackagePanel } from '~/components/deploy/DeliveryPackagePanel';
import { ReleasePanel } from '~/components/deploy/ReleasePanel';
import { ProductEvolutionPanel } from '~/components/deploy/ProductEvolutionPanel';
import { IncrementalEngineeringPanel } from '~/components/deploy/IncrementalEngineeringPanel';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';

/**
 * Deployment Status Card — Sprint 88 (GitHub Product Integration), extended Sprint 89 (Supabase
 * Product Integration) and Sprint 90 (Environment & Runtime Configuration), Part 7.
 *
 * The Project Dashboard's ONLY source for deployment/provider information — everything shown here
 * comes from `deploymentRepository.getDeploymentWithProviders`/`getDeploymentHistory` (never from
 * `github_connection`/`github-repo-*` localStorage), plus `assessSupabaseReadiness` (project's
 * approved structured schema) and `assessEnvironmentReadiness` (the connected GitHub/Supabase
 * provider rows plus the active Application Manifest's `environmentRequirements` — the ONLY
 * BuildersDB read this component makes outside the Deployment domain, since that list of variable
 * NAMES has no other owner). Never legacy `Project.databaseActivation` connection identity, which
 * Sprint 89 keeps as the schema/provisioning workflow's own state, not a second source of
 * Deployment truth (see `supabaseDeployService.ts`'s header comment). Reading from BuildersDB on
 * every mount is also what satisfies Part 7 (Sprint 88)/Part 10 (Sprint 89)/Part 8 (Sprint 90)'s
 * "reopen the project, connection/environment state remains available, no manual reconnect"
 * requirement — there is no session-local "ready" flag to restore; the persisted Deployment row
 * already knows.
 */

export interface DeploymentStatusCardProps {
  project: Project;
}

function deploymentStatusPresentation(status: DeploymentStatus): { status: BuildersStatus; label: string } {
  switch (status) {
    case 'planning':
      return { status: 'pending', label: 'Planning' };
    case 'engineering':
      return { status: 'working', label: 'Engineering' };
    case 'generated':
      return { status: 'working', label: 'Generated' };
    case 'repository_connected':
      return { status: 'active', label: 'Repository Connected' };
    case 'database_connected':
      return { status: 'active', label: 'Database Connected' };
    case 'environment_ready':
      return { status: 'active', label: 'Environment Ready' };
    case 'deploying':
      return { status: 'working', label: 'Deploying' };
    case 'deployed':
      return { status: 'active', label: 'Deployed' };
    case 'verified':
      return { status: 'active', label: 'Verified' };
    case 'delivery_ready':
      return { status: 'success', label: 'Delivery Ready' };
    case 'released':
      return { status: 'success', label: 'Released' };
    case 'maintenance':
      return { status: 'info', label: 'Maintenance' };
    case 'archived':
      return { status: 'completed', label: 'Archived' };
    case 'failed':
      return { status: 'error', label: 'Failed' };
    default:
      return { status: 'pending', label: status };
  }
}

function findLatestEvent(history: DeploymentHistoryEvent[], eventTypes: string[]): DeploymentHistoryEvent | undefined {
  return history.find((event) => eventTypes.includes(event.eventType));
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function DeploymentStatusCard({ project }: DeploymentStatusCardProps) {
  const projectId = project.id;
  const [deployment, setDeployment] = useState<DeploymentWithProviders | null>(null);
  const [history, setHistory] = useState<DeploymentHistoryEvent[]>([]);
  const [manifest, setManifest] = useState<ApplicationManifest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [showVercelDialog, setShowVercelDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      const [result, activeManifest] = await Promise.all([
        deploymentRepository.getDeploymentWithProviders(projectId),
        getActiveApplicationManifest(projectId),
      ]);

      if (cancelled) {
        return;
      }

      setManifest(activeManifest);

      if (!result) {
        setDeployment(null);
        setHistory([]);
        setStatus('ready');

        return;
      }

      const historyResult = await deploymentRepository.getDeploymentHistory(result.id);

      if (cancelled) {
        return;
      }

      setDeployment(result);
      setHistory(historyResult);
      setStatus('ready');
    })().catch(() => {
      if (!cancelled) {
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  if (status === 'loading') {
    return <div className="h-24 rounded-xl bg-bolt-elements-background-depth-2/60 animate-pulse" />;
  }

  if (status === 'error') {
    return null;
  }

  if (!deployment) {
    return (
      <div className="rounded-xl border border-dashed border-bolt-elements-borderColor/60 p-4 text-center">
        <span className="i-ph:github-logo h-6 w-6 text-bolt-elements-textTertiary mx-auto mb-2 block" />
        <div className="text-sm text-bolt-elements-textSecondary">No deployment yet</div>
        <div className="text-xs text-bolt-elements-textTertiary mt-1">
          Connect a repository from Deploy → GitHub to start this project's Deployment.
        </div>
      </div>
    );
  }

  const environmentRequirements = manifest?.environmentRequirements ?? [];
  const deploymentPresentation = deploymentStatusPresentation(deployment.status);
  const { github, supabase } = deployment;
  const latestPush = findLatestEvent(history, ['push_successful']);
  const latestCommit = findLatestEvent(history, ['push_successful', 'repository_connected', 'repository_updated']);
  const latestSchemaApplication = findLatestEvent(history, ['database_connected', 'database_updated']);
  const readiness = assessSupabaseReadiness(project);
  const missingReadinessItems = readiness.items.filter((item) => !item.ready);
  const isRealSupabaseMode = project.databaseActivation?.provisioning?.provider === 'supabase';
  const environmentReport = assessEnvironmentReadiness({
    environmentRequirements,
    github: deployment.github,
    supabase: deployment.supabase,
  });
  const isEnvironmentReady =
    deployment.status === 'environment_ready' ||
    ['deploying', 'deployed', 'verified', 'delivery_ready', 'released', 'maintenance', 'archived'].includes(
      deployment.status,
    );
  const { vercel } = deployment;
  const canDeployToVercel = deployment.status === 'environment_ready' || deployment.status === 'failed';
  const isDeploying = deployment.status === 'deploying';
  const latestDeploymentUrl = (vercel?.metadata?.latestDeploymentUrl as string | undefined) ?? vercel?.productionUrl;
  const latestDeploymentState = vercel?.metadata?.latestDeploymentState as string | undefined;
  const latestDeploymentAt = vercel?.metadata?.latestDeploymentAt as string | undefined;

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-5 bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="i-ph:github-logo h-4 w-4 text-bolt-elements-textSecondary" />
          <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">Deployment</h3>
        </div>
        <BuildersStatusBadge status={deploymentPresentation.status} label={deploymentPresentation.label} />
      </div>

      {github ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Repository</span>
            <span className="text-bolt-elements-textPrimary font-mono text-xs">
              {github.repoFullName ?? `${github.repoOwner ?? '?'}/${github.repoName ?? '?'}`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Owner</span>
            <span className="text-bolt-elements-textPrimary text-xs">{github.repoOwner ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Branch</span>
            <span className="text-bolt-elements-textPrimary text-xs">{github.defaultBranch}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Connection</span>
            <BuildersStatusBadge
              status={github.status === 'connected' ? 'success' : github.status === 'error' ? 'error' : 'pending'}
              label={github.status === 'connected' ? 'Connected' : github.status === 'error' ? 'Error' : 'Pending'}
              compact
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Latest Commit</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latestCommit ? formatTimestamp(latestCommit.createdAt) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Latest Push</span>
            <span className="text-bolt-elements-textPrimary text-xs">
              {latestPush ? formatTimestamp(latestPush.createdAt) : '—'}
            </span>
          </div>

          {github.repoUrl && (
            <div className="pt-2">
              <a
                href={github.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
              >
                Open Repository
              </a>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-bolt-elements-textTertiary">No GitHub repository connected yet.</div>
      )}

      <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="i-ph:database-duotone h-4 w-4 text-bolt-elements-textSecondary" />
            <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">Supabase</h4>
          </div>
          <BuildersStatusBadge
            status={isRealSupabaseMode ? 'success' : 'info'}
            label={isRealSupabaseMode ? 'Real' : 'Simulated'}
            compact
          />
        </div>

        {supabase ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Project</span>
              <span className="text-bolt-elements-textPrimary font-mono text-xs">
                {(supabase.metadata?.projectName as string | undefined) ?? supabase.supabaseProjectRef ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Region</span>
              <span className="text-bolt-elements-textPrimary text-xs">{supabase.region ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Connection</span>
              <BuildersStatusBadge
                status={supabase.status === 'connected' ? 'success' : supabase.status === 'error' ? 'error' : 'pending'}
                label={
                  supabase.status === 'connected' ? 'Connected' : supabase.status === 'error' ? 'Error' : 'Pending'
                }
                compact
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Schema Version</span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {supabase.metadata?.schemaVersion ? `v${supabase.metadata.schemaVersion}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">
                Last Schema Applied
              </span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {latestSchemaApplication ? formatTimestamp(latestSchemaApplication.createdAt) : '—'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-bolt-elements-textTertiary">No Supabase database connected yet.</div>
        )}

        {missingReadinessItems.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
              Missing Readiness Items
            </div>
            <ul className="space-y-0.5">
              {missingReadinessItems.map((item) => (
                <li key={item.key} className="text-xs text-bolt-elements-textSecondary">
                  <span className="font-medium text-bolt-elements-textPrimary">{item.label}</span> — {item.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="i-ph:gear-duotone h-4 w-4 text-bolt-elements-textSecondary" />
            <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">
              Environment
            </h4>
          </div>
          <BuildersStatusBadge
            status={isEnvironmentReady ? 'success' : 'pending'}
            label={isEnvironmentReady ? 'Environment Ready' : 'Not Ready'}
            compact
          />
        </div>

        {environmentReport.variables.length === 0 ? (
          <div className="text-xs text-bolt-elements-textTertiary">
            This project's Application Manifest declares no environment variables to configure.
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">
                Resolved Variables
              </span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {environmentReport.resolvedVariables.length} / {environmentReport.variables.length}
              </span>
            </div>

            {environmentReport.missingVariables.length > 0 && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                  Missing Variables
                </div>
                <ul className="space-y-0.5">
                  {environmentReport.missingVariables.map((variable) => (
                    <li key={variable.name} className="text-xs text-bolt-elements-textSecondary">
                      <span className="font-mono font-medium text-bolt-elements-textPrimary">{variable.name}</span>
                      {variable.sensitive && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          (sensitive)
                        </span>
                      )}{' '}
                      — {variable.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {environmentReport.manualVariables.length > 0 && (
              <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
                  Manual Actions Required
                </div>
                <ul className="space-y-0.5">
                  {environmentReport.manualVariables.map((variable) => (
                    <li key={variable.name} className="text-xs text-bolt-elements-textSecondary">
                      <span className="font-mono font-medium text-bolt-elements-textPrimary">{variable.name}</span> —{' '}
                      {variable.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-bolt-elements-borderColor/30">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="i-ph:triangle-duotone h-4 w-4 text-bolt-elements-textSecondary" />
            <h4 className="text-xs font-semibold text-bolt-elements-textPrimary uppercase tracking-wide">Vercel</h4>
          </div>
          {vercel && (
            <BuildersStatusBadge
              status={vercel.status === 'connected' ? 'success' : vercel.status === 'error' ? 'error' : 'pending'}
              label={vercel.status === 'connected' ? 'Connected' : vercel.status === 'error' ? 'Error' : 'Pending'}
              compact
            />
          )}
        </div>

        {vercel ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Project</span>
              <span className="text-bolt-elements-textPrimary font-mono text-xs">
                {vercel.vercelProjectName ?? vercel.vercelProjectId ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Team</span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {(vercel.metadata?.teamId as string | undefined) ?? 'Personal account'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Framework</span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {(vercel.metadata?.framework as string | undefined) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Production Branch</span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {(vercel.metadata?.productionBranch as string | undefined) ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Latest Deployment</span>
              <span className="text-bolt-elements-textPrimary text-xs">{latestDeploymentState ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-bolt-elements-textTertiary text-xs uppercase tracking-wide">Deployed At</span>
              <span className="text-bolt-elements-textPrimary text-xs">
                {latestDeploymentAt ? formatTimestamp(latestDeploymentAt) : '—'}
              </span>
            </div>

            {latestDeploymentUrl && (
              <div className="pt-2">
                <a
                  href={latestDeploymentUrl.startsWith('http') ? latestDeploymentUrl : `https://${latestDeploymentUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buildersButtonVariants({ size: 'sm', variant: 'outline' })}
                >
                  Open Deployment
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-bolt-elements-textTertiary">Not connected to Vercel yet.</div>
        )}

        <div className="pt-3">
          {isDeploying ? (
            <BuildersStatusBadge status="working" label="Deploying…" />
          ) : (
            canDeployToVercel && (
              <button
                type="button"
                onClick={() => setShowVercelDialog(true)}
                className={buildersButtonVariants({ size: 'sm', variant: 'primary' })}
              >
                {deployment.status === 'failed' ? 'Retry Deployment' : 'Deploy to Vercel'}
              </button>
            )
          )}
        </div>
      </div>

      <DeploymentVerificationPanel
        deployment={deployment}
        manifest={manifest}
        onVerificationComplete={() => setReloadToken((token) => token + 1)}
      />

      <DeliveryPackagePanel
        project={project}
        deployment={deployment}
        onPackageGenerated={() => setReloadToken((token) => token + 1)}
      />

      <ReleasePanel
        project={project}
        deployment={deployment}
        onReleaseChanged={() => setReloadToken((token) => token + 1)}
      />

      <ProductEvolutionPanel project={project} deployment={deployment} />

      <IncrementalEngineeringPanel project={project} deployment={deployment} />

      {showVercelDialog && (
        <VercelDeployDialog
          isOpen={showVercelDialog}
          onClose={() => setShowVercelDialog(false)}
          project={project}
          deployment={deployment}
          environmentRequirements={environmentRequirements}
          onDeployed={() => setReloadToken((token) => token + 1)}
        />
      )}
    </div>
  );
}
