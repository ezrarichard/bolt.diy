import { useStore } from '@nanostores/react';
import { useMemo } from 'react';
import { isBuildersDbConfigured } from '~/lib/builders-db/client';
import { isGitHubConnected } from '~/lib/stores/githubConnection';
import { supabaseConnection } from '~/lib/stores/supabase';
import { vercelConnection } from '~/lib/stores/vercel';
import { netlifyConnection } from '~/lib/stores/netlify';
import {
  detectStorageAvailable,
  overallHealth,
  resolveSystemHealth,
  type HealthComponent,
  type HealthStatus,
} from '~/lib/observability/health/systemHealth';
import type { AiUsageEvent } from '~/lib/observability/ai-usage/aiUsageQueryTypes';

/**
 * Bridges the app's existing connection stores into the pure health resolver.
 *
 * All the decision logic lives in systemHealth.ts (and is unit-tested there); this hook only
 * gathers state. Nothing here opens a connection or polls a provider — every input is state the
 * app already maintains for its own purposes, so viewing health costs nothing.
 */

const RECENT_WINDOW = 20;

export function useSystemHealth(
  events: AiUsageEvent[],
  ledgerReachable: boolean,
): {
  components: HealthComponent[];
  overall: HealthStatus;
} {
  const githubConnected = useStore(isGitHubConnected);
  const supabase = useStore(supabaseConnection);
  const vercel = useStore(vercelConnection);
  const netlify = useStore(netlifyConnection);

  return useMemo(() => {
    const recent = events.slice(0, RECENT_WINDOW);

    /* Whichever deployment provider is actually connected; Vercel wins only because it is checked first. */
    const deploymentProvider = vercel.user ? 'Vercel' : netlify.user ? 'Netlify' : null;

    const components = resolveSystemHealth({
      recentAiStatuses: recent.map((event) => event.status),
      aiProvider: events[0]?.provider ?? null,
      buildersDbConfigured: isBuildersDbConfigured(),
      buildersDbReachable: ledgerReachable,
      supabaseConfigured: Boolean(supabase.token || supabase.user),
      supabaseConnected: Boolean(supabase.user) || supabase.isConnected === true,
      githubConnected,
      deploymentProvider,
      deploymentConnected: Boolean(deploymentProvider),
      storageAvailable: detectStorageAvailable(),
    });

    return { components, overall: overallHealth(components) };
  }, [events, ledgerReachable, githubConnected, supabase, vercel, netlify]);
}
