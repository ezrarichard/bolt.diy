import { INCREMENTAL_ROLE_LABELS, type IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import type { InvalidationDecision } from '~/lib/evolution/incrementalExecutionTypes';
import { CONSUMED_ARTIFACTS, GATE_DEPENDENCY, transitiveConsumersOf } from '~/lib/evolution/roleDependencyGraph';
import { PIPELINE_ORDER } from '~/lib/evolution/roleSelection';

/**
 * Downstream Invalidation Policy — Sprint 97, Part 5.
 *
 * Sprint 96 REPORTED that re-running a role may leave later approved artifacts stale
 * (`detectStaleDownstreamRisks`) and said so honestly rather than resolving it. This resolves it,
 * deterministically, from the dependency edges in `roleDependencyGraph.ts` — which are themselves
 * read from the engines' own gates and context reads, not from position in a list.
 *
 * FOUR STATES, ONE RULE EACH:
 *
 *   invalidated       The role is executing (its released output is being replaced), OR its GATE
 *                     producer is executing. A gate edge is the strongest there is: the consuming
 *                     role literally cannot run without that artifact, so a rewritten gate artifact
 *                     means the consumer's output answers a question that no longer holds.
 *   potentially_stale A non-gate producer it READS is executing. The artifact may still be
 *                     entirely correct — the executing role may change nothing this consumer
 *                     depended on — so this is a flag for review, not a demand to re-run.
 *   requires_review   Only a transitively upstream role is executing. The effect, if any, is
 *                     indirect; a human should look, and nothing more is claimed.
 *   valid             Nothing upstream of it is executing at all.
 *
 * WHAT THIS POLICY WILL NOT DO (Part 5's prohibitions, and one of its own):
 *  - it never deletes an artifact;
 *  - it never marks an old artifact approved;
 *  - it never expands the execution. `mustRerun` on a role that is NOT approved is reported as a
 *    finding, and the runner turns it into a BLOCK requiring an operator decision (Part 7's
 *    "invalidated dependency missing from execution"). Silently adding the role would be automatic
 *    scope expansion, which this sprint explicitly forbids.
 */

export interface InvalidationPolicyInput {
  /** The approved role selection — what will actually run. */
  approvedRoles: IncrementalRoleId[];

  /** Each role's artifact type, from the plan's own role decisions. */
  artifactTypeByRole?: Partial<Record<IncrementalRoleId, string | undefined>>;
}

/** One decision per pipeline role, in pipeline order. Total: no role is left unaccounted for. */
export function applyInvalidationPolicy(input: InvalidationPolicyInput): InvalidationDecision[] {
  const executing = new Set(input.approvedRoles);

  return PIPELINE_ORDER.map((role) => {
    const artifactType = input.artifactTypeByRole?.[role];
    const label = INCREMENTAL_ROLE_LABELS[role];

    if (executing.has(role)) {
      return {
        role,
        label,
        artifactType,
        state: 'invalidated' as const,
        mustRerun: true,
        requiresReview: true,
        causedBy: [role],
        reasoning: `${label} is in the approved selection, so its released output is being replaced by this execution.`,
        evidence: [`${role} ← (this execution)`],
      };
    }

    const gate = GATE_DEPENDENCY[role];
    const gateExecuting = gate && executing.has(gate);

    const directExecuting = CONSUMED_ARTIFACTS[role].filter((producer) => executing.has(producer) && producer !== gate);

    const indirectExecuting = PIPELINE_ORDER.filter(
      (candidate) =>
        executing.has(candidate) &&
        candidate !== gate &&
        !CONSUMED_ARTIFACTS[role].includes(candidate) &&
        transitiveConsumersOf(candidate).includes(role),
    );

    if (gateExecuting) {
      return {
        role,
        label,
        artifactType,
        state: 'invalidated' as const,
        mustRerun: true,
        requiresReview: true,
        causedBy: [gate!, ...directExecuting],
        reasoning: `${label} cannot run at all without ${INCREMENTAL_ROLE_LABELS[gate!]}'s artifact, and that artifact is being rewritten — the released ${label} output was produced against a design that no longer holds.`,
        evidence: [
          `${role} ← ${gate} (gate: canGenerate requires the ${INCREMENTAL_ROLE_LABELS[gate!]} artifact)`,
          ...directExecuting.map((producer) => `${role} ← ${producer} (context read)`),
        ],
      };
    }

    if (directExecuting.length > 0) {
      return {
        role,
        label,
        artifactType,
        state: 'potentially_stale' as const,
        mustRerun: false,
        requiresReview: true,
        causedBy: directExecuting,
        reasoning: `${label} reads ${directExecuting
          .map((producer) => INCREMENTAL_ROLE_LABELS[producer])
          .join(
            ', ',
          )}, which ${directExecuting.length === 1 ? 'is' : 'are'} being rewritten. The released output may still be correct — review it against the new output before relying on it.`,
        evidence: directExecuting.map((producer) => `${role} ← ${producer} (context read, not a gate)`),
      };
    }

    if (indirectExecuting.length > 0) {
      return {
        role,
        label,
        artifactType,
        state: 'requires_review' as const,
        mustRerun: false,
        requiresReview: true,
        causedBy: indirectExecuting,
        reasoning: `${label} does not read ${indirectExecuting
          .map((producer) => INCREMENTAL_ROLE_LABELS[producer])
          .join(
            ', ',
          )} directly, but sits downstream of ${indirectExecuting.length === 1 ? 'it' : 'them'} — any effect would be indirect and is not assumed.`,
        evidence: indirectExecuting.map((producer) => `${role} ⟵⟵ ${producer} (transitive)`),
      };
    }

    return {
      role,
      label,
      artifactType,
      state: 'valid' as const,
      mustRerun: false,
      requiresReview: false,
      causedBy: [],
      reasoning: `Nothing ${label} depends on is being re-run, so the released artifact still applies unchanged.`,
      evidence: [],
    };
  });
}

/**
 * Every artifact the policy says MUST be regenerated that the approved selection does not
 * regenerate. Reported to the operator on the dashboard; NOT on its own a reason to stop.
 *
 * Most entries here are benign and expected — that is the whole thesis of incremental engineering.
 * Re-running QA invalidates the DevOps artifact by the gate rule, but nothing in this execution
 * READS the DevOps artifact, so a stale one harms nothing today: it is a flag on a document, and
 * the operator can raise a follow-up change request for it.
 */
export function missingMandatoryReruns(
  decisions: InvalidationDecision[],
  approvedRoles: IncrementalRoleId[],
): InvalidationDecision[] {
  return decisions.filter((decision) => decision.mustRerun && !approvedRoles.includes(decision.role));
}

/**
 * Part 7's `invalidated_dependency_missing`, narrowed to the case that is actually unsafe: an
 * invalidated artifact that a role IN THIS EXECUTION will read.
 *
 * That is the real failure — QA verifying against a Database design that Architecture's re-run has
 * invalidated, while nobody re-runs the Database Engineer. The role would be handed a document the
 * policy has just declared untrustworthy, and would have no way to know.
 *
 * The broader "something downstream is stale" case is deliberately NOT blocking. Blocking on it
 * would make almost every incremental change require the full pipeline, which is the exact outcome
 * this whole feature exists to avoid — and it would train operators to click past the block.
 */
export function blockingInvalidatedInputs(
  decisions: InvalidationDecision[],
  approvedRoles: IncrementalRoleId[],
): InvalidationDecision[] {
  const consumedByApproved = new Set(
    approvedRoles
      .flatMap((role) => CONSUMED_ARTIFACTS[role] ?? [])
      .filter((producer) => !approvedRoles.includes(producer)),
  );

  return decisions.filter(
    (decision) => decision.mustRerun && !approvedRoles.includes(decision.role) && consumedByApproved.has(decision.role),
  );
}

/** The review-only roles: not executing, not required to, but flagged for a human. */
export function reviewOnlyRoles(
  decisions: InvalidationDecision[],
  approvedRoles: IncrementalRoleId[],
): IncrementalRoleId[] {
  return decisions
    .filter((decision) => !approvedRoles.includes(decision.role) && decision.requiresReview && !decision.mustRerun)
    .map((decision) => decision.role);
}

export function summariseInvalidations(decisions: InvalidationDecision[]): string {
  const counts = decisions.reduce<Record<string, number>>((accumulator, decision) => {
    accumulator[decision.state] = (accumulator[decision.state] ?? 0) + 1;
    return accumulator;
  }, {});

  return PIPELINE_ORDER.length === 0
    ? 'No roles to assess.'
    : `${counts.invalidated ?? 0} invalidated, ${counts.potentially_stale ?? 0} potentially stale, ${counts.requires_review ?? 0} to review, ${counts.valid ?? 0} unaffected.`;
}
