/**
 * Deployment Domain Foundation — Sprint 87 (Part 0 architecture review).
 *
 * Describes `builders_project_deployments`/`builders_deployment_github`/
 * `builders_deployment_supabase`/`builders_deployment_vercel`/`builders_deployment_history`
 * (see supabase/migrations/20260804100000_deployment_foundation.sql). Every Project owns exactly
 * one Deployment; the Deployment owns each provider connection as a pluggable child — see that
 * migration's header comment for the full architecture rationale.
 *
 * Nothing in this sprint calls the GitHub/Supabase/Vercel APIs — these types only describe the
 * persisted connection state a future sprint's integration will populate
 * (`repositoryProviderId`-shaped fields are left null/pending until then).
 */

/**
 * The Deployment's own lifecycle — see `lifecycleTransitions.ts`'s
 * `DEPLOYMENT_STATUS_TRANSITIONS`, the one place this is validated. Linear and mostly
 * no-skip/no-regress, mirroring `MvpStatus`'s existing convention, with `failed` playing the
 * same "can interrupt any pre-released state, resumes back into one of them" role `blocked`
 * plays for `MvpStatus`.
 *
 * Sprint 93 inserts `delivery_ready` between `verified` and `released`: the Customer Delivery
 * Package has been assembled and the application is ready to hand over. Deliberately NOT the same
 * as `released` (which stays out of scope until Sprint 94's Release Management) — packaging a
 * handover artifact is not the same act as releasing to production.
 */
export type DeploymentStatus =
  | 'planning'
  | 'engineering'
  | 'generated'
  | 'repository_connected'
  | 'database_connected'
  | 'environment_ready'
  | 'deploying'
  | 'deployed'
  | 'verified'
  | 'delivery_ready'
  | 'released'
  | 'maintenance'
  | 'archived'
  | 'failed';

export type DeploymentEnvironment = 'production' | 'staging' | 'preview';

/** A provider connection's own state — independent of the parent Deployment's overall `status`. */
export type ProviderConnectionStatus = 'pending' | 'connected' | 'error';

/** One project's Deployment — the parent entity. Mirrors a `builders_project_deployments` row. */
export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  environment: DeploymentEnvironment;
  lastError?: string;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  releasedAt?: string;
  archivedAt?: string;
}

export interface DeploymentDraft {
  projectId: string;
  environment?: DeploymentEnvironment;
  createdBy?: string;
}

/** GitHub repo connection for a Deployment. Mirrors a `builders_deployment_github` row. */
export interface DeploymentGithub {
  id: string;
  deploymentId: string;
  projectId: string;
  repoOwner?: string;
  repoName?: string;
  repoFullName?: string;
  repoUrl?: string;
  defaultBranch: string;
  visibility: string;
  status: ProviderConnectionStatus;
  lastError?: string;
  connectedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentGithubInput {
  deploymentId: string;
  projectId: string;
  repoOwner?: string;
  repoName?: string;
  repoFullName?: string;
  repoUrl?: string;
  defaultBranch?: string;
  visibility?: string;
  status?: ProviderConnectionStatus;
  metadata?: Record<string, unknown>;
}

/** Supabase project connection for a Deployment. Mirrors a `builders_deployment_supabase` row. */
export interface DeploymentSupabase {
  id: string;
  deploymentId: string;
  projectId: string;
  supabaseProjectRef?: string;
  supabaseProjectUrl?: string;
  region?: string;
  status: ProviderConnectionStatus;
  lastError?: string;
  connectedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentSupabaseInput {
  deploymentId: string;
  projectId: string;
  supabaseProjectRef?: string;
  supabaseProjectUrl?: string;
  region?: string;
  status?: ProviderConnectionStatus;
  metadata?: Record<string, unknown>;
}

/** Vercel project connection for a Deployment. Mirrors a `builders_deployment_vercel` row. */
export interface DeploymentVercel {
  id: string;
  deploymentId: string;
  projectId: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  productionUrl?: string;
  status: ProviderConnectionStatus;
  lastError?: string;
  connectedAt?: string;
  lastDeployedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentVercelInput {
  deploymentId: string;
  projectId: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  productionUrl?: string;
  status?: ProviderConnectionStatus;
  metadata?: Record<string, unknown>;
}

/** One provider an event can concern — null for a generic/status-only event. */
export type DeploymentEventProvider = 'github' | 'supabase' | 'vercel';

/**
 * One append-only history entry. Mirrors a `builders_deployment_history` row — see that table's
 * migration comment for why this is append-only (no update path, no unique constraint).
 */
export interface DeploymentHistoryEvent {
  id: string;
  deploymentId: string;
  projectId: string;
  eventType: string;
  fromStatus?: DeploymentStatus;
  toStatus?: DeploymentStatus;
  provider?: DeploymentEventProvider;
  message?: string;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
}

export interface DeploymentHistoryEventInput {
  deploymentId: string;
  projectId: string;
  eventType: string;
  fromStatus?: DeploymentStatus;
  toStatus?: DeploymentStatus;
  provider?: DeploymentEventProvider;
  message?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

/** A Deployment plus every provider connection attached to it, if any — the full picture the Workspace's Deployment surface needs in one read. */
export interface DeploymentWithProviders extends Deployment {
  github: DeploymentGithub | null;
  supabase: DeploymentSupabase | null;
  vercel: DeploymentVercel | null;
}
