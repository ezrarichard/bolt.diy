import type { RequirementsDraft } from './prompts/requirements';

/**
 * Project Definition Summary — the stats shown on the final "Approve Project Definition &
 * Start Engineering" screen (ProjectDefinitionWorkspace.tsx). Pure functions only, no React,
 * same separation every engine/prompt file in this directory already keeps.
 */

export interface ProjectDefinitionCounts {
  moduleCount: number;
  pageCount: number;
  userFlowCount: number;
}

/** Counts modules/pages/user flows straight off the draft's own list fields — no separate bookkeeping to keep in sync. */
export function countProjectDefinitionSections(draft: RequirementsDraft): ProjectDefinitionCounts {
  return {
    moduleCount: draft.coreFeatures?.length ?? 0,
    pageCount: draft.pages?.length ?? 0,
    userFlowCount: draft.userFlows?.length ?? 0,
  };
}

/**
 * Rough, presentation-only estimate of engineering time — NOT a real scheduling/estimation
 * system, just a complexity-weighted heuristic over module/page/user-flow counts so the
 * approval screen shows *something* concrete rather than nothing. Modules weigh more than
 * pages/flows since a module typically implies its own backend + data model work, not just a
 * screen. Safe to replace with a smarter estimate later (e.g. one informed by the actual
 * Architecture Draft) without any caller needing to change — this is the only place the
 * heuristic lives.
 */
export function estimateEngineeringDuration(draft: RequirementsDraft): string {
  const { moduleCount, pageCount, userFlowCount } = countProjectDefinitionSections(draft);
  const complexity = moduleCount * 2 + pageCount * 1 + userFlowCount * 1;

  if (complexity <= 5) {
    return '~1-2 days';
  }

  if (complexity <= 12) {
    return '~3-5 days';
  }

  if (complexity <= 25) {
    return '~1-2 weeks';
  }

  return '~2-4 weeks';
}
