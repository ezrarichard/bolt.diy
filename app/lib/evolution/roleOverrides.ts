import {
  INCREMENTAL_ROLE_LABELS,
  type IncrementalEngineeringPlan,
  type IncrementalRoleId,
} from '~/lib/evolution/engineeringScopeTypes';
import type {
  RoleOverride,
  RoleOverrideViolation,
  RoleSelectionResolution,
} from '~/lib/evolution/incrementalExecutionTypes';
import {
  CODE_PRODUCING_ROLES,
  isKnownRole,
  positionOf,
  transitiveConsumersOf,
} from '~/lib/evolution/roleDependencyGraph';
import { PIPELINE_ORDER } from '~/lib/evolution/roleSelection';

/**
 * Operator Review and Role Override — Sprint 97, Part 4.
 *
 * The plan recommends; the operator decides. This module is the whole of that decision: pure,
 * deterministic, and the only place an approved role selection can be produced. The runner refuses
 * to execute anything this function did not return as `ok`.
 *
 * "DO NOT PERMIT INVALID EXECUTION GRAPHS" is enforced, not advised. An override that would leave
 * the pipeline in a state its own gates cannot honour is REJECTED with a named violation, and the
 * caller gets the recommended selection back unchanged — never a half-applied set.
 *
 * THE RULES, AND WHY EACH ONE EXISTS:
 *
 *  1. Every override needs a reason (Part 4, explicit). A selection changed without a recorded
 *     reason is indistinguishable from a bug six months later.
 *  2. An override must change something. Including an already-selected role or excluding an
 *     already-skipped one is rejected rather than silently absorbed, so the persisted override
 *     list never contains entries that did nothing.
 *  3. QA cannot be removed while any code-producing role runs (Part 4, explicit). Database,
 *     UI/UX, Backend and Frontend all describe generated code; shipping a change to any of them
 *     with no re-verification is exactly the failure mode incremental engineering must not enable.
 *  4. A role cannot be excluded while a role that CONSUMES its output still runs. If Backend
 *     re-runs, its output changes; Frontend reads that output (frontendEngineerEngine's
 *     `buildFrontendContext` reads the Backend draft), so a Frontend run without a Backend run
 *     would be built on the released Backend design while the real one is being rewritten. This
 *     is the "hard dependency" Part 4 names, read from the engines rather than assumed.
 *  5. A role the operator ADDS must have a buildable reduced context (Part 4, explicit). Roles
 *     the plan never selected have no `ReducedRoleContext`, so one is derived from the scope; if
 *     the scope contains nothing that role could act on, the addition is rejected rather than
 *     executed against an empty brief.
 */

function violation(
  code: RoleOverrideViolation['code'],
  role: IncrementalRoleId,
  message: string,
): RoleOverrideViolation {
  return { code, role, message };
}

/** Which scope slices make a role's reduced context non-empty. Mirrors `engineeringContextReducer`'s own needs table. */
function hasScopeFor(role: IncrementalRoleId, plan: IncrementalEngineeringPlan): boolean {
  const { scope } = plan;
  const anyFiles = scope.affectedPages.length + scope.affectedComponents.length > 0;

  switch (role) {
    case 'requirements':
    case 'productowner':
      return scope.affectedFeatures.length > 0;
    case 'architecture':
      return (
        scope.affectedFeatures.length > 0 ||
        anyFiles ||
        scope.affectedDatabaseObjects.length > 0 ||
        scope.affectedApis.length > 0 ||
        scope.affectedEnvironment.length > 0
      );
    case 'database':
      return scope.affectedDatabaseObjects.length > 0;
    case 'uiux':
    case 'frontend':
      return anyFiles;
    case 'backend':
      return scope.affectedApis.length > 0 || scope.affectedDatabaseObjects.length > 0 || anyFiles;
    case 'devops':
      return scope.affectedEnvironment.length > 0;
    case 'qa':
      /* QA verifies whatever else changes — any non-empty scope is a brief it can act on. */
      return (
        scope.affectedFeatures.length > 0 ||
        anyFiles ||
        scope.affectedDatabaseObjects.length > 0 ||
        scope.affectedApis.length > 0
      );
    default:
      return false;
  }
}

export interface ResolveRoleSelectionInput {
  plan: IncrementalEngineeringPlan;
  overrides?: RoleOverride[];
}

