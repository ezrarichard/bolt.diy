import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import type { SupabaseProject } from '~/types/supabase';
import {
  connectSupabaseProject,
  disconnectSupabaseProject,
  generateDatabaseSchema,
  provisionDatabase,
  retryProvisionDatabase,
  validateDatabaseSchema,
  verifyDatabaseConnection,
} from '~/lib/database-activation/databaseActivationService';
import type { DatabaseProviderId } from '~/lib/database-activation/provisioning/databaseProvisioner';
import {
  connectSupabaseProvisioningSession,
  isSupabaseProvisioningConnected,
} from '~/lib/database-activation/provisioning/supabaseSessionCredentials';
import { syncSupabaseDeploymentAfterProvisioning } from '~/lib/services/supabaseDeployService';

interface DatabaseActivationCardProps {
  project: Project;
  className?: string;
}

type RunningAction = 'generate' | 'validate' | 'provision' | 'retry' | 'verify' | null;

const inputClass =
  'w-full px-2.5 py-1.5 rounded-lg text-xs bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-blue-500/50';

/*
 * Literal, non-templated class strings — UnoCSS/Tailwind's production build statically scans
 * source text for exact class names, so a templated `bg-${color}-500/10` helper would work in dev
 * but silently vanish from the production bundle (see the class-name audit that caught this).
 */
const BUTTON_CLASS = {
  blue: 'px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
  purple:
    'px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
  amber:
    'px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
  green:
    'px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
  red: 'px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
} as const;

/**
 * Database Activation Card — Sprint 75 (Real Backend Activation, Phase 1), extended Sprint 76
 * (Real Database Provisioning, Phase 2).
 *
 * Same footprint/visual style as RegionalProfileCard/PackageProfileCard, but action-driven
 * rather than a single `<select>`: each step (Connect, Generate Schema, Validate, Provision,
 * Retry, Verify/Refresh Connection) is an explicit button the user presses, never triggered
 * automatically — see Part 10's safety requirement. Reads `project.databaseActivation` (reactive
 * — the same `project` prop every other Workspace card reads) and calls into
 * databaseActivationService.ts, the only writer of that state.
 *
 * Sprint 76's Supabase Connect flow deliberately does NOT use the legacy `useSupabaseConnection`
 * hook/`supabaseConnection` store — it captures the Management PAT into the session-scoped
 * credential holder (`supabaseSessionCredentials.ts`) instead, per
 * docs/backend-activation/Provisioning-Architecture.md §4. The PAT never touches component state,
 * `Project`, or anything passed to `databaseActivationService` — only the selected project's
 * public id does.
 */
