import type { ProjectKnowledge } from '~/lib/projects/knowledge';
import type { AIDecision } from '~/lib/projects/draftParsing';
import type { EngineeringHandoff } from './productOwner';

/**
 * Shared prompt-formatting helpers — Sprint 14, extended Sprint 32 for the
 * AI Engineering Team Context Chain (Engineering Notes / AI Decisions
 * shared across every role, and the collaboration framing every system
 * prompt now includes).
 *
 * Small, pure string formatters used by every `prompts/*.ts` file
 * (requirements.ts, architecture.ts, and future AI-role prompt files) so
 * "how do we describe a list" and "how do we describe Project Knowledge to
 * an AI role" are defined exactly once. Nothing here calls an LLM or
 * gathers data itself — these only format values they're given.
 */

export function formatList(items: string[] | undefined, fallback = 'None specified'): string {
  return items && items.length > 0 ? items.join(', ') : fallback;
}

/**
 * Sprint 32 — the TypeScript-flavored type hint every `JSON_SHAPE` template
 * literal uses to describe one field to the AI (`"key": string`, `"key":
 * string[]`, or — for the new shared `'decisions'` field kind — an array of
 * the `AIDecision` shape). One shared implementation so all 8 prompt files'
 * `JSON_SHAPE` constants describe the `'decisions'` kind identically.
 */
export function formatJsonShapeField(field: { key: string; kind: 'text' | 'list' | 'decisions' }): string {
  if (field.kind === 'list') {
    return `  "${field.key}": string[]`;
  }

  if (field.kind === 'decisions') {
    return `  "${field.key}": { "decision": string, "reason": string, "alternativeConsidered": string, "whyRejected": string, "recommendation": string, "futureImprovements": string }[]`;
  }

  return `  "${field.key}": string`;
}

function formatDecisionList(decisions: AIDecision[] | undefined): string | undefined {
  if (!decisions || decisions.length === 0) {
    return undefined;
  }

  return decisions
    .map((entry, index) => {
      const lines = [
        `${index + 1}. Decision: ${entry.decision}`,
        `   Reason: ${entry.reason}`,
        entry.alternativeConsidered && `   Alternative considered: ${entry.alternativeConsidered}`,
        entry.whyRejected && `   Why rejected: ${entry.whyRejected}`,
        entry.recommendation && `   Recommendation: ${entry.recommendation}`,
        entry.futureImprovements && `   Future improvements: ${entry.futureImprovements}`,
      ].filter(Boolean);

      return lines.join('\n');
    })
    .join('\n');
}

/**
 * Sprint 32 — strips the shared `engineeringNotes`/`aiDecisions` fields out
 * of a field list before using it to describe an UPSTREAM draft to another
 * role. Every user prompt already shows a dedicated "Engineering Notes from
 * previous engineers" / "AI Decisions made so far" section (built from
 * `collaborationContext.ts`, spanning every approved upstream artifact, not
 * just the one being described here) — including these two fields again
 * inside a per-draft `formatDraftFields` dump would duplicate exactly the
 * content the sprint's context-budget guidance calls out to avoid. Only
 * used when formatting an upstream draft for display; each role's own
 * JSON_SHAPE still lists both fields via the unfiltered `*_DRAFT_FIELDS`.
 */
export function omitCollaborationFields<T extends { key: string }>(fields: T[]): T[] {
  return fields.filter((field) => field.key !== 'engineeringNotes' && field.key !== 'aiDecisions');
}

/**
 * Sprint 15 — generic "describe an already-parsed AI draft to another AI
 * role" formatter, extracted so app/lib/projects/prompts/database.ts can
 * describe the approved Architecture Draft to the Database Designer without
 * hand-rolling architecture-specific formatting. Reusable by any future
 * prompt that needs to feed one AI role's draft into another's context.
 * Sprint 32 — every draft now carries a shared `'decisions'`-kind field
 * (AI Decisions); formatted via `formatDecisionList` above rather than the
 * plain-list/plain-text branches.
 */
export function formatDraftFields<T>(
  draft: T | undefined,
  fields: { key: keyof T; label: string; kind: 'text' | 'list' | 'decisions' }[],
): string {
  if (!draft) {
    return 'Not available yet.';
  }

  const lines = fields
    .map((field) => {
      const value = draft[field.key];

      if (!value) {
        return undefined;
      }

      if (field.kind === 'decisions') {
        const display = formatDecisionList(value as unknown as AIDecision[]);
        return display ? `${field.label}:\n${display}` : undefined;
      }

      const display = Array.isArray(value) ? formatList(value as string[]) : (value as string);

      return `${field.label}: ${display}`;
    })
    .filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join('\n') : 'Not available yet.';
}

/**
 * Sprint 32 — every system prompt now appends this fragment verbatim so
 * every AI role explicitly understands it is joining an existing
 * engineering team rather than starting from a blank slate: previous roles'
 * approved decisions are settled constraints to extend, not redesign. The
 * exact JSON contract line (mentioning `engineeringNotes`/`aiDecisions`) is
 * still up to each prompt file's own JSON_SHAPE description, since the key
 * names differ only in this — the *framing* is identical everywhere.
 */
