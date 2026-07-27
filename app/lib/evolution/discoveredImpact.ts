import { extractJsonPayload } from '~/lib/projects/draftParsing';
import type { IncrementalRoleId } from '~/lib/evolution/engineeringScopeTypes';
import { IMPACT_SECTION_LABELS, type ImpactSectionId } from '~/lib/evolution/impactTypes';
import type {
  DiscoveredImpact,
  DiscoveredImpactAction,
  DiscoveredImpactSeverity,
  ScopeExpansionDecisionType,
} from '~/lib/evolution/incrementalExecutionTypes';

/**
 * Newly Discovered Impact — Sprint 97, Part 10.
 *
 * A role running against a reduced scope is the first thing in this platform positioned to notice
 * that the scope is WRONG — it is looking closely at the one area the change touches. Part 10 makes
 * that observation a first-class, structured result rather than prose buried in a draft.
 *
 * SCOPE IS NEVER EXPANDED AUTOMATICALLY. That is the single rule this module exists to enforce.
 * A material discovery PAUSES the execution and waits for an operator; an immaterial one is
 * recorded and the execution continues. Nothing here adds a role, widens a file list or re-runs an
 * analysis, and a model asking for `expand_scope` is a request, never a decision.
 */

/**
 * Reads the raw AI response back into an object so `discoveredImpact` can be recovered.
 *
 * WHY THIS IS NEEDED. Each role's own `parseDraft` validates into that role's typed draft and
 * DROPS anything it does not recognise — which is correct behaviour, and which would silently
 * discard every out-of-scope finding a role reported. The report is not part of the role's design
 * output, so extending eight draft types with a field none of them owns would be the wrong fix.
 * Reading it from the response the role actually returned is the right one.
 *
 * Reuses `extractJsonPayload`, the same fence/prose stripper the real parsers use, so this sees
 * exactly the text they saw. A response that is not JSON simply yields nothing.
 */
export function readDiscoveredImpactField(rawText: string): unknown {
  try {
    return JSON.parse(extractJsonPayload(rawText));
  } catch {
    return undefined;
  }
}

const SEVERITIES: DiscoveredImpactSeverity[] = ['low', 'medium', 'high', 'critical'];

const ACTIONS: DiscoveredImpactAction[] = [
  'expand_scope',
  'return_to_impact_analysis',
  'monitor_only',
  'no_action_required',
];

const CATEGORIES = Object.keys(IMPACT_SECTION_LABELS) as ImpactSectionId[];

/**
 * Reads the `discoveredImpact` array out of a parsed role draft. Defensive by design: the array is
 * optional, the model may omit fields, and an entry that cannot be understood is DROPPED rather
 * than coerced into a plausible-looking finding. A fabricated "medium/technical" default would be
 * worse than no finding at all, because a human would act on it.
 */
export function parseDiscoveredImpacts(
  draft: unknown,
  reportedByRole: IncrementalRoleId,
  reportedAt: string,
): DiscoveredImpact[] {
  const raw = (draft as { discoveredImpact?: unknown } | null | undefined)?.discoveredImpact;

  if (!Array.isArray(raw)) {
    return [];
  }

  const parsed: DiscoveredImpact[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
    const affectedArtifact = typeof candidate.affectedArtifact === 'string' ? candidate.affectedArtifact.trim() : '';
    const reasoning = typeof candidate.reasoning === 'string' ? candidate.reasoning.trim() : '';

    /* No description and no affected artifact means there is nothing a human could act on. */
    if (!description || !affectedArtifact) {
      continue;
    }

    const category = CATEGORIES.includes(candidate.category as ImpactSectionId)
      ? (candidate.category as ImpactSectionId)
      : undefined;
    const severity = SEVERITIES.includes(candidate.severity as DiscoveredImpactSeverity)
      ? (candidate.severity as DiscoveredImpactSeverity)
      : undefined;
    const recommendedAction = ACTIONS.includes(candidate.recommendedAction as DiscoveredImpactAction)
      ? (candidate.recommendedAction as DiscoveredImpactAction)
      : undefined;

    if (!category || !severity || !recommendedAction) {
      continue;
    }

    parsed.push({
      description,
      category,
      affectedArtifact,
      reasoning: reasoning || description,
      severity,
      recommendedAction,
      scopeChangeRequired: candidate.scopeChangeRequired === true,
      reportedByRole,
      reportedAt,
    });
  }

  return parsed;
}

/**
 * Material = the execution must stop and ask. Two independent triggers, both deliberately
 * conservative: the role explicitly said the scope must change, or the severity is high enough that
 * continuing would mean shipping a change whose consequences nobody has assessed.
 *
 * `monitor_only`/`no_action_required` at low or medium severity are recorded and passed over — that
 * is the case where pausing would train operators to click through pauses.
 */
export function isMaterialDiscovery(discovery: DiscoveredImpact): boolean {
  if (discovery.scopeChangeRequired) {
    return true;
  }

  if (discovery.recommendedAction === 'expand_scope' || discovery.recommendedAction === 'return_to_impact_analysis') {
    return true;
  }

  return discovery.severity === 'high' || discovery.severity === 'critical';
}

export function materialDiscoveries(discoveries: DiscoveredImpact[]): DiscoveredImpact[] {
  return discoveries.filter(isMaterialDiscovery);
}

/** Whether a recorded operator decision permits the execution to carry on. */
export function decisionAllowsContinuation(decision: ScopeExpansionDecisionType): boolean {
  return decision === 'continue_without_expansion' || decision === 'reject_expansion';
}

/**
 * What an operator decision means for the run. Note that `approve_expansion` does NOT resume this
 * execution: an expanded scope is a different scope, so it needs a re-planned engineering plan and
 * a new execution. Resuming under the old plan while claiming the scope grew would be exactly the
 * silent expansion Part 10 forbids.
 */
export function describeScopeDecision(decision: ScopeExpansionDecisionType): string {
  switch (decision) {
    case 'approve_expansion':
      return 'Scope expansion approved — re-plan the incremental engineering work against the wider scope and start a new execution. This execution stays blocked and its completed role runs are kept.';
    case 'reject_expansion':
      return 'Scope expansion rejected — the discovered impact is recorded and the execution continues within the originally approved scope.';
    case 'return_to_impact_analysis':
      return 'Returned to impact analysis — re-analyse the change request before any further engineering. This execution stays blocked.';
    case 'continue_without_expansion':
      return 'Continuing without expansion — the discovered impact is recorded for a later change request and the current scope stands.';
    default:
      return 'Unknown decision.';
  }
}

export function summariseDiscoveries(discoveries: DiscoveredImpact[]): string {
  if (discoveries.length === 0) {
    return 'No impact outside the approved scope was reported.';
  }

  const material = materialDiscoveries(discoveries).length;

  return `${discoveries.length} discovery(ies) outside scope, ${material} requiring an operator decision.`;
}