export function DatabaseActivationCard({ project, className }: DatabaseActivationCardProps) {
  const [running, setRunning] = useState<RunningAction>(null);
  const [provider, setProvider] = useState<DatabaseProviderId>(
    project.databaseActivation?.connectionConfig?.provider ?? 'mock',
  );
  const [tokenInput, setTokenInput] = useState('');
  const [availableProjects, setAvailableProjects] = useState<SupabaseProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);

  const sessionConnected = useStore(isSupabaseProvisioningConnected);
  const activation = project.databaseActivation;

  const runAction = async (action: RunningAction, fn: () => Promise<{ ok: boolean; message: string } | void>) => {
    setRunning(action);

    try {
      const result = await fn();

      if (result) {
        if (result.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      }
    } finally {
      setRunning(null);
    }
  };

  /**
   * Sprint 89 — after a REAL (non-mock) Supabase step succeeds, sync the Deployment domain
   * (`attachSupabase`, which itself validates the lifecycle transition, persists status, and
   * records the one canonical history event). Mock-provider results never reach this — see
   * `syncSupabaseDeploymentAfterProvisioning`'s own guard. A sync failure is surfaced as its own
   * toast rather than silently swallowed, without overriding the primary action's own success toast.
   */
  const syncDeploymentIfRealSupabase = async () => {
    if (provider !== 'supabase') {
      return;
    }

    const sync = await syncSupabaseDeploymentAfterProvisioning(project);

    if (!sync.ok) {
      toast.error(sync.message);
    }
  };

  const handleGenerate = () => runAction('generate', async () => generateDatabaseSchema(project));
  const handleValidate = () => runAction('validate', async () => validateDatabaseSchema(project));
  const handleProvision = () =>
    runAction('provision', async () => {
      const result = await provisionDatabase(project, provider);

      if (result.ok) {
        await syncDeploymentIfRealSupabase();
      }

      return result;
    });
  const handleRetry = () =>
    runAction('retry', async () => {
      const result = await retryProvisionDatabase(project);

      if (result.ok) {
        await syncDeploymentIfRealSupabase();
      }

      return result;
    });
  const handleVerify = () =>
    runAction('verify', async () => {
      const result = await verifyDatabaseConnection(project);

      if (result.ok) {
        await syncDeploymentIfRealSupabase();
      }

      return result;
    });

  const handleFetchProjects = async () => {
    if (!tokenInput.trim()) {
      toast.error('Paste your Supabase Management personal access token first.');
      return;
    }

    setIsFetchingProjects(true);

    try {
      const response = await fetch('/api/supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput }),
      });
      const data = (await response.json()) as { stats?: { projects: SupabaseProject[] }; error?: string };

      if (!response.ok || data.error) {
        toast.error(data.error ?? 'Failed to list Supabase projects — check your token.');
        return;
      }

      // Held in memory only for this tab from here on — never written to localStorage.
      connectSupabaseProvisioningSession(tokenInput);
      setTokenInput('');
      setAvailableProjects(data.stats?.projects ?? []);
    } catch {
      toast.error('Failed to reach Supabase — check your connection and try again.');
    } finally {
      setIsFetchingProjects(false);
    }
  };

  const handleSaveConnection = () => {
    if (!selectedProjectId) {
      toast.error('Select a project first.');
      return;
    }

    const selected = availableProjects.find((proj) => proj.id === selectedProjectId);
    const result = connectSupabaseProject(project, selectedProjectId, {
      projectName: selected?.name,
      region: selected?.region,
    });

    if (result.ok) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const handleDisconnect = () => {
    const result = disconnectSupabaseProject(project);
    setAvailableProjects([]);
    setSelectedProjectId('');

    if (result.ok) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const schemaStatus = activation?.schema ? `${activation.schema.tableCount} table(s) generated` : 'Not generated';
  const schemaVersionLabel = activation?.schema?.schemaVersion ? `v${activation.schema.schemaVersion}` : '—';
  const validationStatus = activation?.validation
    ? activation.validation.report.passed
      ? 'Passed'
      : `Failed (${activation.validation.report.errors.length})`
    : 'Not run';
  const provisioningStatus = activation?.provisioning ? activation.provisioning.status : 'Not started';
  const connectionStatus = activation?.connection
    ? activation.connection.verified
      ? 'Verified'
      : 'Not verified'
    : 'Not checked';

  const isConnectedToProject = provider === 'mock' || Boolean(activation?.connectionConfig?.projectId);
  const canValidate = Boolean(activation?.schema);
  const canProvision = Boolean(activation?.validation?.report.passed) && isConnectedToProject;
  const canRetry = activation?.provisioning?.status === 'failed';
  const canVerify = activation?.provisioning?.status === 'succeeded';

  const overallStatus = activation?.connection?.verified
    ? 'Connected'
    : activation?.provisioning?.status === 'succeeded'
      ? 'Provisioned'
      : activation?.validation?.report.passed
        ? 'Validated'
        : activation?.schema
          ? 'Schema generated'
          : 'Not started';

  return (
    <div
      className={classNames(
        'rounded-xl border border-bolt-elements-borderColor/40 dark:border-white/[0.06] p-4',
        'bg-[#F7F7F8]/90 dark:bg-[#161616]/80 backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 ring-1 ring-blue-500/15 shrink-0">
          <div className="i-ph:database-duotone w-4 h-4 text-blue-600/80 dark:text-blue-400/80" />
        </div>
        <div className="text-[13px] font-semibold text-bolt-elements-textPrimary">Database</div>
      </div>

      <div className="mb-3">
        <label className="block text-[11px] text-bolt-elements-textTertiary mb-1" htmlFor="database-provider-select">
          Provider
        </label>
        <select
          id="database-provider-select"
          value={provider}
          onChange={(event) => setProvider(event.target.value as DatabaseProviderId)}
          disabled={running !== null}
          className={inputClass}
        >
          <option value="mock">Mock (simulated — no real database)</option>
          <option value="supabase">Supabase (connect your own project)</option>
        </select>
      </div>

      {provider === 'supabase' && (
        <div className="mb-3 rounded-lg border border-bolt-elements-borderColor/30 p-2.5 space-y-2">
          {activation?.connectionConfig?.projectId ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-bolt-elements-textSecondary">
                Connected: <span className="font-medium">{activation.connectionConfig.projectId}</span>
              </div>
              <button type="button" onClick={handleDisconnect} className={BUTTON_CLASS.red}>
                Disconnect
              </button>
            </div>
          ) : sessionConnected && availableProjects.length > 0 ? (
            <div className="space-y-2">
              <select
                aria-label="Select Supabase project"
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a project…</option>
                {availableProjects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name} ({proj.id})
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleSaveConnection} className={BUTTON_CLASS.blue}>
                Use this project
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Supabase Management personal access token"
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleFetchProjects}
                disabled={isFetchingProjects}
                className={BUTTON_CLASS.blue}
              >
                {isFetchingProjects ? 'Fetching projects…' : 'Fetch my projects'}
              </button>
              <div className="text-[10px] leading-snug text-bolt-elements-textTertiary/80">
                Held in memory for this browser tab only — never saved to disk. Closing the tab or clicking Disconnect
                clears it.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-bolt-elements-textSecondary space-y-0.5 mb-3">
        <div>
          <span className="text-bolt-elements-textTertiary">Database Status: </span>
          {overallStatus}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Schema Status: </span>
          {schemaStatus} <span className="text-bolt-elements-textTertiary">({schemaVersionLabel})</span>
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Validation: </span>
          {validationStatus}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Provisioning Status: </span>
          {provisioningStatus}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Connected: </span>
          {isConnectedToProject ? 'Yes' : 'No'}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Connection Status: </span>
          {connectionStatus}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handleGenerate} disabled={running !== null} className={BUTTON_CLASS.blue}>
          {running === 'generate' ? 'Generating…' : 'Generate Schema'}
        </button>
        <button
          type="button"
          onClick={handleValidate}
          disabled={running !== null || !canValidate}
          className={BUTTON_CLASS.purple}
        >
          {running === 'validate' ? 'Validating…' : 'Validate'}
        </button>
        <button
          type="button"
          onClick={handleProvision}
          disabled={running !== null || !canProvision}
          className={BUTTON_CLASS.amber}
        >
          {running === 'provision' ? 'Provisioning…' : `Provision (${provider})`}
        </button>
        {canRetry && (
          <button type="button" onClick={handleRetry} disabled={running !== null} className={BUTTON_CLASS.amber}>
            {running === 'retry' ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <button
          type="button"
          onClick={handleVerify}
          disabled={running !== null || !canVerify}
          className={BUTTON_CLASS.green}
        >
          {running === 'verify' ? 'Verifying…' : activation?.connection ? 'Refresh' : 'Verify Connection'}
        </button>
      </div>

      <div className="text-[11px] leading-snug text-bolt-elements-textTertiary/80 mt-2.5">
        {provider === 'mock'
          ? 'Provisioning uses a simulated (mock) provider — no real database is created or modified.'
          : 'Provisioning executes real SQL against your own connected Supabase project. BuildersDB is never touched.'}
      </div>
    </div>
  );
}
