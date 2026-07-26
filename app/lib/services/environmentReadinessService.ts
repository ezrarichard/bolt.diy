import type { DeploymentGithub, DeploymentSupabase } from '~/lib/deployment/deploymentTypes';

/**
 * Environment Readiness Service — Sprint 90 (Environment & Runtime Configuration).
 *
 * Part 1 audit finding: no existing code classifies an environment variable as
 * provider-resolved/must-supply-manually/sensitive as a first-class concept.
 * `Application Manifest.environmentRequirements` (`app/lib/application-manifest/manifestTypes.ts`)
 * is only ever a flat list of NAMES (`["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]` today,
 * always exactly those two) — nothing resolves them to actual values or reports per-variable
 * status. `deploymentReadiness.ts` is a deliberately coarse, non-blocking "does `.env.example`
 * exist at all" boolean for a different purpose (Product Package display) and is NOT extended
 * here. `supabaseDeployService.ts`'s `buildSupabaseEnvironmentHandoff` already resolves
 * `VITE_SUPABASE_URL` and explicitly defers `VITE_SUPABASE_ANON_KEY` — this module reuses exactly
 * that resolution logic (not a second copy of it) and turns it into the per-variable
 * resolved/missing/invalid/unknown report the sprint calls for.
 *
 * This file is PURE — no BuildersDB access, no side effects. `deploymentRepository.ts`'s
 * `updateDeploymentEnvironment` is the only place a report produced here is persisted, following
 * the same "assessment lives in a service, mutation lives in the repository" boundary
 * `supabaseDeployService.ts`/`assessSupabaseReadiness` already established.
 */

export type EnvironmentVariableStatus = 'resolved' | 'missing' | 'invalid' | 'unknown';

/** `'provider'` — Builders can resolve this itself from a connected provider. `'manual'` — the customer must supply it (no safe automated flow exists, or the variable isn't recognized at all). */
export type EnvironmentVariableSource = 'provider' | 'manual';

export interface EnvironmentVariable {
  name: string;
  status: EnvironmentVariableStatus;
  source: EnvironmentVariableSource;

  /**
   * Never `true` for a value Builders itself generated as a real secret — only ever flags
   * variables whose safe resolution would require a privileged credential (e.g. the Supabase
   * Management PAT) that this codebase never persists. See Part 5: a sensitive variable's `value`
   * is always left `undefined`, resolved or not.
   */
  sensitive: boolean;

  /** Only ever populated for a non-sensitive, `resolved` variable. */
  value?: string;
  detail: string;
}

export interface EnvironmentReadinessReport {
  variables: EnvironmentVariable[];
  resolvedVariables: EnvironmentVariable[];
  missingVariables: EnvironmentVariable[];
  providerVariables: EnvironmentVariable[];
  manualVariables: EnvironmentVariable[];
  sensitiveVariables: EnvironmentVariable[];

  /** True when no variable is `invalid` — the only status this sprint treats as a real blocker (see this file's header comment and `deploymentRepository.updateDeploymentEnvironment`). `missing`/`unknown` variables still require manual action but don't block the lifecycle transition — deploying to any real host always involves entering secrets there by hand. */
  ready: boolean;

  /** True only when every variable is actually `resolved` — stricter than `ready`, for UI copy that wants to distinguish "safe to proceed" from "fully automatic." */
  fullyResolved: boolean;
}

interface ProviderContext {
  github: DeploymentGithub | null;
  supabase: DeploymentSupabase | null;
}

interface KnownVariableMapping {
  /** Resolves a safe, non-secret value from already-connected providers, or `undefined` if not resolvable. Never called for a `sensitive` mapping — see `sensitive` below. */
  resolve: (ctx: ProviderContext) => string | undefined;

  /** See `EnvironmentVariable.sensitive`'s own comment. */
  sensitive: boolean;
  detailResolved: string;
  detailMissing: string;
}

/**
 * Part 3 — provider mapping. GitHub's own identity (repository/branch/commit — see
 * `DeploymentGithub`) contributes no known variable today (no `environmentRequirements` value this
 * codebase ever emits derives from GitHub) — `github` is still threaded through `ProviderContext`
 * so a future variable mapping can read it without this function's signature changing, but nothing
 * fabricates a GitHub-derived variable that doesn't really exist yet.
 */
const KNOWN_VARIABLE_MAPPINGS: Record<string, KnownVariableMapping> = {
  VITE_SUPABASE_URL: {
    resolve: (ctx) => ctx.supabase?.supabaseProjectUrl,
    sensitive: false,
    detailResolved: 'Resolved from the connected Supabase project.',
    detailMissing: 'Connect a Supabase project (Deploy → Database) to resolve this automatically.',
  },
  VITE_SUPABASE_ANON_KEY: {
    resolve: () => undefined,
    sensitive: true,
    detailResolved: '',
    detailMissing:
      "No safe, automated flow resolves this yet — enter your Supabase project's publishable/anon key manually before deploying.",
  },
};

function assessVariable(name: string, ctx: ProviderContext): EnvironmentVariable {
  const mapping = KNOWN_VARIABLE_MAPPINGS[name];

  if (!mapping) {
    return {
      name,
      status: 'unknown',
      source: 'manual',
      sensitive: false,
      detail: 'Not recognized by any provider mapping — requires manual configuration.',
    };
  }

  if (mapping.sensitive) {
    // Never resolved automatically, and never carries a value even if a caller sets one upstream.
    return { name, status: 'missing', source: 'manual', sensitive: true, detail: mapping.detailMissing };
  }

  const resolvedValue = mapping.resolve(ctx);

  if (resolvedValue) {
    return {
      name,
      status: 'resolved',
      source: 'provider',
      sensitive: false,
      value: resolvedValue,
      detail: mapping.detailResolved,
    };
  }

  return { name, status: 'missing', source: 'provider', sensitive: false, detail: mapping.detailMissing };
}

/**
 * Part 4 — validates every required variable name and reports its status. Deliberately does not
 * attempt to detect `'invalid'` for the two known variables today (a URL that merely looks
 * malformed still isn't something this codebase can safely correct) — `'invalid'` is reserved for
 * a future caller that actually re-verifies a value (e.g. Sprint 91 pinging the resolved
 * `VITE_SUPABASE_URL`); this function currently only ever produces `resolved`/`missing`/`unknown`.
 */
export function assessEnvironmentReadiness(params: {
  environmentRequirements: string[];
  github: DeploymentGithub | null;
  supabase: DeploymentSupabase | null;
}): EnvironmentReadinessReport {
  const ctx: ProviderContext = { github: params.github, supabase: params.supabase };
  const variables = params.environmentRequirements.map((name) => assessVariable(name, ctx));

  return {
    variables,
    resolvedVariables: variables.filter((v) => v.status === 'resolved'),
    missingVariables: variables.filter((v) => v.status !== 'resolved'),
    providerVariables: variables.filter((v) => v.source === 'provider'),
    manualVariables: variables.filter((v) => v.source === 'manual'),
    sensitiveVariables: variables.filter((v) => v.sensitive),
    ready: !variables.some((v) => v.status === 'invalid'),
    fullyResolved: variables.length > 0 && variables.every((v) => v.status === 'resolved'),
  };
}
