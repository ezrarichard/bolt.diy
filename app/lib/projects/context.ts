import { blueprintEngine, type BlueprintCategory } from '~/lib/blueprints';
import { getProjectKnowledge, type Project } from '~/lib/stores/projects';
import type { ProjectKnowledge } from '~/lib/projects/knowledge';

/**
 * Project Workspace Context — Sprint 6.
 *
 * Turns a `Project` into structured data describing "what is the active
 * project right now" for UI components (the Current Project badge, the
 * Project Dashboard, and later the AI Builder/GitHub/Supabase layers) to
 * read. Everything here is plain data — no prompt strings, no AI calls,
 * no side effects. Blueprint data always comes through blueprintEngine,
 * never a registry import, per the Sprint 5 architecture.
 */

export interface ProjectWorkspaceContext {
  id: string;
  name: string;
  description?: string;
  icon: string;
  color: string;
}

export interface ProjectBlueprintContext {
  id: string;
  name: string;
  category: BlueprintCategory;
  productType?: string;
  recommendedStack: string[];
  recommendedIntegrations: string[];
  recommendedNextSteps: string[];
}

export interface ProjectContextSummary {
  project: ProjectWorkspaceContext;
  blueprint: ProjectBlueprintContext;

  /**
   * Phase 2 Sprint 9 — structured product knowledge (see
   * app/lib/projects/knowledge.ts), when the project has any saved.
   * undefined when nothing has been captured yet. Structured data only —
   * not used in any AI prompt yet; a future sprint's AI Project Manager
   * will read this.
   */
  knowledge?: ProjectKnowledge;
}

/** The project's own fields, structured for UI consumption. */
export function getProjectWorkspaceContext(project: Project): ProjectWorkspaceContext {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    icon: project.icon,
    color: project.color,
  };
}

/**
 * The project's resolved blueprint, read entirely through blueprintEngine.
 * Falls back to the engine's default blueprint if the project has no
 * blueprintId or an unrecognized one — same fallback behavior as the
 * Project Dashboard (Sprint 4/5), kept consistent here.
 */
export function getProjectBlueprintContext(project: Project): ProjectBlueprintContext {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId) ?? blueprintEngine.getDefaultBlueprint();

  return {
    id: blueprint.id,
    name: blueprint.name,
    category: blueprintEngine.getBlueprintCategory(blueprint.id) ?? blueprint.category,
    productType: blueprintEngine.getBlueprintProductType(blueprint.id),
    recommendedStack: blueprintEngine.getRecommendedStack(blueprint.id),
    recommendedIntegrations: blueprintEngine.getRecommendedIntegrations(blueprint.id),
    recommendedNextSteps: blueprintEngine.getRecommendedNextSteps(blueprint.id),
  };
}

/** Combined project + blueprint (+ knowledge, when present) context — the one-stop shape most UI consumers want. */
export function getProjectContextSummary(project: Project): ProjectContextSummary {
  return {
    project: getProjectWorkspaceContext(project),
    blueprint: getProjectBlueprintContext(project),
    knowledge: getProjectKnowledge(project),
  };
}

/**
 * Placeholder — NOT called anywhere yet.
 *
 * A future sprint will use this to compose the actual AI system-prompt
 * fragment (project name/description/blueprint/stack/integrations, etc.)
 * once prompt injection is in scope. This sprint is architecture only:
 * calling this today has zero effect anywhere, and it intentionally
 * returns undefined.
 */
export function buildFutureProjectSystemContext(_project: Project): string | undefined {
  /*
   * TODO(Sprint 7+): build an AI system-prompt fragment from
   * getProjectContextSummary(project). Do not implement yet — no AI
   * prompt injection this sprint.
   */
  return undefined;
}
