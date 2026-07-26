import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'react-toastify';
import type { DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { Project } from '~/lib/stores/projects';
import { assessEnvironmentReadiness } from '~/lib/services/environmentReadinessService';
import { deployToVercel } from '~/lib/services/vercelDeployService';
import {
  clearVercelSession,
  connectVercelSession,
  getVercelSessionToken,
} from '~/lib/services/vercelSessionCredentials';

/**
 * Vercel Deploy Dialog — Sprint 91, Part 13's "Deploy to Vercel" operator action.
 *
 * Deliberately thin (Part 3: "the UI should not contain a large inline Vercel API workflow") —
 * every real step (token validation, project create/connect, repo-identity check, env var
 * mapping, deploy, poll) lives in `vercelDeployService.ts`'s `deployToVercel`; this component only
 * collects the token and any required manual/sensitive variable values, shows bounded progress,
 * and clears all locally-held secret state on success, cancellation, AND failure (Part 5).
 */

export interface VercelDeployDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  deployment: DeploymentWithProviders;
  environmentRequirements: string[];

  /** Called after a successful deploy so the caller (DeploymentStatusCard) can refresh from the Deployment domain — this dialog never claims authority over what's displayed afterward. */
  onDeployed: () => void;
}

function slugifyProjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100) || 'my-app'
  );
}

export function VercelDeployDialog({
  isOpen,
  onClose,
  project,
  deployment,
  environmentRequirements,
  onDeployed,
}: VercelDeployDialogProps) {
  const [token, setToken] = useState('');
  const [teamId, setTeamId] = useState('');
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [isDeploying, setIsDeploying] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');

  const environmentReport = assessEnvironmentReadiness({
    environmentRequirements,
    github: deployment.github,
    supabase: deployment.supabase,
  });
  const variablesNeedingInput = environmentReport.variables.filter((variable) => variable.status !== 'resolved');
  const requiresSupabase = environmentRequirements.some((name) => name.startsWith('VITE_SUPABASE'));

  function resetSecretState() {
    setToken('');
    setManualValues({});
    clearVercelSession();
  }

  function handleClose() {
    if (isDeploying) {
      return;
    }

    resetSecretState();
    onClose();
  }

  async function handleDeploy(event: React.FormEvent) {
    event.preventDefault();

    if (!token.trim()) {
      toast.error('Enter your Vercel access token first.');
      return;
    }

    const missing = variablesNeedingInput.filter((variable) => !manualValues[variable.name]?.trim());

    if (missing.length > 0) {
      toast.error(`Provide a value for: ${missing.map((v) => v.name).join(', ')}`);
      return;
    }

    setIsDeploying(true);
    setProgressMessage('Validating Vercel credentials…');
    connectVercelSession(token);

    try {
      const activeToken = getVercelSessionToken();

      if (!activeToken) {
        toast.error('Vercel session token was cleared unexpectedly — try again.');
        return;
      }

      setProgressMessage('Creating/connecting the Vercel project…');

      const result = await deployToVercel({
        deployment,
        token: activeToken,
        teamId: teamId.trim() || undefined,
        projectName: slugifyProjectName(project.name),
        requiresSupabase,
        environmentReport,
        manualVariableValues: manualValues,
        target: 'preview',
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      setProgressMessage('Deployment ready.');
      toast.success(result.message);
      onDeployed();
      handleClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vercel deployment failed unexpectedly.');
    } finally {
      setIsDeploying(false);
      resetSecretState();
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]" />
        <div className="fixed inset-0 flex items-center justify-center z-[9999]">
          <Dialog.Content
            className="w-[90vw] md:w-[480px] bg-white dark:bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor-dark shadow-xl p-6"
            aria-describedby="vercel-deploy-description"
          >
            <Dialog.Title className="text-lg font-medium text-bolt-elements-textPrimary mb-1">
              Deploy to Vercel
            </Dialog.Title>
            <p id="vercel-deploy-description" className="text-sm text-bolt-elements-textSecondary mb-4">
              Creates or connects a Vercel project linked to {deployment.github?.repoFullName ?? 'this repository'} and
              triggers a preview deployment.
            </p>

            <form onSubmit={handleDeploy} className="space-y-3">
              <div>
                <label htmlFor="vercel-token" className="block text-xs text-bolt-elements-textSecondary mb-1">
                  Vercel Access Token
                </label>
                <input
                  id="vercel-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Personal access token"
                  className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-sm text-bolt-elements-textPrimary"
                />
                <p className="text-[11px] text-bolt-elements-textTertiary mt-1">
                  Held in memory for this tab only — never saved to disk.
                </p>
              </div>

              <div>
                <label htmlFor="vercel-team" className="block text-xs text-bolt-elements-textSecondary mb-1">
                  Team ID (optional)
                </label>
                <input
                  id="vercel-team"
                  type="text"
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value)}
                  placeholder="team_xxxxxxxx"
                  className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-sm text-bolt-elements-textPrimary"
                />
              </div>

              {variablesNeedingInput.map((variable) => (
                <div key={variable.name}>
                  <label
                    htmlFor={`vercel-var-${variable.name}`}
                    className="block text-xs text-bolt-elements-textSecondary mb-1"
                  >
                    {variable.name}
                    {variable.sensitive && <span className="ml-1 text-amber-600 dark:text-amber-400">(sensitive)</span>}
                  </label>
                  <input
                    id={`vercel-var-${variable.name}`}
                    type={variable.sensitive ? 'password' : 'text'}
                    autoComplete="off"
                    value={manualValues[variable.name] ?? ''}
                    onChange={(event) => setManualValues((prev) => ({ ...prev, [variable.name]: event.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-sm text-bolt-elements-textPrimary"
                  />
                  <p className="text-[11px] text-bolt-elements-textTertiary mt-1">{variable.detail}</p>
                </div>
              ))}

              {isDeploying && (
                <div className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary">
                  <span className="i-ph:spinner-gap animate-spin w-4 h-4" />
                  {progressMessage}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isDeploying}
                  className="px-4 py-2 rounded-lg text-sm bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary border border-bolt-elements-borderColor disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeploying}
                  className="px-4 py-2 rounded-lg text-sm bg-black text-white disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {isDeploying ? 'Deploying…' : 'Deploy to Vercel'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
