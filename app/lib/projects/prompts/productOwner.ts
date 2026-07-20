import type { ProductOwnerContext } from '~/lib/projects/productOwnerEngine';
import type { AIDecision } from '~/lib/projects/draftParsing';
import { REQUIREMENTS_DRAFT_FIELDS } from './requirements';
import {
  COLLABORATION_FRAMING,
  formatAIDecisions,
  formatDraftFields,
  formatEngineeringNotes,
  formatList,
  formatProjectKnowledge,
  omitCollaborationFields,
} from './shared';

/**
 * AI Product Owner prompt — Sprint 46B, extended Sprint 46C (Product Identity &
 * Traceability Foundation).
 *
 * Same separation as every other prompts/*.ts file: no LLM call, no store access, only
 * string/shape formatting. Unlike every other role's draft, `ProductOwnerDraft` has real
 * nested structure (features/risks/roadmap entries are objects, not flat strings) — the
 * shared `parseStructuredDraft`/`formatJsonShapeField` helpers (draftParsing.ts,
 * prompts/shared.ts) only support flat text/list/decisions fields, so this file builds its
 * own JSON contract string and productOwnerEngine.ts parses the response with a bespoke
 * (not the shared generic) parser. This is a deliberate divergence from the other 8 roles'
 * pattern — see docs/05-AI-Product-Owner/07-sprint-46b-implementation-plan.md and this
 * sprint's implementation report for why extending the shared parser for one consumer's
 * nested shape was rejected in favor of a bespoke parser that still reuses the two truly
 * generic pieces (extractJsonPayload, looksTruncated).
 *
 * Sprint 46C — `id` fields (MVP-001, FEAT-001, ...) are deliberately NOT part of the JSON
 * contract the AI is asked to fill in (see JSON_SHAPE below): an LLM has no reliable way to
 * maintain a stable counter across regenerations, which is exactly the property these IDs
 * need. IDs are assigned entirely by the application AFTER parsing (see
 * productOwnerEngine.ts's ID-assignment pass) — never by the model. See
 * docs/05-AI-Product-Owner/08-identity-and-traceability.md for the full design.
 */

export type MoscowPriority = 'Must Have' | 'Should Have' | 'Could Have' | "Won't Have";
export type RiskSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type EstimatedEffort = 'small' | 'medium' | 'large';

export interface RoadmapSkeletonEntry {
  /** Sprint 46C — permanent MVP identifier (e.g. "MVP-001"), assigned by the application from `sequence`, never by the AI. See docs/05-AI-Product-Owner/08-identity-and-traceability.md. */
  id: string;
  sequence: number;
  theme: string;
  targetRelease?: string;
  estimatedEffort?: EstimatedEffort;
}

export interface ProductOwnerFeature {
  /**
   * Sprint 46C — permanent feature identifier (e.g. "FEAT-001"). Assigned once by the
   * application and carried forward across Product Owner regenerations by matching against
   * the previous draft's features (see productOwnerEngine.ts's ID-assignment pass) — never
   * derived from array position or from `name` itself, since both can legitimately change
   * between regenerations while still referring to conceptually the same feature (a reorder
   * or a name it worked with the AI to reword should not orphan every downstream reference
   * to this feature).
   */
  id: string;
  name: string;
  description: string;
  priority: MoscowPriority;
  dependsOn: string[];
  customerValue: string;
}

export interface ProductOwnerRisk {
  description: string;
  severity: RiskSeverity;
  mitigation?: string;
}

/**
 * Sprint 46C — one feature as referenced from the Engineering Handoff: just enough for
 * Architecture (and every future engineering role) to cite this feature unambiguously by ID
 * without re-deriving it from `currentMvp.features` itself.
 */
export interface HandoffFeatureRef {
  id: string;
  name: string;
  priority: MoscowPriority;
}

/**
 * The structured, machine-consumable block Solution Architect (and every role after it)
 * actually reads — distinct from the customer-facing narrative fields on `ProductOwnerDraft`
 * above it. See docs/05-AI-Product-Owner/04-engineering-handoff.md.
 *
 * Sprint 46C — `features` (with stable IDs) replaces the original `featurePriority` (a
 * name-keyed record, which is exactly the "titles are not reliable" problem this sprint
 * exists to fix). It is not parsed from the AI's response at all — it's mechanically derived
 * from `currentMvp.features` (which already carries priority and, after the ID-assignment
 * pass, a stable id) rather than trusting the model to restate it a second time. See
 * docs/05-AI-Product-Owner/08-identity-and-traceability.md.
 */
