import type { Project } from '~/lib/stores/projects';
import { databaseDesignerEngine } from '~/lib/projects/databaseDesignerEngine';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { Deployment, DeploymentSupabase } from '~/lib/deployment/deploymentTypes';

/**
 * Supabase Deploy Service — Sprint 89 (Supabase Product Integration).
 *
 * Unlike GitHub (Sprint 88), a real, tested Supabase provisioning system already existed before
 * this sprint — `databaseActivationService.ts` (connect/generate schema/validate/provision/verify),
 * backed by the real `SupabaseProvisioner` (`provisioning/supabaseProvisioner.ts`), the session-only
 * credential holder, and the deterministic SQL generator/validator. This file does NOT reimplement
 * any of that — it is the thin bridge Part 3 of the sprint brief calls for: it reads
 * `Project.databaseActivation` (the existing system's own persisted state, written only by
 * `databaseActivationService.ts`) and turns a REAL, successfully-provisioned connection into a
 * `deploymentRepository.attachSupabase()` call, the same "provider service -> attachX()" boundary
 * `githubDeployService.ts` established for GitHub. It never calls the Supabase Management API,
 * never executes SQL, and never writes to `builders_project_deployments`/`builders_deployment_*`
 * directly — only `DeploymentRepository` does that.
 *
 * Mock vs. real (Part 6): `syncSupabaseDeploymentAfterProvisioning` refuses to run unless
 * `databaseActivation.connectionConfig.provider === 'supabase'` AND
 * `databaseActivation.provisioning.provider === 'supabase'` — a mock-provisioned project can never
 * reach `attachSupabase()`, so it can never advance the Deployment lifecycle or display as
 * customer-deployment ready, regardless of what `Project.databaseActivation` itself says.
 */

export function deriveSupabaseProjectUrl(projectRef: string): string {
  return `https://${projectRef}.supabase.co`;
}

export interface SupabaseDeploymentSyncResult {
  ok: boolean;
  message: string;
  deployment?: Deployment;
  supabase?: DeploymentSupabase;
}

/**
 * Call this after `databaseActivationService.provisionDatabase`/`retryProvisionDatabase`/
 * `verifyDatabaseConnection` resolves `{ ok: true }` for the `'supabase'` provider. Reads the
 * ALREADY-persisted `project.databaseActivation` (no new I/O of its own) and, only when it
 * reflects a genuinely successful real provisioning, ensures the project's Deployment exists and
 * attaches/updates its Supabase provider row — which itself validates the
 * `repository_connected -> database_connected` transition, upserts the row, and records exactly
 * one Deployment History event (see `deploymentRepository.attachSupabase`'s own comment).
 *
 * Deliberately requires `provisioning.status === 'succeeded'` rather than merely
 * `connectionConfig` existing — Part 5's "keep Deployment at database_connected only when the
 * database connection and agreed schema setup are genuinely complete."
 */
export async function syncSupabaseDeploymentAfterProvisioning(
  project: Project,
  options: { performedBy?: string } = {},
): Promise<SupabaseDeploymentSyncResult> {
  const activation = project.databaseActivation;

  if (activation?.connectionConfig?.provider !== 'supabase' || activation.provisioning?.provider !== 'supabase') {
    return { ok: false, message: 'No real Supabase connection to sync — mock mode never updates the Deployment.' };
  }

  if (activation.provisioning?.status !== 'succeeded') {
    return { ok: false, message: 'Supabase provisioning has not succeeded yet — nothing to sync.' };
  }

  const deployment = await deploymentRepository.ensureDeploymentForProject(project.id, {
    createdBy: options.performedBy,
  });

  if (!deployment) {
    return { ok: false, message: "Could not resolve this project's Deployment — BuildersDB may be unavailable." };
  }

  const projectRef = activation.connectionConfig.projectId;

  const supabase = await deploymentRepository.attachSupabase(
    {
      deploymentId: deployment.id,
      projectId: project.id,
      supabaseProjectRef: projectRef,
      supabaseProjectUrl: deriveSupabaseProjectUrl(projectRef),
      region: activation.connectionConfig.region,
      status: 'connected',
      metadata: {
        projectName: activation.connectionConfig.projectName,
        schemaVersion: activation.schema?.schemaVersion,
        tableCount: activation.schema?.tableCount,
        lastSchemaAppliedAt: activation.provisioning.finishedAt,
        lastOperationSummary: activation.provisioning.message,
        connectionVerified: activation.connection?.verified ?? false,
        mode: 'real',
      },
    },
    { performedBy: options.performedBy },
  );

  if (!supabase) {
    return {
      ok: false,
      message:
        'Supabase was provisioned, but the Deployment could not be updated — connect a GitHub repository first ' +
        '(repository_connected must precede database_connected), or check the server logs for details.',
    };
  }

  return { ok: true, message: 'Deployment updated: database_connected.', deployment, supabase };
}

export interface SupabaseReadinessItem {
  key:
    | 'schema'
    | 'foreign_keys_indexes'
    | 'rls_policies'
    | 'auth'
    | 'storage_buckets'
    | 'seed_data'
    | 'environment_variables';
  label: string;
  ready: boolean;
  detail: string;
}

