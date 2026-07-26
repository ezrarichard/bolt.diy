import { useEffect, useState } from 'react';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type {
  DeploymentHistoryEvent,
  DeploymentStatus,
  DeploymentWithProviders,
} from '~/lib/deployment/deploymentTypes';
import { BuildersStatusBadge, buildersButtonVariants, type BuildersStatus } from '~/components/ui/builders';

/**
 * Deployment Status Card — Sprint 88 (GitHub Product Integration), Part 6.
 *
 * The Project Dashboard's ONLY source for deployment/provider information — everything shown
 * here comes from `deploymentRepository.getDeploymentWithProviders`/`getDeploymentHistory`, never
 * from `github_connection`/`github-repo-*` localStorage or any other legacy store. Reading from
 * BuildersDB on every mount is also what satisfies Part 7's "reopen the project, repository
 * reconnects automatically, no manual reconnect" requirement — there is no session-local
 * "connected" flag to restore; the persisted Deployment row already knows.
 */

export interface DeploymentStatusCardProps {
  projectId: string;
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

export function DeploymentStatusCard({ projectId }: DeploymentStatusCardProps) {
  const [deployment, setDeployment] = useState<DeploymentWithProviders | null>(null);
  const [history, setHistory] = useState<DeploymentHistoryEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      const result = await deploymentRepository.getDeploymentWithProviders(projectId);

      if (cancelled) {
        return;
      }

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
  }, [projectId]);

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

  const deploymentPresentation = deploymentStatusPresentation(deployment.status);
  const { github } = deployment;
  const latestPush = findLatestEvent(history, ['push_successful']);
  const latestCommit = findLatestEvent(history, ['push_successful', 'repository_connected', 'repository_updated']);

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
    </div>
  );
}
