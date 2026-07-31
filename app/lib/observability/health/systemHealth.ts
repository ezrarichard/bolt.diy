/**
 * Builders Observability — system health.
 *
 * Health is DERIVED from state the app already maintains: the existing connection stores
 * (`githubConnection`, `supabaseConnection`, `vercelConnection`, `netlifyConnection`), BuildersDB
 * configuration, and the AI usage ledger itself. Nothing here polls a provider or opens a new
 * connection, so opening the dashboard cannot itself cause load or rate limiting.
 *
 * The status vocabulary is deliberately small and honest:
 *  - `healthy`   — configured and working.
 *  - `warning`   — configured, but something is degraded (recent AI failures, for example).
 *  - `offline`   — configured but unreachable/not connected.
 *  - `not-configured` — the user has not set this up. Rendered as a neutral dash, NOT as a
 *    failure: an unconfigured optional integration is not a problem to alarm anyone about.
 *
 * Pure functions over injected state — no store reads here — so every branch is unit-testable.
 */

export type HealthStatus = 'healthy' | 'warning' | 'offline' | 'not-configured';

export interface HealthComponent {
  id: string;
  label: string;
  status: HealthStatus;

  /** One short line explaining the status — shown on hover, never invented. */
  detail: string;
}

export interface HealthInputs {
  /** Newest-first AI statuses, used to judge the provider. Empty means "no recent activity". */
  recentAiStatuses: ('success' | 'failed' | 'cancelled')[];

  /** Provider name from the most recent AI request, or null when there is none. */
  aiProvider: string | null;

  buildersDbConfigured: boolean;

  /** True when the usage ledger read succeeded — the most direct evidence BuildersDB is reachable. */
  buildersDbReachable: boolean;

  supabaseConnected: boolean;
  supabaseConfigured: boolean;
  githubConnected: boolean;

  /** Vercel/Netlify — whichever is connected. Null when neither is. */
  deploymentProvider: string | null;
  deploymentConnected: boolean;

  /** Browser storage availability, the app's local persistence layer for settings and drafts. */
  storageAvailable: boolean;

  /**
   * Telemetry self-monitoring (see app/lib/observability/telemetry/). Passed in rather than read
   * here so this module stays a pure function of its inputs.
   */
  telemetry?: {
    state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
    missing: string[];
    lastErrorMessage?: string;
  };
}

/** Judges the AI provider from recent outcomes. More than a third failing is a warning, all failing is offline. */
function resolveAiStatus(inputs: HealthInputs): HealthComponent {
  const { recentAiStatuses, aiProvider } = inputs;

  if (!aiProvider || recentAiStatuses.length === 0) {
    return {
      id: 'ai-provider',
      label: 'AI Provider',
      status: 'not-configured',
      detail: 'No AI requests recorded yet',
    };
  }

  const failures = recentAiStatuses.filter((status) => status === 'failed').length;
  const failureRate = failures / recentAiStatuses.length;

  if (failures === recentAiStatuses.length) {
    return {
      id: 'ai-provider',
      label: 'AI Provider',
      status: 'offline',
      detail: `${aiProvider}: every recent request failed`,
    };
  }

  if (failureRate > 1 / 3) {
    return {
      id: 'ai-provider',
      label: 'AI Provider',
      status: 'warning',
      detail: `${aiProvider}: ${failures} of the last ${recentAiStatuses.length} requests failed`,
    };
  }

  return { id: 'ai-provider', label: 'AI Provider', status: 'healthy', detail: `${aiProvider} responding normally` };
}

/**
 * Telemetry health. This is the component that would have surfaced the missing ledger: an absent
 * table is `offline` with the exact objects named, not a quiet nothing.
 */
function resolveTelemetryStatus(inputs: HealthInputs): HealthComponent {
  const telemetry = inputs.telemetry;

  if (!telemetry || telemetry.state === 'unknown') {
    return { id: 'telemetry', label: 'Telemetry', status: 'not-configured', detail: 'Not checked yet' };
  }

  if (telemetry.state === 'unavailable') {
    return {
      id: 'telemetry',
      label: 'Telemetry',
      status: 'offline',
      detail: `Usage is not being recorded — missing: ${telemetry.missing.join(', ')}`,
    };
  }

  if (telemetry.state === 'degraded') {
    return {
      id: 'telemetry',
      label: 'Telemetry',
      status: 'warning',
      detail: telemetry.lastErrorMessage
        ? `Logging failures detected — ${telemetry.lastErrorMessage}`
        : 'Logging failures detected',
    };
  }

  return { id: 'telemetry', label: 'Telemetry', status: 'healthy', detail: 'Usage is being recorded' };
}

export function resolveSystemHealth(inputs: HealthInputs): HealthComponent[] {
  const buildersDb: HealthComponent = !inputs.buildersDbConfigured
    ? { id: 'builders-db', label: 'BuildersDB', status: 'not-configured', detail: 'BuildersDB is not configured' }
    : inputs.buildersDbReachable
      ? { id: 'builders-db', label: 'BuildersDB', status: 'healthy', detail: 'Connected' }
      : { id: 'builders-db', label: 'BuildersDB', status: 'offline', detail: 'Configured but unreachable' };

  /*
   * Supabase here means a PROJECT's own database connection, which is separate from BuildersDB
   * even though both are Supabase — a user can have BuildersDB working and no project database.
   */
  const supabase: HealthComponent = !inputs.supabaseConfigured
    ? { id: 'supabase', label: 'Supabase', status: 'not-configured', detail: 'No project database connected' }
    : inputs.supabaseConnected
      ? { id: 'supabase', label: 'Supabase', status: 'healthy', detail: 'Project database connected' }
      : { id: 'supabase', label: 'Supabase', status: 'offline', detail: 'Configured but not connected' };

  const github: HealthComponent = inputs.githubConnected
    ? { id: 'github', label: 'GitHub', status: 'healthy', detail: 'Connected' }
    : { id: 'github', label: 'GitHub', status: 'not-configured', detail: 'Not connected' };

  const deployment: HealthComponent = !inputs.deploymentProvider
    ? { id: 'deployment', label: 'Deployment', status: 'not-configured', detail: 'No deployment provider connected' }
    : inputs.deploymentConnected
      ? { id: 'deployment', label: 'Deployment', status: 'healthy', detail: `${inputs.deploymentProvider} connected` }
      : {
          id: 'deployment',
          label: 'Deployment',
          status: 'offline',
          detail: `${inputs.deploymentProvider} not reachable`,
        };

  const storage: HealthComponent = inputs.storageAvailable
    ? { id: 'storage', label: 'Storage', status: 'healthy', detail: 'Local storage available' }
    : { id: 'storage', label: 'Storage', status: 'offline', detail: 'Local storage unavailable or full' };

  return [resolveAiStatus(inputs), resolveTelemetryStatus(inputs), buildersDb, supabase, github, deployment, storage];
}

/**
 * The single worst status across components, for the collapsed indicator in the status bar.
 * `not-configured` never escalates the overall state — an integration the user chose not to set up
 * must not make the whole system look unhealthy.
 */
export function overallHealth(components: HealthComponent[]): HealthStatus {
  if (components.some((component) => component.status === 'offline')) {
    return 'offline';
  }

  if (components.some((component) => component.status === 'warning')) {
    return 'warning';
  }

  return components.some((component) => component.status === 'healthy') ? 'healthy' : 'not-configured';
}

/** Probes browser storage by actually writing — `typeof localStorage` alone passes even when quota is exhausted or access is blocked. */
export function detectStorageAvailable(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }

    const probe = '__builders_storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);

    return true;
  } catch {
    return false;
  }
}
