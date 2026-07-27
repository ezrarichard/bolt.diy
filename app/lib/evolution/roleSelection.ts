import { ARTIFACT_TYPES } from '~/lib/projects/artifacts';
import { AUTO_ENGINEERING_ROLES } from '~/lib/projects/autoEngineeringEngine';
import type { ChangeArea } from '~/lib/evolution/changeRequestTypes';
import {
  IMPACT_ROLE_TO_PIPELINE_ROLE,
  INCREMENTAL_ROLE_LABELS,
  REVIEW_STAGE_LABELS,
  type EngineeringScope,
  type IncrementalPlanPhase,
  type IncrementalRoleId,
  type ReviewRequirement,
  type RoleDecision,
} from '~/lib/evolution/engineeringScopeTypes';
import type { ImpactAnalysis, ImpactSectionId } from '~/lib/evolution/impactTypes';

/**
 * Selective Role Execution, Dependencies and Review Impact — Sprint 96, Parts 3/7/8.
 *
 * DOES NOT DUPLICATE ORCHESTRATION. The canonical pipeline order lives in
 * `AUTO_ENGINEERING_ROLES` (autoEngineeringEngine.ts) and is READ from there — `PIPELINE_ORDER`
 * below derives from that registry rather than restating it, so a role added to the pipeline
 * cannot silently fall out of incremental planning. Each role's own `canGenerate` gate, prompt
 * builder and artifact writer remain entirely that registry's business; this module only decides
 * WHICH of those stages a change needs and IN WHAT ORDER they would run.
 *
 * A NOTE ON DEPENDENCIES THAT MATTERS (Part 7). In the original build, a role's `canGenerate`
 * requires its upstream role's artifact to be APPROVED. For an incremental change to a RELEASED
 * product those upstream artifacts already exist and are already approved — so `dependsOn` here
 * means "must be approved before this role runs", which a released product already satisfies. It
 * does NOT mean "must be re-run". That distinction is the whole point of incremental engineering,
 * and it is why skipping a role is safe rather than merely cheaper.
 */

/** The pipeline's own fixed order, read from the registry, with the Business Analyst prepended (it sits outside that registry — see `engineeringScopeTypes.ts`). */
export const PIPELINE_ORDER: IncrementalRoleId[] = ['requirements', ...AUTO_ENGINEERING_ROLES.map((role) => role.id)];

/** Each role's real artifact type, read from the registry rather than restated. */
const ARTIFACT_TYPE_BY_ROLE: Record<IncrementalRoleId, string | undefined> = {
  ...(Object.fromEntries(AUTO_ENGINEERING_ROLES.map((role) => [role.id, role.artifactType])) as Record<
    IncrementalRoleId,
    string | undefined
  >),
  requirements: ARTIFACT_TYPES.REQUIREMENTS_DRAFT,
};

/** Which impact section, when unaffected, most directly explains skipping a role. Used only to write an honest "NO" reason. */
const ROLE_PRIMARY_SECTION: Partial<Record<IncrementalRoleId, ImpactSectionId>> = {
  database: 'database',
  backend: 'backend',
  frontend: 'ui',
  uiux: 'ui',
  devops: 'infrastructure',
  qa: 'testing',
};

const ROLE_PRIMARY_AREA: Partial<Record<IncrementalRoleId, ChangeArea>> = {
  database: 'database',
  backend: 'backend',
  frontend: 'ui',
  uiux: 'ui',
  devops: 'infrastructure',
};

function dependenciesFor(role: IncrementalRoleId): IncrementalRoleId[] {
  const index = PIPELINE_ORDER.indexOf(role);
  return index <= 0 ? [] : PIPELINE_ORDER.slice(0, index);
}

export interface RoleSelectionInput {
  scope: EngineeringScope;
  impact: ImpactAnalysis;
}

/**
 * Part 3 — a YES/NO for every pipeline role, each with reasoning. A role is selected when the
 * Evolution Plan's own role analysis named it (which itself came from grounded impact findings);
 * it is skipped with a reason drawn from the impact analysis, never with a bare "not needed".
 */
export function selectRoles(input: RoleSelectionInput): RoleDecision[] {
  const { scope, impact } = input;
  const selected = new Set(scope.affectedRoles);
  const sectionById = new Map(impact.sections?.map((section) => [section.id, section]) ?? []);
  const unaffectedByArea = new Map(scope.unaffectedAreas.map((entry) => [entry.area, entry.detail]));

  return PIPELINE_ORDER.map((role) => {
    const isSelected = selected.has(role);
    const primarySection = ROLE_PRIMARY_SECTION[role];
    const section = primarySection ? sectionById.get(primarySection) : undefined;
    const primaryArea = ROLE_PRIMARY_AREA[role];
    const unaffectedDetail = primaryArea ? unaffectedByArea.get(primaryArea) : undefined;

    let reasoning: string;

    if (isSelected) {
      /* Prefer the impact analysis's own words for this role; fall back to its section, then to a scope-derived phrase. */
      const impactReason = impact.roles?.find((entry) => IMPACT_ROLE_TO_PIPELINE_ROLE[entry.role] === role)?.reason;

      reasoning = impactReason
        ? `Selected — ${impactReason}`
        : section?.affected
          ? `Selected — ${section.label.toLowerCase()}: ${section.detail}`
          : `Selected — ${scopeReasonFor(role, scope) ?? 'named by the impact analysis.'}`;
    } else if (unaffectedDetail) {
      reasoning = `Skipped — ${unaffectedDetail}`;
    } else if (section && !section.affected) {
      reasoning = `Skipped — ${section.detail}`;
    } else {
      reasoning = `Skipped — the impact analysis found nothing in this role's area, and the released artifact it already produced still applies.`;
    }

    return {
      role,
      label: INCREMENTAL_ROLE_LABELS[role],
      selected: isSelected,
      reasoning,
      artifactType: ARTIFACT_TYPE_BY_ROLE[role],
      dependsOn: dependenciesFor(role),
    };
  });
}

