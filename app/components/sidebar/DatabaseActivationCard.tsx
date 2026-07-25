import { useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import type { Project } from '~/lib/stores/projects';
import {
  generateDatabaseSchema,
  provisionDatabase,
  validateDatabaseSchema,
  verifyDatabaseConnection,
} from '~/lib/database-activation/databaseActivationService';

interface DatabaseActivationCardProps {
  project: Project;
  className?: string;
}

type RunningAction = 'generate' | 'validate' | 'provision' | 'verify' | null;

/**
 * Database Activation Card — Sprint 75 (Real Backend Activation, Phase 1).
 *
 * Same footprint/visual style as RegionalProfileCard/PackageProfileCard, but action-driven
 * rather than a `<select>`: each step (Generate Schema, Validate, Provision, Verify Connection)
 * is an explicit button the user presses, never triggered automatically — see Part 10's safety
 * requirement. Reads `project.databaseActivation` (reactive — the same `project` prop every
 * other Workspace card reads) and calls into databaseActivationService.ts, the only writer of
 * that state.
 */
export function DatabaseActivationCard({ project, className }: DatabaseActivationCardProps) {
  const [running, setRunning] = useState<RunningAction>(null);
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

  const handleGenerate = () => runAction('generate', async () => generateDatabaseSchema(project));
  const handleValidate = () => runAction('validate', async () => validateDatabaseSchema(project));
  const handleProvision = () => runAction('provision', () => provisionDatabase(project, 'mock'));
  const handleVerify = () => runAction('verify', () => verifyDatabaseConnection(project));

  const schemaStatus = activation?.schema ? `${activation.schema.tableCount} table(s) generated` : 'Not generated';
  const validationStatus = activation?.validation
    ? activation.validation.report.passed
      ? 'Passed'
      : `Failed (${activation.validation.report.errors.length})`
    : 'Not run';
  const provisioningStatus = activation?.provisioning ? activation.provisioning.status : 'Not started';
  const providerLabel = activation?.provisioning?.provider ?? 'mock';
  const connectionStatus = activation?.connection
    ? activation.connection.verified
      ? 'Verified'
      : 'Not verified'
    : 'Not checked';

  const canValidate = Boolean(activation?.schema);
  const canProvision = Boolean(activation?.validation?.report.passed);
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

      <div className="text-xs text-bolt-elements-textSecondary space-y-0.5 mb-3">
        <div>
          <span className="text-bolt-elements-textTertiary">Database Status: </span>
          {overallStatus}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Schema Status: </span>
          {schemaStatus}
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
          <span className="text-bolt-elements-textTertiary">Provider: </span>
          {providerLabel}
        </div>
        <div>
          <span className="text-bolt-elements-textTertiary">Connection Status: </span>
          {connectionStatus}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={running !== null}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'generate' ? 'Generating…' : 'Generate Schema'}
        </button>
        <button
          type="button"
          onClick={handleValidate}
          disabled={running !== null || !canValidate}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'validate' ? 'Validating…' : 'Validate'}
        </button>
        <button
          type="button"
          onClick={handleProvision}
          disabled={running !== null || !canProvision}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'provision' ? 'Provisioning…' : 'Provision (mock)'}
        </button>
        <button
          type="button"
          onClick={handleVerify}
          disabled={running !== null || !canVerify}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'verify' ? 'Verifying…' : 'Verify Connection'}
        </button>
      </div>

      <div className="text-[11px] leading-snug text-bolt-elements-textTertiary/80 mt-2.5">
        Provisioning uses a simulated (mock) provider only in this phase — no real database is created or modified.
      </div>
    </div>
  );
}