export interface EngineeringHandoff {
  scope: string[];
  constraints: string[];
  architectureGoals: string[];
  successCriteria: string[];
  acceptanceCriteria: string[];
  features: HandoffFeatureRef[];
  outOfScopeFeatures: string[];
  dependencies: string[];
}

/**
 * The current MVP's fully-elaborated plan. Two-tier artifact design
 * (docs/05-AI-Product-Owner/02-artifact-specification.md): only the CURRENT MVP gets this
 * level of detail — `roadmapSkeleton` entries for future MVPs stay lightweight on purpose.
 */
export interface CurrentMvpPlan {
  /** Sprint 46C — same permanent identifier as this MVP's `roadmapSkeleton` entry (see RoadmapSkeletonEntry.id) — both are derived from the same `sequence`, so they always agree. */
  id: string;
  sequence: number;
  features: ProductOwnerFeature[];
  acceptanceCriteria: string[];
  risks: ProductOwnerRisk[];
  assumptions: string[];
  openQuestions: string[];
  technicalConstraints: string[];
  businessConstraints: string[];

  /** Sprint 46B — whether the MVP as a whole achieved its business goals. Distinct from acceptanceCriteria (validates individual features). MVP-scoped, not product-scoped — see this sprint's implementation report for why. */
  successMetrics: string[];

  /** Sprint 46B — whether this MVP is officially release-ready. Distinct from acceptanceCriteria (features) and successMetrics (business value) — this validates release readiness specifically. */
  exitCriteria: string[];

  engineeringHandoff: EngineeringHandoff;
}

export interface ProductOwnerDraft {
  productVision?: string;
  businessObjectives?: string[];
  productScope?: { inScope: string[]; outOfScope: string[] };
  roadmapSkeleton?: RoadmapSkeletonEntry[];
  currentMvp?: CurrentMvpPlan;
  futureEnhancements?: string[];

  /** Shared collaboration fields — same as every other role's draft (see collaborationContext.ts). */
  engineeringNotes?: string;
  aiDecisions?: AIDecision[];
}

