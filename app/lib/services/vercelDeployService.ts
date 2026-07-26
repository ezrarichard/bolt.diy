import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { Deployment, DeploymentVercel, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { EnvironmentReadinessReport } from '~/lib/services/environmentReadinessService';

/**
 * Vercel Deploy Service — Sprint 91 (Vercel Deployment Integration).
 *
 * Part 1 audit finding: no real Vercel API client exists in this codebase. `app/lib/stores/vercel.ts`/
 * `VercelTab.tsx`/`VercelDeploy.client.tsx` inline raw, inconsistent-API-version fetches, persist the
 * raw token to `localStorage`/a 365-day cookie, and `VercelDeploy.client.tsx`'s entire flow posts to
 * `/api/vercel-deploy`, a route that does not exist anywhere in this repo (confirmed dead code). None
 * of it creates a project, links a GitHub repo, sets env vars, or polls deployment status — this file
 * is genuinely new, not an extraction of working code. It deliberately does NOT reuse the legacy
 * `vercelConnection` store (wrong storage model for this sprint's rules) — see
 * `vercelSessionCredentials.ts`'s header comment.
 *
 * Layered the same way `githubDeployService.ts`/`supabaseDeployService.ts` are:
 *  - low-level functions (`validateVercelToken`, `listVercelTeams`, `findVercelProject`,
 *    `createVercelProject`, `linkVercelProjectRepository`, `setVercelEnvironmentVariables`,
 *    `createVercelDeployment`, `getVercelDeployment`, `pollVercelDeployment`) — pure external API
 *    calls, no BuildersDB access, raw `fetch` against `api.vercel.com` (matching every existing
 *    Vercel call site in this repo — no Vercel SDK is installed, per the Part 1 audit).
 *  - `deployToVercel` — the high-level orchestrator. Like `supabaseDeployService.ts`'s
 *    `syncSupabaseDeploymentAfterProvisioning`, it DOES call `deploymentRepository` directly
 *    (attach/status writes) — the Architectural Rule's "do not update deployment status directly
 *    from UI components" constrains UI components, not this service layer; components call this
 *    one function and render its progress, never touching `DeploymentRepository` themselves.
 */

const VERCEL_API_BASE = 'https://api.vercel.com';

export type VercelDeploymentState = 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'INITIALIZING';

interface VercelApiErrorBody {
  error?: { message?: string; code?: string };
}

class VercelApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function vercelFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${VERCEL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as VercelApiErrorBody & Record<string, unknown>;

  if (!response.ok) {
    const message = data.error?.message || `Vercel API error (${response.status})`;
    throw new VercelApiError(message, response.status, data.error?.code);
  }

  return data as T;
}

export interface VercelUserInfo {
  id: string;
  name?: string;
  email?: string;
  username?: string;
}

/** Part 2/Part 16 — the first, cheapest check: is this token even valid, before anything else runs. */
export async function validateVercelToken(
  token: string,
): Promise<{ ok: boolean; user?: VercelUserInfo; message: string }> {
  try {
    const data = await vercelFetch<{ user: { id: string; name?: string; email?: string; username?: string } }>(
      token,
      '/v2/user',
    );

    return {
      ok: true,
      user: { id: data.user.id, name: data.user.name, email: data.user.email, username: data.user.username },
      message: 'Vercel token is valid.',
    };
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 403) {
      return { ok: false, message: 'This Vercel token does not have sufficient permissions.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? `Invalid Vercel token: ${error.message}` : 'Invalid Vercel token.',
    };
  }
}

export interface VercelTeamInfo {
  id: string;
  name: string;
  slug: string;
}

export async function listVercelTeams(token: string): Promise<VercelTeamInfo[]> {
  const data = await vercelFetch<{ teams: Array<{ id: string; name: string; slug: string }> }>(token, '/v2/teams');
  return data.teams.map((team) => ({ id: team.id, name: team.name, slug: team.slug }));
}

export interface VercelApiProject {
  id: string;
  name: string;
  framework?: string;
  link?: { type: string; repo?: string; org?: string; repoId?: number };
}

function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

/** Part 17 — resolve-before-create: called before `createVercelProject` so a retry never creates a duplicate. */
export async function findVercelProject(
  token: string,
  name: string,
  teamId?: string,
): Promise<VercelApiProject | null> {
  try {
    const data = await vercelFetch<VercelApiProject>(
      token,
      `/v9/projects/${encodeURIComponent(name)}${teamQuery(teamId)}`,
    );
    return data;
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export interface CreateVercelProjectParams {
  name: string;
  framework?: string;
  buildCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  repoFullName: string;
  productionBranch?: string;
  teamId?: string;
}

/** Part 7A — creates a new Vercel project already linked to the given GitHub repo (Vercel's own `gitRepository` field at creation time — the only reliable way to link a repo this sprint's audit found supported). */
export async function createVercelProject(token: string, params: CreateVercelProjectParams): Promise<VercelApiProject> {
  const body: Record<string, unknown> = {
    name: params.name,
    framework: params.framework,
    buildCommand: params.buildCommand,
    installCommand: params.installCommand,
    outputDirectory: params.outputDirectory,
    rootDirectory: params.rootDirectory,
    gitRepository: { type: 'github', repo: params.repoFullName },
  };

  if (params.productionBranch) {
    body.gitRepository = { ...(body.gitRepository as object), productionBranch: params.productionBranch };
  }

  return vercelFetch<VercelApiProject>(token, `/v11/projects${teamQuery(params.teamId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Part 7B — best-effort linking of an EXISTING Vercel project to a repo, for the "connect existing project" path. Vercel's link endpoint only supports this for projects with no repository already linked; see `deployToVercel`'s repo-identity check for what happens when one is already linked to something else. */
export async function linkVercelProjectRepository(
  token: string,
  projectId: string,
  repoFullName: string,
  teamId?: string,
): Promise<void> {
  await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/link${teamQuery(teamId)}`, {
    method: 'POST',
    body: JSON.stringify({ type: 'github', repo: repoFullName }),
  });
}

export interface VercelEnvVariable {
  key: string;
  value: string;
  target: Array<'production' | 'preview' | 'development'>;
  type: 'plain' | 'encrypted' | 'sensitive';
}

/** Part 6 — pushes resolved + manually-supplied variables to Vercel. Never called with a variable this codebase itself couldn't already account for (see `deployToVercel`'s own gating) — nothing here decides which variables are needed, it only transmits the ones the caller already resolved. */
export async function setVercelEnvironmentVariables(
  token: string,
  projectId: string,
  variables: VercelEnvVariable[],
  teamId?: string,
): Promise<void> {
  if (variables.length === 0) {
    return;
  }

  await vercelFetch(token, `/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery(teamId)}`, {
    method: 'POST',
    body: JSON.stringify(variables),
  });
}

export interface VercelDeploymentInfo {
  id: string;
  url?: string;
  readyState: VercelDeploymentState;
}

export interface CreateVercelDeploymentParams {
  projectId: string;
  name: string;
  repoFullName: string;
  branch: string;
  target: 'production' | 'preview' | 'development';
  teamId?: string;
}

/** Part 9/Part 10 step 3 — triggers a deployment from the linked GitHub repo's branch. */
export async function createVercelDeployment(
  token: string,
  params: CreateVercelDeploymentParams,
): Promise<VercelDeploymentInfo> {
  const data = await vercelFetch<{ id: string; url?: string; readyState: VercelDeploymentState }>(
    token,
    `/v13/deployments${teamQuery(params.teamId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        project: params.projectId,
        target: params.target,
        gitSource: { type: 'github', repo: params.repoFullName, ref: params.branch },
      }),
    },
  );

  return { id: data.id, url: data.url, readyState: data.readyState };
}

export async function getVercelDeployment(
  token: string,
  deploymentId: string,
  teamId?: string,
): Promise<VercelDeploymentInfo> {
  const data = await vercelFetch<{ id: string; url?: string; readyState: VercelDeploymentState }>(
    token,
    `/v13/deployments/${encodeURIComponent(deploymentId)}${teamQuery(teamId)}`,
  );

  return { id: data.id, url: data.url, readyState: data.readyState };
}

export interface PollVercelDeploymentOptions {
  maxAttempts?: number;
  intervalMs?: number;

  /** Injectable for tests — defaults to a real `setTimeout`-based sleep. Never a real delay in the unit test suite (Part 12/18). */
  sleep?: (ms: number) => Promise<void>;
}

export interface VercelPollResult {
  outcome: 'ready' | 'error' | 'canceled' | 'timeout';
  state: VercelDeploymentState | 'UNKNOWN';
  url?: string;
  attempts: number;
  message: string;
}

/**
 * Part 12 — bounded polling with no infinite loop: `maxAttempts` (default 40) hard-caps the number
 * of status checks, `intervalMs` (default 3000) paces them. A network error on any single check is
 * treated as transient (counts toward `attempts`, does not abort the loop) so one flaky request
 * doesn't fail an otherwise-succeeding deployment; `maxAttempts` exhaustion still ends the loop
 * (`'timeout'`), never spinning forever.
 */
export async function pollVercelDeployment(
  token: string,
  deploymentId: string,
  teamId: string | undefined,
  options: PollVercelDeploymentOptions = {},
): Promise<VercelPollResult> {
  const maxAttempts = options.maxAttempts ?? 40;
  const intervalMs = options.intervalMs ?? 3000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastState: VercelDeploymentState | 'UNKNOWN' = 'UNKNOWN';
  let lastUrl: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const info = await getVercelDeployment(token, deploymentId, teamId);
      lastState = info.readyState;
      lastUrl = info.url;

      if (info.readyState === 'READY') {
        return { outcome: 'ready', state: 'READY', url: info.url, attempts: attempt, message: 'Deployment is ready.' };
      }

      if (info.readyState === 'ERROR') {
        return {
          outcome: 'error',
          state: 'ERROR',
          url: info.url,
          attempts: attempt,
          message: 'Deployment build failed.',
        };
      }

      if (info.readyState === 'CANCELED') {
        return {
          outcome: 'canceled',
          state: 'CANCELED',
          url: info.url,
          attempts: attempt,
          message: 'Deployment was canceled.',
        };
      }
    } catch {
      // Transient network/API failure — counted as an attempt, loop continues until maxAttempts.
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  return {
    outcome: 'timeout',
    state: lastState,
    url: lastUrl,
    attempts: maxAttempts,
    message: `Timed out waiting for the deployment to finish (last known state: ${lastState}).`,
  };
}

export interface DeployToVercelParams {
  deployment: DeploymentWithProviders;
  token: string;
  teamId?: string;
  projectName: string;
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
  requiresSupabase: boolean;
  environmentReport: EnvironmentReadinessReport;

  /** Values the operator just typed for variables the report couldn't resolve (Part 5) — held only in memory by the caller, never logged or persisted here. */
  manualVariableValues: Record<string, string>;
  target?: 'production' | 'preview' | 'development';
  performedBy?: string;
}

export interface DeployToVercelResult {
  ok: boolean;
  message: string;
  deployment?: Deployment;
  vercel?: DeploymentVercel;
  deploymentUrl?: string;
}

/**
 * Part 4/10/11 — the full sequence, in order:
 *
 *  0. Precondition checks (Part 4) — refuses with an actionable message and touches nothing if
 *     any fail. This is where "do not silently bypass environment readiness" is enforced.
 *  1. Validate the token (cheapest failure to catch first).
 *  2. Resolve-or-create the Vercel project (Part 17 idempotency — look up by name before create).
 *  3. Verify the resolved project's linked repo matches this Deployment's GitHub repo (Part 8) —
 *     link it if unlinked, refuse if linked to something else.
 *  4. ONLY NOW — with a genuinely existing, correctly-linked Vercel project — call
 *     `deploymentRepository.attachVercel` (Part 11: never attach before the identity is real).
 *  5. `updateDeploymentStatus(..., 'deploying', 'deployment_started')`.
 *  6. Set environment variables (Part 5/6).
 *  7. Trigger the deployment and poll to a terminal state (Part 12).
 *  8. On success: `updateDeploymentStatus(..., 'deployed', 'deployment_succeeded')`, then one more
 *     `attachVercel` call (with an explicit no-op `toStatus`) to persist the latest deployment
 *     id/url/state/timestamp (Part 10 step 5).
 *  9. On failure: `updateDeploymentStatus(..., 'failed', 'deployment_failed')` — never `'deployed'`.
 */
export async function deployToVercel(params: DeployToVercelParams): Promise<DeployToVercelResult> {
  const { deployment, token } = params;

  if (!deployment.github || !deployment.github.repoFullName) {
    return { ok: false, message: 'Connect a GitHub repository before deploying to Vercel.' };
  }

  if (params.requiresSupabase && !deployment.supabase) {
    return { ok: false, message: 'Connect a Supabase project before deploying to Vercel.' };
  }

  if (deployment.status !== 'environment_ready' && deployment.status !== 'failed') {
    return {
      ok: false,
      message: `Deployment must be environment_ready before deploying to Vercel (currently: ${deployment.status}).`,
    };
  }

  const missingManual = params.environmentReport.variables.filter(
    (variable) => variable.status !== 'resolved' && !params.manualVariableValues[variable.name],
  );

  if (missingManual.length > 0) {
    return {
      ok: false,
      message: `Provide a value for: ${missingManual.map((v) => v.name).join(', ')} before deploying.`,
    };
  }

  const tokenCheck = await validateVercelToken(token);

  if (!tokenCheck.ok) {
    return { ok: false, message: tokenCheck.message };
  }

  const repoFullName = deployment.github.repoFullName;
  const branch = deployment.github.defaultBranch;

  let project: VercelApiProject | null;

  try {
    project = await findVercelProject(token, params.projectName, params.teamId);

    if (!project) {
      project = await createVercelProject(token, {
        name: params.projectName,
        framework: params.framework,
        buildCommand: params.buildCommand,
        outputDirectory: params.outputDirectory,
        repoFullName,
        productionBranch: branch,
        teamId: params.teamId,
      });
    } else if (project.link?.repo && project.link.repo.toLowerCase() !== repoFullName.toLowerCase()) {
      return {
        ok: false,
        message: `Vercel project "${params.projectName}" is already linked to a different GitHub repository (${project.link.repo}) — refusing to redirect it to ${repoFullName}.`,
      };
    } else if (!project.link?.repo) {
      await linkVercelProjectRepository(token, project.id, repoFullName, params.teamId);
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? `Vercel project setup failed: ${error.message}` : 'Vercel project setup failed.',
    };
  }

  const vercelRow = await deploymentRepository.attachVercel(
    {
      deploymentId: deployment.id,
      projectId: deployment.projectId,
      vercelProjectId: project.id,
      vercelProjectName: project.name,
      status: 'connected',
      metadata: { teamId: params.teamId, framework: params.framework, productionBranch: branch },
    },
    { performedBy: params.performedBy },
  );

  if (!vercelRow) {
    return {
      ok: false,
      message: 'Vercel project was set up, but the Deployment could not be updated — check server logs for details.',
    };
  }

  const startedOk = await deploymentRepository.updateDeploymentStatus(
    deployment.id,
    deployment.projectId,
    'deploying',
    {
      eventType: 'deployment_started',
      message: `Deployment started for ${project.name}.`,
      createdBy: params.performedBy,
    },
  );

  if (!startedOk) {
    return { ok: false, message: 'Could not transition the Deployment to deploying.' };
  }

  const providerVariables: VercelEnvVariable[] = params.environmentReport.resolvedVariables
    .filter((variable) => variable.value)
    .map((variable) => ({
      key: variable.name,
      value: variable.value as string,
      target: [params.target ?? 'preview'],
      type: 'plain',
    }));

  const manualVariables: VercelEnvVariable[] = params.environmentReport.variables
    .filter((variable) => variable.status !== 'resolved')
    .map((variable) => ({
      key: variable.name,
      value: params.manualVariableValues[variable.name],
      target: [params.target ?? 'preview'],
      type: variable.sensitive ? 'sensitive' : 'plain',
    }));

  try {
    await setVercelEnvironmentVariables(token, project.id, [...providerVariables, ...manualVariables], params.teamId);

    const created = await createVercelDeployment(token, {
      projectId: project.id,
      name: project.name,
      repoFullName,
      branch,
      target: params.target ?? 'preview',
      teamId: params.teamId,
    });

    const pollResult = await pollVercelDeployment(token, created.id, params.teamId);

    if (pollResult.outcome !== 'ready') {
      await deploymentRepository.updateDeploymentStatus(deployment.id, deployment.projectId, 'failed', {
        eventType: 'deployment_failed',
        message: pollResult.message,
        createdBy: params.performedBy,
      });

      return { ok: false, message: pollResult.message };
    }

    const succeededOk = await deploymentRepository.updateDeploymentStatus(
      deployment.id,
      deployment.projectId,
      'deployed',
      {
        eventType: 'deployment_succeeded',
        message: `Deployed ${project.name} — ${pollResult.url ?? created.url ?? ''}`.trim(),
        createdBy: params.performedBy,
      },
    );

    if (!succeededOk) {
      return { ok: false, message: 'Deployment succeeded on Vercel, but the Deployment could not be marked deployed.' };
    }

    const updatedVercelRow = await deploymentRepository.attachVercel(
      {
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        vercelProjectId: project.id,
        vercelProjectName: project.name,
        productionUrl: pollResult.url ?? created.url,
        status: 'connected',
        metadata: {
          teamId: params.teamId,
          framework: params.framework,
          productionBranch: branch,
          latestDeploymentId: created.id,
          latestDeploymentUrl: pollResult.url ?? created.url,
          latestDeploymentState: pollResult.state,
          latestDeploymentAt: new Date().toISOString(),
        },
      },
      { toStatus: 'deployed', performedBy: params.performedBy },
    );

    return {
      ok: true,
      message: `Deployed successfully — ${pollResult.url ?? created.url ?? ''}`.trim(),
      vercel: updatedVercelRow ?? undefined,
      deploymentUrl: pollResult.url ?? created.url,
    };
  } catch (error) {
    const message = error instanceof Error ? `Vercel deployment failed: ${error.message}` : 'Vercel deployment failed.';

    await deploymentRepository.updateDeploymentStatus(deployment.id, deployment.projectId, 'failed', {
      eventType: 'deployment_failed',
      message,
      createdBy: params.performedBy,
    });

    return { ok: false, message };
  }
}
