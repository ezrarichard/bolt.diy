import {
  INCREMENTAL_ROLE_LABELS,
  REVIEW_STAGE_LABELS,
  type IncrementalRoleId,
  type ReviewRequirement,
  type ReviewStage,
} from '~/lib/evolution/engineeringScopeTypes';
import { materialDiscoveries } from '~/lib/evolution/discoveredImpact';
import type {
  DiscoveredImpact,
  IncrementalReviewResult,
  IncrementalRoleRun,
  ScopeExpansionDecision,
} from '~/lib/evolution/incrementalExecutionTypes';
import { CODE_PRODUCING_ROLES } from '~/lib/evolution/roleDependencyGraph';

/**
 * Incremental Reviews — Sprint 97, Part 12.
 *
 * REUSES THE EXISTING REVIEW VOCABULARY. The stages are Sprint 96's `ReviewStage` (Product Review,
 * Roadmap Review, Code Review, customer sign-off), which are the gates this platform genuinely has.
 * Nothing new is invented, and only the stages the approved plan marked `required` are applied —
 * a change that touches no generated code does not manufacture a Code Review.
 *
 * THE ONE RULE THAT MATTERS: an output that exceeded its scope cannot be approved. When a role
 * reported material impact outside scope and no operator has approved an expansion, the review
 * returns `blocked_by_scope` — not `changes_requested`, because nothing is wrong with the OUTPUT;
 * what is missing is a decision. Conflating the two would let a reviewer "fix" a scope problem by
 * asking for edits.
 */

/** Which roles each stage covers. Mirrors `resolveReviewRequirements`' own reasoning in Sprint 96. */
const STAGE_ROLES: Record<ReviewStage, IncrementalRoleId[]> = {
  product_review: ['requirements'],
  roadmap_review: ['productowner'],
  code_review: CODE_PRODUCING_ROLES,
  customer_signoff: ['requirements', 'productowner'],
};

export interface EvaluateReviewsInput {
  /** Only the stages the approved plan requires. */
  reviewRequirements: ReviewRequirement[];
  roleRuns: IncrementalRoleRun[];
  discoveredImpacts: DiscoveredImpact[];
  scopeExpansionDecisions: ScopeExpansionDecision[];
  reviewedAt: string;
}

/**
 * A deterministic first-pass review of an incremental execution. Deliberately mechanical: it
 * checks that the roles a stage covers actually completed, and that nothing in the run escaped the
 * approved scope. It is not an AI reviewer and does not pretend to judge quality — a
 * `changes_requested` here always names a concrete, checkable reason.
 */
export function evaluateIncrementalReviews(input: EvaluateReviewsInput): IncrementalReviewResult[] {
  const required = input.reviewRequirements.filter((requirement) => requirement.required);

  /* An approved expansion or an explicit "continue" is what unblocks a scope-exceeding output. */
  const scopeSettled = input.scopeExpansionDecisions.length > 0;
  const unresolvedDiscoveries = scopeSettled ? [] : materialDiscoveries(input.discoveredImpacts);

  return required.map((requirement) => {
    const coveredRoles = STAGE_ROLES[requirement.stage].filter((role) =>
      input.roleRuns.some((run) => run.role === role),
    );

    const runsForStage = input.roleRuns.filter((run) => coveredRoles.includes(run.role));
    const failed = runsForStage.filter((run) => run.status === 'failed');
    const incomplete = runsForStage.filter((run) => run.status !== 'completed' && run.status !== 'failed');

    const stageDiscoveries = unresolvedDiscoveries.filter(
      (discovery) => discovery.reportedByRole && coveredRoles.includes(discovery.reportedByRole),
    );

    const base = {
      stage: requirement.stage,
      label: REVIEW_STAGE_LABELS[requirement.stage],
      coveredRoles,
      reviewedAt: input.reviewedAt,
    };

    if (stageDiscoveries.length > 0) {
      return {
        ...base,
        decision: 'blocked_by_scope' as const,
        reasoning: `${stageDiscoveries.length} finding(s) outside the approved scope were reported by ${stageDiscoveries
          .map((discovery) => INCREMENTAL_ROLE_LABELS[discovery.reportedByRole!])
          .join(
            ', ',
          )} and no scope decision has been recorded. This output cannot be approved until an operator decides.`,
      };
    }

    if (failed.length > 0) {
      return {
        ...base,
        decision: 'rejected' as const,
        reasoning: `${failed.map((run) => run.label).join(', ')} failed, so there is no complete output to review.`,
      };
    }

    if (incomplete.length > 0) {
      return {
        ...base,
        decision: 'changes_requested' as const,
        reasoning: `${incomplete.map((run) => run.label).join(', ')} did not complete, so this gate cannot pass yet.`,
      };
    }

    if (runsForStage.length === 0) {
      return {
        ...base,
        decision: 'changes_requested' as const,
        reasoning: `${REVIEW_STAGE_LABELS[requirement.stage]} is required by the approved plan, but no role covering it ran in this execution.`,
      };
    }

    return {
      ...base,
      decision: 'approved' as const,
      reasoning: `${runsForStage
        .map((run) => run.label)
        .join(', ')} completed within the approved scope and reported no impact outside it.`,
    };
  });
}

export function reviewsPassed(reviews: IncrementalReviewResult[]): boolean {
  return reviews.every((review) => review.decision === 'approved');
}

export function blockingReviews(reviews: IncrementalReviewResult[]): IncrementalReviewResult[] {
  return reviews.filter((review) => review.decision === 'blocked_by_scope' || review.decision === 'rejected');
}