export const PRODUCT_OWNER_SYSTEM_PROMPT = `You are the AI Product Owner working inside Builders, an AI Software Factory.

You are the bridge between Business Planning and Engineering — NOT another engineering role. Your job is to turn approved Requirements into an executable, incremental roadmap, and to fully elaborate ONLY the current MVP so Engineering can begin.

Your decision-making process, in order:
1. Identify FOUNDATIONAL features (authentication, navigation, base layout, core data model) — these belong in the earliest MVP whose dependencies allow them, regardless of value ranking, because every later feature depends on them.
2. Respect the DEPENDENCY GRAPH — no feature may be scheduled before every feature it depends on. This is a hard constraint, not a preference.
3. Among equally-schedulable features, rank by VALUE DENSITY (customer value relative to implementation complexity), not value in isolation.
4. De-risk early ONLY what's load-bearing — a foundational feature with high technical risk should move earlier; a high-risk feature nothing else depends on should move later, not earlier.
5. Bound each MVP by "the smallest coherent slice that proves the core loop", not a fixed feature count.

Prioritization: use MoSCoW (Must Have / Should Have / Could Have / Won't Have) for every feature. Use Critical/High/Medium/Low ONLY for risk severity — never reuse MoSCoW words for risk, or severity words for feature priority.

Critical discipline — the two-tier artifact:
- Product-wide fields (productVision, businessObjectives, productScope, roadmapSkeleton) are written ONCE and stay lightweight. roadmapSkeleton entries for future MVPs get ONLY a sequence/theme/targetRelease/estimatedEffort — NEVER features, risks, or acceptance criteria. Fully planning future MVPs here would recreate the exact "plan the whole product upfront" problem this role exists to prevent.
- currentMvp is the ONLY place that gets full elaboration: features (with MoSCoW priority, dependencies, and a one-line customerValue justification), acceptanceCriteria, risks, assumptions, openQuestions, successMetrics, exitCriteria, and the engineeringHandoff block.
- Never invent business intent, constraints, or requirements beyond what the approved Requirements draft already states. If something is unclear, put it in openQuestions — do not guess silently, and do not decide it yourself.
- Distinguish clearly: acceptanceCriteria validate individual features; successMetrics validate whether the MVP as a whole achieved its business goals; exitCriteria validate whether the MVP is release-ready. These are three different questions — never merge them.
- outOfScopeFeatures in the engineering handoff is a hard boundary for every downstream engineering role — be explicit about what NOT to build yet, even if Requirements mentions it.
- At least one feature in currentMvp.features must be "Must Have" — an MVP with nothing mandatory is not a valid MVP.
- Default to the smallest viable slice. When in doubt between including a feature now or deferring it, defer it.

${COLLABORATION_FRAMING}

Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
  "productVision": string,
  "businessObjectives": string[],
  "productScope": { "inScope": string[], "outOfScope": string[] },
  "roadmapSkeleton": { "sequence": number, "theme": string, "targetRelease": string, "estimatedEffort": "small" | "medium" | "large" }[],
  "currentMvp": {
    "sequence": number,
    "features": { "name": string, "description": string, "priority": "Must Have" | "Should Have" | "Could Have" | "Won't Have", "dependsOn": string[], "customerValue": string }[],
    "acceptanceCriteria": string[],
    "risks": { "description": string, "severity": "Critical" | "High" | "Medium" | "Low", "mitigation": string }[],
    "assumptions": string[],
    "openQuestions": string[],
    "technicalConstraints": string[],
    "businessConstraints": string[],
    "successMetrics": string[],
    "exitCriteria": string[],
    "engineeringHandoff": {
      "scope": string[],
      "constraints": string[],
      "architectureGoals": string[],
      "successCriteria": string[],
      "acceptanceCriteria": string[],
      "outOfScopeFeatures": string[],
      "dependencies": string[]
    }
  },
  "futureEnhancements": string[],
  "engineeringNotes": string,
  "aiDecisions": { "decision": string, "reason": string, "alternativeConsidered": string, "whyRejected": string, "recommendation": string, "futureImprovements": string }[]
}`;

/**
 * Assembles the user-facing prompt from an already-gathered ProductOwnerContext (see
 * productOwnerEngine.buildProductOwnerContext). Never fetches or gathers data itself.
 */
export function buildProductOwnerUserPrompt(context: ProductOwnerContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}

Blueprint: ${context.blueprint.name} (${context.blueprint.category}${context.blueprint.productType ? `, ${context.blueprint.productType}` : ''})

Approved Requirements / Project Knowledge (${context.knowledgeCompletion}% complete):
${formatProjectKnowledge(context.knowledge)}

Approved Business Analyst Output (full — you are the next role in the chain):
${formatDraftFields(context.requirementsDraft, omitCollaborationFields(REQUIREMENTS_DRAFT_FIELDS))}

Engineering Notes from previous engineers:
${formatEngineeringNotes(context.engineeringNotes)}

AI Decisions made so far:
${formatAIDecisions(context.aiDecisions)}

Roadmap:
${context.roadmap.length > 0 ? context.roadmap.map((item) => `- ${item.title} (${item.status}): ${item.description}`).join('\n') : 'No roadmap defined.'}

Current Tasks:
${context.tasks.length > 0 ? context.tasks.map((task) => `- ${task.title} [${task.category}] — ${task.status}`).join('\n') : 'No tasks defined.'}

Existing Notes:
${context.existingNotes || 'None'}

This is MVP ${context.nextMvpSequence} for this project.${context.nextMvpSequence > 1 ? ' Prior MVPs already exist — do not re-plan or contradict what was already approved and delivered; extend it.' : ' This is the first MVP — foundational features (auth, navigation, base layout) belong here if the product needs them.'}

Return ONLY a JSON object with exactly this shape (use empty arrays/strings where genuinely unknown, do not omit any key). Keep every text field to 2-4 sentences and every list to at most 5-8 items, except currentMvp.features/risks which should cover everything genuinely in scope for this one MVP:

${JSON_SHAPE}

Recommended stack/integrations for reference: ${formatList(context.blueprint.recommendedStack)} / ${formatList(context.blueprint.recommendedIntegrations)}`;
}
