import { formatJsonShapeField, formatList } from './shared';
import type { RoadmapReviewContext } from '~/lib/projects/roadmapReviewEngine';

/**
 * Product Owner Roadmap Review prompt — Sprint 83.
 *
 * Following `prompts/productReview.ts`'s exact pattern (types + field list + system prompt +
 * user-prompt builder, nothing else) for the Product Owner's post-review planning workflow:
 * turning an APPROVED Business Analyst Product Review into the next roadmap proposal. Every
 * field here is flat text/list — unlike the original AI Product Owner draft
 * (`prompts/productOwner.ts`), a Roadmap Review has no nested feature/risk objects, so it reuses
 * the SHARED generic `parseStructuredDraft`/`formatJsonShapeField` machinery
 * (`draftParsing.ts`/`prompts/shared.ts`) rather than a bespoke parser.
 */

export interface ProductOwnerRoadmapOutput {
  executiveSummary?: string;
  roadmapChanges?: string[];
  featurePriorities?: string[];
  mvp2CandidateScope?: string[];
  deferredScope?: string[];

  /**
   * Not one of the sprint brief's ten named output sections verbatim — added because the
   * OBJECTIVE section explicitly states the Product Owner decides "what should be removed," and
   * `RoadmapReview.removedFeatures` (a required domain field) needs a real source rather than
   * being force-fit out of `roadmapChanges`'s freeform prose.
   */
  removedFeatures?: string[];

  futureVision?: string[];
  dependencyAnalysis?: string[];

  /**
   * Also not one of the ten named sections — `assumptions` is a standard planning field this
   * codebase's own `CurrentMvpPlan.assumptions` (prompts/productOwner.ts) already produces;
   * reused here for the same reason, not invented.
   */
  assumptions?: string[];

  businessRisks?: string[];
  technicalRisks?: string[];
  releaseRecommendation?: string;
}

export interface RoadmapReviewOutputFieldConfig {
  key: keyof ProductOwnerRoadmapOutput;
  label: string;
  kind: 'text' | 'list';
}

/**
 * Single source of truth for the output's shape — drives the JSON contract described to the AI
 * below and `roadmapReviewEngine.parseAnalysis`'s field-by-field extraction. Add a field here
 * once and every consumer picks it up automatically (same discipline `PRODUCT_REVIEW_OUTPUT_FIELDS`
 * established).
 */
export const ROADMAP_REVIEW_OUTPUT_FIELDS: RoadmapReviewOutputFieldConfig[] = [
  { key: 'executiveSummary', label: 'Executive Summary', kind: 'text' },
  { key: 'roadmapChanges', label: 'Roadmap Changes', kind: 'list' },
  { key: 'featurePriorities', label: 'Feature Priorities', kind: 'list' },
  { key: 'mvp2CandidateScope', label: 'MVP2 Candidate Scope', kind: 'list' },
  { key: 'deferredScope', label: 'Deferred Scope', kind: 'list' },
  { key: 'removedFeatures', label: 'Removed Features', kind: 'list' },
  { key: 'futureVision', label: 'Future Vision', kind: 'list' },
  { key: 'dependencyAnalysis', label: 'Dependency Analysis', kind: 'list' },
  { key: 'assumptions', label: 'Assumptions', kind: 'list' },
  { key: 'businessRisks', label: 'Business Risks', kind: 'list' },
  { key: 'technicalRisks', label: 'Technical Risks', kind: 'list' },
  { key: 'releaseRecommendation', label: 'Release Recommendation', kind: 'text' },
];

export const PRODUCT_OWNER_ROADMAP_REVIEW_SYSTEM_PROMPT = `You are the AI Product Owner working inside Builders, an AI Software Factory, conducting a Roadmap Review after a Business Analyst Product Review has been approved.

Your job is to decide what ships next — never to engineer it:
- Do NOT write or suggest code, database schema, API design, or any implementation detail.
- Do NOT generate engineering tasks — that begins only after this roadmap is itself approved and Gate A runs (out of scope for you).
- You consume ONLY the approved Product Review you are given — never raw customer feedback, support tickets, or analytics directly. If the Product Review's evidence is thin on some point, say so in openQuestions-style language inside your Executive Summary rather than inventing signal you weren't given.

Your decision-making process, in order (same discipline you already apply when planning any MVP):
1. Respect the DEPENDENCY GRAPH — no feature may be scheduled before every feature it depends on. This is a hard constraint, not a preference.
2. Among equally-schedulable features, rank by VALUE DENSITY (customer value relative to implementation complexity), not value in isolation.
3. Bound the next MVP by "the smallest coherent slice that responds to what the Product Review surfaced", not a fixed feature count.
4. Every deviation from the existing roadmap (a feature added, removed, deferred, or reprioritized relative to what was already sketched) belongs in "Roadmap Changes" — never a silent rewrite of the roadmap with no explanation.

Prioritization: use MoSCoW (Must Have / Should Have / Could Have / Won't Have) language in "Feature Priorities" and Critical/High/Medium/Low for risk severity — never mix the two vocabularies.

Respond with ONLY a single JSON object matching the requested shape exactly — no markdown code fences, no commentary before or after it.`;

const JSON_SHAPE = `{
${ROADMAP_REVIEW_OUTPUT_FIELDS.map(formatJsonShapeField).join(',\n')}
}`;

/**
 * Assembles the user-facing prompt from an already-gathered `RoadmapReviewContext` (see
 * `roadmapReviewEngine.buildRoadmapReviewContext`). Never fetches or gathers data itself.
 */
export function buildRoadmapReviewUserPrompt(context: RoadmapReviewContext): string {
  return `Project: ${context.project.name}${context.project.description ? ` — ${context.project.description}` : ''}
${context.project.productVision ? `Product Vision: ${context.project.productVision}` : ''}

Released MVP under review: ${context.sourceMvp.code ?? context.sourceMvp.theme ?? `MVP sequence ${context.sourceMvp.sequence}`}${context.sourceMvp.theme ? ` — ${context.sourceMvp.theme}` : ''}

Approved Product Review (the ONLY feedback source you may use):
- Summary: ${context.productReview.summary ?? 'None provided'}
- Business Risks: ${formatList(context.productReview.businessRisks)}
- Opportunities: ${formatList(context.productReview.opportunities)}
- Feature Requests: ${formatList(context.productReview.featureRequests)}
- Technical Concerns: ${formatList(context.productReview.technicalConcerns)}
- Recommendations: ${formatList(context.productReview.recommendations)}

Existing Product Roadmap (skeleton — future MVPs beyond the one you are planning stay lightweight, do not re-plan them):
${context.roadmapSkeleton.length > 0 ? context.roadmapSkeleton.map((entry) => `- MVP${entry.sequence}: ${entry.theme}${entry.targetRelease ? ` (target ${entry.targetRelease})` : ''}`).join('\n') : 'No roadmap skeleton recorded.'}

You are planning: MVP${context.targetRoadmapEntry.sequence} — "${context.targetRoadmapEntry.theme}"${context.targetRoadmapEntry.targetRelease ? ` (target ${context.targetRoadmapEntry.targetRelease})` : ''}

Current Features across the product so far:
${context.currentFeatures.length > 0 ? context.currentFeatures.map((feature) => `- ${feature.code} (${feature.moduleSlug}): ${feature.title}`).join('\n') : 'No Features recorded yet.'}

Return ONLY a JSON object with exactly these keys (use empty arrays/strings where genuinely unknown, do not omit any key):

${JSON_SHAPE}`;
}