/** A short grounded phrase for a selected role whose primary section did not itself fire. */
function scopeReasonFor(role: IncrementalRoleId, scope: EngineeringScope): string | undefined {
  switch (role) {
    case 'requirements':
      return `${scope.affectedFeatures.length} released feature(s) are implicated, which changes agreed requirements.`;
    case 'productowner':
      return 'Scope changes must be placed in the roadmap before engineering starts.';
    case 'architecture':
      return 'The change affects how the released architecture fits together.';
    case 'qa':
      return `${scope.affectedPages.length + scope.affectedComponents.length} released file(s) change, so the live application must be re-verified.`;
    default:
      return undefined;
  }
}

/**
 * Part 7 — the selected roles in the pipeline's own fixed order. Unselected roles are simply
 * absent; the order of the rest is never rearranged, because the existing pipeline's gates depend
 * on it.
 */
export function buildExecutionOrder(decisions: RoleDecision[]): IncrementalPlanPhase[] {
  return decisions
    .filter((decision) => decision.selected)
    .sort((a, b) => PIPELINE_ORDER.indexOf(a.role) - PIPELINE_ORDER.indexOf(b.role))
    .map((decision, index) => ({
      order: index + 1,
      role: decision.role,
      label: decision.label,
      artifactType: decision.artifactType,
      reasoning: decision.reasoning,
    }));
}

/**
 * Part 7's other half: which SELECTED roles have SELECTED roles downstream of them. Re-running an
 * upstream role while a downstream one also re-runs is fine (the downstream one reads the new
 * output); the case worth surfacing is a re-run whose downstream artifacts are NOT being re-run
 * and may now be stale. This reports it rather than resolving it — invalidation is execution
 * behaviour, which this sprint does not implement.
 */
export function detectStaleDownstreamRisks(
  decisions: RoleDecision[],
): Array<{ role: IncrementalRoleId; staleRoles: IncrementalRoleId[] }> {
  const selected = decisions.filter((decision) => decision.selected).map((decision) => decision.role);
  const risks: Array<{ role: IncrementalRoleId; staleRoles: IncrementalRoleId[] }> = [];

  for (const role of selected) {
    const index = PIPELINE_ORDER.indexOf(role);
    const downstreamNotRerun = PIPELINE_ORDER.slice(index + 1).filter((candidate) => !selected.includes(candidate));

    if (downstreamNotRerun.length > 0) {
      risks.push({ role, staleRoles: downstreamNotRerun });
    }
  }

  return risks;
}

/**
 * Part 8 — which review gates run, and which are skipped. Only gates this platform genuinely has
 * (Product Review, Roadmap Review, Code Review, plus customer sign-off for high risk). A skipped
 * gate carries its reason, so "we skipped review" is never silent.
 */
export function resolveReviewRequirements(decisions: RoleDecision[], impact: ImpactAnalysis): ReviewRequirement[] {
  const selected = new Set(decisions.filter((decision) => decision.selected).map((decision) => decision.role));
  const touchesCode = ['database', 'backend', 'frontend', 'uiux'].some((role) =>
    selected.has(role as IncrementalRoleId),
  );
  const highRisk = impact.risk?.level === 'high' || impact.risk?.level === 'critical';

  return [
    {
      stage: 'product_review',
      label: REVIEW_STAGE_LABELS.product_review,
      required: selected.has('requirements'),
      reasoning: selected.has('requirements')
        ? 'The Business Analyst re-runs, so agreed requirements change and must be reviewed.'
        : 'Requirements are unchanged — the released Product Review still applies.',
    },
    {
      stage: 'roadmap_review',
      label: REVIEW_STAGE_LABELS.roadmap_review,
      required: selected.has('productowner'),
      reasoning: selected.has('productowner')
        ? 'The Product Owner re-runs, so MVP scope moves and the roadmap must be re-reviewed.'
        : 'MVP scope is unchanged — the released roadmap still applies.',
    },
    {
      stage: 'code_review',
      label: REVIEW_STAGE_LABELS.code_review,
      required: touchesCode,
      reasoning: touchesCode
        ? 'Generated code will be modified, so the existing code review gate applies to the change.'
        : 'No generated code is modified by this change.',
    },
    {
      stage: 'customer_signoff',
      label: REVIEW_STAGE_LABELS.customer_signoff,
      required: highRisk,
      reasoning: highRisk
        ? `Risk assessed as ${impact.risk.level} — confirm with the customer before engineering starts.`
        : 'Risk does not warrant a separate customer gate before work begins.',
    },
  ];
}