export interface SupabaseReadinessReport {
  items: SupabaseReadinessItem[];
  allReady: boolean;
}

/**
 * Part 7 — a grounded readiness result, never a fabricated one. Reads ONLY what the approved
 * structured schema (`databaseDesignerEngine.getApprovedStructuredSchema`, the same source
 * `databaseActivationService` itself uses) and the Application Manifest's own
 * `environmentRequirements` (passed in by the caller, since resolving that is a DB read this pure
 * function shouldn't own) actually contain. `schemaTypes.ts`'s own header comment is explicit that
 * `storageBuckets`/`policies` are typed but nothing in this codebase generates SQL from them yet,
 * and `parseStructuredDatabaseSchema` silently drops them if present — so "not ready" here is the
 * honest, current state, not a placeholder to fill in later without re-checking.
 */
export function assessSupabaseReadiness(
  project: Project,
  options: { environmentRequirements?: string[] } = {},
): SupabaseReadinessReport {
  const schema = databaseDesignerEngine.getApprovedStructuredSchema(project);
  const tableCount = schema?.tables.length ?? 0;
  const hasForeignKeysOrIndexes = Boolean(
    schema?.tables.some((table) => (table.foreignKeys?.length ?? 0) > 0 || (table.indexes?.length ?? 0) > 0),
  );
  const policyCount = schema?.policies?.length ?? 0;
  const storageBucketCount = schema?.storageBuckets?.length ?? 0;

  const environmentRequirements = options.environmentRequirements;
  const hasSupabaseEnvVars = Boolean(
    environmentRequirements?.includes('VITE_SUPABASE_URL') &&
      environmentRequirements?.includes('VITE_SUPABASE_ANON_KEY'),
  );

  const items: SupabaseReadinessItem[] = [
    {
      key: 'schema',
      label: 'Tables & Schema',
      ready: tableCount > 0,
      detail: tableCount > 0 ? `${tableCount} table(s) in the approved schema.` : 'No approved database schema yet.',
    },
    {
      key: 'foreign_keys_indexes',
      label: 'Foreign Keys & Indexes',
      ready: hasForeignKeysOrIndexes,
      detail: hasForeignKeysOrIndexes
        ? 'At least one table declares a foreign key or index.'
        : 'No foreign keys or indexes declared in the approved schema.',
    },
    {
      key: 'rls_policies',
      label: 'RLS Policies',
      ready: policyCount > 0,
      detail:
        policyCount > 0
          ? `${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} declared.`
          : 'Row Level Security policies are not generated yet — the SQL generator does not emit them.',
    },
    {
      key: 'auth',
      label: 'Authentication Wiring',
      ready: false,
      detail: 'Authentication wiring between the generated app and this Supabase project is not modeled yet.',
    },
    {
      key: 'storage_buckets',
      label: 'Storage Buckets',
      ready: storageBucketCount > 0,
      detail:
        storageBucketCount > 0
          ? `${storageBucketCount} bucket(s) declared.`
          : 'No storage buckets declared in the approved schema.',
    },
    {
      key: 'seed_data',
      label: 'Seed / Demo Data',
      ready: false,
      detail: 'Seed or demo data generation is not modeled yet.',
    },
    {
      key: 'environment_variables',
      label: 'Required Environment Variables',
      ready: hasSupabaseEnvVars,
      detail: environmentRequirements
        ? hasSupabaseEnvVars
          ? 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are declared in the Application Manifest.'
          : 'VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are missing from the Application Manifest environment requirements.'
        : 'Application Manifest environment requirements were not provided to this check.',
    },
  ];

  return { items, allReady: items.every((item) => item.ready) };
}

export interface SupabaseEnvironmentHandoff {
  VITE_SUPABASE_URL?: string;

  /** Always undefined today — no approved, safe flow resolves the publishable/anon key yet. Sprint 90's job, per the sprint brief's own scope note. */
  VITE_SUPABASE_ANON_KEY?: string;
  projectRef?: string;
  missingRequiredVariables: string[];
}

/**
 * Part 8 — exposes exactly the safe values Sprint 90 (Environment Readiness) needs, and nothing
 * else. Never touches the Management PAT/service-role key, never writes a `.env` file. Reads only
 * `project.databaseActivation` (already-persisted, non-secret identity).
 */
export function buildSupabaseEnvironmentHandoff(
  project: Project,
  options: { environmentRequirements?: string[] } = {},
): SupabaseEnvironmentHandoff {
  const activation = project.databaseActivation;
  const projectRef =
    activation?.connectionConfig?.provider === 'supabase' ? activation.connectionConfig.projectId : undefined;
  const url = projectRef ? deriveSupabaseProjectUrl(projectRef) : undefined;

  const required = options.environmentRequirements ?? [];
  const resolved: Record<string, string | undefined> = { VITE_SUPABASE_URL: url };
  const missingRequiredVariables = required.filter((name) => !resolved[name]);

  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: undefined,
    projectRef,
    missingRequiredVariables,
  };
}
