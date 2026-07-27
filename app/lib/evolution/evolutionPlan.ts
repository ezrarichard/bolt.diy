import {
  CHANGE_CATEGORY_LABELS,
  type ChangeRequest,
  type ChangeRequestPriority,
} from '~/lib/evolution/changeRequestTypes';
import {
  COMPLEXITY_LEVEL_LABELS,
  ENGINEERING_ROLE_LABELS,
  RISK_LEVEL_LABELS,
  type EngineeringRole,
  type ImpactAnalysis,
  type RiskLevel,
} from '~/lib/evolution/impactTypes';

/**
 * Evolution Plan — Sprint 95, Part 6.
 *
 * The last step of this sprint and the boundary of it: a plan says WHAT would need to happen and
 * WHO would need to be involved, and stops there. It creates no MVP, writes no manifest, schedules
 * no sprint and generates no code — every "suggested" field is a recommendation for a human to act
 * on, named as such.
 *
 * Pure projection of an `ImpactAnalysis` plus the request that produced it. No new facts are
 * introduced: if the analysis found nothing, the plan says so rather than inventing phases.
 */

export type SuggestedMvpPlacement = 'current_mvp_maintenance' | 'next_mvp' | 'dedicated_mvp' | 'needs_scoping';

export interface EvolutionPhase {
  id: string;
  name: string;

  /** Which roles carry this phase — drawn from the analysis, never expanded. */
  roles: EngineeringRole[];
  detail: string;
}

export interface EvolutionPlan {
  summary: string;

  /** The grounded artifacts this change would touch, grouped for a human reader. */
  affectedArtifacts: Array<{ group: string; items: string[] }>;

  requiredRoles: Array<{ role: EngineeringRole; label: string; reason: string }>;

  /** Existing Builders review gates this change would have to pass. Named from what the platform really has. */
  requiredReviews: string[];

  estimatedPhases: EvolutionPhase[];
  estimatedRisks: Array<{ label: string; detail: string }>;

  /** A recommendation for a human. Nothing is created, scheduled or scoped by this plan. */
  suggestedMvp: { placement: SuggestedMvpPlacement; label: string; reasoning: string };
  suggestedSprint: string;
  suggestedPriority: ChangeRequestPriority;

  /** Work this plan deliberately excludes, so the boundary is explicit rather than assumed. */
  futureScope: string[];

  createdAt: string;
}

const PLACEMENT_LABELS: Record<SuggestedMvpPlacement, string> = {
  current_mvp_maintenance: 'Maintenance of the current MVP',
  next_mvp: 'Schedule into the next MVP',
  dedicated_mvp: 'Scope as its own MVP',
  needs_scoping: 'Needs scoping before it can be placed',
};

function suggestPlacement(analysis: ImpactAnalysis): {
  placement: SuggestedMvpPlacement;
  label: string;
  reasoning: string;
} {
  const { complexity, classification, summary } = analysis;

  if (summary.totalFindings === 0) {
    return {
      placement: 'needs_scoping',
      label: PLACEMENT_LABELS.needs_scoping,
      reasoning: 'Nothing in the released baseline was matched, so there is not enough information to place this work.',
    };
  }

  if (classification.category === 'major_expansion' || complexity.level === 'very_large') {
    return {
      placement: 'dedicated_mvp',
      label: PLACEMENT_LABELS.dedicated_mvp,
      reasoning: `${classification.category === 'major_expansion' ? 'Classified as a major product expansion' : 'Estimated very large'}, which is new scope rather than a change to the delivered MVP.`,
    };
  }

  if (complexity.level === 'large' || analysis.summary.affectedFeatures >= 3) {
    return {
      placement: 'next_mvp',
      label: PLACEMENT_LABELS.next_mvp,
      reasoning: `${complexity.level === 'large' ? 'Estimated large' : `${analysis.summary.affectedFeatures} released features implicated`} — too broad to absorb as maintenance.`,
    };
  }

  return {
    placement: 'current_mvp_maintenance',
    label: PLACEMENT_LABELS.current_mvp_maintenance,
    reasoning: `Estimated ${COMPLEXITY_LEVEL_LABELS[complexity.level].toLowerCase()} and confined to ${analysis.summary.affectedFeatures} released feature(s).`,
  };
}

