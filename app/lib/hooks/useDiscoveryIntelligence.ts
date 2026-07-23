import { useEffect, useState } from 'react';
import { isBuildersDbAvailable } from '~/lib/builders-db/repositories/buildersDbRepository';
import { getLatestRequirementsSession } from '~/lib/builders-db/repositories/requirementsSessionRepository';
import { getBusinessUnderstandingModel } from '~/lib/builders-db/repositories/businessUnderstandingRepository';
import type { BusinessUnderstandingModel, RequirementsSession } from '~/lib/projects/requirementsSession';

/**
 * Sprint 54.1 — Discovery Intelligence UI Integration.
 *
 * Read path for the Sprint 50-54 durable discovery pipeline (Requirements Session ->
 * Business Understanding Model -> Business Assessment -> Discovery Decision), all of which
 * was, until this sprint, written to BuildersDB but never read back by any UI component.
 * Reuses the exact repository functions the write path (`requirementsSessionOrchestrator.ts`)
 * already calls — no new Supabase client, no duplicated query logic.
 *
 * Every distinct "nothing to show" case is its own status so the caller can render the
 * empty/legacy copy the sprint brief calls for, rather than a single ambiguous `null`:
 * - 'unavailable' — BuildersDB isn't configured/reachable (never a customer-facing error).
 * - 'no-session' — legacy project, or a session was never created (pre-Sprint-51 project).
 * - 'no-model' — a session exists but the model row hasn't been initialized yet.
 * - 'error' — an actual fetch failure (network, etc.) — logged, never thrown.
 */
export type DiscoveryIntelligenceState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'no-session' }
  | { status: 'no-model' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: RequirementsSession; model: BusinessUnderstandingModel };

export function useDiscoveryIntelligence(
  projectId: string | undefined,
  refreshKey: number = 0,
): DiscoveryIntelligenceState {
  const [state, setState] = useState<DiscoveryIntelligenceState>({ status: 'loading' });

  /*
   * Resets synchronously during render (React's documented "adjusting state when a prop
   * changes" pattern) rather than in the effect below — switching projects must never paint
   * even one frame of the previous project's discovery data before the new fetch resolves.
   */
  const [loadedForKey, setLoadedForKey] = useState<string>('');
  const currentKey = `${projectId ?? ''}:${refreshKey}`;

  if (currentKey !== loadedForKey) {
    setLoadedForKey(currentKey);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    if (!projectId) {
      setState({ status: 'no-session' });
      return undefined;
    }

    if (!isBuildersDbAvailable()) {
      setState({ status: 'unavailable' });
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const session = await getLatestRequirementsSession(projectId);

        if (cancelled) {
          return;
        }

        if (!session) {
          setState({ status: 'no-session' });
          return;
        }

        const model = await getBusinessUnderstandingModel(session.id);

        if (cancelled) {
          return;
        }

        if (!model) {
          setState({ status: 'no-model' });
          return;
        }

        setState({ status: 'ready', session, model });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  return state;
}
