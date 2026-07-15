import type { ProjectHydrationState } from './hydration';

/**
 * Sprint 46 — pure decision table for "should the autonomous pipeline run right now, given
 * this project's BuildersDB hydration state and how many artifacts already exist locally."
 * Extracted out of useAutoEngineeringPipeline.ts's effect so the resume/blocking rules (the
 * actual point of Sprint 46) are testable without rendering a React hook:
 *
 *  - not_started -> kick off hydration, then wait for the next status.
 *  - loading -> wait; deciding anything from `project.artifacts` right now would race a fetch
 *    that might still replace it wholesale.
 *  - failed + no local artifacts -> block. There is no safe assumption here: BuildersDB being
 *    unreachable is NOT the same as "this project has no completed roles yet," so silently
 *    proceeding could restart (and duplicate) real work the instant connectivity returns.
 *  - failed + local artifacts exist -> proceed using the local fallback, same as `ready`.
 *  - ready -> proceed; `project.artifacts` already reflects BuildersDB's merged, authoritative
 *    state (see hydrateProjectData in app/lib/stores/projects.ts).
 */
export type PipelineHydrationGate =
  | { action: 'trigger-hydration' }
  | { action: 'wait' }
  | { action: 'block'; message: string }
  | { action: 'proceed' };

export function resolvePipelineHydrationGate(
  hydrationState: ProjectHydrationState,
  localArtifactCount: number,
): PipelineHydrationGate {
  if (hydrationState.status === 'not_started') {
    return { action: 'trigger-hydration' };
  }

  if (hydrationState.status === 'loading') {
    return { action: 'wait' };
  }

  if (hydrationState.status === 'failed' && localArtifactCount === 0) {
    return {
      action: 'block',
      message: hydrationState.error ?? "Could not load this project's saved progress from BuildersDB.",
    };
  }

  return { action: 'proceed' };
}
