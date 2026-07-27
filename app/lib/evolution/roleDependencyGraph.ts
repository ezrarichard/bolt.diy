import type { IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import { PIPELINE_ORDER } from '~/lib/evolution/roleSelection';

/**
 * Role Dependency Graph — Sprint 97, Parts 4/5/11.
 *
 * Sprint 96's `RoleDecision.dependsOn` is "everything upstream in the pipeline order", which is
 * the right answer to "what must be APPROVED before this role may run". It is the wrong answer to
 * "whose fresh output does this role actually read", and Parts 5 and 11 need the second question:
 * invalidation and execution ordering both depend on real edges, not on position in a list.
 *
 * SO THE EDGES ARE READ FROM THE ENGINES THEMSELVES, not invented here:
 *
 *   GATE_DEPENDENCY  — the single artifact each role's own `canGenerate` requires, verbatim:
 *       productowner ← requirements (isRequirementsCaptured), architecture ← productowner,
 *       database ← architecture, uiux ← architecture, backend ← database, frontend ← backend,
 *       qa ← frontend, devops ← qa.
 *   CONSUMED_ARTIFACTS — every OTHER approved artifact type a role's `buildXContext` reads
 *       (`getApprovedArtifactContent` calls in each engine file, minus its own type). These are
 *       real reads: a change to one of them changes what the consuming role would produce.
 *
 * If an engine's gates or context reads change, these tables must change with them — that is why
 * each entry names the engine it came from rather than asserting a general architecture.
 */

/** The one artifact each role's `canGenerate` blocks on. `requirements` has no producer role (its input is human knowledge). */
export const GATE_DEPENDENCY: Partial<Record<IncrementalRoleId, IncrementalRoleId>> = {
  /** productOwnerEngine.canGenerateProductOwner — requires captured requirements. */
  productowner: 'requirements',

  /** solutionArchitectEngine.canGenerateArchitecture — requires an approved Product Owner draft. */
  architecture: 'productowner',

  /** databaseDesignerEngine.canGenerateDatabase — requires an approved Architecture draft. */
  database: 'architecture',

  /** uiuxDesignerEngine.canGenerateUIUX — requires an approved Architecture draft. */
  uiux: 'architecture',

  /** backendEngineerEngine.canGenerateBackend — requires an approved Database draft. */
  backend: 'database',

  /** frontendEngineerEngine.canGenerateFrontend — requires an approved Backend draft. */
  frontend: 'backend',

  /** qaEngineerEngine.canGenerateQA — requires an approved Frontend draft. */
  qa: 'frontend',

  /** devopsEngineerEngine.canGenerateDevOps — requires an approved QA draft. */
  devops: 'qa',
};

/**
 * Every approved upstream artifact a role's context builder actually reads, gate included. Taken
 * from the `ARTIFACT_TYPES.*` references in each engine's `buildXContext`, with the role's own
 * type removed (a role reading its own previous version is a revision, not a dependency).
 */
export const CONSUMED_ARTIFACTS: Record<IncrementalRoleId, IncrementalRoleId[]> = {
  requirements: [],
  productowner: ['requirements'],
  architecture: ['requirements', 'productowner'],
  database: ['productowner', 'architecture'],
  uiux: ['productowner', 'architecture'],
  backend: ['productowner', 'architecture', 'database'],
  frontend: ['productowner', 'architecture', 'uiux', 'backend'],
  qa: ['productowner', 'architecture', 'database', 'uiux', 'backend', 'frontend'],
  devops: ['productowner', 'architecture', 'database', 'uiux', 'backend', 'frontend', 'qa'],
};

/** Roles whose output describes generated code. Used by Part 4's QA rule and Part 12's review gating. */
export const CODE_PRODUCING_ROLES: IncrementalRoleId[] = ['database', 'uiux', 'backend', 'frontend'];

/** Roles that read `role`'s output directly. Derived, never restated. */
export function directConsumersOf(role: IncrementalRoleId): IncrementalRoleId[] {
  return PIPELINE_ORDER.filter((candidate) => CONSUMED_ARTIFACTS[candidate].includes(role));
}

/** Roles whose gate is `role` — the strongest edge there is: they cannot run at all without it. */
export function gateConsumersOf(role: IncrementalRoleId): IncrementalRoleId[] {
  return PIPELINE_ORDER.filter((candidate) => GATE_DEPENDENCY[candidate] === role);
}

/** Every role reachable downstream of `role` through consumption edges. */
export function transitiveConsumersOf(role: IncrementalRoleId): IncrementalRoleId[] {
  const found = new Set<IncrementalRoleId>();
  const queue = [...directConsumersOf(role)];

  while (queue.length > 0) {
    const next = queue.shift()!;

    if (found.has(next)) {
      continue;
    }

    found.add(next);
    queue.push(...directConsumersOf(next));
  }

  return PIPELINE_ORDER.filter((candidate) => found.has(candidate));
}

/** Pipeline position, used everywhere ordering matters. `-1` for a role the pipeline does not contain. */
export function positionOf(role: IncrementalRoleId): number {
  return PIPELINE_ORDER.indexOf(role);
}

export function isKnownRole(role: string): role is IncrementalRoleId {
  return PIPELINE_ORDER.includes(role as IncrementalRoleId);
}

/**
 * Part 11 — roles that may safely run at the same time: no consumption edge between them, in
 * either direction. Returned as ordered groups over the approved selection.
 *
 * THE RUNNER DOES NOT USE THIS TO PARALLELISE. Sprint 97 executes strictly sequentially (Part 11's
 * stated preference, and the existing orchestrator is itself sequential — `useAutoEngineeringPipeline`
 * runs one role at a time against a store it re-reads each iteration). This function exists so the
 * independence claim is computed and testable rather than asserted, and so a later sprint that does
 * parallelise has the graph answer already proven.
 */
export function independentGroups(roles: IncrementalRoleId[]): IncrementalRoleId[][] {
  const ordered = PIPELINE_ORDER.filter((role) => roles.includes(role));
  const groups: IncrementalRoleId[][] = [];

  for (const role of ordered) {
    const target = groups.find((group) =>
      group.every(
        (member) =>
          !CONSUMED_ARTIFACTS[role].includes(member) &&
          !CONSUMED_ARTIFACTS[member].includes(role) &&
          !transitiveConsumersOf(member).includes(role) &&
          !transitiveConsumersOf(role).includes(member),
      ),
    );

    if (target) {
      target.push(role);
    } else {
      groups.push([role]);
    }
  }

  return groups;
}