export const COLLABORATION_FRAMING = `You are joining an existing engineering team inside Builders. Previous engineers on this project have already completed and had their work approved — their decisions are settled, not open for redesign. You MUST build upon what they already decided: read their Engineering Notes and AI Decisions carefully, respect and extend their choices, and only flag a genuine conflict (never silently override one) in your own "openQuestions"-style field if something truly doesn't fit. Do not restate their work — assume the reader already has it; focus your own output on what your role specifically adds on top of it.`;

/**
 * Sprint 32 — every draft's own "Engineering Notes For Next Engineer" and
 * "AI Decisions" fields are for THIS role's own output (instructing the
 * *next* engineer). This formats what EARLIER roles already left behind —
 * gathered across every approved upstream artifact by
 * app/lib/projects/collaborationContext.ts — so the current role can read
 * the accumulated, distilled knowledge of the whole team so far without
 * re-reading every full document. Always included regardless of context
 * budget: these are the cheapest, highest-signal section in the chain.
 */
export function formatEngineeringNotes(entries: { role: string; notes: string }[]): string {
  if (entries.length === 0) {
    return 'None yet.';
  }

  return entries.map((entry) => `${entry.role}:\n${entry.notes}`).join('\n\n');
}

export function formatAIDecisions(entries: { role: string; decisions: AIDecision[] }[]): string {
  if (entries.length === 0) {
    return 'None yet.';
  }

  return entries
    .map((entry) => `${entry.role}:\n${formatDecisionList(entry.decisions) ?? 'None recorded.'}`)
    .join('\n\n');
}

/**
 * Sprint 46B — formats the Product Owner's structured handoff for a downstream engineering
 * role's prompt. Undefined (legacy projects, or any project predating the Product Owner role)
 * renders as a plain fallback line rather than an empty section, so every engineering role's
 * prompt degrades gracefully to "scope the full product" behavior for those projects.
 *
 * Sprint 46C — each feature is shown with its permanent id (e.g. "FEAT-001") ahead of its
 * name/priority, so a role's own output can cite features unambiguously by ID.
 *
 * Sprint 47 — extracted out of prompts/architecture.ts (its original, only caller) so every
 * engineering role from Architecture through QA can use the exact same formatting instead of
 * each re-implementing it — this is what makes the Engineering Handoff "the single source of
 * truth" for MVP/feature scope consistently across the whole pipeline, not just its first
 * consumer.
 */
export function formatEngineeringHandoff(handoff: EngineeringHandoff | undefined): string {
  if (!handoff) {
    return 'None — this project predates the AI Product Owner role. Proceed as before, scoping the full product.';
  }

  const featureLines = handoff.features.map((feature) => `- [${feature.id}] ${feature.name}: ${feature.priority}`);

  return [
    `In scope for this MVP: ${formatList(handoff.scope)}`,
    `Constraints: ${formatList(handoff.constraints)}`,
    `Architecture goals: ${formatList(handoff.architectureGoals)}`,
    `Success criteria: ${formatList(handoff.successCriteria)}`,
    `Acceptance criteria: ${formatList(handoff.acceptanceCriteria)}`,
    `Features (cite by ID in your own output where relevant):\n${featureLines.length > 0 ? featureLines.join('\n') : 'None specified'}`,
    `OUT OF SCOPE for this MVP — do NOT build, scaffold, or reference functionality for these, even if Requirements mentions them: ${formatList(handoff.outOfScopeFeatures)}`,
    `Dependencies: ${formatList(handoff.dependencies)}`,
  ].join('\n');
}

export function formatProjectKnowledge(knowledge: ProjectKnowledge | undefined): string {
  if (!knowledge) {
    return 'Nothing captured yet.';
  }

  const lines = [
    knowledge.projectVision && `Vision: ${knowledge.projectVision}`,
    knowledge.industry && `Industry: ${knowledge.industry}`,
    knowledge.businessModel && `Business model: ${knowledge.businessModel}`,
    knowledge.targetUsers && `Target users: ${knowledge.targetUsers}`,
    knowledge.location && `Region: ${knowledge.location}`,
    knowledge.coreFeatures?.length && `Core features: ${formatList(knowledge.coreFeatures)}`,
    knowledge.pagesOrScreens?.length && `Pages/screens: ${formatList(knowledge.pagesOrScreens)}`,
    knowledge.userRoles?.length && `User roles: ${formatList(knowledge.userRoles)}`,
    knowledge.integrations?.length && `Integrations: ${formatList(knowledge.integrations)}`,
    knowledge.paymentNeeds?.length && `Payments: ${formatList(knowledge.paymentNeeds)}`,
    knowledge.complianceNeeds?.length && `Compliance: ${formatList(knowledge.complianceNeeds)}`,
    knowledge.shippingNeeds?.length && `Shipping: ${formatList(knowledge.shippingNeeds)}`,
    knowledge.languages?.length && `Languages: ${formatList(knowledge.languages)}`,
    knowledge.brandTone && `Brand tone: ${knowledge.brandTone}`,
    knowledge.technicalPreferences && `Technical preferences: ${knowledge.technicalPreferences}`,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : 'Nothing captured yet.';
}