/**
 * Applies operator overrides to the plan's recommendation and validates the result as a whole.
 *
 * Validation is done on the FINAL set, not per override: two overrides can each be individually
 * sensible and jointly produce an invalid graph (exclude Backend, exclude QA), and only the final
 * set can catch that. On any violation the approved selection falls back to the recommendation —
 * "restore recommended selection" (Part 4) is therefore also just `resolveRoleSelection` with no
 * overrides.
 */
export function resolveRoleSelection(input: ResolveRoleSelectionInput): RoleSelectionResolution {
  const recommendedRoles = input.plan.executionOrder.map((phase) => phase.role);
  const overrides = input.overrides ?? [];
  const violations: RoleOverrideViolation[] = [];

  const selection = new Set<IncrementalRoleId>(recommendedRoles);
  const seen = new Set<string>();
  const applied: RoleOverride[] = [];

  for (const override of overrides) {
    if (!isKnownRole(override.role)) {
      violations.push(
        violation('unknown_role', override.role, `"${override.role}" is not a role in the engineering pipeline.`),
      );
      continue;
    }

    if (!override.reason?.trim()) {
      violations.push(
        violation(
          'missing_reason',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]}: every role override needs a recorded reason.`,
        ),
      );
      continue;
    }

    if (seen.has(override.role)) {
      violations.push(
        violation(
          'duplicate_override',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]} has more than one override — decide once.`,
        ),
      );
      continue;
    }

    seen.add(override.role);

    const alreadySelected = selection.has(override.role);

    if (override.action === 'include' && alreadySelected) {
      violations.push(
        violation(
          'not_applicable',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]} is already selected — no override needed.`,
        ),
      );
      continue;
    }

    if (override.action === 'exclude' && !alreadySelected) {
      violations.push(
        violation(
          'not_applicable',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]} is already skipped — no override needed.`,
        ),
      );
      continue;
    }

    if (override.action === 'include' && !hasScopeFor(override.role, input.plan)) {
      violations.push(
        violation(
          'no_reduced_context',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]} cannot be added: the approved scope contains nothing this role could work from, so it would receive an empty brief.`,
        ),
      );
      continue;
    }

    if (override.action === 'include') {
      selection.add(override.role);
    } else {
      selection.delete(override.role);
    }

    applied.push({ ...override, reason: override.reason.trim() });
  }

  const approved = PIPELINE_ORDER.filter((role) => selection.has(role));

  /* Rule 3 — QA is mandatory whenever generated code is described by a role that runs. */
  const runsCode = approved.some((role) => CODE_PRODUCING_ROLES.includes(role));

  if (runsCode && !approved.includes('qa')) {
    violations.push(
      violation(
        'qa_required',
        'qa',
        `QA Engineer cannot be excluded while ${approved
          .filter((role) => CODE_PRODUCING_ROLES.includes(role))
          .map((role) => INCREMENTAL_ROLE_LABELS[role])
          .join(', ')} run — generated code changes must be re-verified.`,
      ),
    );
  }

  /* Rule 4 — no approved role may be left consuming an output that is being rewritten without it. */
  for (const override of applied) {
    if (override.action !== 'exclude') {
      continue;
    }

    const strandedConsumers = transitiveConsumersOf(override.role).filter((consumer) => approved.includes(consumer));

    if (strandedConsumers.length > 0) {
      violations.push(
        violation(
          'dependency_broken',
          override.role,
          `${INCREMENTAL_ROLE_LABELS[override.role]} cannot be excluded while ${strandedConsumers
            .map((role) => INCREMENTAL_ROLE_LABELS[role])
            .join(
              ', ',
            )} still run — they read its output, so they would be built on the released version while it changes.`,
        ),
      );
    }
  }

  if (violations.length > 0) {
    return {
      ok: false,
      recommendedRoles,
      approvedRoles: recommendedRoles,
      appliedOverrides: [],
      violations,
    };
  }

  return {
    ok: true,
    recommendedRoles,
    approvedRoles: approved,
    appliedOverrides: applied,
    violations: [],
  };
}

/** Part 4's "restore recommended selection", named so the intent is explicit at every call site. */
export function restoreRecommendedSelection(plan: IncrementalEngineeringPlan): RoleSelectionResolution {
  return resolveRoleSelection({ plan, overrides: [] });
}

/**
 * Part 11 — the approved roles in the pipeline's own order. Never rearranged: the existing gates
 * (`canGenerate`) depend on that order, and reordering them would be redesigning the pipeline.
 */
export function approvedExecutionOrder(approvedRoles: IncrementalRoleId[]): IncrementalRoleId[] {
  return PIPELINE_ORDER.filter((role) => approvedRoles.includes(role)).sort((a, b) => positionOf(a) - positionOf(b));
}
