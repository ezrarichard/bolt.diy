import type {
  Deployment,
  DeploymentDraft,
  DeploymentEnvironment,
  DeploymentEventProvider,
  DeploymentGithub,
  DeploymentGithubInput,
  DeploymentHistoryEvent,
  DeploymentHistoryEventInput,
  DeploymentStatus,
  DeploymentSupabase,
  DeploymentSupabaseInput,
  DeploymentVercel,
  DeploymentVercelInput,
  ProviderConnectionStatus,
} from '~/lib/deployment/deploymentTypes';

/**
 * BuildersDB row/frontend shape mapping for the Deployment Foundation — Sprint 87. Mirrors the
 * convention `blueprintResolutionDbTypes.ts` established: each `BuildersDb<X>Row` interface is
 * the literal shape of a row in its table (see
 * supabase/migrations/20260804100000_deployment_foundation.sql for the DDL), and this file is the
 * only place a row is translated into the application's camelCase shape.
 */

export interface BuildersDbProjectDeploymentRow {
  id: string;
  project_id: string;
  status: DeploymentStatus;
  environment: DeploymentEnvironment;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  released_at: string | null;
  archived_at: string | null;
}

export function fromProjectDeploymentRow(row: BuildersDbProjectDeploymentRow): Deployment {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    environment: row.environment,
    lastError: row.last_error ?? undefined,
    metadata: row.metadata ?? {},
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    releasedAt: row.released_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

export function toProjectDeploymentInsert(draft: DeploymentDraft): Record<string, unknown> {
  return {
    project_id: draft.projectId,
    environment: draft.environment ?? 'production',
    created_by: draft.createdBy ?? null,
  };
}

export interface BuildersDbDeploymentGithubRow {
  id: string;
  deployment_id: string;
  project_id: string;
  repo_owner: string | null;
  repo_name: string | null;
  repo_full_name: string | null;
  repo_url: string | null;
  default_branch: string;
  visibility: string;
  status: ProviderConnectionStatus;
  last_error: string | null;
  connected_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function fromDeploymentGithubRow(row: BuildersDbDeploymentGithubRow): DeploymentGithub {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    repoOwner: row.repo_owner ?? undefined,
    repoName: row.repo_name ?? undefined,
    repoFullName: row.repo_full_name ?? undefined,
    repoUrl: row.repo_url ?? undefined,
    defaultBranch: row.default_branch,
    visibility: row.visibility,
    status: row.status,
    lastError: row.last_error ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeploymentGithubUpsert(input: DeploymentGithubInput): Record<string, unknown> {
  return {
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    repo_owner: input.repoOwner ?? null,
    repo_name: input.repoName ?? null,
    repo_full_name: input.repoFullName ?? null,
    repo_url: input.repoUrl ?? null,
    default_branch: input.defaultBranch ?? 'main',
    visibility: input.visibility ?? 'private',
    status: input.status ?? 'connected',
    metadata: input.metadata ?? {},
    connected_at: new Date().toISOString(),
  };
}

export interface BuildersDbDeploymentSupabaseRow {
  id: string;
  deployment_id: string;
  project_id: string;
  supabase_project_ref: string | null;
  supabase_project_url: string | null;
  region: string | null;
  status: ProviderConnectionStatus;
  last_error: string | null;
  connected_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function fromDeploymentSupabaseRow(row: BuildersDbDeploymentSupabaseRow): DeploymentSupabase {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    supabaseProjectRef: row.supabase_project_ref ?? undefined,
    supabaseProjectUrl: row.supabase_project_url ?? undefined,
    region: row.region ?? undefined,
    status: row.status,
    lastError: row.last_error ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeploymentSupabaseUpsert(input: DeploymentSupabaseInput): Record<string, unknown> {
  return {
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    supabase_project_ref: input.supabaseProjectRef ?? null,
    supabase_project_url: input.supabaseProjectUrl ?? null,
    region: input.region ?? null,
    status: input.status ?? 'connected',
    metadata: input.metadata ?? {},
    connected_at: new Date().toISOString(),
  };
}

export interface BuildersDbDeploymentVercelRow {
  id: string;
  deployment_id: string;
  project_id: string;
  vercel_project_id: string | null;
  vercel_project_name: string | null;
  production_url: string | null;
  status: ProviderConnectionStatus;
  last_error: string | null;
  connected_at: string | null;
  last_deployed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function fromDeploymentVercelRow(row: BuildersDbDeploymentVercelRow): DeploymentVercel {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    vercelProjectId: row.vercel_project_id ?? undefined,
    vercelProjectName: row.vercel_project_name ?? undefined,
    productionUrl: row.production_url ?? undefined,
    status: row.status,
    lastError: row.last_error ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    lastDeployedAt: row.last_deployed_at ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeploymentVercelUpsert(input: DeploymentVercelInput): Record<string, unknown> {
  return {
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    vercel_project_id: input.vercelProjectId ?? null,
    vercel_project_name: input.vercelProjectName ?? null,
    production_url: input.productionUrl ?? null,
    status: input.status ?? 'connected',
    metadata: input.metadata ?? {},
    connected_at: new Date().toISOString(),
  };
}

export interface BuildersDbDeploymentHistoryRow {
  id: string;
  deployment_id: string;
  project_id: string;
  event_type: string;
  from_status: DeploymentStatus | null;
  to_status: DeploymentStatus | null;
  provider: DeploymentEventProvider | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export function fromDeploymentHistoryRow(row: BuildersDbDeploymentHistoryRow): DeploymentHistoryEvent {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    eventType: row.event_type,
    fromStatus: row.from_status ?? undefined,
    toStatus: row.to_status ?? undefined,
    provider: row.provider ?? undefined,
    message: row.message ?? undefined,
    metadata: row.metadata ?? {},
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

export function toDeploymentHistoryInsert(input: DeploymentHistoryEventInput): Record<string, unknown> {
  return {
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    event_type: input.eventType,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    provider: input.provider ?? null,
    message: input.message ?? null,
    metadata: input.metadata ?? {},
    created_by: input.createdBy ?? null,
  };
}