/** Phases come from the roles the analysis actually found — never a fixed template. */
function buildPhases(analysis: ImpactAnalysis): EvolutionPhase[] {
  const roles = new Set(analysis.roles.map((entry) => entry.role));
  const phases: EvolutionPhase[] = [];

  if (roles.has('business_analyst') || roles.has('product_owner')) {
    phases.push({
      id: 'scope',
      name: 'Confirm scope',
      roles: [...roles].filter((role) => role === 'business_analyst' || role === 'product_owner'),
      detail: 'Turn the customer request into agreed requirements and place it in the roadmap.',
    });
  }

  if (roles.has('solution_architect')) {
    phases.push({
      id: 'design',
      name: 'Architecture decision',
      roles: ['solution_architect'],
      detail: 'Decide how the change fits the released architecture before anything is built.',
    });
  }

  if (roles.has('ui_ux')) {
    phases.push({ id: 'ux', name: 'Design', roles: ['ui_ux'], detail: 'Design the user-facing change.' });
  }

  const buildRoles = [...roles].filter((role) =>
    ['database_engineer', 'backend_engineer', 'frontend_engineer'].includes(role),
  );

  if (buildRoles.length > 0) {
    phases.push({
      id: 'build',
      name: 'Implementation',
      roles: buildRoles,
      detail: `Implement the change across ${analysis.summary.affectedFiles} implicated file(s).`,
    });
  }

  if (roles.has('qa')) {
    phases.push({
      id: 'verify',
      name: 'Verification',
      roles: ['qa'],
      detail: 'Re-verify the live application, including the checks that currently cover the affected areas.',
    });
  }

  if (roles.has('devops')) {
    phases.push({
      id: 'release',
      name: 'Deploy and release',
      roles: ['devops'],
      detail: 'Update environment configuration, redeploy and cut a new release from the updated baseline.',
    });
  }

  return phases;
}

/** Only review gates this platform genuinely has (Product Review, Roadmap Review, Code Review). */
function buildRequiredReviews(analysis: ImpactAnalysis): string[] {
  const reviews: string[] = [];
  const roles = new Set(analysis.roles.map((entry) => entry.role));

  if (roles.has('product_owner')) {
    reviews.push('Roadmap Review — the change alters what the next MVP contains.');
  }

  if (roles.has('business_analyst')) {
    reviews.push('Product Review — the change alters agreed requirements.');
  }

  if (analysis.summary.affectedFiles > 0) {
    reviews.push('Code Review — generated code will be modified.');
  }

  if (analysis.risk.level === 'high' || analysis.risk.level === 'critical') {
    reviews.push(`Customer sign-off before work starts — risk assessed as ${RISK_LEVEL_LABELS[analysis.risk.level]}.`);
  }

  return reviews;
}

function buildAffectedArtifacts(analysis: ImpactAnalysis): EvolutionPlan['affectedArtifacts'] {
  return analysis.sections
    .filter((section) => section.affected && section.items.length > 0)
    .map((section) => ({
      group: section.label,
      items: section.items.map(
        (item) => `${item.label}${item.identifier !== item.label ? ` (${item.identifier})` : ''}`,
      ),
    }));
}

/** Priority is the customer's, raised only when the analysis found a grounded reason. Never lowered. */
function suggestPriority(request: ChangeRequest, risk: RiskLevel): ChangeRequestPriority {
  const order: ChangeRequestPriority[] = ['low', 'medium', 'high', 'urgent'];
  const current = order.indexOf(request.priority);
  const floor = risk === 'critical' ? order.indexOf('urgent') : risk === 'high' ? order.indexOf('high') : current;

  return order[Math.max(current, floor)];
}

export function buildEvolutionPlan(params: {
  request: ChangeRequest;
  analysis: ImpactAnalysis;
  createdAt: string;
}): EvolutionPlan {
  const { request, analysis } = params;
  const placement = suggestPlacement(analysis);
  const phases = buildPhases(analysis);

  const summary =
    analysis.summary.totalFindings === 0
      ? `"${request.title}" could not be linked to anything in release ${analysis.releaseVersion ?? '(unversioned)'}. No plan can be grounded until the request names released features, pages or tables.`
      : `"${request.title}" is a ${CHANGE_CATEGORY_LABELS[analysis.classification.category].toLowerCase()} against release ${analysis.releaseVersion ?? '(unversioned)'}, touching ${analysis.summary.affectedFeatures} feature(s) and ${analysis.summary.affectedFiles} generated file(s) across ${analysis.summary.affectedSections} impact area(s). Estimated ${COMPLEXITY_LEVEL_LABELS[analysis.complexity.level].toLowerCase()} with ${RISK_LEVEL_LABELS[analysis.risk.level].toLowerCase()} risk.`;

  return {
    summary,
    affectedArtifacts: buildAffectedArtifacts(analysis),
    requiredRoles: analysis.roles.map((entry) => ({
      role: entry.role,
      label: ENGINEERING_ROLE_LABELS[entry.role],
      reason: entry.reason,
    })),
    requiredReviews: buildRequiredReviews(analysis),
    estimatedPhases: phases,
    estimatedRisks: analysis.risk.factors.map((factor) => ({ label: factor.label, detail: factor.detail })),
    suggestedMvp: placement,
    suggestedSprint:
      phases.length === 0
        ? 'Not schedulable yet — the impact analysis found nothing to plan.'
        : `Approximately ${phases.length} phase(s) of work; sequence them in the order listed above.`,
    suggestedPriority: suggestPriority(request, analysis.risk.level),
    futureScope: [
      'No code is generated by this plan — incremental engineering is a later sprint.',
      'No MVP, sprint or roadmap entry is created; the suggestions above are for a human to act on.',
      'The released product, its manifest and its release record are left completely untouched.',
    ],
    createdAt: params.createdAt,
  };
}
